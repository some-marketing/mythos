#!/usr/bin/env node
'use strict';

/**
 * distill-session-note.cjs — distill a harness session JSONL into a
 * schema-conforming session note on the vault-mirrored repo surface.
 *
 * Plan: memory-dreaming-obsidian-improvements (step mdoi-claude-session-distill)
 * Binding gates (amendment 20260610T111449Z, AMD-1 + base step gates):
 *   (a) Session-JSONL substrates are PRIVATE LOCAL SUBSTRATES. Source selection
 *       and ALL reads (including classification reads) route through
 *       instructions/canonical/private-surface-introspection-rule.yaml:
 *       this tool refuses to read any source without a task-specific operator
 *       ratification receipt (--ratification <receipt.json>) naming the
 *       substrate, the bounded source, and retention of the distilled note on
 *       the vault-mirrored repo surface. No standing allowance exists
 *       (re-review rerev-mdoi-001) — every run needs a receipt.
 *   (b) First distillation restricted to a SYSTEM-classified session.
 *   (c) PERSONAL-classified sessions are excluded by default; the receipt must
 *       carry allow_personal: true (explicit operator allowance) to override.
 *   (d) privacy_classification is a judgment made by READING PROSE TURNS, not
 *       keyword counts (jsonl-grep-counts-misleading). This tool does not
 *       classify; the operator/agent classifies from --preview output (itself
 *       receipt-gated) and passes --classification explicitly.
 *   (e) S4 credential lint: the generated note is piped through
 *       tools/memory/contextual-inject-lint.cjs sentinel patterns BEFORE any
 *       write; any hit aborts with no file written.
 *   (f) No automatic hook wiring — manual invocation only.
 *
 * Every permitted run writes a search receipt
 * (_dev/reports/analysis/private-surface-receipts/) per the rule's
 * receipt_fields.
 *
 * Mechanical-first: the tool extracts everything mechanically determinable
 * (session_id, timestamps, model, cwd, turn counts, files touched). Judgment
 * fields (summary, outcome, decisions, context) come from the invoking
 * operator/agent via flags — this tool performs no LLM calls.
 *
 * Usage:
 *   node tools/transcripts/distill-session-note.cjs \
 *     --jsonl <path> --ratification <receipt.json> \
 *     --classification SYSTEM --summary "..." [--outcome "..."] \
 *     [--context "..."] [--decision "..."]... [--debrief <path>] \
 *     [--scope system] [--slug my-session] [--preview] [--dry-run]
 *
 *   --preview     print a bounded prose preview (first/last turns) for the
 *                 classification judgment, write a receipt, and exit. No note.
 *   --fixture     allow a synthetic /tmp fixture without a receipt (testing
 *                 only; refuses real substrate paths).
 *
 * Stdlib-only. Exit 0 on success; non-zero on any gate refusal.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(REPO_ROOT, '_dev', 'state');
const RECEIPTS_DIR = path.join(REPO_ROOT, '_dev', 'reports', 'analysis', 'private-surface-receipts');
const S4_LINT = path.join(REPO_ROOT, 'tools', 'memory', 'contextual-inject-lint.cjs');
const NOTE_LINT = path.join(REPO_ROOT, 'tools', 'transcripts', 'lint-session-notes.cjs');
const RULE_PATH = 'instructions/canonical/private-surface-introspection-rule.yaml';

// Known private session-JSONL substrate roots (rerev-mdoi-001).
const PRIVATE_SUBSTRATE_ROOTS = [
  path.join(os.homedir(), '.claude', 'projects'),
  path.join(REPO_ROOT, '_dev', 'desktop'),
];

function die(msg, code) {
  process.stderr.write(`distill-session-note: ${msg}\n`);
  process.exit(code === undefined ? 1 : code);
}

function parseArgs(argv) {
  const a = {
    jsonl: null, ratification: null, classification: null,
    summary: null, outcome: null, context: null, decisions: [],
    debrief: null, scope: 'system', slug: null,
    preview: false, dryRun: false, fixture: false,
    parentSession: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const f = argv[i];
    const next = () => argv[++i];
    if (f === '--jsonl') a.jsonl = next();
    else if (f === '--ratification') a.ratification = next();
    else if (f === '--classification') a.classification = next();
    else if (f === '--summary') a.summary = next();
    else if (f === '--outcome') a.outcome = next();
    else if (f === '--context') a.context = next();
    else if (f === '--decision') a.decisions.push(next());
    else if (f === '--debrief') a.debrief = next();
    else if (f === '--scope') a.scope = next();
    else if (f === '--slug') a.slug = next();
    else if (f === '--parent-session') a.parentSession = next();
    else if (f === '--preview') a.preview = true;
    else if (f === '--dry-run') a.dryRun = true;
    else if (f === '--fixture') a.fixture = true;
    else die(`unknown flag ${f}`);
  }
  return a;
}

function isPrivateSubstratePath(p) {
  const real = fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p);
  return PRIVATE_SUBSTRATE_ROOTS.some((root) => real.startsWith(root + path.sep) || real === root);
}

/** Gate (a): validate the operator ratification receipt. */
function validateRatification(receiptPath, jsonlPath) {
  let r;
  try {
    r = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch (e) {
    die(`GATE REFUSAL (AMD-1a): ratification receipt unreadable: ${e.message}`);
  }
  const errs = [];
  if (r.schema !== 'PrivateSurfaceRatification/1.0') errs.push("schema must be 'PrivateSurfaceRatification/1.0'");
  if (!r.ratification_id) errs.push('ratification_id required');
  if (r.substrate !== 'session-jsonl') errs.push("substrate must be 'session-jsonl'");
  if (!r.ratified_by || !/operator|{OPERATOR_NAME}|human/i.test(String(r.ratified_by))) {
    errs.push('ratified_by must name the human operator');
  }
  if (!r.ratified_at) errs.push('ratified_at required');
  if (!Array.isArray(r.allowed_sources) || !r.allowed_sources.length) {
    errs.push('allowed_sources[] required (bounded source paths/globs)');
  } else {
    const real = path.resolve(jsonlPath);
    const ok = r.allowed_sources.some((src) => {
      const abs = path.resolve(String(src).replace(/^~\//, os.homedir() + '/'));
      return real === abs || real.startsWith(abs.replace(/\*+$/, ''));
    });
    if (!ok) errs.push(`source ${jsonlPath} is not within allowed_sources`);
  }
  if (r.retention !== 'schema-conforming note on vault-mirrored repo surface') {
    errs.push("retention must be exactly 'schema-conforming note on vault-mirrored repo surface' (no-repo-commit-of-private-output principle requires the retention decision in the ratification)");
  }
  if (errs.length) {
    die(`GATE REFUSAL (AMD-1a, ${RULE_PATH}): invalid ratification receipt:\n  - ${errs.join('\n  - ')}`);
  }
  return r;
}

/** Read + mechanically parse the session JSONL. */
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

function writeReceipt(fields) {
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const p = path.join(RECEIPTS_DIR, `${stamp}__session-jsonl-distill.json`);
  fs.writeFileSync(p, JSON.stringify(fields, null, 2) + '\n');
  return path.relative(REPO_ROOT, p);
}

function runS4Lint(text) {
  const res = spawnSync('node', [S4_LINT], { input: text, encoding: 'utf8' });
  return { code: res.status, stderr: res.stderr || '' };
}

function buildNote(args, parsed, todayIso) {
  const date = (parsed.firstTs || todayIso).slice(0, 10);
  const fmLines = [
    '---',
    'type: llm_session',
    'schema_version: SessionNote/1.0',
    `date: ${date}`,
    'agent: claude-code',
    `model: ${parsed.model || 'null'}`,
    'provider: anthropic',
    'platform: cli',
    `scope: ${args.scope}`,
    `session_id: ${parsed.sessionId || 'null'}`,
    `parent_session_id: ${args.parentSession || 'null'}`,
    'source_artifacts:',
    `  - ${path.relative(REPO_ROOT, path.resolve(args.jsonl)).startsWith('..') ? path.resolve(args.jsonl).replace(os.homedir(), '~') : path.relative(REPO_ROOT, path.resolve(args.jsonl))}`,
    ...(args.debrief ? [`  - ${args.debrief}`] : []),
    `termination_status: ${args.outcome ? 'clean' : 'unknown'}`,
    'writer: tools/transcripts/distill-session-note.cjs',
    `privacy_classification: ${args.classification}`,
    'human_operator: {OPERATOR_NAME}',
    `started_at: ${parsed.firstTs || 'null'}`,
    `ended_at: ${parsed.lastTs || 'null'}`,
    'tags:',
    '  - session-transcript',
    '  - mythos',
    '  - distilled',
    `summary: ${String(args.summary).replace(/\n/g, ' ')}`,
    `outcome: ${args.outcome ? String(args.outcome).replace(/\n/g, ' ') : 'null'}`,
    '---',
  ];
  const body = [
    '',
    `# Session Note — ${date} — claude-code — ${args.slug || parsed.sessionId || 'session'}`,
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
    ...(args.debrief ? ['', `Debrief (authoritative for decisions/actions detail): \`${args.debrief}\``] : []),
    '',
  ];
  return fmLines.concat(body).join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.jsonl) die('--jsonl <path> is required');
  if (!fs.existsSync(args.jsonl)) die(`source not found: ${args.jsonl}`);

  const isFixture = args.fixture;
  if (isFixture) {
    const real = fs.realpathSync(args.jsonl);
    const tmpReal = fs.realpathSync(os.tmpdir());
    if (!(real.startsWith('/tmp/') || real.startsWith('/private/tmp/') || real.startsWith(tmpReal + path.sep))) {
      die('GATE REFUSAL: --fixture only accepts synthetic sources under /tmp');
    }
    if (isPrivateSubstratePath(args.jsonl)) {
      die('GATE REFUSAL: --fixture cannot point at a private substrate path');
    }
  } else {
    // Gate (a): every non-fixture read of a session JSONL requires a receipt —
    // session JSONL is a private substrate wherever it lives.
    if (!args.ratification) {
      die(`GATE REFUSAL (AMD-1a, ${RULE_PATH}): session-JSONL is a private local substrate with NO standing allowance (rerev-mdoi-001). Provide a task-specific operator ratification receipt via --ratification <receipt.json>. The receipt must name substrate 'session-jsonl', the bounded allowed_sources, and retention 'schema-conforming note on vault-mirrored repo surface'.`);
    }
  }

  const ratification = isFixture ? null : validateRatification(args.ratification, args.jsonl);

  const parsed = parseSessionJsonl(args.jsonl);

  if (args.preview) {
    // Bounded prose preview for the classification judgment (AMD-1d: read
    // prose turns, not keyword counts). First 3 + last 3 prose turns, capped.
    const head = parsed.turns.slice(0, 3);
    const tail = parsed.turns.length > 6 ? parsed.turns.slice(-3) : parsed.turns.slice(head.length);
    const cap = (t) => (t.length > 600 ? t.slice(0, 600) + ' …' : t);
    process.stdout.write(`# classification preview — ${args.jsonl}\n`);
    process.stdout.write(`# session_id=${parsed.sessionId} turns=${parsed.turns.length} ${parsed.firstTs} → ${parsed.lastTs}\n\n`);
    for (const t of head) process.stdout.write(`[${t.role}] ${cap(t.text)}\n\n`);
    if (parsed.turns.length > 6) process.stdout.write(`… ${parsed.turns.length - 6} turns elided …\n\n`);
    for (const t of tail) process.stdout.write(`[${t.role}] ${cap(t.text)}\n\n`);
    if (!isFixture) {
      const receipt = writeReceipt({
        schema: 'PrivateSurfaceReceipt/1.0',
        substrate: 'session-jsonl',
        wrapper: 'tools/transcripts/distill-session-note.cjs --preview',
        ratification_id: ratification.ratification_id,
        query_bounds: `single file: ${args.jsonl}; first/last 3 prose turns, 600-char cap`,
        fields_read: ['sessionId', 'timestamps', 'model', 'cwd', 'prose turn text (bounded preview)'],
        incidental_count: 0,
        redaction_applied: 'turn-text capped; no note written',
        retained_artifacts: ['this receipt only'],
        cleanup_status: 'no residue (preview printed to stdout only)',
      });
      process.stderr.write(`receipt: ${receipt}\n`);
    }
    return;
  }

  // Classification gates (b)/(c)/(d).
  if (!args.classification) {
    die('GATE REFUSAL (AMD-1d): --classification is required and must come from a prose-turn reading judgment (use --preview first). Valid: SYSTEM | PERSONAL | CLIENT:<code>.');
  }
  if (!/^(SYSTEM|PERSONAL|CLIENT:[A-Za-z0-9_-]+)$/.test(args.classification)) {
    die(`invalid --classification '${args.classification}' (SYSTEM | PERSONAL | CLIENT:<code>)`);
  }
  if (args.classification === 'PERSONAL' && !(ratification && ratification.allow_personal === true)) {
    die('GATE REFUSAL (AMD-1c): PERSONAL-classified sessions are excluded from distillation by default. The operator ratification receipt must carry allow_personal: true to override.');
  }
  if (!args.summary) die('--summary is required (schema field; judgment input from the classifying reader)');

  const note = buildNote(args, parsed, new Date().toISOString());

  // Gate (e): S4 credential lint BEFORE write.
  const lint = runS4Lint(note);
  if (lint.code !== 0) {
    die(`GATE REFUSAL (S4 lint): sentinel hit in generated note — NOTHING WRITTEN.\n${lint.stderr}`);
  }

  const date = (parsed.firstTs || new Date().toISOString()).slice(0, 10);
  const slug = args.slug || (parsed.sessionId ? parsed.sessionId.slice(0, 8) : 'session');
  const outPath = path.join(OUT_DIR, `${date}__${slug}.md`);

  if (args.dryRun) {
    process.stdout.write(note);
    process.stderr.write(`\ndry-run: would write ${path.relative(REPO_ROOT, outPath)} (S4 lint clean)\n`);
    return;
  }

  fs.writeFileSync(outPath, note);

  // Validate the written note against the schema lint.
  const v = spawnSync('node', [NOTE_LINT, outPath], { encoding: 'utf8' });
  process.stderr.write(v.stdout || '');
  if (v.status !== 0) {
    fs.unlinkSync(outPath);
    die('generated note failed lint-session-notes — removed. This is a bug in the distiller.');
  }

  if (!isFixture) {
    const receipt = writeReceipt({
      schema: 'PrivateSurfaceReceipt/1.0',
      substrate: 'session-jsonl',
      wrapper: 'tools/transcripts/distill-session-note.cjs',
      ratification_id: ratification.ratification_id,
      query_bounds: `single file: ${args.jsonl}`,
      fields_read: ['sessionId', 'timestamps', 'model', 'cwd', 'version', 'prose turns', 'tool_use file paths'],
      incidental_count: 0,
      redaction_applied: 'S4 sentinel lint passed pre-write; judgment fields operator-supplied',
      retained_artifacts: [path.relative(REPO_ROOT, outPath)],
      cleanup_status: `retained per ratification (${ratification.ratification_id}): schema-conforming note on vault-mirrored repo surface`,
      note_sha256: crypto.createHash('sha256').update(note).digest('hex'),
    });
    process.stderr.write(`receipt: ${receipt}\n`);
  }
  process.stdout.write(`${path.relative(REPO_ROOT, outPath)}\n`);
}

main();
