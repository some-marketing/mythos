#!/usr/bin/env node
'use strict';
/**
 * place-root-docs — merges a small, enumerated set of root-level files (README.md,
 * QUICKSTART.md, ...) into an export target's repo root.
 *
 * This exists because export-public.cjs's resolveTargetPath refuses any unit whose
 * targetPath resolves to the target repo root itself (EP-S2-002: a misconfigured
 * whole-directory unit must never be able to wholesale-swap the entire target repo).
 * That guard stays untouched. Root-level docs are placed by this separate, narrower
 * tool instead: no whole-directory rename/backup/rollback machinery, no swap of
 * anything the caller didn't explicitly enumerate — just named source files copied
 * (with the same denylist substitution + forbidden-term scan the main exporter uses)
 * onto named destination files at the target repo root.
 *
 * Source of truth for WHICH files get placed is the map's "root_files" object
 * ({ "<source path, repo-root-relative>": "<dest path, relative to target repo root>" }).
 * There is no CLI mechanism to place a file the map doesn't declare — every dest path
 * this tool will ever touch is looked up FROM the map's root_files values, never
 * accepted as a bare argument, so a caller cannot smuggle in an undeclared file even
 * with direct access to the exported functions below.
 *
 * Dry-run by default (computes + reports substitutions/lint, writes nothing).
 * --apply requires every enumerated file to be lint-clean; if any fails, none are
 * written (same whole-batch-before-any-write posture as export-public.cjs).
 *
 * Usage: node tools/export-public/place-root-docs.cjs --map <path> [--denylist <path>] [--apply] [--json]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  buildSubstitutions, applySubstitutions, scanForDenylist, scanForbidden, resolveTargetPath, inspectFile,
} = require('./export-public.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_DIR = path.join(__dirname, 'config');
const RECEIPT_DIR = path.join(REPO_ROOT, '_dev', 'reports', 'analysis', 'public-export');

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

/**
 * Resolve one enumerated destination. `destRel` MUST be one of the values in
 * rootFiles (enumerated-only enforcement) — this is checked BEFORE any path
 * resolution, so a caller cannot pass an arbitrary string and have it silently
 * accepted just because it happens to also be a syntactically valid relative path.
 * Containment (no escape from the target repo) is delegated to the same
 * resolveTargetPath the main exporter uses at write time.
 */
function resolveEnumeratedTarget(repoReal, rootFiles, destRel) {
  const declared = new Set(Object.values(rootFiles || {}));
  if (!declared.has(destRel)) {
    throw new Error('refused: destination not enumerated in root_files: ' + destRel);
  }
  return resolveTargetPath(repoReal, destRel);
}

/**
 * Compute (never writes) what placing every root_files entry would produce: for
 * each entry, read the source, apply denylist substitution, scan the substituted
 * output, and resolve+contain the destination. Returns { ok, entries, problems }
 * where entries carry per-file substitution/lint detail and problems is the
 * batch-blocking list (missing source, symlink source, escaping/duplicate
 * destination, undeclared destination, contamination).
 */
function planRootDocs(map, denylist, targetRepo) {
  const rootFiles = map.root_files || {};
  const subs = buildSubstitutions(denylist);
  const problems = [];
  const entries = [];
  if (!fs.existsSync(targetRepo)) {
    problems.push('target repo missing: ' + targetRepo);
    return { ok: false, entries, problems, repoReal: null };
  }
  const repoReal = fs.realpathSync(targetRepo);
  const seenTargets = new Set();
  for (const [srcRel, destRel] of Object.entries(rootFiles)) {
    const srcPath = path.join(REPO_ROOT, srcRel);
    const entry = { srcRel, destRel, applied: [], lintHits: [] };
    if (!fs.existsSync(srcPath)) {
      problems.push(`${srcRel}: source missing`);
      entries.push(entry);
      continue;
    }
    const stat = fs.lstatSync(srcPath);
    if (stat.isSymbolicLink()) {
      problems.push(`${srcRel}: symlink not permitted as a root_files source`);
      entries.push(entry);
      continue;
    }
    if (!stat.isFile()) {
      problems.push(`${srcRel}: not a regular file`);
      entries.push(entry);
      continue;
    }
    let targetPath;
    try {
      targetPath = resolveEnumeratedTarget(repoReal, rootFiles, destRel);
    } catch (e) {
      problems.push(`${srcRel} -> ${destRel}: ${e.message}`);
      entries.push(entry);
      continue;
    }
    if (seenTargets.has(targetPath)) {
      problems.push(`duplicate resolved destination: ${destRel} (${targetPath})`);
      entries.push(entry);
      continue;
    }
    seenTargets.add(targetPath);
    // R3-1: inspectFile is the shared byte/encoding-aware primitive (decodes
    // BOM'd UTF-16 correctly, byte-scans binary content, hard-blocks undecodable
    // "text") — the root-file lane must not carry its own separate UTF-8 assumption.
    const inspected = inspectFile(srcPath, destRel, denylist);
    // EP-S2-012 (mirrors export-public.cjs): scan forbidden[] against the RAW
    // source BEFORE substitution runs, so an overlapping substitution entry can
    // never erase a forbidden term ahead of detection. Hard, unconditional —
    // never suppressed by what substitution does next.
    // R2-3: also scan the SOURCE and DESTINATION path/filename strings themselves
    // — a forbidden token can ship as a name even when file content is clean.
    const rawForbiddenHits = [
      ...inspected.hits,
      ...(inspected.text !== null ? scanForbidden(inspected.text, denylist, destRel) : []),
      ...scanForbidden(srcRel, denylist, srcRel),
      ...scanForbidden(destRel, denylist, destRel),
    ];
    if (inspected.text === null && !inspected.blocked) {
      // Binary root file (no declared text extension) with no forbidden byte hits:
      // ship the raw bytes as-is, no substitution possible.
      entry.applied = [];
      entry.lintHits = rawForbiddenHits;
      entry.text = null;
      entry.rawBuffer = fs.readFileSync(srcPath);
      entry.targetPath = targetPath;
      entry.mode = stat.mode;
      if (rawForbiddenHits.length) problems.push(`${destRel}: ${rawForbiddenHits.length} denylist hit(s) — CONTAMINATED, refusing to place`);
      entries.push(entry);
      continue;
    }
    const sourceText = inspected.text !== null ? inspected.text : '';
    const { text, applied } = applySubstitutions(sourceText, subs);
    const lintHits = [...rawForbiddenHits, ...(inspected.text !== null ? scanForDenylist(text, denylist, destRel) : [])];
    entry.applied = applied;
    entry.lintHits = lintHits;
    entry.text = text;
    entry.targetPath = targetPath;
    // Preserve the source file's mode (e.g. quickstart.sh's +x) — substitution only
    // touches text content, so the permission bits of the placed file should match
    // the source exactly, not whatever the platform default happens to be.
    entry.mode = stat.mode;
    if (lintHits.length) {
      problems.push(`${destRel}: ${lintHits.length} denylist hit(s) — CONTAMINATED, refusing to place`);
    }
    entries.push(entry);
  }
  return { ok: problems.length === 0 && entries.length > 0, entries, problems, repoReal };
}

/** Writes every entry from a clean plan. Requires plan.ok === true. */
function applyRootDocs(plan, targetRepo) {
  if (!plan.ok) throw new Error('applyRootDocs requires a clean plan (run planRootDocs first)');
  const written = [];
  for (const entry of plan.entries) {
    fs.mkdirSync(path.dirname(entry.targetPath), { recursive: true });
    fs.writeFileSync(entry.targetPath, entry.text !== null ? entry.text : entry.rawBuffer);
    if (entry.mode !== undefined) fs.chmodSync(entry.targetPath, entry.mode);
    written.push(entry.destRel);
  }
  return { ok: true, written };
}

function writeReceipt(mapId, plan, applied) {
  const receipt = {
    schema: 'PlaceRootDocs/1.0',
    placed_at: new Date().toISOString(),
    map_id: mapId,
    mode: applied ? 'apply' : 'dry-run',
    ok: plan.ok,
    problems: plan.problems,
    files: plan.entries.map((e) => ({
      source: e.srcRel,
      dest: e.destRel,
      substitutions: e.applied.map((a) => ({ kind: a.kind, count: a.count })),
      lint_hits: e.lintHits.length,
    })),
  };
  receipt.content_hash = crypto.createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
  fs.mkdirSync(RECEIPT_DIR, { recursive: true });
  // F7 (mirrors export-public.cjs): keep the full timestamp through milliseconds
  // (the old `.slice(0, 15)` truncated BEFORE milliseconds appeared) and add a
  // random per-write run suffix so two writes in the same millisecond still land
  // on distinct filenames.
  const stamp = receipt.placed_at.replace(/[:.]/g, '');
  const runSuffix = crypto.randomBytes(4).toString('hex');
  const receiptPath = path.join(RECEIPT_DIR, `place-root-docs__${mapId}__${stamp}__${runSuffix}.json`);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  return receiptPath;
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const json = args.includes('--json');
  const mapArg = args.includes('--map') ? args[args.indexOf('--map') + 1] : null;
  const denylistArg = args.includes('--denylist') ? args[args.indexOf('--denylist') + 1] : null;
  if (!mapArg) {
    console.error('place-root-docs: --map <path> is required');
    process.exit(2);
  }
  const mapPath = path.isAbsolute(mapArg) ? mapArg : path.join(CONFIG_DIR, mapArg);
  const denylistPath = path.isAbsolute(denylistArg || '') ? denylistArg : path.join(CONFIG_DIR, denylistArg || 'denylist.json');
  const map = loadJson(mapPath);
  const denylist = loadJson(denylistPath);
  const mapId = path.basename(mapPath).replace(/\.json$/, '');
  const targetRepo = (map.target_repo || '').replace(/^~/, require('os').homedir());

  if (!map.root_files || Object.keys(map.root_files).length === 0) {
    if (!json) console.log('place-root-docs: no root_files declared in ' + mapId + ' — nothing to do.');
    process.exit(0);
  }

  const plan = planRootDocs(map, denylist, targetRepo);
  let applied = false;
  if (plan.ok && apply) {
    applyRootDocs(plan, targetRepo);
    applied = true;
  }
  const receiptPath = writeReceipt(mapId, plan, applied);

  if (json) {
    console.log(JSON.stringify({ apply, applied, ok: plan.ok, problems: plan.problems, entries: plan.entries.map(({ text, rawBuffer, ...e }) => e), receiptPath }, null, 2));
  } else {
    for (const e of plan.entries) {
      console.log(`[${e.destRel}] source=${e.srcRel} subs=${e.applied.length} lint_hits=${e.lintHits.length}${applied ? ' -> WRITTEN' : apply ? '' : ' (dry-run)'}`);
      for (const h of e.lintHits.slice(0, 10)) console.log(`    CONTAMINATION ${h.file}:${h.line} [${h.kind}] ${h.term} :: ${h.excerpt}`);
    }
    for (const p of plan.problems) console.error('PROBLEM ' + p);
    console.log(plan.ok ? (applied ? 'place-root-docs: WRITTEN' : 'place-root-docs: CLEAN (dry-run)') : 'place-root-docs: BLOCKED — no writes performed.');
    console.log('receipt: ' + path.relative(REPO_ROOT, receiptPath));
  }
  process.exit(plan.ok ? 0 : 1);
}

if (require.main === module) main();
module.exports = { planRootDocs, applyRootDocs, resolveEnumeratedTarget };
