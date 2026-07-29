#!/usr/bin/env node
'use strict';
/**
 * smoke-clean-clone — verifies exported units are self-contained and clean in an
 * isolated copy of the target repo (never the live working tree).
 *
 * For every unit in config/framework-export-map.json:
 *   - the unit MUST be present in the copy (a missing unit is a FAILURE, not a skip —
 *     a smoke that verifies zero units must not report CLEAN);
 *   - all files readable; every .json parses; no symlinks;
 *   - framework units (validate !== 'none') carry a manifest.json with required keys;
 *   - no denylist hits (config/denylist.json — in the public repo this is the example
 *     list; run from the private repo for the authoritative scan);
 *   - no absolute private home-directory paths in text files.
 *
 * Usage: node tools/export-public/smoke-clean-clone.cjs [--repo <path>] [--map <path>] [--denylist <path>] [--json]
 *   --repo defaults to the map's target_repo. The repo is copied to a temp dir
 *   (git clone when possible, file copy otherwise) and scanned there. Git is invoked
 *   with an argument vector (no shell interpretation of paths).
 *   --map/--denylist default to the original framework-export-map.json/denylist.json
 *   filenames and resolve relative to config/ unless absolute, mirroring export-public.cjs
 *   so a second export target (e.g. mythos) can be smoke-tested independently.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { scanForDenylist, REQUIRED_MANIFEST_KEYS } = require('./export-public.cjs');

const CONFIG_DIR = path.join(__dirname, 'config');
const TEXT_EXTENSIONS = new Set(['.md', '.json', '.yaml', '.yml', '.js', '.cjs', '.mjs', '.txt', '.html', '.css', '.sh', '.py', '.env', '.example']);
const HOME_ROOTS = ['home', 'Users'].join('|');
const ABS_PATH_RE = new RegExp('/(?:' + HOME_ROOTS + ')/[A-Za-z0-9_.-]+/');

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function isTextFile(p) { return TEXT_EXTENSIONS.has(path.extname(p).toLowerCase()) || path.basename(p).startsWith('.env'); }

function walk(dir, base = dir, violations = null) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      if (violations) violations.push(path.relative(base, full));
      continue;
    }
    if (entry.isDirectory()) out.push(...walk(full, base, violations));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

function isolate(repo) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-clone-'));
  try {
    execFileSync('git', ['clone', '--quiet', '--local', '--depth', '1', repo, path.join(tmp, 'clone')], { stdio: 'pipe' });
    return path.join(tmp, 'clone');
  } catch {
    // Fallback copy must not sanitize the evidence surface: silently dropping
    // symlinks here would hand verifyClone a cleaned tree and let it report
    // CLEAN on a repo that actually contains violations. Fail instead.
    const violations = [];
    const files = walk(repo, repo, violations);
    if (violations.length) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw new Error('smoke isolate: symlink(s) in source repo — refusing to verify a sanitized copy: ' + violations.join(', '));
    }
    const dest = path.join(tmp, 'copy');
    fs.mkdirSync(dest, { recursive: true });
    for (const rel of files) {
      const d = path.join(dest, rel);
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(path.join(repo, rel), d);
    }
    return dest;
  }
}

/**
 * Verify every mapped unit inside an isolated clone. Missing units are PROBLEMS
 * (minimum-coverage enforcement): ok requires every unit present AND at least one
 * unit checked — an empty map or empty repo can never report CLEAN.
 */
function verifyClone(clone, units, denylist) {
  const problems = [];
  const checked = [];
  for (const [id, entry] of Object.entries(units)) {
    const targetDir = path.join(clone, entry.target);
    if (!fs.existsSync(targetDir)) {
      problems.push(`${id}: mapped unit missing from repo (expected at ${entry.target})`);
      checked.push({ unit: id, present: false });
      continue;
    }
    let files = 0;
    const symlinks = [];
    for (const rel of walk(targetDir, targetDir, symlinks)) {
      files += 1;
      const p = path.join(targetDir, rel);
      if (isTextFile(p)) {
        let text;
        try { text = fs.readFileSync(p, 'utf8'); } catch (e) { problems.push(`${id}/${rel}: unreadable: ${e.message}`); continue; }
        if (p.endsWith('.json')) { try { JSON.parse(text); } catch (e) { problems.push(`${id}/${rel}: invalid JSON: ${e.message}`); } }
        for (const h of scanForDenylist(text, denylist, `${id}/${rel}`)) problems.push(`${h.file}:${h.line}: denylist [${h.kind}] ${h.term}`);
        const abs = text.match(ABS_PATH_RE);
        if (abs) problems.push(`${id}/${rel}: absolute private path: ${abs[0]}`);
      }
    }
    for (const s of symlinks) problems.push(`${id}/${s}: symlink in exported unit (not permitted)`);
    if (entry.validate !== 'none') {
      const manifestPath = path.join(targetDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) problems.push(`${id}: manifest.json missing`);
      else {
        try {
          const manifest = loadJson(manifestPath);
          for (const key of REQUIRED_MANIFEST_KEYS) if (manifest[key] === undefined) problems.push(`${id}: manifest missing ${key}`);
        } catch (e) { problems.push(`${id}: manifest unparseable: ${e.message}`); }
      }
    }
    checked.push({ unit: id, present: true, files });
  }
  const verified = checked.filter((c) => c.present).length;
  if (verified === 0) problems.push('minimum coverage not met: zero units verified');
  return { ok: problems.length === 0, problems, checked, verified };
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const repoArg = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : null;
  const mapArg = args.includes('--map') ? args[args.indexOf('--map') + 1] : null;
  const denylistArg = args.includes('--denylist') ? args[args.indexOf('--denylist') + 1] : null;
  const mapPath = path.isAbsolute(mapArg || '') ? mapArg : path.join(CONFIG_DIR, mapArg || 'framework-export-map.json');
  const denylistPath = path.isAbsolute(denylistArg || '') ? denylistArg : path.join(CONFIG_DIR, denylistArg || 'denylist.json');
  const exportMap = loadJson(mapPath);
  const denylist = loadJson(denylistPath);
  const repo = (repoArg || exportMap.target_repo).replace(/^~/, os.homedir());
  if (!fs.existsSync(repo)) { console.error('smoke-clean-clone: repo missing: ' + repo); process.exit(1); }

  const clone = isolate(repo);
  const units = { ...exportMap.frameworks, ...(exportMap.units || {}) };
  const { ok, problems, checked, verified } = verifyClone(clone, units, denylist);
  fs.rmSync(path.dirname(clone), { recursive: true, force: true });

  if (json) console.log(JSON.stringify({ ok, repo, checked, problems }, null, 2));
  else {
    for (const c of checked) console.log(`  ${c.present ? 'OK  ' : 'MISS'} ${c.unit}${c.present ? ` (${c.files} files)` : ' (not in repo)'}`);
    for (const p of problems) console.error('  PROBLEM ' + p);
    console.log(ok ? `smoke-clean-clone: CLEAN (${verified}/${Object.keys(units).length} unit(s) verified)` : `smoke-clean-clone: ${problems.length} problem(s)`);
  }
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
module.exports = { isolate, verifyClone };
