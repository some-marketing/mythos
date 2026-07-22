#!/usr/bin/env node
'use strict';

/**
 * write-canonical-entry.js
 *
 * Canonical memory writer for the Topological Sovereignty layer.
 * Anchor concept: _dev/concepts/topological-sovereignty-memory/concept.md
 *
 * Load-bearing invariant:
 *   No cache may accept a write that this writer cannot receipt.
 *
 * Flow:
 *   1. Preflight: canonical layer reachable (entries dir + ledger writable).
 *      If not -> exit code 3, error code CANONICAL_UNREACHABLE, no writes.
 *   2. Build typed entry, compute sha256(body) as content_hash.
 *   3. Atomic write to _dev/state/kernel-memory/entries/<id>.json
 *      (tmp + fsync + rename, same filesystem).
 *   4. Append ledger event via tools/memory/append-ledger-entry.js.
 *   5. If ledger append fails, unlink the entry file -> no orphan.
 *   6. Patch the entry to bind the ledger_event_id (receipt).
 *   7. Emit receipt JSON on stdout.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const { parseArgs } = require('../workspace/lib/args');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
// CAT_MEMORY_ROOT: test/override hook so acceptance tests can run hermetically
// against a temp canonical store instead of the real one (the canonical paths
// are otherwise hardcoded, which made the writer untestable in isolation).
// Defaults to PROJECT_ROOT. The spawned appender inherits this env and honors it too.
const MEMORY_ROOT = process.env.CAT_MEMORY_ROOT ? path.resolve(process.env.CAT_MEMORY_ROOT) : PROJECT_ROOT;
const ENTRIES_DIR = path.join(MEMORY_ROOT, '_dev/state/kernel-memory/entries');
const LEDGER_PATH = path.join(MEMORY_ROOT, '_dev/state/memory-ledger.jsonl');
const LEDGER_DIR = path.dirname(LEDGER_PATH);
const APPEND_LEDGER = path.join(PROJECT_ROOT, 'tools/memory/append-ledger-entry.js');

const SCHEMA_VERSION = '1';
const TYPES = ['user', 'feedback', 'project', 'reference'];
const ANCHOR_PREFIXES = ['commit:', 'path:', 'signal:', 'concept:', 'transcript:', 'operator-instruction:'];
const ACTORS = ['claude', 'codex', 'gemini', 'operator', 'human', 'cron', 'other'];

const EXIT = {
  USAGE: 2,
  CANONICAL_UNREACHABLE: 3,
  VALIDATION: 4,
  LEDGER_FAILED: 5,
  IO: 6
};

function help() {
  console.log(`
Write a canonical memory entry to ${path.relative(PROJECT_ROOT, ENTRIES_DIR)}
and append a paired event to the memory ledger. Refuses to write if the
canonical layer is unreachable. No partial writes; no orphan entries.

Usage:
  node tools/memory/write-canonical-entry.js [options]

Required:
  --type             user|feedback|project|reference
  --title            Short title (≤200 chars)
  --anchor-ref       <prefix>:<ref>   prefixes: ${ANCHOR_PREFIXES.map(p => p.replace(':','')).join(', ')}
  --source-artifact  Origin descriptor — e.g. "chat:2026-05-14"

Body source (exactly one):
  --body             Inline body string
  --body-file        Path to file whose contents become the body
  --body-stdin       Read body from stdin

Optional:
  --id               Override id. Default: ulid-shaped timestamp+random.
  --supersedes       Prior canonical entry id this entry supersedes.
  --actor            ${ACTORS.join('|')}  Default: claude
  --tags             Comma-separated tags
  --dry-run          Print the entry and ledger args without writing
  --help             Show this help

Exit codes:
  0   success
  2   usage error
  3   CANONICAL_UNREACHABLE — canonical layer not writable
  4   validation error
  5   ledger append failed (entry unlinked; no orphan)
  6   io error
`.trim());
}

function fail(code, msg, extra) {
  const payload = { error: code, message: msg };
  if (extra) Object.assign(payload, extra);
  process.stderr.write(JSON.stringify(payload) + '\n');
  process.exit(typeof code === 'number' ? code : EXIT.USAGE);
}

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function generateId() {
  const ts = isoNow().replace(/[:T]/g, '-').replace(/Z$/, 'Z');
  const ms = String(Date.now() % 1000).padStart(3, '0');
  const rand = crypto.randomBytes(4).toString('hex');
  return `${ts}-${ms}-${rand}`.toLowerCase();
}

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function preflightCanonical() {
  // The invariant: canonical layer reachable, or refuse.
  try {
    if (!fs.existsSync(ENTRIES_DIR)) {
      fail(EXIT.CANONICAL_UNREACHABLE, 'CANONICAL_UNREACHABLE', {
        reason: 'entries_dir_missing',
        path: ENTRIES_DIR
      });
    }
    const stat = fs.statSync(ENTRIES_DIR);
    if (!stat.isDirectory()) {
      fail(EXIT.CANONICAL_UNREACHABLE, 'CANONICAL_UNREACHABLE', {
        reason: 'entries_dir_not_directory',
        path: ENTRIES_DIR
      });
    }
    fs.accessSync(ENTRIES_DIR, fs.constants.W_OK);
    if (!fs.existsSync(LEDGER_DIR)) {
      fail(EXIT.CANONICAL_UNREACHABLE, 'CANONICAL_UNREACHABLE', {
        reason: 'ledger_dir_missing',
        path: LEDGER_DIR
      });
    }
    fs.accessSync(LEDGER_DIR, fs.constants.W_OK);
    if (fs.existsSync(LEDGER_PATH)) {
      fs.accessSync(LEDGER_PATH, fs.constants.W_OK);
    }
    if (!fs.existsSync(APPEND_LEDGER)) {
      fail(EXIT.CANONICAL_UNREACHABLE, 'CANONICAL_UNREACHABLE', {
        reason: 'ledger_writer_missing',
        path: APPEND_LEDGER
      });
    }
  } catch (err) {
    if (err && typeof err.code === 'string' && err.code.startsWith('CANONICAL')) throw err;
    fail(EXIT.CANONICAL_UNREACHABLE, 'CANONICAL_UNREACHABLE', {
      reason: 'preflight_io_error',
      detail: err.message
    });
  }
}

function loadBody(args) {
  const sources = ['body', 'body_file', 'body_stdin'].filter(k => args[k]);
  if (sources.length !== 1) {
    fail(EXIT.USAGE, 'exactly one of --body, --body-file, --body-stdin required');
  }
  if (args.body) return String(args.body);
  if (args.body_file) {
    const p = path.resolve(args.body_file);
    if (!fs.existsSync(p)) fail(EXIT.IO, `--body-file not found: ${p}`);
    return fs.readFileSync(p, 'utf8');
  }
  // body_stdin
  return fs.readFileSync(0, 'utf8');
}

function validateEntry(entry) {
  if (!TYPES.includes(entry.type)) {
    fail(EXIT.VALIDATION, `type must be one of: ${TYPES.join(', ')}`);
  }
  if (!entry.title || entry.title.length > 200) {
    fail(EXIT.VALIDATION, 'title required, ≤200 chars');
  }
  if (!entry.body || entry.body.length === 0) {
    fail(EXIT.VALIDATION, 'body required');
  }
  if (!ANCHOR_PREFIXES.some(p => entry.anchor_ref.startsWith(p))) {
    fail(EXIT.VALIDATION, `anchor_ref must start with one of: ${ANCHOR_PREFIXES.join(', ')}`);
  }
  if (!entry.source_artifact) {
    fail(EXIT.VALIDATION, 'source_artifact required');
  }
  if (entry.actor && !ACTORS.includes(entry.actor)) {
    fail(EXIT.VALIDATION, `actor must be one of: ${ACTORS.join(', ')}`);
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(entry.id)) {
    fail(EXIT.VALIDATION, 'id must match ^[a-z0-9][a-z0-9_-]{0,127}$');
  }
}

function atomicWrite(entryPath, payload) {
  const tmp = `${entryPath}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  const fd = fs.openSync(tmp, 'w', 0o644);
  try {
    fs.writeFileSync(fd, payload);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, entryPath);
}

function appendLedger(entry) {
  // Compose, do not duplicate. Shell out to append-ledger-entry.js.
  // Use the canonical repo-relative path as memory_file so the ledger row
  // points at canonical truth, not a harness pocket.
  const memoryFile = path.relative(MEMORY_ROOT, path.join(ENTRIES_DIR, `${entry.id}.json`));
  const args = [
    APPEND_LEDGER,
    '--event', 'create',
    '--memory-file', memoryFile,
    '--memory-type', entry.type,
    '--conversion-state', 'raw_capture',
    '--anchor-ref', entry.anchor_ref,
    '--source-artifact', entry.source_artifact,
    '--content-hash', entry.content_hash,
    '--actor', entry.actor || 'claude',
    '--notes', `canonical-entry:${entry.id}`
  ];
  if (entry.supersedes) {
    // D1 (2026-06-04): a supersession is ONE `create` event that CARRIES a
    // `supersedes` ref — NOT a second `--event supersede`. A duplicate --event
    // flag is overwritten by the appender's arg parser (last wins), silently
    // turning the create into a bare supersede and losing the create semantics
    // (the entry is new content AND a supersession). The appender records
    // `supersedes` on any event and only *requires* it for event=supersede, so
    // create+supersedes is valid and atomic: one entry = one ledger row = one receipt.
    args.push('--supersedes', entry.supersedes);
  }
  const res = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (res.status !== 0) {
    return { ok: false, stdout: res.stdout, stderr: res.stderr, status: res.status };
  }
  // append-ledger-entry.js prints "appended: <event_id>" on success.
  const m = /appended:\s*(\S+)/.exec(res.stdout || '');
  return { ok: true, event_id: m ? m[1] : null, stdout: res.stdout };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { help(); return; }

  // Step 1: preflight first — canonical-unreachable refuses without touching disk.
  preflightCanonical();

  const body = loadBody(args);
  const id = String(args.id || generateId());
  const entry = {
    id,
    schema_version: SCHEMA_VERSION,
    type: args.type,
    title: args.title,
    body,
    anchor_ref: args.anchor_ref,
    source_artifact: args.source_artifact,
    created_ts: isoNow(),
    content_hash: sha256(body),
    supersedes: args.supersedes || null,
    actor: args.actor || 'claude',
    tags: args.tags ? String(args.tags).split(',').map(s => s.trim()).filter(Boolean) : [],
    ledger_event_id: null
  };
  validateEntry(entry);

  const entryPath = path.join(ENTRIES_DIR, `${entry.id}.json`);

  if (args.dry_run) {
    process.stdout.write(JSON.stringify({ dry_run: true, entry, entry_path: entryPath }, null, 2) + '\n');
    return;
  }

  if (fs.existsSync(entryPath)) {
    fail(EXIT.VALIDATION, `entry id collision: ${entry.id}`);
  }

  // Step 3: atomic write of the entry.
  try {
    atomicWrite(entryPath, JSON.stringify(entry, null, 2) + '\n');
  } catch (err) {
    fail(EXIT.IO, `entry write failed: ${err.message}`);
  }

  // Step 4: paired ledger append. If it fails, unlink the entry -> no orphan.
  const ledger = appendLedger(entry);
  if (!ledger.ok) {
    try { fs.unlinkSync(entryPath); } catch (_) { /* best effort */ }
    fail(EXIT.LEDGER_FAILED, 'ledger append failed; entry unlinked to preserve no-orphan invariant', {
      ledger_status: ledger.status,
      ledger_stderr: ledger.stderr
    });
  }

  // Step 6: bind the ledger receipt back into the entry.
  entry.ledger_event_id = ledger.event_id;
  try {
    atomicWrite(entryPath, JSON.stringify(entry, null, 2) + '\n');
  } catch (err) {
    // Don't unlink — the ledger record is durable; the receipt-binding is a
    // best-effort patch. Surface the divergence.
    process.stderr.write(JSON.stringify({
      warning: 'receipt_binding_failed',
      entry_path: entryPath,
      ledger_event_id: ledger.event_id,
      detail: err.message
    }) + '\n');
  }

  const receipt = {
    ok: true,
    id: entry.id,
    path: path.relative(PROJECT_ROOT, entryPath),
    content_hash: entry.content_hash,
    ledger_event_id: ledger.event_id,
    created_ts: entry.created_ts
  };
  process.stdout.write(JSON.stringify(receipt) + '\n');
}

main();
