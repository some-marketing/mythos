#!/usr/bin/env node
'use strict';
//
// tools/security/vault-hygiene/check-vault-boundary.js
//
// THE MECHANICAL AUDITOR. Asserts the automation-vault boundary holds.
// PASS/FAIL/WARN per check; non-zero overall exit on any FAIL. Metadata only —
// NEVER reads or prints a secret value.
//
// Checks:
//   A  placement       — every class-1 item resolves in "Automation".
//   B  anchor isolation — no class-2 trust anchor is present in "Automation".
//   C  identity scope   — if OP_SERVICE_ACCOUNT_TOKEN is set, the automation
//                         identity sees ONLY "Automation". If not set, WARN
//                         LOUDLY (boundary UNENFORCED) and report visible count.
//   D  code references  — repo `op://` refs for class-1 secrets point at
//                         op://Automation/...; flag any still on a personal
//                         vault ({VAULT}|{VAULT}|Personal|Private).
//
// Usage:
//   node tools/security/vault-hygiene/check-vault-boundary.js
//   node tools/security/vault-hygiene/check-vault-boundary.js --manifest <path>
//   node tools/security/vault-hygiene/check-vault-boundary.js --repo-root <path>
//   node tools/security/vault-hygiene/check-vault-boundary.js --json
//   node tools/security/vault-hygiene/check-vault-boundary.js --help
//
// Exit codes: 0 = all checks PASS (WARN allowed), 1 = one or more FAIL,
//             3 = config error.
//
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  DESTINATION_VAULT,
  loadManifest,
  itemExistsInVault,
  makeRealOpRunner,
  probeOpAvailable
} = require('./lib.cjs');

const DEFAULT_MANIFEST = path.join(__dirname, 'vault-manifest.json');
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '../../..');
const TOOL_DIR_NAME = 'vault-hygiene';

// ─── Pure check core (unit-tested with injected fakes) ───────────────────────
//
// Each check returns { id, name, status: 'PASS'|'FAIL'|'WARN', lines: [] }.

/** CHECK A — every class-1 item resolves in Automation. */
function checkPlacement(manifest, opRunner, opAvailable = true) {
  const lines = [];
  let fail = false;
  if (!opAvailable) {
    return {
      id: 'A',
      name: 'placement (class-1 in Automation)',
      status: 'WARN',
      lines: ['  WARN  `op` is not reachable/authenticated — cannot verify placement (run under an authed `op` session or OP_SERVICE_ACCOUNT_TOKEN).']
    };
  }
  const class1 = [
    ...manifest.class1_move
      // consolidate/needs_classification items are not yet expected in Automation.
      .filter((e) => !e.consolidate && e.action !== 'consolidate' && !e.needs_classification)
      .map((e) => e.title),
    ...manifest.class1_already_automation.map((e) => e.title)
  ];
  for (const title of class1) {
    const r = itemExistsInVault(opRunner, title, DESTINATION_VAULT);
    if (r.exists) {
      lines.push(`  PASS  "${title}" present in ${DESTINATION_VAULT}`);
    } else {
      fail = true;
      lines.push(`  FAIL  "${title}" NOT in ${DESTINATION_VAULT} (still only in a personal vault?)`);
    }
  }
  // Report deferred items for operator visibility (not a failure).
  for (const e of manifest.class1_move) {
    if (e.needs_classification) lines.push(`  note  "${e.title}" deferred (needs_classification) — not asserted`);
    else if (e.consolidate || e.action === 'consolidate') lines.push(`  note  "${e.title}" deferred (consolidate duplicate) — not asserted`);
  }
  return { id: 'A', name: 'placement (class-1 in Automation)', status: fail ? 'FAIL' : 'PASS', lines };
}

/** CHECK B — no class-2 anchor present in Automation. */
function checkAnchorIsolation(manifest, opRunner, opAvailable = true) {
  const lines = [];
  let fail = false;
  if (!opAvailable) {
    return {
      id: 'B',
      name: 'anchor isolation (class-2 NOT in Automation)',
      status: 'WARN',
      lines: ['  WARN  `op` is not reachable/authenticated — cannot verify anchor isolation.']
    };
  }
  for (const a of manifest.class2_anchors_never_move) {
    const r = itemExistsInVault(opRunner, a.title, DESTINATION_VAULT);
    if (r.exists) {
      fail = true;
      lines.push(`  FAIL  TRUST ANCHOR "${a.title}" FOUND in ${DESTINATION_VAULT} — the bot could forge its own authorization`);
    } else {
      lines.push(`  PASS  anchor "${a.title}" absent from ${DESTINATION_VAULT}`);
    }
  }
  return { id: 'B', name: 'anchor isolation (class-2 NOT in Automation)', status: fail ? 'FAIL' : 'PASS', lines };
}

/**
 * CHECK C — identity scope.
 * @param {object} env  process.env-like
 * @param {(args:string[])=>string} opRunner
 */
function checkIdentityScope(env, opRunner) {
  const lines = [];
  const tokenSet = Boolean(env.OP_SERVICE_ACCOUNT_TOKEN && String(env.OP_SERVICE_ACCOUNT_TOKEN).trim());

  let vaults;
  try {
    const out = opRunner(['vault', 'list', '--format', 'json']);
    vaults = JSON.parse(out).map((v) => v.name || v.id).filter(Boolean);
  } catch (err) {
    return {
      id: 'C',
      name: 'identity scope',
      status: 'WARN',
      lines: [`  WARN  could not enumerate vaults: ${String(err.message).split('\n')[0]}`]
    };
  }

  const nonAutomation = vaults.filter((v) => v !== DESTINATION_VAULT);

  if (!tokenSet) {
    lines.push('  WARN  OP_SERVICE_ACCOUNT_TOKEN is NOT set — the vault boundary is UNENFORCED.');
    lines.push('        Automation currently runs as a FULL personal 1Password account, so it can');
    lines.push(`        read every vault. Visible vaults: ${vaults.length} (${vaults.join(', ')}).`);
    lines.push('        Scope the automation identity to a service account limited to "Automation".');
    return { id: 'C', name: 'identity scope (UNENFORCED — token unset)', status: 'WARN', lines };
  }

  // Token is set → the visible set IS the automation identity's reach.
  if (nonAutomation.length === 0 && vaults.includes(DESTINATION_VAULT)) {
    lines.push(`  PASS  automation identity sees ONLY "${DESTINATION_VAULT}" — boundary holds.`);
    return { id: 'C', name: 'identity scope', status: 'PASS', lines };
  }
  lines.push(`  FAIL  automation identity sees ${vaults.length} vault(s): ${vaults.join(', ')}`);
  lines.push(`        boundary requires ONLY "${DESTINATION_VAULT}". Offending: ${nonAutomation.join(', ') || '(Automation missing)'}`);
  return { id: 'C', name: 'identity scope', status: 'FAIL', lines };
}

// A ref under one of these prefixes is a historical log / archived transcript /
// memory doc — it records the OLD path but does not execute, so it does not
// break after the identity fix. Such refs are FLAGGED (listed) but do not FAIL.
const HISTORICAL_PATH_RE = /^(_dev\/(archive|transcripts|state|reports)\/|mythos-memories\/)/;

function isHistoricalRef(relLine) {
  return HISTORICAL_PATH_RE.test(relLine);
}

/**
 * CHECK D — code references. Greps the repo for op:// refs.
 * `grepFn(pattern)` returns an array of "relpath:line:text" strings (matches).
 * FAILs on personal-vault refs in LIVE surfaces (code/config/instructions/
 * skills — these break after the fix); historical/log/memory refs and refs to
 * deferred items are listed as informational flags only.
 */
function checkCodeReferences(manifest, grepFn) {
  const liveLines = [];
  const historicalLines = [];
  let fail = false;
  const personalVaults = manifest.personal_vaults || ["{VAULT}", '{VAULT}', 'Personal', 'Private'];

  // Every class-1 item that is expected to live in Automation.
  const class1 = [
    ...manifest.class1_move.map((e) => ({ title: e.title, entry: e })),
    ...manifest.class1_already_automation.map((e) => ({ title: e.title, entry: e }))
  ];

  for (const item of class1) {
    const deferred = item.entry.needs_classification || item.entry.consolidate || item.entry.action === 'consolidate';
    let liveHits = 0;
    let historicalHits = 0;
    for (const pv of personalVaults) {
      const pattern = `op://${pv}/${item.title}`;
      let matches;
      try {
        matches = grepFn(pattern);
      } catch (_err) {
        matches = [];
      }
      for (const m of matches) {
        const historical = isHistoricalRef(m);
        if (historical) {
          historicalHits++;
          historicalLines.push(`  flag  "${item.title}" (historical, non-breaking) op://${pv}/... — ${m}`);
        } else if (deferred) {
          liveHits++;
          liveLines.push(`  flag  "${item.title}" (deferred — needs decision) op://${pv}/... — ${m}`);
        } else {
          liveHits++;
          fail = true;
          liveLines.push(`  FAIL  "${item.title}" LIVE ref via op://${pv}/... — ${m}`);
        }
      }
    }
    if (liveHits === 0 && historicalHits === 0) {
      liveLines.push(`  PASS  "${item.title}" — no personal-vault op:// reference found`);
    }
  }

  const lines = liveLines.slice();
  if (historicalLines.length) {
    lines.push(`  ---- ${historicalLines.length} historical/log/memory reference(s) (informational, non-breaking) ----`);
    lines.push(...historicalLines);
  }

  return { id: 'D', name: 'code references (class-1 point at Automation)', status: fail ? 'FAIL' : 'PASS', lines };
}

/**
 * Build a repo grep function bound to a root. Metadata-only: it scans for the
 * literal token `op://` (never a secret value). The whole repo is scanned ONCE
 * and cached; each returned grepFn(pattern) filters the cached lines in JS, so
 * auditing N items is a single repo pass rather than N. `git grep` (tracked
 * files, fast) is preferred; a plain `grep` is the fallback for non-git roots.
 */
function makeRepoGrep(repoRoot) {
  let cache = null;

  function scanOnce() {
    if (cache) return cache;
    let out = '';
    // Preferred: git grep over tracked files (fast, respects the repo).
    try {
      out = execFileSync(
        'git',
        ['grep', '-nI', '--fixed-strings', 'op://', '--', '.', `:(exclude)tools/security/${TOOL_DIR_NAME}/*`],
        { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }
      );
    } catch (gitErr) {
      if (gitErr.status === 1) { cache = []; return cache; } // git grep: no matches
      // Fallback: plain grep (non-git root or git unavailable).
      try {
        out = execFileSync(
          'grep',
          ['-rnI', '--exclude-dir=node_modules', '--exclude-dir=.git', `--exclude-dir=${TOOL_DIR_NAME}`, '--fixed-strings', 'op://', repoRoot],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }
        );
      } catch (grepErr) {
        if (grepErr.status === 1) { cache = []; return cache; }
        throw grepErr;
      }
    }
    cache = out
      .split('\n')
      .filter(Boolean)
      .map((l) => l.replace(repoRoot + path.sep, '').trim());
    return cache;
  }

  return function grepFn(pattern) {
    return scanOnce().filter((l) => l.includes(pattern));
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { manifest: DEFAULT_MANIFEST, repoRoot: DEFAULT_REPO_ROOT, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--manifest') opts.manifest = path.resolve(argv[++i]);
    else if (a.startsWith('--manifest=')) opts.manifest = path.resolve(a.slice('--manifest='.length));
    else if (a === '--repo-root') opts.repoRoot = path.resolve(argv[++i]);
    else if (a.startsWith('--repo-root=')) opts.repoRoot = path.resolve(a.slice('--repo-root='.length));
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

const HELP = `check-vault-boundary.js — mechanical auditor for the automation-vault boundary.

  PASS/FAIL/WARN per check; non-zero exit on any FAIL. Metadata only.

Usage:
  node tools/security/vault-hygiene/check-vault-boundary.js [--manifest <path>] [--repo-root <path>] [--json]

Checks:
  A  placement        every class-1 item resolves in "${DESTINATION_VAULT}"
  B  anchor isolation no class-2 trust anchor is present in "${DESTINATION_VAULT}"
  C  identity scope   with OP_SERVICE_ACCOUNT_TOKEN set, only "${DESTINATION_VAULT}" is visible
                      (unset → WARN: boundary UNENFORCED)
  D  code references  class-1 op:// refs point at op://${DESTINATION_VAULT}/...

Exit: 0 all-pass (WARN allowed), 1 any FAIL, 3 config error.`;

/**
 * Run all checks. Returns { checks, overall }.
 * Injectable deps for testing: opRunner, grepFn, env.
 */
function runChecks(manifest, { opRunner, grepFn, env, opAvailable }) {
  // Preflight once so per-item probes don't each hang on an auth prompt.
  const available = opAvailable === undefined ? probeOpAvailable(opRunner) : opAvailable;
  const checks = [
    checkPlacement(manifest, opRunner, available),
    checkAnchorIsolation(manifest, opRunner, available),
    checkIdentityScope(env, opRunner),
    checkCodeReferences(manifest, grepFn)
  ];
  const overall = checks.some((c) => c.status === 'FAIL') ? 'FAIL' : 'PASS';
  return { checks, overall };
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message + '\n\n' + HELP);
    process.exit(3);
  }
  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  let manifest;
  try {
    manifest = loadManifest(opts.manifest);
  } catch (err) {
    console.error(`Failed to load manifest: ${err.message}`);
    process.exit(3);
  }

  const result = runChecks(manifest, {
    opRunner: makeRealOpRunner(),
    grepFn: makeRepoGrep(opts.repoRoot),
    env: process.env
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.overall === 'FAIL' ? 1 : 0);
  }

  console.log(`\n=== vault-boundary audit → "${DESTINATION_VAULT}" ===`);
  console.log(`Manifest: ${opts.manifest}`);
  console.log(`Repo:     ${opts.repoRoot}\n`);
  for (const c of result.checks) {
    console.log(`CHECK ${c.id} — ${c.name}: ${c.status}`);
    for (const l of c.lines) console.log(l);
    console.log('');
  }
  const warnCount = result.checks.filter((c) => c.status === 'WARN').length;
  console.log(`--- overall: ${result.overall}${warnCount ? ` (${warnCount} WARN)` : ''} ---\n`);
  process.exit(result.overall === 'FAIL' ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  checkPlacement,
  checkAnchorIsolation,
  checkIdentityScope,
  checkCodeReferences,
  isHistoricalRef,
  makeRepoGrep,
  runChecks,
  parseArgs
};
