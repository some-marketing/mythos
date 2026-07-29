#!/usr/bin/env node
/**
 * verify-run-evidence.cjs — Validates a test run environment has expected evidence.
 *
 * Uses the VerificationSignal/1.0 contract via shared signal library.
 *
 * Checks per environment directory:
 *   - run.meta.json exists and is valid JSON with required keys
 *   - Phase screenshots P1-P5 exist in evidence/
 *   - Console, datalayer, navigation JSONL files in evidence/
 *   - submit.result.json in evidence/
 *   - Derived summaries: run.summary.json, run.summary.md, env.report.md
 *   - Cookie snapshots P1-P5 in cookies/
 *   - Network summary in network/
 *
 * Usage: node verify-run-evidence.cjs <env-dir> [--output=path]
 *   env-dir: path to a run environment (e.g., testcases/{id}/runs/{run}/A-logged_out/)
 *
 * Exit code 0 = PASS/WARN, 1 = FAIL
 */

const fs = require('fs');
const path = require('path');
const { createSignal, addCheck, writeSignal, printSummary, printJsonOutput } = require('./lib/signal.cjs');
const checks = require('./lib/checks.cjs');

const envDir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const outputArg = process.argv.find(a => a.startsWith('--output='));
const defaultOut = path.join(__dirname, '..', '..', '_dev', 'reports', 'signals', 'verify-run-evidence.signal.json');
const outputPath = outputArg ? outputArg.split('=')[1] : defaultOut;

if (!envDir) {
  console.error('Usage: node verify-run-evidence.cjs <env-dir> [--output=path]');
  console.error('  env-dir: path to run environment (e.g., testcases/wpforms_88823/runs/run_0009/A-logged_out/)');
  process.exit(2);
}

if (!fs.existsSync(envDir)) {
  console.error(`Environment directory not found: ${envDir}`);
  process.exit(2);
}

const envName = path.basename(envDir);
const signal = createSignal('verify-run-evidence', `run evidence: ${envName}`);

// ─── run.meta.json ──────────────────────────────────────────────────────────

const metaPath = path.join(envDir, 'run.meta.json');
addCheck(signal, checks.fileExists(metaPath, {
  id: 'meta.exists', category: 'metadata', message: 'run.meta.json exists'
}));

if (fs.existsSync(metaPath)) {
  addCheck(signal, checks.jsonValid(metaPath, {
    id: 'meta.valid', category: 'metadata', message: 'run.meta.json is valid JSON'
  }));

  addCheck(signal, checks.jsonHasKeys(metaPath,
    ['run_id', 'testcase_id', 'environment', 'test_identity', 'test_links'],
    { id: 'meta.required_keys', category: 'metadata', message: 'run.meta.json has required keys' }
  ));
}

// ─── Phase Screenshots (P1-P5) ─────────────────────────────────────────────

const PHASE_SCREENSHOTS = [
  { file: 'P1.page.png', phase: 'P1', description: 'landing page' },
  { file: 'P2.page.png', phase: 'P2', description: 'pre-form navigation' },
  { file: 'P3.page.png', phase: 'P3', description: 'form displayed' },
  { file: 'P4.page.png', phase: 'P4', description: 'form filled' },
  { file: 'P5.submit.page.png', phase: 'P5', description: 'post-submit' }
];

for (const ss of PHASE_SCREENSHOTS) {
  const ssPath = path.join(envDir, 'evidence', ss.file);
  addCheck(signal, checks.fileExists(ssPath, {
    id: `screenshot.${ss.phase}`, category: 'screenshots',
    message: `${ss.phase} screenshot (${ss.description}): ${ss.file}`
  }));

  if (fs.existsSync(ssPath)) {
    addCheck(signal, checks.fileMinSize(ssPath, 5000, {
      id: `screenshot.${ss.phase}.size`, category: 'screenshots', severity: 'warning',
      message: `${ss.phase} screenshot >= 5KB (not a broken image)`
    }));
  }
}

// ─── Evidence JSONL/JSON Files ──────────────────────────────────────────────

const EVIDENCE_FILES = [
  { file: 'console.events.jsonl', severity: 'critical', description: 'console event log' },
  { file: 'datalayer.events.jsonl', severity: 'critical', description: 'dataLayer event log' },
  { file: 'navigation.timeline.jsonl', severity: 'critical', description: 'navigation timeline' },
  { file: 'submit.result.json', severity: 'critical', description: 'form submission result' },
  { file: 'datalayer.summary.json', severity: 'warning', description: 'dataLayer summary' },
  { file: 'console.errors.summary.md', severity: 'warning', description: 'console errors summary' },
  { file: 'expected_console_logs.json', severity: 'warning', description: 'expected console log patterns' },
  { file: 'expected_datalayer_events.json', severity: 'warning', description: 'expected dataLayer events' }
];

for (const ef of EVIDENCE_FILES) {
  const efPath = path.join(envDir, 'evidence', ef.file);
  addCheck(signal, checks.fileExists(efPath, {
    id: `evidence.${ef.file.replace(/\./g, '_')}`, category: 'evidence',
    severity: ef.severity,
    message: `${ef.description}: ${ef.file}`
  }));
}

// submit.result.json validity and key check
const submitPath = path.join(envDir, 'evidence', 'submit.result.json');
if (fs.existsSync(submitPath)) {
  addCheck(signal, checks.jsonValid(submitPath, {
    id: 'evidence.submit_result_valid', category: 'evidence',
    message: 'submit.result.json is valid JSON'
  }));
}

// ─── Cookie Snapshots ───────────────────────────────────────────────────────

const COOKIE_PHASES = ['P1', 'P2', 'P3', 'P4', 'P5'];
for (const phase of COOKIE_PHASES) {
  const cookiePath = path.join(envDir, 'cookies', `${phase}.cookies.json`);
  addCheck(signal, checks.fileExists(cookiePath, {
    id: `cookies.${phase}`, category: 'cookies', severity: 'warning',
    message: `${phase} cookie snapshot`
  }));

  const wsPath = path.join(envDir, 'cookies', `${phase}.webstorage.json`);
  addCheck(signal, checks.fileExists(wsPath, {
    id: `webstorage.${phase}`, category: 'cookies', severity: 'warning',
    message: `${phase} webstorage snapshot`
  }));
}

// ─── Network Summary ────────────────────────────────────────────────────────

addCheck(signal, checks.fileExists(path.join(envDir, 'network', 'network.summary.jsonl'), {
  id: 'network.summary', category: 'network', severity: 'warning',
  message: 'Network summary: network.summary.jsonl'
}));

// ─── Derived Artifacts ──────────────────────────────────────────────────────

const derivedDir = path.join(envDir, 'derived');

addCheck(signal, checks.fileExists(path.join(derivedDir, 'run.summary.json'), {
  id: 'derived.summary_json', category: 'derived',
  message: 'Derived: run.summary.json'
}));

if (fs.existsSync(path.join(derivedDir, 'run.summary.json'))) {
  addCheck(signal, checks.jsonValid(path.join(derivedDir, 'run.summary.json'), {
    id: 'derived.summary_json_valid', category: 'derived',
    message: 'run.summary.json is valid JSON'
  }));

  addCheck(signal, checks.jsonHasKeys(path.join(derivedDir, 'run.summary.json'),
    ['run_id', 'testcase_id', 'environment', 'status'],
    { id: 'derived.summary_json_keys', category: 'derived',
      message: 'run.summary.json has required keys (run_id, testcase_id, environment, status)' }
  ));
}

addCheck(signal, checks.fileExists(path.join(derivedDir, 'run.summary.md'), {
  id: 'derived.summary_md', category: 'derived',
  message: 'Derived: run.summary.md'
}));

if (fs.existsSync(path.join(derivedDir, 'run.summary.md'))) {
  addCheck(signal, checks.fileMinSize(path.join(derivedDir, 'run.summary.md'), 100, {
    id: 'derived.summary_md_size', category: 'derived', severity: 'warning',
    message: 'run.summary.md >= 100 bytes'
  }));
}

addCheck(signal, checks.fileExists(path.join(derivedDir, 'env.report.md'), {
  id: 'derived.env_report', category: 'derived',
  message: 'Derived: env.report.md'
}));

if (fs.existsSync(path.join(derivedDir, 'env.report.md'))) {
  addCheck(signal, checks.fileMinSize(path.join(derivedDir, 'env.report.md'), 200, {
    id: 'derived.env_report_size', category: 'derived', severity: 'warning',
    message: 'env.report.md >= 200 bytes'
  }));
}

// ─── Finalize and Output ──────────────────────────────────────────────────

if (!printJsonOutput(signal)) {
  writeSignal(signal, outputPath);
  printSummary(signal);
  console.log(`\nSignal: ${outputPath}`);
}

process.exit(signal.gate_decision.proceed ? 0 : 1);
