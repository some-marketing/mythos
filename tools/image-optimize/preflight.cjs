#!/usr/bin/env node
'use strict';

// tools/image-optimize/preflight.cjs
//
// Mythos image-optimization standard — shared DEPLOY PREFLIGHT (slice S2).
//
// ONE module that every website deploy script sources and runs BEFORE it builds
// its upload manifest. It does NOT re-encode anything — it VERIFIES the deploy
// directory's image state by the DerivativeManifest (S0/S1) and the tier caps
// (config.json). It scans the deploy-local dir for deployable rasters and flags:
//
//   - raw .png/.jpg/.jpeg present in the deploy dir that is NOT allowlisted
//     (originals should not deploy; they should have .webp/.avif derivatives) ->
//     UNOPTIMIZED (code 10).
//   - .webp/.avif that exceeds the tier caps from config -> OVERSIZED (code 11).
//   - a deployed derivative whose source moved (manifest source_sha256 no longer
//     matches the on-disk source) -> reported as a stale/missing-manifest finding
//     where applicable.
//   - quality-floor violations (below-quality-floor, code 13) are reserved for a
//     later slice's quality metric; the exit code is DEFINED + documented here so
//     downstream tracking is stable.
//   - missing encoder/module needed for verification (code 12). In warn mode this
//     never hard-breaks the deploy: it warns-and-continues.
//
// TWO modes (ADJ#3):
//   warn (default)  — print violations, always exit 0. The "recommended" posture
//                     used until S5 proves the standard. The CURRENT portal deploy
//                     (review-images are still 1MB+ PNGs) must NOT break, so the
//                     deploy scripts call this in warn mode for now.
//   enforce         — exit NON-ZERO on the first/most-severe violation. The
//                     "required" posture, used only after S5 promotion.
//
// DISTINCT STRUCTURED EXIT CODES (ADJ#5):
//   0   ok — no violations
//   10  unoptimized-raster   — a raw png/jpg/jpeg deployable, not allowlisted
//   11  oversized-derivative — a webp/avif over its tier byte cap
//   12  missing-encoder      — a verification dependency is absent on this surface
//   13  below-quality-floor  — (reserved) a derivative below the quality floor
// In warn mode the process ALWAYS exits 0 but prints the would-be code per finding.
// In enforce mode the process exits with the HIGHEST-PRECEDENCE code among the
// findings (precedence: 12 > 11 > 10 > 13, i.e. a missing encoder is the most
// deploy-blocking because verification itself could not complete).
//
// CLI:
//   node tools/image-optimize/preflight.cjs --dir <deploy-local-dir>
//        [--manifest <derivative-manifest-path>]
//        [--mode warn|enforce] [--allowlist <path>] [--config <path>] [--json]
//
// S2 only. No storage/df guardrails (S3), no framework gate (S4), no backfill (S5).

const fs = require('fs');
const path = require('path');

const { loadConfig, loadManifest } = require('./lib/engine.cjs');
const { resolveTiers, loadAllowlist, allowlistReason } = require('./lib/policy.cjs');

// ---- S4 framework-manifest caps override (ADJ#4) ---------------------------
// A wordpress framework manifest may declare an `image_optimization` block with
// an optional per-framework `caps: { hero, content, thumb }` byte-cap override
// of the tools/image-optimize/config.json policy defaults, plus a
// `caps_provenance` / `effective_from` validation-artifact pointer. The caps are
// the byte ceilings (max_bytes) the preflight enforces a derivative against; the
// per-tier max_width never changes (it is a build-time resize concern, not a
// deploy-verify concern). This reads the block and returns a `tiers` override in
// the shape resolveTiers() already accepts ({ <tier>: { max_bytes } }), so the
// existing config-resolution layering (opts.tiers > config.policy.tiers >
// defaults) is reused unchanged — no new resolution path. Returns null when the
// manifest is absent/invalid or carries no caps, so callers degrade to config
// defaults without throwing.
function capsFromFrameworkManifest(frameworkManifestPath) {
  if (!frameworkManifestPath) return null;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(frameworkManifestPath, 'utf8'));
  } catch {
    return null; // absent/invalid manifest -> no override (config defaults win)
  }
  const block = manifest && manifest.image_optimization;
  if (!block || typeof block !== 'object') return null;
  const caps = block.caps;
  if (!caps || typeof caps !== 'object') return null;
  const tiers = {};
  for (const tierName of ['hero', 'content', 'thumb']) {
    const v = caps[tierName];
    if (v !== undefined && v !== null && Number.isFinite(Number(v))) {
      tiers[tierName] = { max_bytes: Number(v) };
    }
  }
  return Object.keys(tiers).length > 0 ? tiers : null;
}

const DEFAULT_CONFIG = path.join(__dirname, 'config.json');
const DEFAULT_MANIFEST = path.join(__dirname, 'derivative-manifest.json');

// ---- Structured exit codes (ADJ#5) -----------------------------------------
const EXIT = {
  OK: 0,
  UNOPTIMIZED_RASTER: 10,
  OVERSIZED_DERIVATIVE: 11,
  MISSING_ENCODER: 12,
  BELOW_QUALITY_FLOOR: 13,
};
// Enforce-mode precedence (highest first): a verification dependency missing is
// the most deploy-blocking, then oversize, then unoptimized, then quality-floor.
const ENFORCE_PRECEDENCE = [
  EXIT.MISSING_ENCODER,
  EXIT.OVERSIZED_DERIVATIVE,
  EXIT.UNOPTIMIZED_RASTER,
  EXIT.BELOW_QUALITY_FLOOR,
];
const CODE_LABEL = {
  0: 'ok',
  10: 'unoptimized-raster',
  11: 'oversized-derivative',
  12: 'missing-encoder',
  13: 'below-quality-floor',
};

const RAW_RASTER_EXTS = new Set(['.png', '.jpg', '.jpeg']);
const DERIVATIVE_EXTS = new Set(['.webp', '.avif']);

// Default tier used to choose a byte cap for a derivative when the manifest does
// not record one. The standard treats an un-tiered deployed derivative against
// the LARGEST (hero) cap so the preflight never false-fails a legitimately large
// hero image; the per-asset tier (from the manifest entry) is preferred when present.
const DEFAULT_VERIFY_TIER = 'hero';

function sha256File(filePath) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// Recursively enumerate every file under dir (no symlink following beyond stat).
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
      // Skip VCS / deps dirs — the deploy scripts already exclude these.
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      out.push(...walkFiles(full));
    } else if (ent.isFile()) {
      out.push(full);
    }
  }
  return out;
}

// Index manifest entries by derivative_path basename AND absolute path, and by
// source_path, so we can look an asset up however the deploy dir references it.
function indexManifest(manifest) {
  const byDerivBase = new Map();
  const byDerivAbs = new Map();
  const bySourceBase = new Map();
  for (const e of manifest.entries || []) {
    if (e.derivative_path) {
      byDerivAbs.set(path.resolve(e.derivative_path), e);
      byDerivBase.set(path.basename(e.derivative_path), e);
    }
    if (e.source_path) {
      bySourceBase.set(path.basename(e.source_path), e);
    }
    // S1 also carries optional avif sub-records — index those too.
    if (e.avif && e.avif.derivative_path) {
      byDerivAbs.set(path.resolve(e.avif.derivative_path), e);
      byDerivBase.set(path.basename(e.avif.derivative_path), e);
    }
  }
  return { byDerivBase, byDerivAbs, bySourceBase };
}

// Resolve the byte cap that applies to a derivative file. Prefer the tier the
// manifest recorded for it; otherwise use the default verify tier (hero/largest).
function capForDerivative(file, idx, tiers) {
  const entry =
    idx.byDerivAbs.get(path.resolve(file)) || idx.byDerivBase.get(path.basename(file));
  const tierName = (entry && entry.tier) || DEFAULT_VERIFY_TIER;
  const tier = tiers[tierName] || tiers[DEFAULT_VERIFY_TIER];
  return { tierName, cap: tier ? tier.max_bytes : Infinity, entry };
}

// Core, side-effect-free analysis. Returns a structured report. Never throws on
// expected conditions (missing manifest/config); surfaces them as findings.
//
// opts: { dir, manifestPath?, allowlistPath?, allowlist?, config?, configPath? }
function analyze(opts) {
  const dir = path.resolve(String(opts.dir));
  const findings = [];

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return {
      ok: false,
      dir,
      findings: [
        {
          code: EXIT.MISSING_ENCODER,
          label: CODE_LABEL[EXIT.MISSING_ENCODER],
          file: dir,
          message: `preflight: deploy dir does not exist or is not a directory: ${dir}`,
        },
      ],
      scanned: 0,
      summary: { rasters: 0, derivatives: 0 },
    };
  }

  const config = opts.config || loadConfig(opts.configPath || DEFAULT_CONFIG) || {};
  // S4: an optional per-framework caps override (image_optimization.caps in a
  // framework manifest) takes precedence over config.policy.tiers byte caps.
  // opts.tiers (explicit caller override) still wins over the framework manifest.
  const frameworkTiers =
    opts.tiers || capsFromFrameworkManifest(opts.frameworkManifestPath) || undefined;
  const tiers = resolveTiers({ config, tiers: frameworkTiers });
  const manifestPath = opts.manifestPath || DEFAULT_MANIFEST;
  const manifest = loadManifest(manifestPath);
  const idx = indexManifest(manifest);
  const allowlist = loadAllowlist({
    allowlist: opts.allowlist,
    allowlistPath: opts.allowlistPath,
  });

  const files = walkFiles(dir);
  let rasters = 0;
  let derivatives = 0;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();

    // ---- Raw raster present in deploy dir -> UNOPTIMIZED (unless allowlisted) ----
    if (RAW_RASTER_EXTS.has(ext)) {
      rasters += 1;
      const reason = allowlistReason(allowlist, file);
      if (reason) {
        findings.push({
          code: EXIT.OK,
          label: 'allowlisted-raster',
          file,
          allowlisted: true,
          allowlist_reason: reason,
          message: `preflight: ALLOWLISTED raw raster ${rel(dir, file)} (reason: ${reason})`,
        });
        continue;
      }
      findings.push({
        code: EXIT.UNOPTIMIZED_RASTER,
        label: CODE_LABEL[EXIT.UNOPTIMIZED_RASTER],
        file,
        bytes: safeSize(file),
        message:
          `preflight: UNOPTIMIZED raster in deploy dir: ${rel(dir, file)} (${safeSize(file)}B). ` +
          `Originals should not deploy — produce a .webp/.avif derivative (image-optimize optimize-tiered) ` +
          `or allowlist-with-reason.`,
      });
      continue;
    }

    // ---- Deployed derivative -> verify cap + manifest currency ----
    if (DERIVATIVE_EXTS.has(ext)) {
      derivatives += 1;
      const bytes = safeSize(file);
      const { tierName, cap, entry } = capForDerivative(file, idx, tiers);

      // Oversized derivative (over its tier byte cap) -> OVERSIZED, unless allowlisted.
      if (bytes > cap) {
        const reason = allowlistReason(allowlist, file);
        if (reason) {
          findings.push({
            code: EXIT.OK,
            label: 'allowlisted-oversize',
            file,
            allowlisted: true,
            allowlist_reason: reason,
            bytes,
            cap_bytes: cap,
            tier: tierName,
            message: `preflight: ALLOWLISTED oversize ${rel(dir, file)} (${bytes}B > ${cap}B ${tierName} cap; reason: ${reason})`,
          });
        } else {
          findings.push({
            code: EXIT.OVERSIZED_DERIVATIVE,
            label: CODE_LABEL[EXIT.OVERSIZED_DERIVATIVE],
            file,
            bytes,
            cap_bytes: cap,
            tier: tierName,
            message:
              `preflight: OVERSIZED derivative ${rel(dir, file)} is ${bytes}B, over the ${cap}B ${tierName} cap. ` +
              `Re-encode at a smaller tier/quality or allowlist-with-reason.`,
          });
        }
      }

      // Manifest currency: where a manifest entry exists AND its source is still on
      // disk, the recorded source_sha256 must still match (else the derivative is
      // stale relative to a changed source). This is a verification-only check; a
      // derivative with no manifest entry is NOT failed here (the manifest may be
      // partial), it is noted at info level.
      if (entry && entry.source_path && fs.existsSync(entry.source_path)) {
        let currentSrcSha = null;
        try {
          currentSrcSha = sha256File(entry.source_path);
        } catch {
          currentSrcSha = null;
        }
        if (currentSrcSha && entry.source_sha256 && currentSrcSha !== entry.source_sha256) {
          findings.push({
            code: EXIT.UNOPTIMIZED_RASTER,
            label: 'stale-derivative',
            file,
            message:
              `preflight: STALE derivative ${rel(dir, file)} — its source changed since the manifest entry ` +
              `(source ${entry.source_path} sha mismatch). Re-run image-optimize before deploy.`,
          });
        }
      } else if (!entry && !allowlistReason(allowlist, file)) {
        // No derivative-manifest evidence at all: the kernel line requires that a
        // deployed derivative be a CHECKED image-optimize output. Without an entry
        // it is unproven, so enforce mode must NOT silently pass it (codex S2
        // MAJOR#2). Flagged as code 10 (unverified) unless allowlisted-with-reason;
        // warn mode prints it and still exits 0. NOTE: a dedicated code 14
        // (missing-evidence) is the cleaner long-term taxonomy, but expanding the
        // exit-code set needs operator confirm — using 10 keeps the taxonomy stable.
        findings.push({
          code: EXIT.UNOPTIMIZED_RASTER,
          label: 'unverified-derivative',
          file,
          bytes,
          message:
            `preflight: UNVERIFIED derivative ${rel(dir, file)} has no derivative-manifest evidence ` +
            `(not proven to be an image-optimize output). Re-run image-optimize to record it, or allowlist-with-reason.`,
        });
      }
      continue;
    }

    // Non-image files are ignored by the preflight.
  }

  const violations = findings.filter((f) => f.code !== EXIT.OK);
  return {
    ok: violations.length === 0,
    dir,
    manifest_path: manifestPath,
    findings,
    scanned: files.length,
    summary: { rasters, derivatives, violations: violations.length },
  };
}

function rel(base, file) {
  const r = path.relative(base, file);
  return r || path.basename(file);
}

function safeSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

// Map a report's violations to the enforce-mode exit code (highest precedence).
function enforceExitCode(report) {
  const codes = new Set(report.findings.filter((f) => f.code !== EXIT.OK).map((f) => f.code));
  for (const c of ENFORCE_PRECEDENCE) {
    if (codes.has(c)) return c;
  }
  return EXIT.OK;
}

// Run preflight and return { exitCode, report }. mode: 'warn' | 'enforce'.
function runPreflight(opts) {
  const mode = opts.mode === 'enforce' ? 'enforce' : 'warn';
  const report = analyze(opts);
  report.mode = mode;
  const wouldBe = enforceExitCode(report);
  report.would_be_exit = wouldBe;
  // warn always exits 0; enforce exits the precedence code.
  report.exit_code = mode === 'enforce' ? wouldBe : EXIT.OK;
  return report;
}

// ---- CLI ------------------------------------------------------------------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
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

function printHuman(report) {
  const w = (s) => process.stdout.write(s + '\n');
  w(`image-optimize preflight (S2) — mode=${report.mode}`);
  w(`  dir:      ${report.dir}`);
  if (report.manifest_path) w(`  manifest: ${report.manifest_path}`);
  w(`  scanned ${report.scanned} file(s): ${report.summary.rasters} raw raster(s), ${report.summary.derivatives} derivative(s)`);
  const violations = report.findings.filter((f) => f.code !== EXIT.OK);
  const notes = report.findings.filter((f) => f.code === EXIT.OK && f.allowlisted);
  for (const f of notes) w(`  [allow] ${f.message}`);
  if (violations.length === 0) {
    w('  => OK: no image-optimization violations.');
  } else {
    for (const f of violations) {
      w(`  [code ${f.code} ${f.label}] ${f.message}`);
    }
    if (report.mode === 'warn') {
      w(
        `  => WARN: ${violations.length} violation(s) found (would-be exit ${report.would_be_exit} ` +
          `${CODE_LABEL[report.would_be_exit] || ''} in enforce mode). Exiting 0 (recommended posture; not yet required).`
      );
    } else {
      w(`  => ENFORCE FAIL: exit ${report.would_be_exit} (${CODE_LABEL[report.would_be_exit] || ''}).`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir || args.dir === true) {
    process.stderr.write(
      'image-optimize preflight (S2)\n' +
        'Usage:\n' +
        '  node tools/image-optimize/preflight.cjs --dir <deploy-local-dir>\n' +
        '       [--manifest <path>] [--mode warn|enforce] [--allowlist <path>] [--config <path>]\n' +
        '       [--framework-manifest <path>] [--json]\n' +
        'Exit codes: 0 ok; 10 unoptimized-raster; 11 oversized-derivative; 12 missing-encoder; 13 below-quality-floor.\n' +
        'warn mode always exits 0 (prints would-be code); enforce exits the highest-precedence code.\n'
    );
    return 1;
  }

  let report;
  try {
    report = runPreflight({
      dir: String(args.dir),
      manifestPath: args.manifest ? path.resolve(String(args.manifest)) : undefined,
      allowlistPath: args.allowlist ? path.resolve(String(args.allowlist)) : undefined,
      configPath: args.config ? path.resolve(String(args.config)) : undefined,
      frameworkManifestPath: args['framework-manifest']
        ? path.resolve(String(args['framework-manifest']))
        : undefined,
      mode: args.mode ? String(args.mode) : 'warn',
    });
  } catch (err) {
    // Resilience: an unexpected internal error must NOT hard-break a warn-mode
    // deploy. Degrade to a warning and exit 0 in warn mode; surface in enforce.
    const mode = args.mode === 'enforce' ? 'enforce' : 'warn';
    process.stderr.write(`image-optimize preflight: ${err && err.message ? err.message : err}\n`);
    return mode === 'enforce' ? EXIT.MISSING_ENCODER : 0;
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    printHuman(report);
  }
  return report.exit_code;
}

module.exports = {
  EXIT,
  CODE_LABEL,
  ENFORCE_PRECEDENCE,
  RAW_RASTER_EXTS,
  DERIVATIVE_EXTS,
  analyze,
  runPreflight,
  enforceExitCode,
  capsFromFrameworkManifest,
};

if (require.main === module) {
  process.exit(main());
}
