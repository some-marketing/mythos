/**
 * signal.cjs — VerificationSignal builder and lifecycle manager for Mythos.
 *
 * Usage:
 *   const { createSignal, addCheck, finalize, writeSignal } = require('./lib/signal.cjs');
 *   const signal = createSignal('verify-framework', 'framework:wordpress/qa');
 *   addCheck(signal, { id: 'foo', category: 'bar', severity: 'critical', status: 'PASS', message: '...' });
 *   finalize(signal);
 *   writeSignal(signal, 'tools/verify/.scratch/signal.json');
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION_1_0 = 'VerificationSignal/1.0';
const SCHEMA_VERSION_1_1 = 'VerificationSignal/1.1';
// Default export for backward compat — existing callers read this constant.
const SCHEMA_VERSION = SCHEMA_VERSION_1_0;

const VALID_SIGNAL_TYPES = ['cycle-complete', 'ready-for-review', 'blocked', 'ready-for-clear'];
const VALID_LIFECYCLE_STATES = ['live', 'closed'];
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

function portablePathString(value) {
  if (typeof value !== 'string') return value;
  return value
    .split(PROJECT_ROOT + path.sep).join('')
    .split(PROJECT_ROOT).join('.');
}

function makeSignalPortable(value) {
  if (Array.isArray(value)) return value.map(makeSignalPortable);
  if (!value || typeof value !== 'object') return portablePathString(value);
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = makeSignalPortable(entry);
  }
  return result;
}

function createSignal(source, scope, tier = 'mechanical', opts = {}) {
  const isProfileAware = Boolean(opts.profileId);
  const signal = {
    schema: isProfileAware ? SCHEMA_VERSION_1_1 : SCHEMA_VERSION_1_0,
    timestamp: new Date().toISOString(),
    source,
    scope,
    tier,
    verdict: null,
    summary: { total: 0, passed: 0, failed: 0, warned: 0, skipped: 0 },
    checks: [],
    failures: [],
    gate_decision: { proceed: null, reason: '', blocked_by: [] }
  };
  // v1.1 fields — present only when a profile is active.
  // Populates the minimum fields required by the v1.1 schema.
  if (isProfileAware) {
    signal.profile_id = opts.profileId;
    if (opts.attempt != null) signal.attempt = opts.attempt;
    signal.next_actions = [];
    signal.remediation = {
      auto_fix_safe_actions: false,
      max_attempts: 0,
      remaining_attempts: 0
    };
  }
  return signal;
}

function addNextAction(signal, action) {
  if (!Array.isArray(signal.next_actions)) return;
  signal.next_actions.push(action);
}

function addCheck(signal, opts) {
  const { id, category, severity = 'critical', message, evidence, detail, fix_hint } = opts;
  let status = opts.status;

  if (typeof opts.test === 'function') {
    try {
      const result = opts.test();
      status = result ? 'PASS' : (severity === 'warning' ? 'WARN' : 'FAIL');
    } catch (e) {
      status = 'FAIL';
    }
  }

  const check = { id, category, severity, status, message };
  if (evidence) check.evidence = evidence;
  if (detail) check.detail = detail;

  signal.checks.push(check);
  signal.summary.total++;

  switch (status) {
    case 'PASS': signal.summary.passed++; break;
    case 'FAIL':
      signal.summary.failed++;
      signal.failures.push({
        id, category, message,
        ...(fix_hint ? { fix_hint } : {})
      });
      if (severity === 'critical') {
        signal.gate_decision.blocked_by.push(id);
      }
      break;
    case 'WARN': signal.summary.warned++; break;
    case 'SKIP': signal.summary.skipped++; break;
  }

  return check;
}

function finalize(signal) {
  const criticalFails = signal.checks.filter(c => c.status === 'FAIL' && c.severity === 'critical');

  if (criticalFails.length > 0) {
    signal.verdict = 'FAIL';
    signal.gate_decision.proceed = false;
    signal.gate_decision.reason = `${criticalFails.length} critical check(s) failed.`;
  } else if (signal.summary.warned > 0) {
    signal.verdict = 'WARN';
    signal.gate_decision.proceed = true;
    signal.gate_decision.reason = `All critical checks pass. ${signal.summary.warned} warning(s) (non-blocking).`;
    signal.gate_decision.blocked_by = [];
  } else {
    signal.verdict = 'PASS';
    signal.gate_decision.proceed = true;
    signal.gate_decision.reason = `All ${signal.summary.total} checks pass.`;
    signal.gate_decision.blocked_by = [];
  }

  return signal;
}

function writeSignal(signal, outputPath) {
  if (signal.verdict === null) finalize(signal);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(makeSignalPortable(signal), null, 2));
  return outputPath;
}

function readSignal(signalPath) {
  return JSON.parse(fs.readFileSync(signalPath, 'utf8'));
}

function readAndClean(signalPath) {
  if (!fs.existsSync(signalPath)) {
    throw new Error(`Signal file not found: ${signalPath}`);
  }
  const signal = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
  fs.unlinkSync(signalPath);
  return signal;
}

function printSummary(signal) {
  const label = signal.verdict === 'PASS' ? 'PASS' : signal.verdict === 'WARN' ? 'WARN' : 'FAIL';
  console.log(`\n${label}: ${signal.source} — ${signal.scope}`);
  console.log(`  ${signal.summary.passed}/${signal.summary.total} checks passed`);

  if (signal.failures.length > 0) {
    console.log(`\n  Failures (${signal.failures.length}):`);
    for (const f of signal.failures) {
      console.log(`    - [${f.category}] ${f.message}${f.fix_hint ? ` -> ${f.fix_hint}` : ''}`);
    }
  }

  if (signal.summary.warned > 0) {
    const warns = signal.checks.filter(c => c.status === 'WARN');
    console.log(`\n  Warnings (${warns.length}):`);
    for (const w of warns) {
      console.log(`    - [${w.category}] ${w.message}`);
    }
  }

  console.log(`\n  Gate: proceed=${signal.gate_decision.proceed} — ${signal.gate_decision.reason}`);
}

module.exports = {
  SCHEMA_VERSION,
  SCHEMA_VERSION_1_0,
  SCHEMA_VERSION_1_1,
  VALID_SIGNAL_TYPES,
  VALID_LIFECYCLE_STATES,
  createSignal,
  addCheck,
  addNextAction,
  finalize,
  writeSignal,
  readSignal,
  readAndClean,
  printSummary
};
