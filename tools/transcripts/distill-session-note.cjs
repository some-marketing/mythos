#!/usr/bin/env node
'use strict';

/**
 * distill-session-note.cjs — distill a harness session JSONL into a
 * schema-conforming session note (see tools/memory/schemas/session-note.schema.json
 * if your guild ports the memory scaffold).
 *
 * This is a genericized STUB of the pattern, not a full private-governance
 * port. The source this was extracted from wrapped every read of a session
 * transcript in an elaborate operator-ratification-receipt system (a private
 * substrate-introspection rule specific to one guild's governance model) and
 * hardcoded that guild's operator name and brand tag into the note template.
 * None of that ships here. What's kept is the load-bearing PATTERN:
 *
 *   1. Session JSONL is potentially sensitive (it may contain anything a
 *      session touched) — reading it should be a deliberate, explicit act,
 *      not an incidental one. This stub requires an explicit --i-understand
 *      flag before it reads anything; build your own consent/ratification
 *      gate in front of this if your guild needs one.
 *   2. Extract everything MECHANICALLY determinable (session_id, timestamps,
 *      model, cwd, turn count, files touched) — never let judgment fields
 *      (summary, decisions, outcome) come from an automated read of the
 *      transcript itself. Those come from the invoking operator/agent via
 *      flags, exactly as in the source design.
 *   3. Lint the generated note against a schema before writing it, and
 *      before that, run it through whatever credential/secret-pattern lint
 *      your guild has (this stub's lint step is a no-op placeholder —
 *      wire in your own).
 *
 * Usage:
 *   node tools/transcripts/distill-session-note.cjs \
 *     --jsonl <path> --i-understand \
 *     --summary "..." [--outcome "..."] [--context "..."] \
 *     [--decision "..."]... [--scope system] [--slug my-session] \
 *     [--preview] [--dry-run]
 *
 *   --preview   print a bounded prose preview (first/last turns) and exit.
 *               No note written.
 *
 * Stdlib-only. Exit 0 on success; non-zero on any gate refusal.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(REPO_ROOT, '_dev', 'state');

function die(msg, code) {
  process.stderr.write(`distill-session-note: ${msg}\n`);
  process.exit(code === undefined ? 1 : code);
}

function parseArgs(argv) {
  const a = {
    jsonl: null, summary: null, outcome: null, context: null, decisions: [],
    scope: 'system', slug: null, preview: false, dryRun: false, understand: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const f = argv[i];
    const next = () => argv[++i];
    if (f === '--jsonl') a.jsonl = next();
    else if (f === '--summary') a.summary = next();
    else if (f === '--outcome') a.outcome = next();
    else if (f === '--context') a.context = next();
    else if (f === '--decision') a.decisions.push(next());
    else if (f === '--scope') a.scope = next();
    else if (f === '--slug') a.slug = next();
    else if (f === '--preview') a.preview = true;
    else if (f === '--dry-run') a.dryRun = true;
    else if (f === '--i-understand') a.understand = true;
    else die(`unknown flag ${f}`);
  }
  return a;
}

/** Mechanical-only lint: replace with your own secret/credential-pattern scan. */
function lintNote(_text) {
  return { ok: true, reason: null };
}

/** Read + mechanically parse the session JSONL. Extracts structure only —
 * no judgment, no summarization, no LLM call. */
function parseSessionJsonl(jsonlPath) {
  const raw = fs.readFileSync(jsonlPath, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  const turns = [];
  let sessionId = null, cwd = null, version = null, model = null;
  let firstTs = null, lastTs = null;
  const filesTouched = new Set();
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch (_) { continue; }
    if (e.sessionId && !sessionId) sessionId = e.sessionId;
    if (e.cwd && !cwd) cwd = e.cwd;
    if (e.version && !version) version = e.version;
    if (e.timestamp) {
      if (!firstTs) firstTs = e.timestamp;
      lastTs = e.timestamp;
    }
    const msg = e.message;
    if (!msg || !msg.role) continue;
    if (msg.model && !model) model = msg.model;
    const content = msg.content;
    let text = '';
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && block.text) text += block.text + '\n';
        if (block.type === 'tool_use' && block.input) {
          const fp = block.input.file_path || block.input.path || null;
          if (fp) filesTouched.add(fp);
        }
      }
    }
    text = text.trim();
    if (text) turns.push({ role: msg.role, text });
  }
  return { sessionId, cwd, version, model, firstTs, lastTs, turns, filesTouched: [...filesTouched].sort(), lineCount: lines.length };
}

function buildNote(args, parsed, todayIso) {
  const date = (parsed.firstTs || todayIso).slice(0, 10);
  const fmLines = [
    '---',
    'type: llm_session',
    'schema_version: SessionNote/1.0',
    `date: ${date}`,
    `model: ${parsed.model || 'null'}`,
    `scope: ${args.scope}`,
    `session_id: ${parsed.sessionId || 'null'}`,
    'source_artifacts:',
    `  - ${path.relative(REPO_ROOT, path.resolve(args.jsonl)).startsWith('..') ? path.resolve(args.jsonl).replace(os.homedir(), '~') : path.relative(REPO_ROOT, path.resolve(args.jsonl))}`,
    `termination_status: ${args.outcome ? 'clean' : 'unknown'}`,
    'writer: tools/transcripts/distill-session-note.cjs',
    `started_at: ${parsed.firstTs || 'null'}`,
    `ended_at: ${parsed.lastTs || 'null'}`,
    'tags:',
    '  - session-transcript',
    '  - distilled',
    `summary: ${String(args.summary).replace(/\n/g, ' ')}`,
    `outcome: ${args.outcome ? String(args.outcome).replace(/\n/g, ' ') : 'null'}`,
    '---',
  ];
  const body = [
    '',
    `# Session Note — ${date} — ${args.slug || parsed.sessionId || 'session'}`,
    '',
    '## Context',
    '',
    args.context || '(not supplied — see source artifacts)',
    '',
    '## Decisions',
    '',
    ...(args.decisions.length ? args.decisions.map((d) => `- ${d}`) : ['- (none recorded)']),
    '',
    '## Actions',
    '',
    `- ${parsed.turns.length} prose turns over ${parsed.lineCount} JSONL records (${parsed.firstTs || '?'} → ${parsed.lastTs || '?'}).`,
    ...(parsed.cwd ? [`- Working directory: ${parsed.cwd}`] : []),
    '',
    '## Artifacts',
    '',
    ...(parsed.filesTouched.length
      ? parsed.filesTouched.map((f) => `- \`${f}\``)
      : ['- (no file mutations recorded in source)']),
    '',
  ];
  return fmLines.concat(body).join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.jsonl) die('--jsonl <path> is required');
  if (!fs.existsSync(args.jsonl)) die(`source not found: ${args.jsonl}`);

  if (!args.understand) {
    die('GATE REFUSAL: session JSONL may contain anything a session touched. Pass --i-understand to confirm you intend to read this file. Build your own consent/ratification gate in front of this stub if your guild needs one.');
  }

  const parsed = parseSessionJsonl(args.jsonl);

  if (args.preview) {
    // Bounded prose preview — read the actual prose, don't judge from
    // keyword counts. First 3 + last 3 prose turns, capped.
    const head = parsed.turns.slice(0, 3);
    const tail = parsed.turns.length > 6 ? parsed.turns.slice(-3) : parsed.turns.slice(head.length);
    const cap = (t) => (t.length > 600 ? t.slice(0, 600) + ' …' : t);
    process.stdout.write(`# preview — ${args.jsonl}\n`);
    process.stdout.write(`# session_id=${parsed.sessionId} turns=${parsed.turns.length} ${parsed.firstTs} → ${parsed.lastTs}\n\n`);
    for (const t of head) process.stdout.write(`[${t.role}] ${cap(t.text)}\n\n`);
    if (parsed.turns.length > 6) process.stdout.write(`… ${parsed.turns.length - 6} turns elided …\n\n`);
    for (const t of tail) process.stdout.write(`[${t.role}] ${cap(t.text)}\n\n`);
    return;
  }

  if (!args.summary) die('--summary is required (a judgment field from the classifying reader, not derived automatically)');

  const note = buildNote(args, parsed, new Date().toISOString());

  const lint = lintNote(note);
  if (!lint.ok) {
    die(`GATE REFUSAL: note lint failed — NOTHING WRITTEN.\n${lint.reason}`);
  }

  const date = (parsed.firstTs || new Date().toISOString()).slice(0, 10);
  const slug = args.slug || (parsed.sessionId ? parsed.sessionId.slice(0, 8) : 'session');
  const outPath = path.join(OUT_DIR, `${date}__${slug}.md`);

  if (args.dryRun) {
    process.stdout.write(note);
    process.stderr.write(`\ndry-run: would write ${path.relative(REPO_ROOT, outPath)}\n`);
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(outPath, note);
  process.stdout.write(`${path.relative(REPO_ROOT, outPath)}\n`);
}

main();
