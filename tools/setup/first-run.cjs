#!/usr/bin/env node
/**
 * first-run.cjs — Guided onboarding for a fresh clone.
 *
 * Run via: npm run setup
 *
 * Does six things, in order, and never mutates anything destructively:
 *   1. Checks Node/npm versions.
 *   2. Verifies dependencies are installed (offers the install command if not).
 *   3. Scaffolds .env from .env.example if absent, and explains that every key is optional
 *      for basic framework use.
 *   4. Points git at this repo's hooks (.githooks) so the pre-push guard is active.
 *   5. Runs a read-only fixture smoke: lists the registered frameworks and confirms one loads.
 *   6. Prints a guided "your first framework run" walkthrough pointing at a PROVEN framework.
 *   7. Runs a non-blocking update check (whether this copy is behind origin/main).
 *
 * Exit 0 when the smoke passes; exit 1 only when the environment cannot support a first run
 * (e.g. dependencies missing). Missing optional API keys never fail the run.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const MIN_NODE_MAJOR = 18;

function line(s = '') { process.stdout.write(s + '\n'); }
function ok(s) { line('  ✓ ' + s); }
function warn(s) { line('  ! ' + s); }
function step(n, s) { line('\n[' + n + '/7] ' + s); }

let hadBlocker = false;

// 1. Node / npm versions
step(1, 'Environment');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= MIN_NODE_MAJOR) {
  ok('Node ' + process.versions.node + ' (>= ' + MIN_NODE_MAJOR + ' required)');
} else {
  warn('Node ' + process.versions.node + ' is below the required v' + MIN_NODE_MAJOR + '. Please upgrade.');
  hadBlocker = true;
}

// 2. Dependencies
step(2, 'Dependencies');
const nodeModules = path.join(ROOT, 'node_modules');
const hasPkgLock = fs.existsSync(path.join(ROOT, 'package-lock.json'));
if (fs.existsSync(nodeModules)) {
  ok('node_modules present');
} else if (hasPkgLock) {
  // The tooling is intentionally dependency-light; many commands run on Node built-ins alone.
  warn('node_modules not found. Run `npm install` for full tooling, then re-run `npm run setup`.');
} else {
  ok('no external dependencies required for the core toolchain');
}

// 3. .env scaffold
step(3, 'Configuration (.env)');
const envPath = path.join(ROOT, '.env');
const envExample = path.join(ROOT, '.env.example');
if (fs.existsSync(envPath)) {
  ok('.env already present (left untouched)');
} else if (fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, envPath);
  ok('.env created from .env.example');
} else {
  warn('.env.example not found; skipping .env scaffold');
}
line('  Every key in .env is OPTIONAL for basic framework use. Add a key only when you');
line('  use the integration that needs it — e.g. PERPLEXITY_API_KEY for the optional');
line('  `npm run research:perplexity` research leg.');

// 4. Git hooks: point git at the repo's .githooks so the pre-push guard is active
step(4, 'Git hooks');
const gitDir = path.join(ROOT, '.git');
const hooksDir = path.join(ROOT, '.githooks');
if (!fs.existsSync(gitDir)) {
  warn('not a git repository — skipping hook wiring (clone with git to enable the pre-push guard)');
} else if (!fs.existsSync(hooksDir)) {
  warn('.githooks not found — skipping hook wiring');
} else {
  try {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: ROOT, stdio: 'ignore' });
    ok('git hooks wired (core.hooksPath = .githooks); pre-push blocks direct pushes to main — see CONTRIBUTING.md');
  } catch (err) {
    warn('could not set core.hooksPath: ' + err.message);
  }
}

// 5. Fixture smoke: list frameworks + confirm one loads
step(5, 'Fixture smoke');
const frameworksDir = path.join(ROOT, 'frameworks');
const manifests = [];
(function walk(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (e.isDirectory()) walk(path.join(dir, e.name));
    else if (e.name === 'manifest.json') manifests.push(path.join(dir, e.name));
  }
})(frameworksDir);

const realFrameworks = manifests.filter((m) => !m.includes(path.sep + '_template' + path.sep));
if (realFrameworks.length === 0) {
  warn('no framework manifests found under frameworks/ — is the clone complete?');
  hadBlocker = true;
} else {
  ok(realFrameworks.length + ' registered frameworks found');
  // Confirm a PROVEN one loads and parses.
  const proven = realFrameworks.find((m) => m.includes(path.join('wordpress', 'design-research')))
    || realFrameworks[0];
  try {
    const parsed = JSON.parse(fs.readFileSync(proven, 'utf8'));
    const rel = path.relative(frameworksDir, path.dirname(proven));
    ok('framework "' + rel + '" loads (manifest v' + (parsed.version || '?') + ')');
  } catch (err) {
    warn('a framework manifest failed to parse: ' + err.message);
    hadBlocker = true;
  }
}

// 6. Guided walkthrough
step(6, 'Your first framework run');
line('');
line('  A grimoire (framework) is a reusable workflow (prompt chain + guardrails). Try a Silver-rank one:');
line('');
line('    1. Open this repo in your AI coding agent (Claude Code, Cursor, Codex, OpenCode).');
line('    2. Scaffold a workspace and a project against a framework that ships templates:');
line('');
line('         npm run workspace:scaffold -- --client-code DEMO --client-name "Demo Co" --out demo-ws');
line('         npm run workspace:project  -- --framework wordpress/design-research \\');
line('                                       --slug my-first-project --workspace demo-ws');
line('');
line('    3. Open the generated WORKFLOW_GUIDE.md in demo-ws/projects/<id>/ and follow');
line('       its step-by-step prompts, or run the chain with /cast-grimoire (run-framework) in your agent.');
line('');
line('  See the rank ladder in README.md (Iron / Bronze / Silver / Gold / Diamond) to pick a framework,');
line('  and QUICKSTART.md for the full walkthrough.');
line('');

// 7. Update check (non-blocking): is this copy behind the shared version?
// Runs the check-updates tool in-process; any failure here never fails setup.
step(7, 'Updates');
const checkUpdatesPath = path.join(ROOT, 'tools', 'updates', 'check-updates.cjs');
if (!fs.existsSync(checkUpdatesPath)) {
  warn('update check skipped (tools/updates not shipped)');
} else {
  try {
    const out = execFileSync('node', [checkUpdatesPath], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    process.stdout.write(out.replace(/^/gm, '  '));
  } catch (err) {
    warn('update check skipped: ' + (err && err.message ? err.message : 'unavailable'));
  }
}

if (hadBlocker) {
  line('\nSetup finished with items to resolve above. Address them, then re-run `npm run setup`.');
  process.exit(1);
}
line('\nSetup complete — you are ready for your first framework run.');
process.exit(0);
