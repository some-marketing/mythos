#!/usr/bin/env node
'use strict';

/**
 * Append a validated entry to _dev/state/memory-ledger.jsonl.
 *
 * Schema source: _dev/state/memory-ledger.README.md
 * Schema doc:    _dev/concepts/memory-anchor-schema.md
 *
 * The helper enforces:
 *   - required fields present and non-empty
 *   - enum fields match allowed values
 *   - anchor_ref carries a recognized prefix
 *   - content_hash auto-computed when memory_file points at an existing file
 *   - event_id auto-generated if not supplied (ts-slug shape)
 *   - ts auto-set to now-UTC if not supplied
 *   - session_id auto-detected from _dev/state/active-sessions/ if not supplied
 *
 * It does NOT mutate the memory file itself. Callers are responsible for
 * actually writing the memory; this helper only records the event.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { parseArgs } = require('../workspace/lib/args');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
// CAT_MEMORY_ROOT: honor the same test/override root as write-canonical-entry.js
// so the writer→appender chain stays consistent under hermetic acceptance tests.
const MEMORY_ROOT = process.env.CAT_MEMORY_ROOT ? path.resolve(process.env.CAT_MEMORY_ROOT) : PROJECT_ROOT;
const LEDGER_PATH = path.join(MEMORY_ROOT, '_dev/state/memory-ledger.jsonl');
const ACTIVE_SESSIONS_DIR = path.join(PROJECT_ROOT, '_dev/state/active-sessions');
const MEMORY_DIR = path.resolve(
  process.env.HOME,
  '.claude/projects/{PROJECT_SLUG}/memory'
);

const EVENTS = ['create', 'supersede', 'retire', 'reconcile', 'classify'];
const TYPES = ['user', 'feedback', 'project', 'reference'];
const STATES = [
  'raw_capture',
  'reconciled',
  'action_queued',
  'consumed_into_plan',
  'converted_to_test',
  'converted_to_command_or_spec',
  'archived_context_only',
  'deferred_with_trigger'
];
const ANCHOR_PREFIXES = [
  'commit:',
  'path:',
  'signal:',
  'concept:',
  'transcript:',
  'operator-instruction:'
];
const ACTORS = ['claude', 'codex', 'gemini', 'operator', 'human', 'cron', 'other'];

function help() {
  console.log(`
Append a validated memory-ledger entry to ${path.relative(PROJECT_ROOT, LEDGER_PATH)}.

Usage:
  node tools/memory/append-ledger-entry.js [options]

Required:
  --event              create|supersede|retire|reconcile|classify
  --memory-file        Filename relative to memory dir (or _META_ token for non-file events)
  --memory-type        user|feedback|project|reference
  --conversion-state   ${STATES.join('|')}
  --anchor-ref         <prefix>:<ref>  prefix one of: ${ANCHOR_PREFIXES.map(p => p.replace(':','')).join(', ')}
  --source-artifact    Origin descriptor, e.g. "chat:2026-04-29" or "debrief:<run-id>"

Optional:
  --supersedes         Prior memory_file (for event=supersede). Default null.
  --actor              ${ACTORS.join('|')}  Default: claude
  --notes              Free-form context, ≤200 chars
  --session-id         Override session id (default: auto-detect from active-sessions)
  --event-id           Override event id (default: auto-generated)
  --ts                 Override timestamp (default: now-UTC)
  --content-hash       Override content hash (default: auto-computed if memory_file exists)
  --no-hash            Skip content hash even when file exists
  --dry-run            Print the line without appending
  --help               Show this help
`.trim());
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(2);
}

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function autoEventId(ts, memoryFile, event) {
  // Add ms + 4-char random suffix to avoid collisions when two entries for the
  // same {memory_file, event} land in the same second (per Codex review 2026-04-29).
  const stamp = ts.replace(/[:T]/g, '-').replace(/Z$/, 'Z');
  const ms = String(Date.now() % 1000).padStart(3, '0');
  const rand = crypto.randomBytes(2).toString('hex');
  return `${stamp}-${ms}-${rand}-${slugify(event + '-' + memoryFile)}`;
}

function detectSessionId() {
  try {
    const files = fs.readdirSync(ACTIVE_SESSIONS_DIR)
      .filter(f => /^[0-9a-f-]{36}\.json$/.test(f));
    if (files.length === 1) return files[0].replace(/\.json$/, '');
    if (files.length > 1) {
      const newest = files
        .map(f => ({ f, m: fs.statSync(path.join(ACTIVE_SESSIONS_DIR, f)).mtimeMs }))
        .sort((a, b) => b.m - a.m)[0];
      return newest.f.replace(/\.json$/, '');
    }
  } catch (_) { /* ignore */ }
  return 'unknown-session';
}

function stripFrontmatter(text) {
  // Require closing delimiter on its own line so YAML body containing "---"
  // (e.g. inside a multi-line string) doesn't terminate stripping early.
  // Per Codex review 2026-04-29.
  if (!/^---\r?\n/.test(text)) return text;
  const m = text.match(/\n---\r?\n/);
  if (!m) return text;
  return text.slice(m.index + m[0].length);
}

function computeContentHash(memoryFile) {
  if (!memoryFile || memoryFile.startsWith('_') && memoryFile.endsWith('_')) return null;
  const full = path.join(MEMORY_DIR, memoryFile);
  if (!fs.existsSync(full)) return null;
  const body = stripFrontmatter(fs.readFileSync(full, 'utf8'));
  return crypto.createHash('sha256').update(body).digest('hex');
}

function validate(entry) {
  const required = ['event', 'memory_file', 'memory_type', 'conversion_state', 'anchor_ref', 'source_artifact'];
  for (const k of required) {
    if (!entry[k] || String(entry[k]).trim() === '') fail(`missing required field: ${k}`);
  }
  if (!EVENTS.includes(entry.event)) fail(`event must be one of: ${EVENTS.join(', ')}`);
  if (!TYPES.includes(entry.memory_type)) fail(`memory_type must be one of: ${TYPES.join(', ')}`);
  if (!STATES.includes(entry.conversion_state)) fail(`conversion_state must be one of: ${STATES.join(', ')}`);
  if (!ANCHOR_PREFIXES.some(p => entry.anchor_ref.startsWith(p))) {
    fail(`anchor_ref must start with one of: ${ANCHOR_PREFIXES.join(', ')}`);
  }
  if (entry.actor && !ACTORS.includes(entry.actor)) fail(`actor must be one of: ${ACTORS.join(', ')}`);
  if (entry.notes && entry.notes.length > 200) fail('notes must be ≤200 chars');
  if (entry.event === 'supersede' && !entry.supersedes) fail('event=supersede requires --supersedes');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { help(); return; }

  const ts = args.ts || isoNow();
  const memoryFile = args.memory_file;
  if (!memoryFile) { help(); fail('--memory-file is required'); }

  let contentHash = null;
  if (args.content_hash) contentHash = args.content_hash;
  else if (!args.no_hash) contentHash = computeContentHash(memoryFile);

  const entry = {
    event_id: args.event_id || autoEventId(ts, memoryFile, args.event || 'unknown'),
    ts,
    event: args.event,
    memory_file: memoryFile,
    memory_type: args.memory_type,
    conversion_state: args.conversion_state,
    anchor_ref: args.anchor_ref,
    source_artifact: args.source_artifact,
    content_hash: contentHash,
    supersedes: args.supersedes || null,
    session_id: args.session_id || detectSessionId(),
    actor: args.actor || 'claude',
    notes: args.notes || null
  };

  validate(entry);

  const line = JSON.stringify(entry) + '\n';

  if (args.dry_run) {
    process.stdout.write(line);
    return;
  }

  fs.appendFileSync(LEDGER_PATH, line);
  console.log(`appended: ${entry.event_id}`);
}

main();
