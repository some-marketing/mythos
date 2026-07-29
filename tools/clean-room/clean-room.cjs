#!/usr/bin/env node
'use strict';
//
// tools/clean-room/clean-room.cjs
//
// Clean-Room Re-Expression gate: a mechanism for license-contaminated external
// sources (e.g. UI/UX pattern references, animation libraries):
//
//   quarantine raw external text  →  an isolated pass re-expresses the concept in
//   Mythos's own words  →  verify the output is NOT a verbatim copy  →  delete the
//   quarantine (raw text gone) and write a durable CleanRoom/1.0 receipt.
//
// It lets us extract intellectual value from license-unclear sources WITHOUT ever
// shipping their copyrighted text into redistributed frameworks. Aligns with
// scaffold-framework's `distilled_from` provenance discipline.
//
// This tool is the MECHANISM for safe distillation once the operator has decided
// to proceed knowledge-only. It does NOT make the license decision — that bubbles
// to the human (see synthesis "Bubble-up").
//
// Lifecycle subcommands:
//   quarantine <source-path-or-url> --id <slug>
//       Copy/fetch the raw source into reports/clean-room/quarantine/<slug>/
//       with a manifest (source, retrieved_at, sha256 of raw text). The quarantine
//       dir is the ONLY place raw text lives.
//
//   verify <quarantine-id> <reexpressed-output-path> [--threshold <0..1>]
//       Compute normalized n-gram (shingle) overlap between the quarantined raw
//       text and the proposed re-expression. FAIL (exit 1) if overlap exceeds the
//       threshold (verbatim-copy guard). PASS (exit 0) if sufficiently re-expressed.
//
//   release <quarantine-id> <reexpressed-output-path> [--threshold <0..1>]
//       Re-run verify; on PASS, delete the quarantine dir and write a CleanRoom/1.0
//       receipt to reports/clean-room/receipts/<slug>.json. Refuses on FAIL.
//
// Common flags:
//   --json            machine-readable output
//   --signal <path>   also emit a VerificationSignal/1.0 (via tools/verify/lib/signal.cjs)
//   --threshold <n>   override the default overlap threshold (verify/release)
//
// Usage:
//   node tools/clean-room/clean-room.cjs quarantine ./src.md --id ui-ux-heuristics
//   node tools/clean-room/clean-room.cjs verify ui-ux-heuristics ./distilled.md
//   node tools/clean-room/clean-room.cjs release ui-ux-heuristics ./distilled.md
//
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let signalLib = null;
try {
  signalLib = require('../verify/lib/signal.cjs');
} catch {
  signalLib = null;
}

const RECEIPT_SCHEMA = 'CleanRoom/1.0';

// Default state roots. Resolved relative to the repo root (two levels up from
// tools/clean-room/). Overridable via env for tests / alternate checkouts.
const REPO_ROOT = process.env.CLEAN_ROOM_REPO_ROOT
  ? path.resolve(process.env.CLEAN_ROOM_REPO_ROOT)
  : path.resolve(__dirname, '..', '..');
const STATE_ROOT = path.join(REPO_ROOT, 'reports', 'clean-room');
const QUARANTINE_ROOT = path.join(STATE_ROOT, 'quarantine');
const RECEIPTS_ROOT = path.join(STATE_ROOT, 'receipts');

// Default verbatim-copy threshold. Normalized 4-gram shingle overlap (Jaccard).
// Genuinely re-expressed prose about the same concept typically shares well under
// 0.15 of its word-shingles with the source; verbatim or lightly-paraphrased text
// shares far more. 0.30 leaves clear daylight: it FAILS near-verbatim copies and
// PASSES real re-expression while tolerating unavoidable shared domain terms.
const DEFAULT_THRESHOLD = 0.30;
const SHINGLE_N = 4;

// ── slug + path helpers ──────────────────────────────────────────────────────

function sanitizeSlug(raw) {
  const slug = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug;
}

function quarantineDir(slug) {
  return path.join(QUARANTINE_ROOT, slug);
}

function manifestPath(slug) {
  return path.join(quarantineDir(slug), 'manifest.json');
}

function rawPath(slug) {
  return path.join(quarantineDir(slug), 'raw.txt');
}

function receiptPath(slug) {
  return path.join(RECEIPTS_ROOT, `${slug}.json`);
}

// ── overlap metric ───────────────────────────────────────────────────────────

// Normalize text to a token stream: lowercase, strip punctuation, collapse
// whitespace. This makes overlap insensitive to formatting/casing so the metric
// measures genuine textual reuse rather than cosmetic differences.
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Build the set of contiguous n-gram shingles over the token stream.
function shingleSet(tokens, n = SHINGLE_N) {
  const set = new Set();
  if (tokens.length < n) {
    // Short texts: fall back to the whole token sequence as a single shingle so
    // the metric is still defined (and tiny near-identical snippets still overlap).
    if (tokens.length > 0) set.add(tokens.join(' '));
    return set;
  }
  for (let i = 0; i + n <= tokens.length; i++) {
    set.add(tokens.slice(i, i + n).join(' '));
  }
  return set;
}

// Jaccard overlap between the two shingle sets: |A ∩ B| / |A ∪ B|. Symmetric,
// 0 (no shared shingles) .. 1 (identical). This is the verbatim-copy metric.
function overlapScore(rawText, candidateText, n = SHINGLE_N) {
  const a = shingleSet(tokenize(rawText), n);
  const b = shingleSet(tokenize(candidateText), n);
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const sh of a) if (b.has(sh)) intersection++;
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

// ── source acquisition ───────────────────────────────────────────────────────

function isUrl(source) {
  return /^https?:\/\//i.test(String(source || ''));
}

// Fetch raw text. Local paths are read directly. URLs are fetched via the global
// fetch (Node >= 18) — no new deps. Network failures throw with a clear message.
async function acquireRawText(source) {
  if (isUrl(source)) {
    if (typeof fetch !== 'function') {
      throw new Error('global fetch unavailable in this Node runtime; cannot fetch URL sources');
    }
    const res = await fetch(source);
    if (!res.ok) {
      throw new Error(`failed to fetch ${source}: HTTP ${res.status}`);
    }
    return await res.text();
  }
  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved)) {
    throw new Error(`source not found: ${source}`);
  }
  return fs.readFileSync(resolved, 'utf8');
}

// ── lifecycle operations ─────────────────────────────────────────────────────

async function quarantine(source, slugRaw) {
  const slug = sanitizeSlug(slugRaw);
  if (!slug) throw new Error('quarantine requires a non-empty --id slug');
  const rawText = await acquireRawText(source);
  const dir = quarantineDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(rawPath(slug), rawText);
  const manifest = {
    id: slug,
    source: String(source),
    source_type: isUrl(source) ? 'url' : 'path',
    retrieved_at: new Date().toISOString(),
    sha256: sha256(rawText),
    bytes: Buffer.byteLength(rawText, 'utf8'),
    raw_path: path.relative(REPO_ROOT, rawPath(slug)),
    note: 'Quarantined raw external text. Re-express in Mythos words, verify, then release (deletes this dir).'
  };
  fs.writeFileSync(manifestPath(slug), JSON.stringify(manifest, null, 2));
  return { slug, dir, manifest };
}

function readManifest(slug) {
  const mp = manifestPath(slug);
  if (!fs.existsSync(mp)) {
    throw new Error(`no quarantine found for id "${slug}" (expected ${path.relative(REPO_ROOT, mp)})`);
  }
  return JSON.parse(fs.readFileSync(mp, 'utf8'));
}

function readRaw(slug) {
  const rp = rawPath(slug);
  if (!fs.existsSync(rp)) {
    throw new Error(`quarantined raw text missing for id "${slug}" (expected ${path.relative(REPO_ROOT, rp)})`);
  }
  return fs.readFileSync(rp, 'utf8');
}

function verify(slugRaw, outputPath, opts = {}) {
  const slug = sanitizeSlug(slugRaw);
  const threshold = typeof opts.threshold === 'number' ? opts.threshold : DEFAULT_THRESHOLD;
  readManifest(slug); // existence guard
  const rawText = readRaw(slug);
  const resolvedOutput = path.resolve(outputPath);
  if (!fs.existsSync(resolvedOutput)) {
    throw new Error(`re-expressed output not found: ${outputPath}`);
  }
  const candidate = fs.readFileSync(resolvedOutput, 'utf8');
  const score = overlapScore(rawText, candidate);
  const pass = score <= threshold;
  return {
    slug,
    output_path: path.relative(REPO_ROOT, resolvedOutput),
    overlap_score: Number(score.toFixed(4)),
    threshold,
    metric: `normalized ${SHINGLE_N}-gram shingle Jaccard overlap`,
    pass
  };
}

function release(slugRaw, outputPath, opts = {}) {
  const slug = sanitizeSlug(slugRaw);
  const manifest = readManifest(slug);
  const result = verify(slug, outputPath, opts);
  if (!result.pass) {
    return { ...result, released: false };
  }
  // Passing verify → delete the quarantine dir (raw text gone) and write receipt.
  const receipt = {
    schema: RECEIPT_SCHEMA,
    id: slug,
    source: manifest.source,
    source_type: manifest.source_type,
    source_sha256: manifest.sha256,
    retrieved_at: manifest.retrieved_at,
    verified_at: new Date().toISOString(),
    output_path: result.output_path,
    overlap_score: result.overlap_score,
    threshold: result.threshold,
    metric: result.metric,
    note: 'Clean-room re-expression verified non-verbatim; quarantine raw text deleted. Distillation is clean-room.'
  };
  fs.mkdirSync(RECEIPTS_ROOT, { recursive: true });
  fs.writeFileSync(receiptPath(slug), JSON.stringify(receipt, null, 2));
  fs.rmSync(quarantineDir(slug), { recursive: true, force: true });
  return { ...result, released: true, receipt, receipt_path: path.relative(REPO_ROOT, receiptPath(slug)) };
}

// ── signal emission ──────────────────────────────────────────────────────────

function emitSignal(signalPath, op, result) {
  if (!signalLib || !signalPath) return;
  const signal = signalLib.createSignal('clean-room', `clean-room:${op}:${result.slug || ''}`);
  const isVerifyLike = op === 'verify' || op === 'release';
  if (isVerifyLike) {
    signalLib.addCheck(signal, {
      id: 'non-verbatim-reexpression',
      category: 'license-hygiene',
      severity: 'critical',
      status: result.pass ? 'PASS' : 'FAIL',
      message: result.pass
        ? `Overlap ${result.overlap_score} <= threshold ${result.threshold}: re-expression is non-verbatim.`
        : `Overlap ${result.overlap_score} > threshold ${result.threshold}: too close to verbatim copy.`,
      fix_hint: result.pass ? undefined : 'Re-express the concept further in Mythos words; reduce shared phrasing.'
    });
    if (op === 'release') {
      signalLib.addCheck(signal, {
        id: 'quarantine-released',
        category: 'license-hygiene',
        severity: 'info',
        status: result.released ? 'PASS' : 'SKIP',
        message: result.released
          ? 'Quarantine deleted; CleanRoom/1.0 receipt written.'
          : 'Release withheld: verify did not pass.'
      });
    }
  } else {
    signalLib.addCheck(signal, {
      id: 'quarantined',
      category: 'license-hygiene',
      severity: 'info',
      status: 'PASS',
      message: `Raw source quarantined under id "${result.slug}".`
    });
  }
  signalLib.writeSignal(signal, signalPath);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseFlags(argv) {
  const flags = { json: false, signal: null, threshold: null, id: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') flags.json = true;
    else if (a === '--signal') flags.signal = argv[++i];
    else if (a === '--threshold') flags.threshold = Number(argv[++i]);
    else if (a === '--id') flags.id = argv[++i];
    else positional.push(a);
  }
  return { flags, positional };
}

function usage() {
  console.error([
    'usage:',
    '  clean-room quarantine <source-path-or-url> --id <slug> [--json] [--signal <path>]',
    '  clean-room verify <quarantine-id> <reexpressed-output-path> [--threshold <0..1>] [--json] [--signal <path>]',
    '  clean-room release <quarantine-id> <reexpressed-output-path> [--threshold <0..1>] [--json] [--signal <path>]'
  ].join('\n'));
}

async function main() {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];
  const { flags, positional } = parseFlags(argv.slice(1));
  const opts = {};
  if (flags.threshold != null && !Number.isNaN(flags.threshold)) opts.threshold = flags.threshold;

  try {
    if (subcommand === 'quarantine') {
      const source = positional[0];
      if (!source || !flags.id) { usage(); process.exit(2); }
      const result = await quarantine(source, flags.id);
      const out = { op: 'quarantine', slug: result.slug, dir: path.relative(REPO_ROOT, result.dir), manifest: result.manifest };
      emitSignal(flags.signal, 'quarantine', { slug: result.slug });
      if (flags.json) console.log(JSON.stringify(out, null, 2));
      else {
        console.log(`Quarantined "${result.slug}"`);
        console.log(`  dir:     ${out.dir}`);
        console.log(`  source:  ${result.manifest.source}`);
        console.log(`  sha256:  ${result.manifest.sha256}`);
        console.log(`  next:    re-express in Mythos words, then 'clean-room verify ${result.slug} <output>'`);
      }
      process.exit(0);
    }

    if (subcommand === 'verify') {
      const [slug, output] = positional;
      if (!slug || !output) { usage(); process.exit(2); }
      const result = verify(slug, output, opts);
      emitSignal(flags.signal, 'verify', result);
      if (flags.json) console.log(JSON.stringify({ op: 'verify', ...result }, null, 2));
      else {
        console.log(`${result.pass ? 'PASS' : 'FAIL'}: clean-room verify "${result.slug}"`);
        console.log(`  overlap:   ${result.overlap_score} (${result.metric})`);
        console.log(`  threshold: ${result.threshold}`);
        if (!result.pass) console.log('  action:    re-express further; output is too close to verbatim.');
      }
      process.exit(result.pass ? 0 : 1);
    }

    if (subcommand === 'release') {
      const [slug, output] = positional;
      if (!slug || !output) { usage(); process.exit(2); }
      const result = release(slug, output, opts);
      emitSignal(flags.signal, 'release', result);
      if (flags.json) console.log(JSON.stringify({ op: 'release', ...result }, null, 2));
      else if (result.released) {
        console.log(`RELEASED: clean-room "${result.slug}"`);
        console.log(`  overlap:   ${result.overlap_score} <= ${result.threshold}`);
        console.log(`  receipt:   ${result.receipt_path}`);
        console.log('  quarantine deleted (raw text gone).');
      } else {
        console.log(`WITHHELD: clean-room release "${result.slug}" — verify did not pass`);
        console.log(`  overlap:   ${result.overlap_score} > ${result.threshold}`);
        console.log('  quarantine retained; re-express further and re-run.');
      }
      process.exit(result.released ? 0 : 1);
    }

    usage();
    process.exit(2);
  } catch (err) {
    if (flags.json) console.log(JSON.stringify({ error: String(err && err.message || err) }, null, 2));
    else console.error(`clean-room: ${err && err.message || err}`);
    process.exit(2);
  }
}

module.exports = {
  RECEIPT_SCHEMA,
  DEFAULT_THRESHOLD,
  SHINGLE_N,
  sanitizeSlug,
  tokenize,
  shingleSet,
  overlapScore,
  sha256,
  quarantine,
  verify,
  release,
  quarantineDir,
  receiptPath,
  STATE_ROOT,
  QUARANTINE_ROOT,
  RECEIPTS_ROOT
};

if (require.main === module) {
  main();
}
