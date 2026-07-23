#!/usr/bin/env node
'use strict';

/**
 * safety-family-tier-blind-lint.cjs — structural safety/quality boundary lint.
 *
 * tier-enforcement-implementation slice 2, step tier-s2a-safety-family-lint
 * (convene 20260611T130035Z condition 5 / plan gate G5):
 *
 *   The SAFETY family (dangerous-cmd, arc-guard, credential/private-surface,
 *   client-boundary, convene receipts) is TIER-BLIND BY CONSTRUCTION and is
 *   never expressed as a tier add. This lint makes that boundary structurally
 *   unviolable BEFORE any tier-gate consumer exists:
 *
 *   A. Any safety-family hook (the built-in SAFETY_SURFACES registry, plus any
 *      scanned file declaring `ENFORCEMENT_FAMILY: safety`) that imports or
 *      reads readSessionTier / readSessionStamp / readSessionAdds /
 *      resolveAddsForTier is a FINDING — safety gates never consult tier.
 *
 *   B. Any scanned hook that DOES read session tier state must declare its
 *      enforcement family in a header constant
 *      (`ENFORCEMENT_FAMILY: quality-process`) so the safety/quality boundary
 *      is explicit at the top of every tier consumer.
 *
 * Exemptions (documented, mirroring process-tier-rule-lint.cjs):
 *   - session-start-tier-stamp.cjs — the stamp WRITER, infrastructure rather
 *     than an enforcement consumer.
 *   - lib/ subdirectory — process-tier.cjs defines the accessors themselves.
 *
 * Exit codes: 0 clean, 1 findings. CLI:
 *   --hooks-dir <dir>   additional scan directory (repeatable; fixtures/tests)
 *   --no-default-scan   skip the repo default scan (fixture-only runs)
 *   --root <dir>        repo root override
 *   --json              machine-readable output
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

// Safety-family enforcement surfaces (tier-blind by construction). Paths are
// repo-root-relative. Extend this registry when a new safety gate lands.
const SAFETY_SURFACES = [
  'tools/kernel/hooks/pretool-arc-guard.cjs',          // arc-guard (scope expansion)
  'tools/kernel/hooks/dispatch-pretool.cjs',           // dangerous-cmd registry host + safety routing
  'tools/verify/hooks/pre-write-convene-required.cjs', // convene-receipt governance-write gate
  'tools/body/private-surface-prebash.cjs'             // credential / private-surface gate
];

// Files exempt from the family-declaration requirement (rule B) with reason.
const DECLARATION_EXEMPT = {
  'session-start-tier-stamp.cjs': 'stamp WRITER, not an enforcement consumer (mirrors process-tier-rule-lint exemption)'
};

const FAMILY_DECL = /ENFORCEMENT_FAMILY\s*[:=]\s*['"]?(safety|quality-process)\b/;
const TIER_READ = /readSessionTier|readSessionStamp|readSessionAdds|resolveAddsForTier/;

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function declaredFamily(text) {
  const m = FAMILY_DECL.exec(text || '');
  return m ? m[1] : null;
}

function lintFile(filePath, label, { isRegisteredSafety = false } = {}) {
  const findings = [];
  const text = readText(filePath);
  if (text === null) {
    if (isRegisteredSafety) {
      findings.push({ type: 'registry', file: label, reason: 'registered safety surface missing on disk — update SAFETY_SURFACES' });
    }
    return findings;
  }
  const family = declaredFamily(text);
  const isSafety = isRegisteredSafety || family === 'safety';
  const readsTier = TIER_READ.test(text);

  if (isSafety && readsTier) {
    findings.push({
      type: 'safety-family-reads-tier',
      file: label,
      reason: 'SAFETY-family hook imports or reads session tier state (readSessionTier/readSessionStamp/readSessionAdds/resolveAddsForTier) — the safety family is tier-blind by construction (convene 20260611T130035Z condition 5) and must never tier its behavior'
    });
  }
  if (isSafety && family === 'quality-process') {
    findings.push({
      type: 'family-conflict',
      file: label,
      reason: 'registered SAFETY surface declares ENFORCEMENT_FAMILY: quality-process — resolve the registry/declaration conflict'
    });
  }
  if (!isSafety && readsTier && family !== 'quality-process') {
    const base = path.basename(filePath);
    if (!Object.prototype.hasOwnProperty.call(DECLARATION_EXEMPT, base)) {
      findings.push({
        type: 'tier-consumer-missing-family-declaration',
        file: label,
        reason: 'hook reads session tier state but declares no enforcement family — add a header constant `ENFORCEMENT_FAMILY: quality-process` (tier-s2a-safety-family-lint)'
      });
    }
  }
  return findings;
}

function scanDir(dir, root) {
  const findings = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir).filter((f) => {
      if (!f.endsWith('.cjs') && !f.endsWith('.js')) return false;
      try {
        return fs.statSync(path.join(dir, f)).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    return findings;
  }
  for (const f of entries) {
    const full = path.join(dir, f);
    const label = path.relative(root, full) || full;
    findings.push(...lintFile(full, label));
  }
  return findings;
}

function run({ root = ROOT, extraDirs = [], defaultScan = true } = {}) {
  const findings = [];
  if (defaultScan) {
    // Registered safety surfaces — scanned by path, independent of headers, so
    // removing a declaration can never silently exit the safety family.
    for (const rel of SAFETY_SURFACES) {
      findings.push(...lintFile(path.join(root, rel), rel, { isRegisteredSafety: true }));
    }
    // All direct hook files (tier consumers must declare their family).
    findings.push(...scanDir(path.join(root, 'tools/kernel/hooks'), root));
    findings.push(...scanDir(path.join(root, 'tools/verify/hooks'), root));
  }
  for (const dir of extraDirs) {
    findings.push(...scanDir(dir, root));
  }
  return { findings };
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const defaultScan = !args.includes('--no-default-scan');
  const rootIdx = args.indexOf('--root');
  const root = rootIdx !== -1 ? path.resolve(args[rootIdx + 1]) : ROOT;
  const extraDirs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--hooks-dir' && args[i + 1]) extraDirs.push(path.resolve(args[i + 1]));
  }

  const { findings } = run({ root, extraDirs, defaultScan });

  if (jsonMode) {
    process.stdout.write(JSON.stringify({
      convene_ref: '20260611T130035Z condition 5 / plan step tier-s2a-safety-family-lint',
      safety_surfaces: SAFETY_SURFACES,
      findings
    }, null, 2) + '\n');
  } else if (findings.length === 0) {
    console.log('safety-family-tier-blind-lint: clean (safety family tier-blind; tier consumers family-declared)');
  } else {
    for (const f of findings) {
      console.error(`FINDING [${f.type}] ${f.file} — ${f.reason}`);
    }
    console.error(`safety-family-tier-blind-lint: ${findings.length} finding(s)`);
  }
  process.exit(findings.length === 0 ? 0 : 1);
}

module.exports = { DECLARATION_EXEMPT, FAMILY_DECL, SAFETY_SURFACES, TIER_READ, lintFile, run };

if (require.main === module) {
  main();
}
