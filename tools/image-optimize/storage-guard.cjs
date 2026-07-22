#!/usr/bin/env node
'use strict';

// tools/image-optimize/storage-guard.cjs
//
// Mythos image-optimization standard — STORAGE GUARDRAILS (slice S3).
//
// The portal deploys derivatives over SFTP to a Plesk VPS (vps.superdavesauto.ca)
// with a 75GB total disk ceiling. S3 keeps that ceiling honest WITHOUT requiring a
// live connection to unit-test: every remote reading enters through an injected
// command runner (dependency-injection seam, mirroring the emit() seam in
// tools/smos-runtime/hook-emulation.js). The actual remote df invocation is
// COMPOSED here (the exact command string a deploy script runs) but NOT executed —
// the deploy script runs it later under deploy/run-with-op.sh.
//
// Five guardrails (all build + verify only — NEVER a live connection; NEVER a
// delete without an explicit --apply):
//
//   1. Remote df quota preflight — given a `df -Pk` reading (or an injected
//      runner), ABORT if free space is below a configurable threshold
//      (default 10GB, per the convene synthesis: codex 15GB vs gemini 5GB on a
//      75GB box -> 10GB compromise, configurable).
//   2. Originals-never-on-VPS policy check — the deploy set must contain no
//      original/source rasters (.png/.jpg/.jpeg) destined for the webroot.
//      Originals belong in a git-ignored off-box location (the documented
//      convention: _local/image-originals/, ignored via .gitignore).
//   3. Retention — retain the current optimized set + EXACTLY ONE previous
//      rollback bundle; list older bundles for pruning. Prune is opt-in
//      (--apply); dry-run by default.
//   4. Mechanical orphan-prune — identify derivative files no longer referenced
//      by the current DerivativeManifest (orphans) and list them; prune only
//      with --apply. A local mechanical helper the operator runs, NOT a WP cron.
//   5. Deploy evidence emission — emit total image bytes, largest image,
//      derivative count, skipped originals, as JSON.
//
// FAIL-SAFE invariants:
//   * No function here opens a network connection. The remote reading is always
//     injected (a string, or a runner function). The composed command string is
//     returned for a deploy script to execute under the op wrapper.
//   * No function deletes anything unless apply === true is passed explicitly.
//     Default everywhere is dry-run (apply false).
//
// CLI:
//   node tools/image-optimize/storage-guard.cjs df-check --df-output <file|->
//        [--min-free-gb N] [--json]
//   node tools/image-optimize/storage-guard.cjs originals-check --dir <deploy-dir> [--json]
//   node tools/image-optimize/storage-guard.cjs retention --bundles-dir <dir>
//        [--keep-previous N] [--apply] [--json]
//   node tools/image-optimize/storage-guard.cjs orphan-prune --dir <derivatives-dir>
//        [--manifest <path>] [--apply] [--json]
//   node tools/image-optimize/storage-guard.cjs evidence --dir <deploy-dir> [--json]
//   node tools/image-optimize/storage-guard.cjs remote-df-command [--remote-dir DIR]
//
// Exit codes:
//   0   ok / within guardrails / dry-run reported
//   1   usage / runtime error
//   20  df-quota-fail        — free space below the threshold (deploy must abort)
//   21  originals-present    — original raster destined for the webroot
//
// S3 only. No framework gate (S4), no backfill/promotion (S5).

const fs = require('fs');
const path = require('path');

const { loadManifest } = require('./lib/engine.cjs');

// ---- Structured exit codes -------------------------------------------------
const EXIT = {
  OK: 0,
  USAGE: 1,
  DF_QUOTA_FAIL: 20,
  ORIGINALS_PRESENT: 21,
};

const BYTES_PER_GB = 1024 * 1024 * 1024;
const DEFAULT_MIN_FREE_GB = 10; // convene compromise on the 75GB box; configurable.

// Original/source raster extensions that must NEVER reach the VPS webroot.
const ORIGINAL_RASTER_EXTS = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp']);
// Deployable derivative extensions (the only rasters allowed on the box).
const DERIVATIVE_EXTS = new Set(['.webp', '.avif']);
// Everything image-shaped, for evidence accounting.
const ALL_IMAGE_EXTS = new Set([
  ...ORIGINAL_RASTER_EXTS,
  ...DERIVATIVE_EXTS,
  '.gif',
  '.svg',
]);

// Documented git-ignored off-box originals convention. Originals live HERE (or a
// per-project sibling), never in the deploy tree / webroot.
const ORIGINALS_CONVENTION_DIR = '_local/image-originals/';

// ===========================================================================
// (1) Remote df quota preflight
// ===========================================================================

// Compose the EXACT remote command a deploy script runs to read free space on
// the VPS volume that holds the webroot. Auth posture mirrors the portal's
// sftp-deploy.sh (password auth, no pubkey) so it composes cleanly under
// deploy/run-with-op.sh. `df -Pk` is POSIX-portable (1024-byte blocks, one
// physical line per filesystem) and is the most parser-stable df form.
//
// The deploy script supplies $ADPORTAL_FTPS_USER / $ADPORTAL_FTPS_HOST in env
// (resolved by run-with-op.sh); remoteDir defaults to '.' (the SFTP login dir,
// which is the webroot's volume). This function returns the argv-style command
// AND a ready-to-eval shell string; it does NOT run anything.
function buildRemoteDfCommand({ remoteDir = '.' } = {}) {
  // POSIX df, 1K blocks, on the target path's filesystem. `-P` forces the
  // single-line portable format so the parser never has to stitch wrapped lines.
  const remoteCommand = `df -Pk ${shellQuote(remoteDir)}`;
  // SSH argv matching sftp-deploy.sh's auth flags (password auth only). The
  // password is fed by the deploy script's expect wrapper / run-with-op env —
  // it is NOT embedded here.
  const sshArgs = [
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'NumberOfPasswordPrompts=1',
    '-o', 'PreferredAuthentications=password',
    '-o', 'PubkeyAuthentication=no',
    '-o', 'BatchMode=no',
    '${ADPORTAL_FTPS_USER}@${ADPORTAL_FTPS_HOST}',
    remoteCommand,
  ];
  return {
    remote_command: remoteCommand,
    ssh_argv: ['ssh', ...sshArgs],
    // A copy-pasteable shell string a deploy script can `eval` under run-with-op.sh.
    // (Password supplied non-interactively by the deploy script's expect wrapper.)
    shell: `ssh ${sshArgs.map(shellQuote).join(' ')}`,
    note:
      'Run under deploy/run-with-op.sh so $ADPORTAL_FTPS_USER/$ADPORTAL_FTPS_HOST resolve ' +
      'and the password is fed by the expect wrapper. Capture stdout and pass it to ' +
      'storage-guard df-check --df-output -.',
  };
}

function shellQuote(s) {
  const str = String(s);
  // Leave the env-var placeholders and pure-safe tokens unquoted; single-quote
  // anything else.
  if (/^[A-Za-z0-9_@./:${}-]+$/.test(str)) return str;
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

// Parse `df -Pk` output robustly. Handles:
//   - the header line (skipped)
//   - a filesystem name that wrapped onto its own line (df without -P does this;
//     -P prevents it, but we stitch defensively anyway)
//   - extra leading/trailing whitespace and variable column spacing
// Returns { filesystem, blocks_1k, used_1k, available_1k, capacity, mounted_on,
//           available_bytes, available_gb }. Throws on unparseable input.
function parseDfPk(output) {
  if (output == null || String(output).trim() === '') {
    throw new Error('storage-guard: empty df output — cannot determine free space (fail safe: treat as abort).');
  }
  const rawLines = String(output)
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() !== '');

  // Drop the header line (starts with "Filesystem" case-insensitively).
  const lines = rawLines.filter((l) => !/^\s*Filesystem\b/i.test(l));
  if (lines.length === 0) {
    throw new Error('storage-guard: df output had no data rows after the header.');
  }

  // Stitch a wrapped filesystem line: a line with a single token (the fs name)
  // followed by a line that begins with whitespace + numbers belongs together.
  const stitched = [];
  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].trim().split(/\s+/);
    if (cols.length === 1 && i + 1 < lines.length && /^\s/.test(lines[i + 1])) {
      stitched.push((lines[i].trim() + ' ' + lines[i + 1].trim()).trim());
      i++;
    } else {
      stitched.push(lines[i].trim());
    }
  }

  // Take the LAST data row (the target path's filesystem; df -P <path> prints one).
  const row = stitched[stitched.length - 1];
  const cols = row.split(/\s+/);
  // POSIX -P columns: Filesystem 1024-blocks Used Available Capacity Mounted-on
  // With a multi-word mount point, mounted_on may span trailing columns; we only
  // need the first 5 numeric-bearing columns. Find the 4 numeric columns after fs.
  if (cols.length < 6) {
    throw new Error(`storage-guard: unparseable df row (need >=6 columns, got ${cols.length}): "${row}"`);
  }
  const filesystem = cols[0];
  const blocks_1k = toInt(cols[1]);
  const used_1k = toInt(cols[2]);
  const available_1k = toInt(cols[3]);
  const capacity = cols[4];
  const mounted_on = cols.slice(5).join(' ');

  if (available_1k == null) {
    throw new Error(`storage-guard: could not parse the Available column from df row: "${row}"`);
  }

  const available_bytes = available_1k * 1024;
  return {
    filesystem,
    blocks_1k,
    used_1k,
    available_1k,
    capacity,
    mounted_on,
    available_bytes,
    available_gb: available_bytes / BYTES_PER_GB,
  };
}

function toInt(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/[^0-9]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// The df quota preflight. Reads the remote df output via an INJECTED runner (so
// it is unit-testable with no live connection), parses it, and decides
// abort/ok against the threshold.
//
// opts: {
//   minFreeGb?       (default 10)
//   dfOutput?        — a raw `df -Pk` string (inject the reading directly)
//   runDf?           — a runner () => string returning df output (DI seam; the
//                      live deploy passes a runner that execs the SSH command;
//                      tests pass a stub). If both dfOutput and runDf are given,
//                      dfOutput wins.
//   remoteDir?       — used only to compose the command string in the result.
// }
// Returns { ok, abort, reason, min_free_gb, min_free_bytes, reading, command }.
// `abort === true` means the DEPLOY MUST NOT PROCEED. Never throws on a low
// reading (that's a normal abort result); throws only on unparseable/missing
// input when no runner is available.
function dfQuotaPreflight(opts = {}) {
  const minFreeGb = opts.minFreeGb != null ? Number(opts.minFreeGb) : DEFAULT_MIN_FREE_GB;
  if (!Number.isFinite(minFreeGb) || minFreeGb < 0) {
    throw new Error(`storage-guard: invalid minFreeGb "${opts.minFreeGb}".`);
  }
  const minFreeBytes = Math.round(minFreeGb * BYTES_PER_GB);
  const command = buildRemoteDfCommand({ remoteDir: opts.remoteDir });

  // Resolve the reading: explicit dfOutput, else the injected runner.
  let output = opts.dfOutput;
  if (output == null && typeof opts.runDf === 'function') {
    output = opts.runDf({ command });
  }
  if (output == null) {
    // Fail SAFE: no reading and no runner -> treat as abort, not silent pass.
    return {
      ok: false,
      abort: true,
      reason:
        'no df reading available (no --df-output and no injected runner) — failing safe: ABORT. ' +
        'Capture the remote df output and pass it to df-check.',
      min_free_gb: minFreeGb,
      min_free_bytes: minFreeBytes,
      reading: null,
      command,
    };
  }

  const reading = parseDfPk(output);
  const abort = reading.available_bytes < minFreeBytes;
  return {
    ok: !abort,
    abort,
    reason: abort
      ? `free space ${fmtGb(reading.available_bytes)} is below the ${minFreeGb}GB threshold — ABORT deploy.`
      : `free space ${fmtGb(reading.available_bytes)} >= ${minFreeGb}GB threshold — ok.`,
    min_free_gb: minFreeGb,
    min_free_bytes: minFreeBytes,
    reading,
    command,
  };
}

function fmtGb(bytes) {
  return `${(bytes / BYTES_PER_GB).toFixed(2)}GB`;
}

// ===========================================================================
// (2) Originals-never-on-VPS policy check
// ===========================================================================

// Recursively enumerate files under a dir (skips VCS/deps dirs).
function walkFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      out.push(...walkFiles(full));
    } else if (ent.isFile()) {
      out.push(full);
    }
  }
  return out;
}

// Scan a deploy set (a directory) for original/source rasters that would deploy
// to the webroot. Complements S2's preflight (which flags unoptimized rasters):
// this is the stricter "no originals on the box, ever" invariant.
//
// opts: { dir, allowOriginalsUnder? } — allowOriginalsUnder is an array of
// path fragments (e.g. the documented off-box convention dir) that are NOT part
// of the deploy set; a hit there is informational, not a violation. By default
// the deploy dir IS the webroot, so any original under it is a violation.
// Returns { ok, dir, originals: [...], derivatives: n, scanned: n }.
function originalsCheck(opts = {}) {
  const dir = path.resolve(String(opts.dir));
  const result = { ok: true, dir, originals: [], derivatives: 0, scanned: 0 };
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    result.ok = false;
    result.error = `deploy dir does not exist or is not a directory: ${dir}`;
    return result;
  }
  const allowUnder = (opts.allowOriginalsUnder || []).map((p) => String(p));
  const files = walkFiles(dir);
  result.scanned = files.length;
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (DERIVATIVE_EXTS.has(ext)) result.derivatives += 1;
    if (ORIGINAL_RASTER_EXTS.has(ext)) {
      const allowed = allowUnder.some((frag) => file.includes(frag));
      if (allowed) continue;
      result.ok = false;
      result.originals.push({
        file,
        rel: path.relative(dir, file),
        bytes: safeSize(file),
        message:
          `original raster destined for the webroot: ${path.relative(dir, file)}. ` +
          `Originals must NOT live on the VPS — keep them off-box under ${ORIGINALS_CONVENTION_DIR} ` +
          `(git-ignored) and deploy only .webp/.avif derivatives.`,
      });
    }
  }
  return result;
}

// ===========================================================================
// (3) Retention: current + exactly one rollback bundle
// ===========================================================================

// A "bundle" is an immediate subdirectory of bundlesDir (e.g. a timestamped
// optimized-set snapshot). Retention keeps the CURRENT bundle plus `keepPrevious`
// previous bundles (default 1 = one rollback) and lists the rest for prune.
//
// Ordering: bundles are sorted newest-first. By default newness is by directory
// mtime; if every bundle name is a lexically-sortable timestamp, name order is
// used (more stable across copies). The newest = current.
//
// opts: { bundlesDir, keepPrevious? (default 1), apply? (default false) }
// Returns { ok, bundles_dir, keep, retained: [...], prunable: [...], pruned: [...], applied }.
// NEVER deletes unless apply === true.
function retention(opts = {}) {
  const bundlesDir = path.resolve(String(opts.bundlesDir));
  const keepPrevious = opts.keepPrevious != null ? Math.max(0, parseInt(opts.keepPrevious, 10) || 0) : 1;
  const apply = opts.apply === true;
  const result = {
    ok: true,
    bundles_dir: bundlesDir,
    keep: keepPrevious + 1, // current + N previous
    retained: [],
    prunable: [],
    pruned: [],
    applied: apply,
  };

  if (!fs.existsSync(bundlesDir) || !fs.statSync(bundlesDir).isDirectory()) {
    result.ok = false;
    result.error = `bundles dir does not exist or is not a directory: ${bundlesDir}`;
    return result;
  }

  let dirs = fs
    .readdirSync(bundlesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  // Prefer name-sort when names look like sortable timestamps; else mtime.
  const allTimestampLike = dirs.length > 0 && dirs.every((n) => /\d{6,}/.test(n));
  if (allTimestampLike) {
    dirs.sort().reverse(); // newest (lexically-largest) first
  } else {
    dirs = dirs
      .map((n) => ({ n, mtime: safeMtime(path.join(bundlesDir, n)) }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((x) => x.n);
  }

  const keepCount = keepPrevious + 1;
  result.retained = dirs.slice(0, keepCount).map((n) => path.join(bundlesDir, n));
  result.prunable = dirs.slice(keepCount).map((n) => path.join(bundlesDir, n));

  if (apply) {
    for (const p of result.prunable) {
      rmrf(p);
      result.pruned.push(p);
    }
  }
  return result;
}

function safeMtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

// ===========================================================================
// (4) Mechanical orphan-prune (against the current derivative manifest)
// ===========================================================================

// Identify derivative files in a derivatives dir that are NOT referenced by any
// entry in the current DerivativeManifest (orphans). Lists them; prunes only
// with apply === true. Reuses loadManifest() from the S0 engine so the manifest
// shape stays the single source of truth.
//
// opts: { dir, manifestPath, apply? (default false), exts? }
// Returns { ok, dir, manifest_path, referenced: n, orphans: [...], pruned: [...], applied }.
// NEVER deletes unless apply === true.
function orphanPrune(opts = {}) {
  const dir = path.resolve(String(opts.dir));
  const manifestPath = opts.manifestPath ? path.resolve(String(opts.manifestPath)) : null;
  const apply = opts.apply === true;
  const exts = opts.exts ? new Set(opts.exts.map((e) => e.toLowerCase())) : DERIVATIVE_EXTS;

  const result = {
    ok: true,
    dir,
    manifest_path: manifestPath,
    referenced: 0,
    orphans: [],
    pruned: [],
    applied: apply,
  };

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    result.ok = false;
    result.error = `derivatives dir does not exist or is not a directory: ${dir}`;
    return result;
  }
  if (!manifestPath) {
    result.ok = false;
    result.error = 'orphan-prune requires --manifest <path> (the current DerivativeManifest).';
    return result;
  }

  const manifest = loadManifest(manifestPath);
  // Build the set of referenced derivative absolute paths (primary + avif + png_fallback).
  const referenced = new Set();
  for (const e of manifest.entries || []) {
    addRef(referenced, e.derivative_path);
    if (e.avif) addRef(referenced, e.avif.derivative_path);
    if (e.png_fallback) addRef(referenced, e.png_fallback.derivative_path);
  }
  result.referenced = referenced.size;

  const files = walkFiles(dir);
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!exts.has(ext)) continue; // only consider derivative files for orphaning
    if (referenced.has(path.resolve(file))) continue;
    result.orphans.push({
      file,
      rel: path.relative(dir, file),
      bytes: safeSize(file),
    });
  }

  if (apply) {
    for (const o of result.orphans) {
      try {
        fs.unlinkSync(o.file);
        result.pruned.push(o.file);
      } catch (err) {
        o.prune_error = err.message;
      }
    }
  }
  return result;
}

function addRef(set, p) {
  if (p) set.add(path.resolve(p));
}

// ===========================================================================
// (5) Deploy evidence emission
// ===========================================================================

// Emit the deploy evidence the synthesis calls for, as a structured object:
// total image bytes, largest image, derivative count, skipped originals.
//
// opts: { dir }
// Returns {
//   schema, dir, generated_at,
//   total_image_bytes, image_count, derivative_count, original_count,
//   largest_image: { file, rel, bytes } | null,
//   skipped_originals: [...]   // originals that should NOT deploy (= violations)
// }
function deployEvidence(opts = {}) {
  const dir = path.resolve(String(opts.dir));
  const now = typeof opts.now === 'function' ? opts.now : () => new Date().toISOString();
  const evidence = {
    schema: 'ImageDeployEvidence/1.0',
    dir,
    generated_at: now(),
    total_image_bytes: 0,
    image_count: 0,
    derivative_count: 0,
    original_count: 0,
    largest_image: null,
    skipped_originals: [],
  };

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    evidence.error = `deploy dir does not exist or is not a directory: ${dir}`;
    return evidence;
  }

  const files = walkFiles(dir);
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!ALL_IMAGE_EXTS.has(ext)) continue;
    const bytes = safeSize(file);
    evidence.image_count += 1;
    evidence.total_image_bytes += bytes;
    if (DERIVATIVE_EXTS.has(ext)) evidence.derivative_count += 1;
    if (ORIGINAL_RASTER_EXTS.has(ext)) {
      evidence.original_count += 1;
      // Originals should not deploy — list them as skipped (the deploy should
      // exclude them; here they are reported as the to-be-skipped set).
      evidence.skipped_originals.push({ file, rel: path.relative(dir, file), bytes });
    }
    if (!evidence.largest_image || bytes > evidence.largest_image.bytes) {
      evidence.largest_image = { file, rel: path.relative(dir, file), bytes };
    }
  }
  return evidence;
}

// ---- shared helpers --------------------------------------------------------
function safeSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

// Recursive remove (dir or file). Only ever called when apply === true.
function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

// ===========================================================================
// CLI
// ===========================================================================
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--apply') args.apply = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    } else args._.push(a);
  }
  return args;
}

function readDfOutputArg(arg) {
  if (arg === '-' || arg === true) {
    return fs.readFileSync(0, 'utf8'); // stdin
  }
  return fs.readFileSync(String(arg), 'utf8');
}

function out(json, obj, human) {
  if (json) process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  else human();
}

function cmdDfCheck(args) {
  const minFreeGb = args['min-free-gb'] != null && args['min-free-gb'] !== true
    ? Number(args['min-free-gb'])
    : DEFAULT_MIN_FREE_GB;
  let dfOutput;
  if (args['df-output'] != null) {
    dfOutput = readDfOutputArg(args['df-output']);
  }
  let res;
  try {
    res = dfQuotaPreflight({ minFreeGb, dfOutput, remoteDir: args['remote-dir'] });
  } catch (err) {
    process.stderr.write(`storage-guard df-check: ${err.message}\n`);
    return EXIT.DF_QUOTA_FAIL; // fail safe: parse failure => abort code
  }
  out(args.json, res, () => {
    process.stdout.write(`storage-guard df-check (S3) — min_free=${res.min_free_gb}GB\n`);
    if (res.reading) {
      process.stdout.write(
        `  filesystem=${res.reading.filesystem} available=${fmtGb(res.reading.available_bytes)} ` +
          `mounted_on=${res.reading.mounted_on}\n`
      );
    }
    process.stdout.write(`  => ${res.abort ? 'ABORT' : 'OK'}: ${res.reason}\n`);
    process.stdout.write(`  remote command: ${res.command.remote_command}\n`);
  });
  return res.abort ? EXIT.DF_QUOTA_FAIL : EXIT.OK;
}

function cmdOriginalsCheck(args) {
  if (!args.dir || args.dir === true) {
    process.stderr.write('storage-guard originals-check: --dir <deploy-dir> required\n');
    return EXIT.USAGE;
  }
  const res = originalsCheck({ dir: args.dir });
  out(args.json, res, () => {
    process.stdout.write(`storage-guard originals-check (S3)\n  dir: ${res.dir}\n`);
    if (res.error) {
      process.stdout.write(`  ERROR: ${res.error}\n`);
      return;
    }
    process.stdout.write(`  scanned ${res.scanned} file(s); ${res.derivatives} derivative(s)\n`);
    if (res.ok) process.stdout.write('  => OK: no original rasters destined for the webroot.\n');
    else {
      for (const o of res.originals) process.stdout.write(`  [originals-present] ${o.message}\n`);
      process.stdout.write(`  => FAIL: ${res.originals.length} original(s) in the deploy set.\n`);
    }
  });
  if (res.error) return EXIT.USAGE;
  return res.ok ? EXIT.OK : EXIT.ORIGINALS_PRESENT;
}

function cmdRetention(args) {
  if (!args['bundles-dir'] || args['bundles-dir'] === true) {
    process.stderr.write('storage-guard retention: --bundles-dir <dir> required\n');
    return EXIT.USAGE;
  }
  const res = retention({
    bundlesDir: args['bundles-dir'],
    keepPrevious: args['keep-previous'],
    apply: !!args.apply,
  });
  out(args.json, res, () => {
    process.stdout.write(`storage-guard retention (S3) — keep current + ${res.keep - 1} previous\n`);
    process.stdout.write(`  bundles_dir: ${res.bundles_dir}\n`);
    if (res.error) {
      process.stdout.write(`  ERROR: ${res.error}\n`);
      return;
    }
    for (const r of res.retained) process.stdout.write(`  [retain] ${path.basename(r)}\n`);
    for (const p of res.prunable) {
      process.stdout.write(`  [${res.applied ? 'PRUNED' : 'prunable'}] ${path.basename(p)}\n`);
    }
    process.stdout.write(
      res.applied
        ? `  => APPLIED: pruned ${res.pruned.length} old bundle(s).\n`
        : `  => DRY-RUN: ${res.prunable.length} bundle(s) would be pruned (pass --apply to remove). Nothing deleted.\n`
    );
  });
  return res.error ? EXIT.USAGE : EXIT.OK;
}

function cmdOrphanPrune(args) {
  if (!args.dir || args.dir === true) {
    process.stderr.write('storage-guard orphan-prune: --dir <derivatives-dir> required\n');
    return EXIT.USAGE;
  }
  const res = orphanPrune({
    dir: args.dir,
    manifestPath: args.manifest,
    apply: !!args.apply,
  });
  out(args.json, res, () => {
    process.stdout.write(`storage-guard orphan-prune (S3)\n  dir: ${res.dir}\n`);
    if (res.error) {
      process.stdout.write(`  ERROR: ${res.error}\n`);
      return;
    }
    process.stdout.write(`  manifest: ${res.manifest_path} (referenced ${res.referenced} derivative(s))\n`);
    for (const o of res.orphans) {
      process.stdout.write(`  [${res.applied ? 'PRUNED' : 'orphan'}] ${o.rel} (${o.bytes}B)\n`);
    }
    process.stdout.write(
      res.applied
        ? `  => APPLIED: pruned ${res.pruned.length} orphan(s).\n`
        : `  => DRY-RUN: ${res.orphans.length} orphan(s) (pass --apply to remove). Nothing deleted.\n`
    );
  });
  return res.error ? EXIT.USAGE : EXIT.OK;
}

function cmdEvidence(args) {
  if (!args.dir || args.dir === true) {
    process.stderr.write('storage-guard evidence: --dir <deploy-dir> required\n');
    return EXIT.USAGE;
  }
  const res = deployEvidence({ dir: args.dir });
  out(args.json, res, () => {
    process.stdout.write(`storage-guard deploy evidence (S3)\n  dir: ${res.dir}\n`);
    if (res.error) {
      process.stdout.write(`  ERROR: ${res.error}\n`);
      return;
    }
    process.stdout.write(
      `  total_image_bytes=${res.total_image_bytes} images=${res.image_count} ` +
        `derivatives=${res.derivative_count} originals=${res.original_count}\n`
    );
    if (res.largest_image) {
      process.stdout.write(`  largest_image: ${res.largest_image.rel} (${res.largest_image.bytes}B)\n`);
    }
    if (res.skipped_originals.length) {
      process.stdout.write(`  skipped_originals (must not deploy): ${res.skipped_originals.length}\n`);
    }
  });
  return res.error ? EXIT.USAGE : EXIT.OK;
}

function cmdRemoteDfCommand(args) {
  const cmd = buildRemoteDfCommand({ remoteDir: args['remote-dir'] });
  if (args.json) process.stdout.write(JSON.stringify(cmd, null, 2) + '\n');
  else {
    process.stdout.write('storage-guard remote-df-command (S3) — composed, NOT executed:\n');
    process.stdout.write(`  remote: ${cmd.remote_command}\n`);
    process.stdout.write(`  shell:  ${cmd.shell}\n`);
    process.stdout.write(`  note:   ${cmd.note}\n`);
  }
  return EXIT.OK;
}

function usage() {
  process.stderr.write(
    'image-optimize storage-guard (S3)\n' +
      'Usage:\n' +
      '  storage-guard.cjs df-check --df-output <file|-> [--min-free-gb N] [--remote-dir DIR] [--json]\n' +
      '  storage-guard.cjs originals-check --dir <deploy-dir> [--json]\n' +
      '  storage-guard.cjs retention --bundles-dir <dir> [--keep-previous N] [--apply] [--json]\n' +
      '  storage-guard.cjs orphan-prune --dir <derivatives-dir> --manifest <path> [--apply] [--json]\n' +
      '  storage-guard.cjs evidence --dir <deploy-dir> [--json]\n' +
      '  storage-guard.cjs remote-df-command [--remote-dir DIR] [--json]\n' +
      'Exit codes: 0 ok; 1 usage; 20 df-quota-fail; 21 originals-present.\n' +
      'FAIL-SAFE: no live connection (df reading is injected); never deletes without --apply.\n'
  );
  return EXIT.USAGE;
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));
  switch (cmd) {
    case 'df-check':
      return cmdDfCheck(args);
    case 'originals-check':
      return cmdOriginalsCheck(args);
    case 'retention':
      return cmdRetention(args);
    case 'orphan-prune':
      return cmdOrphanPrune(args);
    case 'evidence':
      return cmdEvidence(args);
    case 'remote-df-command':
      return cmdRemoteDfCommand(args);
    default:
      return usage();
  }
}

module.exports = {
  EXIT,
  BYTES_PER_GB,
  DEFAULT_MIN_FREE_GB,
  ORIGINAL_RASTER_EXTS,
  DERIVATIVE_EXTS,
  ORIGINALS_CONVENTION_DIR,
  buildRemoteDfCommand,
  parseDfPk,
  dfQuotaPreflight,
  originalsCheck,
  retention,
  orphanPrune,
  deployEvidence,
};

if (require.main === module) {
  process.exit(main());
}
