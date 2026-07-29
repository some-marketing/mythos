#!/usr/bin/env node
'use strict';

/**
 * rotate-jsonl.cjs — WAL-style size/age-segmented rotation for append-only
 * _dev/state/**\/*.jsonl surfaces.
 *
 * WHAT IT DOES
 *   Append-only JSONL logs under _dev/state grow without bound (F1). This tool
 *   rotates each covered surface like a write-ahead log: when a live file
 *   crosses its size or age bound, the cold PREFIX (oldest lines) is split off,
 *   gzipped into an archive-compatible location, and the live file is rewritten
 *   with only its recent readable tail. Recent history stays plain-text and
 *   readable in place; cold history is preserved compressed, never deleted.
 *
 * WHY IT IS SAFE
 *   - DEFAULT DRY-RUN (grounding A3, A5): prints the rotation plan and mutates
 *     nothing. Mutation requires the explicit --apply flag. Promotion of a
 *     surface to unattended --apply scheduling requires a recorded observation
 *     window (a bounded run of dry-run cycles captured as durable artifacts)
 *     before it is trusted to run unattended.
 *   - NON-INTERACTIVE SAFE: never prompts, never reads stdin, never hangs in a
 *     scheduled/CI context. --apply is the only gate to mutation.
 *   - KILL-SWITCH: if the file _dev/state/rotate-jsonl/disabled exists, the tool
 *     exits 0 without touching anything (even under --apply).
 *   - IDEMPOTENT: rotation always leaves at least keep_tail_lines recent lines
 *     in the live file. A re-run over an already-rotated surface is a no-op
 *     because the size/age triggers no longer fire and the tail floor blocks
 *     any further cut.
 *   - NEVER DELETES: the only mutation is (gzip cold prefix -> archive) then
 *     (rewrite live file with the tail). The tail is written to a temp file and
 *     atomically renamed over the original only after the archive is durable.
 *   - EXPLICIT COVERAGE: every _dev/state JSONL surface is either covered with a
 *     policy or listed as an explicit documented exemption below. Any surface
 *     matching neither is reported as UNCLASSIFIED and left untouched, so a new
 *     writer surfaces loudly rather than silently growing forever.
 *
 * Every --apply rotation appends a lane-health receipt to
 *   _dev/reports/lifecycle/hygiene-lane-health.jsonl  (grounding A2).
 *
 * USAGE
 *   node tools/state/rotate-jsonl.cjs                 # dry-run (default)
 *   node tools/state/rotate-jsonl.cjs --apply         # actually rotate
 *   node tools/state/rotate-jsonl.cjs --surface <rel> # limit to one surface
 *   node tools/state/rotate-jsonl.cjs --verbose
 *   node tools/state/rotate-jsonl.cjs --help
 *
 * Exit 0 = success (including "nothing to do"); 1 = error.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { appendReceipt } = require('../maintenance/lib/hygiene-lane-health.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const STATE_ROOT = path.join(PROJECT_ROOT, '_dev', 'state');
const KILL_SWITCH = path.join(STATE_ROOT, 'rotate-jsonl', 'disabled');

// ── Coverage config ────────────────────────────────────────────────────────
//
// defaults: applied to every covered surface unless overridden.
//   max_bytes        rotate when the live file exceeds this size
//   keep_tail_lines  hard floor of recent lines the live file must retain
//                    (rotation never cuts into these — preserves readable tail
//                     and guarantees idempotency)
//   max_age_days     rotate when the OLDEST retained line is older than this,
//                    detected from a timestamp field; null disables age trigger
//
// surfaces: glob patterns (relative to repo root) that ARE rotated, with
//   optional per-surface bound overrides.
//
// exemptions: glob patterns that are NEVER rotated, each with a reason.
//   Exemptions take precedence over surfaces.
const CONFIG = {
  defaults: {
    max_bytes: 1024 * 1024, // 1 MiB
    keep_tail_lines: 1000,
    max_age_days: 90
  },
  surfaces: [
    { pattern: '_dev/state/*/runs.jsonl' },
    { pattern: '_dev/state/*/launchd-runs.jsonl' },
    { pattern: '_dev/state/kernel-heartbeat-history.jsonl', keep_tail_lines: 2000 },
    { pattern: '_dev/state/perimeter-violations.jsonl', keep_tail_lines: 500 },
    { pattern: '_dev/state/session-boundary-log.jsonl', keep_tail_lines: 500 },
    { pattern: '_dev/state/memory-ledger.jsonl', keep_tail_lines: 500 },
    { pattern: '_dev/state/apple-sync/sync-log.jsonl', keep_tail_lines: 1000 },
    { pattern: '_dev/state/mind-matrix/shadow-decisions.jsonl', keep_tail_lines: 1000 },
    { pattern: '_dev/state/outbound/audit.log.jsonl', keep_tail_lines: 2000, max_age_days: 365 },
    { pattern: '_dev/state/wifi-capture.jsonl', keep_tail_lines: 500 }
  ],
  exemptions: [
    {
      pattern: '_dev/state/contextual-hints/**',
      reason: 'Per-session hint logs owned by tools/memory/contextual-sweep.js (launchd, 120s). That sweeper is the authoritative rotator; a second rotator would race it.'
    },
    {
      pattern: '_dev/state/memory-edges/edges.jsonl',
      reason: 'Graph edge store read whole (upsert semantics), not an append-only log. Truncating the head would corrupt the graph.'
    },
    {
      pattern: '_dev/state/plan-review-gate/overrides.jsonl',
      reason: 'Active-authority override records consulted by the plan-review gate. Rotating could hide a live override.'
    },
    {
      pattern: '_dev/state/tier-gate-soak/**',
      reason: 'Soak observation-window evidence read whole as promotion substrate (grounding A3). Full history must remain in place for the gate to count cases.'
    }
  ]
};

const TIMESTAMP_FIELDS = ['ts', 'timestamp', 'time', 'date', 'at', 'created_at', 'createdAt'];

function help() {
  console.log(`
WAL-style size/age rotation for append-only _dev/state/**/*.jsonl surfaces.

Usage:
  node tools/state/rotate-jsonl.cjs [options]

Options:
  --apply            Actually rotate (default is dry-run, mutates nothing)
  --surface <rel>    Limit to a single surface (repo-relative path)
  --verbose          Show per-surface detail
  --help             Show this help

Kill-switch: create _dev/state/rotate-jsonl/disabled to disable all rotation.
`.trim());
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) { out._.push(tok); continue; }
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (key === 'surface' && next && !next.startsWith('--')) { out.surface = next; i++; }
    else out[key] = true;
  }
  return out;
}

function globFiles(pattern) {
  const out = [];
  let matches;
  try {
    matches = fs.globSync(pattern, { cwd: PROJECT_ROOT, withFileTypes: true });
  } catch {
    return out;
  }
  for (const dirent of matches) {
    if (!dirent.isFile()) continue;
    const base = dirent.parentPath || dirent.path || PROJECT_ROOT;
    out.push(path.resolve(base, dirent.name));
  }
  return out;
}

function matchesGlob(relPath, pattern) {
  // Reuse fs.globSync semantics for a single-path membership test by checking
  // whether the concrete file appears in the pattern's expansion.
  for (const abs of globFiles(pattern)) {
    if (path.relative(PROJECT_ROOT, abs).split(path.sep).join('/') === relPath) return true;
  }
  return false;
}

function surfaceConfigFor(relPath) {
  for (const s of CONFIG.surfaces) {
    if (matchesGlob(relPath, s.pattern)) {
      return { ...CONFIG.defaults, ...s };
    }
  }
  return null;
}

function exemptionFor(relPath) {
  for (const e of CONFIG.exemptions) {
    if (matchesGlob(relPath, e.pattern)) return e;
  }
  return null;
}

function extractTimestamp(line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  for (const field of TIMESTAMP_FIELDS) {
    if (obj[field] != null) {
      const t = Date.parse(obj[field]);
      if (!Number.isNaN(t)) return t;
    }
  }
  return null;
}

function archiveDestFor(relPath) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const surfaceSlug = relPath
    .replace(/^_dev\/state\//, '')
    .replace(/\.jsonl$/, '')
    .replace(/[/]/g, '__');
  const base = path.basename(relPath, '.jsonl');
  return path.join(
    PROJECT_ROOT, '_dev', 'archive', `${year}-${month}`, 'state', surfaceSlug,
    `${base}.${stamp}.jsonl.gz`
  );
}

// Compute the rotation plan for one surface. Returns null when nothing to do.
function planSurface(absPath, cfg, now) {
  let stat;
  try { stat = fs.statSync(absPath); } catch { return null; }
  if (!stat.isFile()) return null;

  const raw = fs.readFileSync(absPath, 'utf8');
  // Preserve exact lines; a trailing newline yields one empty element we drop.
  const lines = raw.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const total = lines.length;
  if (total === 0) return null;

  const keepTail = Math.max(0, cfg.keep_tail_lines);
  const maxCut = Math.max(0, total - keepTail); // never cut into the tail floor
  if (maxCut === 0) return null;

  // Size trigger: if over max_bytes, cut everything above the tail floor.
  let sizeCut = 0;
  if (stat.size > cfg.max_bytes) sizeCut = maxCut;

  // Age trigger: cut the aged prefix (lines older than the cutoff), capped by
  // the tail floor. Requires parseable per-line timestamps; unparseable lines
  // do not extend the aged prefix.
  let ageCut = 0;
  if (cfg.max_age_days != null) {
    const cutoff = now - cfg.max_age_days * 24 * 60 * 60 * 1000;
    let idx = 0;
    while (idx < maxCut) {
      const ts = extractTimestamp(lines[idx]);
      if (ts == null || ts >= cutoff) break; // stop at first non-aged/unknown line
      idx++;
    }
    ageCut = idx;
  }

  const cut = Math.min(maxCut, Math.max(sizeCut, ageCut));
  if (cut <= 0) return null;

  const coldLines = lines.slice(0, cut);
  const tailLines = lines.slice(cut);
  const coldBytes = Buffer.byteLength(coldLines.join('\n') + '\n', 'utf8');

  return {
    absPath,
    relPath: path.relative(PROJECT_ROOT, absPath).split(path.sep).join('/'),
    total,
    cut,
    kept: tailLines.length,
    fileBytes: stat.size,
    coldBytes,
    trigger: sizeCut >= ageCut ? (sizeCut > 0 ? 'size' : 'age') : 'age',
    coldLines,
    tailLines
  };
}

function applyRotation(plan, dest = archiveDestFor(plan.relPath)) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  // 1. Write the compressed cold segment durably first.
  const gz = zlib.gzipSync(Buffer.from(plan.coldLines.join('\n') + '\n', 'utf8'));
  fs.writeFileSync(dest, gz);

  // 2. Atomically replace the live file with its tail.
  const tmp = `${plan.absPath}.rotate.tmp`;
  fs.writeFileSync(tmp, plan.tailLines.join('\n') + '\n');
  fs.renameSync(tmp, plan.absPath);

  return dest;
}

// A2 lane-health receipt: one durable line per apply-mode decision. Delegates to
// the shared canonical writer so every hygiene lane emits the identical schema
// (schema/timestamp/tool/decision/verification/outcome, optional target).
function writeLaneHealthReceipt(fields, opts) {
  return appendReceipt({ tool: 'rotate-jsonl', ...fields }, opts);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { help(); process.exit(0); }

  const apply = Boolean(args.apply);
  const verbose = Boolean(args.verbose);
  const surfaceFilter = args.surface
    ? args.surface.split(path.sep).join('/')
    : null;
  const now = Date.now();

  console.log(apply ? 'rotate-jsonl — APPLY MODE' : 'rotate-jsonl — DRY RUN (default; use --apply to rotate)');
  console.log('='.repeat(56) + '\n');

  // Kill-switch.
  if (fs.existsSync(KILL_SWITCH)) {
    console.log(`Kill-switch present (${path.relative(PROJECT_ROOT, KILL_SWITCH)}). No rotation performed.`);
    process.exit(0);
  }

  // Discover every _dev/state JSONL surface and classify it.
  const allJsonl = globFiles('_dev/state/**/*.jsonl')
    .map((abs) => path.relative(PROJECT_ROOT, abs).split(path.sep).join('/'))
    .sort();

  const covered = [];
  const exempt = [];
  const unclassified = [];

  for (const rel of allJsonl) {
    if (surfaceFilter && rel !== surfaceFilter) continue;
    const ex = exemptionFor(rel);
    if (ex) { exempt.push({ rel, reason: ex.reason }); continue; }
    const cfg = surfaceConfigFor(rel);
    if (cfg) { covered.push({ rel, cfg }); continue; }
    unclassified.push(rel);
  }

  // Build rotation plans for covered surfaces.
  const plans = [];
  for (const { rel, cfg } of covered) {
    const abs = path.join(PROJECT_ROOT, rel);
    const plan = planSurface(abs, cfg, now);
    if (plan) plans.push(plan);
  }

  console.log(`Surfaces: ${covered.length} covered, ${exempt.length} exempt, ${unclassified.length} unclassified.`);
  console.log(`Rotation candidates: ${plans.length}\n`);

  if (verbose && exempt.length) {
    console.log('Exempt surfaces:');
    for (const e of exempt) console.log(`  - ${e.rel}\n      ${e.reason}`);
    console.log('');
  }

  if (unclassified.length) {
    console.log('UNCLASSIFIED _dev/state JSONL surfaces (left untouched — add a policy or exemption in CONFIG):');
    for (const rel of unclassified) console.log(`  ! ${rel}`);
    console.log('');
  }

  if (plans.length === 0) {
    console.log('Nothing to rotate. All covered surfaces are within their size/age bounds.');
    process.exit(0);
  }

  for (const p of plans) {
    console.log(`Surface: ${p.relPath}`);
    console.log(`  Trigger: ${p.trigger}  (${p.total} lines, ${(p.fileBytes / 1024).toFixed(1)} KiB)`);
    console.log(`  Would archive ${p.cut} cold lines (${(p.coldBytes / 1024).toFixed(1)} KiB, gzipped), keep ${p.kept} recent lines.`);
    if (verbose) console.log(`    Archive dest: ${path.relative(PROJECT_ROOT, archiveDestFor(p.relPath))}`);
  }
  console.log('');

  if (!apply) {
    console.log('This was a dry run. Re-run with --apply to rotate.');
    process.exit(0);
  }

  // ── Apply ──
  let rotated = 0;
  let errors = 0;
  for (const p of plans) {
    try {
      const dest = applyRotation(p);
      rotated++;
      console.log(`  rotated: ${p.relPath} -> ${path.relative(PROJECT_ROOT, dest)} (${p.cut} lines archived)`);
      writeLaneHealthReceipt({
        decision: 'rotated',
        target: p.relPath,
        verification: {
          trigger: p.trigger,
          lines_archived: p.cut,
          lines_kept: p.kept,
          cold_bytes: p.coldBytes,
          archive: path.relative(PROJECT_ROOT, dest)
        },
        outcome: 'success'
      });
    } catch (err) {
      errors++;
      console.error(`  FAILED: ${p.relPath}: ${err.message}`);
      writeLaneHealthReceipt({
        decision: 'error',
        target: p.relPath,
        verification: { error: err.message },
        outcome: 'failed'
      });
    }
  }

  console.log(`\nRotation complete. Rotated: ${rotated}${errors ? `, Errors: ${errors}` : ''}`);
  process.exit(errors > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  CONFIG,
  planSurface,
  applyRotation,
  surfaceConfigFor,
  exemptionFor,
  archiveDestFor,
  extractTimestamp,
  globFiles,
  writeLaneHealthReceipt,
  PROJECT_ROOT
};
