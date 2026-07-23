#!/usr/bin/env node
'use strict';

/**
 * session-start-contract-emitter.cjs — always-on ADVISORY behavioral-contract
 * surface at SessionStart.
 *
 * The highest-leverage cross-session lever from
 * `_dev/concepts/lesson-enforcement-ladder.md`: it converts every behavioral
 * lesson from "recalled if a token happens to match" into "stated at the top of
 * every session" — without policing any single action. It NEVER blocks; it only
 * prints. Exit 0 always.
 *
 * Safeguards (all required by the lever's contract):
 *   - FALSIFIER: prints "Operator instruction this session overrides any of
 *     these." so the surfaced contract can never out-rank a live operator.
 *   - TEMPORAL: prints "behavioral contract as of <latest memory date>" so a
 *     stale contract is visibly stale, not silently authoritative.
 *   - OVERRIDE LOG: when the operator overrides a surfaced lesson in-session,
 *     that override is appended as a `lesson-revision candidate` to the
 *     down-rung revisions ledger (see logOverrideCandidates, wired into the
 *     UserPromptSubmit dispatch chain).
 *
 * Durable-source rule: the contract is READ from durable sources — the
 * `feedback_*` memory files indexed in MEMORY.md (the same files the operator
 * curates) — NOT hardcoded. If the memories change, the contract changes.
 *
 * Stdlib-only (no npm install). Fail-silent. Exit 0 always.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT =
  process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..', '..');

// Per-host memory lineage candidates, newest/canonical first. The live MEMORY.md
// lives outside the repo under ~/.claude/projects/<slug>/memory. Lineages differ
// across hosts (see memory [[stale-mythos-checkout-footgun]] /
// [[cross-host-memory-archive-and-lineage]]); resolve through a candidate list
// rather than hardcoding one slug.
function memoryDirCandidates() {
  const home = process.env.HOME || '';
  const slugs = [
    '-Users-admin-dev-mythos-recovered',
    '-Users-admin-Documents-GitHub-mythos'
  ];
  const out = [];
  if (process.env.MYTHOS_MEMORY_DIR) out.push(process.env.MYTHOS_MEMORY_DIR);
  for (const slug of slugs) {
    if (home) out.push(path.join(home, '.claude', 'projects', slug, 'memory'));
  }
  return out;
}

function resolveMemoryDir() {
  for (const dir of memoryDirCandidates()) {
    try {
      if (fs.existsSync(path.join(dir, 'MEMORY.md'))) return dir;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

// The behavioral contract = the feedback-class lessons. These are the lessons
// that describe how the actor should WORK (dispositions), as distinct from
// reference facts. We read the feedback_* files the operator curates rather than
// hardcoding any lesson text.
function loadFeedbackMemories(memoryDir) {
  let entries;
  try {
    entries = fs.readdirSync(memoryDir);
  } catch {
    return [];
  }
  const lessons = [];
  for (const f of entries) {
    if (!f.startsWith('feedback_') || !f.endsWith('.md')) continue;
    const full = path.join(memoryDir, f);
    let raw;
    let mtime;
    try {
      raw = fs.readFileSync(full, 'utf8');
      mtime = fs.statSync(full).mtime;
    } catch {
      continue;
    }
    const fm = parseFrontmatter(raw);
    if (!fm) continue;
    // Only surface true feedback-class lessons (the behavioral contract).
    if (fm.type && fm.type !== 'feedback') continue;
    const slug = fm.name || f.replace(/^feedback_/, '').replace(/\.md$/, '');
    if (!fm.description) continue;
    lessons.push({ slug, description: fm.description, mtime });
  }
  return lessons;
}

// Minimal YAML-frontmatter reader for the fields we need (name, description,
// metadata.type). Stdlib-only; tolerant of the two metadata shapes in use
// (top-level `type:` and nested `metadata:\n  type:`).
function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return null;
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = raw.slice(3, end);
  const lines = block.split('\n');
  const out = {};
  for (const line of lines) {
    const m = line.match(/^\s*(name|description|type):\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    // strip surrounding quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (out[key] === undefined) out[key] = val;
  }
  return Object.keys(out).length ? out : null;
}

function isoDate(d) {
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return 'unknown';
  }
}

// Most-recent latest handoff, if present (durable next-session source). Pure
// pointer — we surface that it exists and its date, not its full body.
function latestHandoff() {
  const dir = path.join(PROJECT_ROOT, '_dev', 'handoffs');
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.startsWith('next-session') && f.endsWith('.md'));
  } catch {
    return null;
  }
  let best = null;
  for (const f of files) {
    let mtime;
    try {
      mtime = fs.statSync(path.join(dir, f)).mtime.getTime();
    } catch {
      continue;
    }
    if (!best || mtime > best.mtime) best = { file: f, mtime };
  }
  return best;
}

function surfacedSetPath(sessionId) {
  return path.join(
    PROJECT_ROOT,
    '_dev',
    'state',
    'lessons-reconcile',
    `surfaced-contract.${safeName(sessionId)}.json`
  );
}

function revisionsLedgerPath() {
  return path.join(
    PROJECT_ROOT,
    '_dev',
    'state',
    'lessons-reconcile',
    'lesson-revisions.jsonl'
  );
}

function safeName(value) {
  return String(value || 'unknown-session').replace(/[^A-Za-z0-9_.-]/g, '_');
}

/**
 * Build the advisory contract text. Returns { text, lessons, latestDate } or
 * null when there is nothing durable to surface.
 */
function buildContract(opts = {}) {
  const memoryDir = opts.memoryDir || resolveMemoryDir();
  if (!memoryDir) return null;
  const lessons = loadFeedbackMemories(memoryDir);
  if (!lessons.length) return null;

  // Temporal stamp = the most recent feedback memory mtime (the contract is "as
  // of" the newest lesson it carries).
  let latest = 0;
  for (const l of lessons) {
    const t = l.mtime ? l.mtime.getTime() : 0;
    if (t > latest) latest = t;
  }
  const latestDate = latest ? isoDate(latest) : 'unknown';

  // Stable order for a glanceable surface and deterministic tests.
  lessons.sort((a, b) => a.slug.localeCompare(b.slug));
  const max = Number.isFinite(opts.max) ? opts.max : lessons.length;
  const shown = lessons.slice(0, max);

  const out = [];
  out.push(`Mythos BEHAVIORAL CONTRACT (advisory — behavioral contract as of ${latestDate}; ${shown.length} feedback lessons):`);
  out.push('  >> FALSIFIER: Operator instruction this session overrides any of these. <<');
  for (const l of shown) {
    out.push(`  • [${l.slug}] ${l.description}`);
  }
  const handoff = latestHandoff();
  if (handoff) {
    out.push(`  Latest handoff: _dev/handoffs/${handoff.file} (${isoDate(handoff.mtime)}) — rebuild current state from durable artifacts.`);
  }
  out.push('  -- end behavioral contract (advisory; not a gate) --');
  out.push('');

  return { text: out.join('\n'), lessons: shown, latestDate };
}

/**
 * Persist which lessons were surfaced this session so the in-session override
 * logger can recognise an override against a SURFACED lesson (vs an unrelated
 * disagreement). Fail-silent.
 */
function persistSurfacedSet(sessionId, contract) {
  if (!sessionId || !contract) return;
  try {
    const p = surfacedSetPath(sessionId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const record = {
      session_id: sessionId,
      surfaced_at: new Date().toISOString(),
      contract_as_of: contract.latestDate,
      lessons: contract.lessons.map((l) => ({ slug: l.slug, description: l.description }))
    };
    fs.writeFileSync(p, JSON.stringify(record, null, 2) + '\n');
  } catch {
    /* fail-silent */
  }
}

// Phrases that signal the operator is overriding / revising a surfaced lesson.
const OVERRIDE_PHRASES = [
  'ignore the lesson',
  'ignore that lesson',
  'override the lesson',
  'override that lesson',
  'that lesson is wrong',
  'that rule is wrong',
  'this rule is wrong',
  'stop applying',
  'no longer applies',
  "don't apply that",
  'do not apply that',
  'drop that rule',
  'retire that lesson',
  'demote that lesson',
  'that contract item is wrong'
];

/**
 * Detect an operator override of a surfaced lesson in this session's prompt and
 * append a `lesson-revision candidate` to the down-rung revisions ledger
 * (`_dev/state/lessons-reconcile/lesson-revisions.jsonl`). This is the OVERRIDE
 * LOG safeguard: a surfaced lesson the operator overrides becomes a durable
 * demotion candidate the coordinator must later resolve. NEVER blocks. Returns
 * the candidate entries appended (for the UserPromptSubmit caller / tests).
 */
function logOverrideCandidates(payload, opts = {}) {
  try {
    const prompt = String((payload && payload.prompt) || '').toLowerCase();
    if (!prompt.trim()) return [];
    const sessionId = String((payload && payload.session_id) || '') || null;
    if (!sessionId) return [];

    const surfacedPath = opts.surfacedSetPath || surfacedSetPath(sessionId);
    let surfaced;
    try {
      surfaced = JSON.parse(fs.readFileSync(surfacedPath, 'utf8'));
    } catch {
      return []; // nothing surfaced this session ⇒ nothing to override
    }
    const lessons = (surfaced && surfaced.lessons) || [];
    if (!lessons.length) return [];

    const hasOverridePhrase = OVERRIDE_PHRASES.some((p) => prompt.includes(p));
    if (!hasOverridePhrase) return [];

    // Which surfaced lesson(s) does the override reference? Match strictly so a
    // single incidental shared word (e.g. "scope" appearing in several slugs)
    // does not over-generate candidates: either the full slug appears, OR the
    // slug's spaced form appears, OR a MAJORITY (≥2 and ≥half) of the slug's
    // distinctive words appear in the prompt.
    const matched = [];
    for (const l of lessons) {
      const slug = String(l.slug || '');
      const slugWords = slug.split('-').filter((w) => w.length >= 4);
      const spaced = slugWords.join(' ');
      const exactHit = slug && (prompt.includes(slug) || (spaced && prompt.includes(spaced)));
      const present = slugWords.filter((w) => prompt.includes(w)).length;
      const majorityHit =
        slugWords.length > 0 && present >= 2 && present >= Math.ceil(slugWords.length / 2);
      if (exactHit || majorityHit) matched.push(l);
    }
    // If an override phrase is present but no specific lesson matched, record a
    // single unattributed candidate so the override is not lost.
    const targets = matched.length ? matched : [{ slug: 'unattributed', description: '(override phrase present; specific lesson not matched)' }];

    const ledgerPath = opts.ledgerPath || revisionsLedgerPath();
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    const now = opts.now || new Date().toISOString();
    const appended = [];
    for (const l of targets) {
      const entry = {
        schema: 'LessonRevision/1.0',
        lesson: l.slug,
        current_rung: 'memory',
        proposed_rung: 'demotion-candidate',
        trigger: 'operator-override',
        evidence: {
          source: 'session-start-contract-emitter/override-logger',
          session_id: sessionId,
          surfaced_contract_as_of: surfaced.contract_as_of || null,
          operator_prompt_excerpt: String((payload && payload.prompt) || '').slice(0, 280)
        },
        session_id: sessionId,
        timestamp: now,
        status: 'candidate'
      };
      fs.appendFileSync(ledgerPath, JSON.stringify(entry) + '\n');
      appended.push(entry);
    }
    return appended;
  } catch {
    return []; // fail-silent: override logging must never block a prompt
  }
}

/**
 * SessionStart entry point. Builds and prints the advisory contract, persists
 * the surfaced set, never blocks.
 */
function emit(payload, opts = {}) {
  const contract = buildContract(opts);
  if (!contract) {
    process.stdout.write('session-start-contract-emitter: no durable behavioral contract to surface.\n');
    return;
  }
  process.stdout.write(contract.text);
  const sessionId =
    (payload && (payload.session_id || payload.sessionId)) ||
    process.env.CLAUDE_SESSION_ID ||
    null;
  persistSurfacedSet(sessionId, contract);
}

function readPayloadFromStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--log-overrides')) {
    // Override-logger mode (invoked from the UserPromptSubmit chain).
    logOverrideCandidates(readPayloadFromStdin());
    process.exit(0);
  }
  // Default: SessionStart emit mode.
  emit(readPayloadFromStdin());
  process.exit(0);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    // Never break SessionStart / UserPromptSubmit.
    process.stdout.write(`session-start-contract-emitter: error (${e.message})\n`);
    process.exit(0);
  }
}

module.exports = {
  buildContract,
  loadFeedbackMemories,
  parseFrontmatter,
  resolveMemoryDir,
  memoryDirCandidates,
  persistSurfacedSet,
  surfacedSetPath,
  revisionsLedgerPath,
  logOverrideCandidates,
  emit,
  OVERRIDE_PHRASES
};
