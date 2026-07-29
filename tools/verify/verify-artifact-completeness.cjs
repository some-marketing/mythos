#!/usr/bin/env node
/**
 * verify-artifact-completeness.cjs — Check whether debrief, validation, and
 * closeout artifacts exist and conform to expected schemas.
 *
 * Gives the LLM rapid structured feedback about what's missing after a
 * sequence closeout without needing to scan files manually.
 *
 * Usage:
 *   node tools/verify/verify-artifact-completeness.cjs [--scope <scope>] [--json] [--project-root <path>] [--help]
 *
 * Exit code 0 = all checks pass, 1 = any check fails
 */

const fs = require('fs');
const path = require('path');

// ─── CLI parsing ────────────────────────────────────────────────────────

let scopeFlag = null;
let jsonOutput = false;
let projectRootFlag = null;

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--help' || process.argv[i] === '-h') {
    console.log(`Usage: node tools/verify/verify-artifact-completeness.cjs [--scope <scope>] [--json] [--project-root <path>] [--help]

Options:
  --scope <scope>          Scope identifier to check artifacts for (optional;
                           if omitted, checks the latest/most-recent artifacts)
  --json                   Output structured JSON instead of human-readable text
  --project-root <path>    Override project root (default: two levels up from script)
  --help                   Show this help message`);
    process.exit(0);
  }
  if ((process.argv[i] === '--scope' || process.argv[i] === '-s') && process.argv[i + 1]) {
    scopeFlag = process.argv[++i];
  }
  if (process.argv[i] === '--project-root' && process.argv[i + 1]) {
    projectRootFlag = process.argv[++i];
  }
  if (process.argv[i] === '--json') {
    jsonOutput = true;
  }
}

const PROJECT_ROOT = projectRootFlag
  ? path.resolve(projectRootFlag)
  : path.resolve(__dirname, '../..');

// ─── Helpers ────────────────────────────────────────────────────────────

const analysisDir = path.join(PROJECT_ROOT, '_dev', 'reports', 'analysis');
const signalDir = path.join(PROJECT_ROOT, '_dev', 'reports', 'signals');
const closedSignalDir = path.join(signalDir, 'closed');

/**
 * List files in a directory, returning [] if the directory doesn't exist.
 */
function safeReaddir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

/**
 * Find the most recent file matching a prefix and suffix in a directory,
 * optionally scoped by a substring.
 *
 * @param {string} dir      Directory to scan
 * @param {string} prefix   Filename prefix (e.g. 'session-debrief__')
 * @param {string} suffix   Filename suffix (e.g. '.md')
 * @param {string|null} scope  Optional scope substring to filter by
 * @returns {{ name: string, fullPath: string } | null}
 */
function findArtifact(dir, prefix, suffix, scope) {
  const files = safeReaddir(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith(suffix))
    .filter(f => !scope || f.includes(scope));

  if (files.length === 0) return null;

  // Sort by mtime descending, pick most recent
  files.sort((a, b) => {
    try {
      const aTime = fs.statSync(path.join(dir, a)).mtimeMs;
      const bTime = fs.statSync(path.join(dir, b)).mtimeMs;
      return bTime - aTime;
    } catch { return 0; }
  });

  return { name: files[0], fullPath: path.join(dir, files[0]) };
}

function findArtifactInDirs(dirs, prefix, suffix, scope) {
  const artifacts = dirs
    .map(dir => findArtifact(dir, prefix, suffix, scope))
    .filter(Boolean);

  if (artifacts.length === 0) return null;

  artifacts.sort((a, b) => {
    try {
      const aTime = fs.statSync(a.fullPath).mtimeMs;
      const bTime = fs.statSync(b.fullPath).mtimeMs;
      return bTime - aTime;
    } catch { return 0; }
  });

  return artifacts[0];
}

/**
 * Safely parse a JSON file, returning null on any error.
 */
function safeParseJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

// ─── Build findings ─────────────────────────────────────────────────────

const findings = [];

function addFinding(id, severity, passed, message, detail) {
  findings.push({
    id,
    severity,
    status: passed ? 'PASS' : 'FAIL',
    message,
    detail: detail || (passed ? 'OK' : 'Not found')
  });
}

// Resolve effective scope label for output
const effectiveScope = scopeFlag || 'latest';

// ─── 1. Session debrief ─────────────────────────────────────────────────

const debrief = findArtifact(analysisDir, 'session-debrief__', '.md', scopeFlag);
const canonicalDebrief = debrief || findArtifact(analysisDir, 'run-debrief__', '.md', scopeFlag);
addFinding(
  'session_debrief_exists',
  'error',
  !!canonicalDebrief,
  `Session debrief exists for scope "${effectiveScope}"`,
  canonicalDebrief
    ? `Found at _dev/reports/analysis/${canonicalDebrief.name}`
    : `No session-debrief__*.md or run-debrief__*.md found${scopeFlag ? ` matching scope "${scopeFlag}"` : ''}`
);

// ─── 2. Closeout validation ─────────────────────────────────────────────

const closeoutVal = findArtifact(analysisDir, 'closeout-validation__', '.json', scopeFlag);
const closeoutValExists = !!closeoutVal;
addFinding(
  'closeout_validation_exists',
  'error',
  closeoutValExists,
  `Closeout validation JSON exists for scope "${effectiveScope}"`,
  closeoutVal
    ? `Found at _dev/reports/analysis/${closeoutVal.name}`
    : `No closeout-validation__*.json found${scopeFlag ? ` matching scope "${scopeFlag}"` : ''}`
);

if (closeoutValExists) {
  const valData = safeParseJson(closeoutVal.fullPath);
  const requiredFields = ['sequence_id', 'validations', 'overall'];
  // Also accept 'scope' + 'evidence' + 'verdict' as an alternate shape
  const hasCanonicalFields = valData && requiredFields.every(k => k in valData);
  const hasAlternateFields = valData && 'scope' in valData && 'evidence' in valData && 'verdict' in valData;
  const hasRequiredShape = hasCanonicalFields || hasAlternateFields;

  addFinding(
    'closeout_validation_schema',
    'error',
    hasRequiredShape,
    'Closeout validation has required fields',
    hasRequiredShape
      ? `Valid shape: ${hasCanonicalFields ? 'canonical (sequence_id, validations, overall)' : 'alternate (scope, evidence, verdict)'}`
      : `Missing required fields in ${closeoutVal.name}. Expected (sequence_id, validations, overall) or (scope, evidence, verdict).`
  );
}

// ─── 3. Closeout reflection ─────────────────────────────────────────────

const reflection = findArtifact(analysisDir, 'closeout-reflection__', '.md', scopeFlag);
addFinding(
  'closeout_reflection_exists',
  'error',
  !!reflection,
  `Closeout reflection exists for scope "${effectiveScope}"`,
  reflection
    ? `Found at _dev/reports/analysis/${reflection.name}`
    : `No closeout-reflection__*.md found${scopeFlag ? ` matching scope "${scopeFlag}"` : ''}`
);

// ─── 4. Lessons reconciliation ──────────────────────────────────────────

const lessons = findArtifact(analysisDir, 'lessons-reconciliation__', '.md', scopeFlag);
addFinding(
  'lessons_reconciliation_exists',
  'warning',
  !!lessons,
  `Lessons reconciliation exists${scopeFlag ? ` for scope "${scopeFlag}"` : ' (any recent)'}`,
  lessons
    ? `Found at _dev/reports/analysis/${lessons.name}`
    : 'No lessons-reconciliation__*.md found'
);

// ─── 5. Lessons expectation-failures JSON ───────────────────────────────

const lessonsJson = findArtifact(analysisDir, 'lessons-reconciliation__', '.expectation-failures.json', scopeFlag);
addFinding(
  'lessons_expectation_failures_exists',
  'warning',
  !!lessonsJson,
  `Lessons expectation-failures JSON exists${scopeFlag ? ` for scope "${scopeFlag}"` : ' (any recent)'}`,
  lessonsJson
    ? `Found at _dev/reports/analysis/${lessonsJson.name}`
    : 'No lessons-reconciliation__*.expectation-failures.json found'
);

// ─── 6. Clear-readiness signal ──────────────────────────────────────────

const clearReadiness = findArtifactInDirs([signalDir, closedSignalDir], 'clear-readiness__', '.json', scopeFlag);
let clearReadinessValid = false;

if (clearReadiness) {
  const crData = safeParseJson(clearReadiness.fullPath);
  clearReadinessValid = crData
    && crData.schema === 'HandoffSignal/1.0'
    && crData.ready_for_clear === true;
}

addFinding(
  'clear_readiness_signal',
  'error',
  clearReadinessValid,
  `Clear-readiness signal exists for scope "${effectiveScope}" with ready_for_clear: true`,
  clearReadiness
    ? (clearReadinessValid
      ? `Found at ${path.relative(PROJECT_ROOT, clearReadiness.fullPath)} — schema and ready_for_clear validated`
      : `Found at ${path.relative(PROJECT_ROOT, clearReadiness.fullPath)} but schema or ready_for_clear check failed`)
    : `No clear-readiness__*.json found${scopeFlag ? ` matching scope "${scopeFlag}"` : ''}`
);

// ─── 7. Verification signal ────────────────────────────────────────────

const verifySystemPath = path.join(signalDir, 'verify-system.signal.json');
let verifySystemPass = false;

if (fs.existsSync(verifySystemPath)) {
  const vsData = safeParseJson(verifySystemPath);
  verifySystemPass = vsData && vsData.verdict === 'PASS';
}

addFinding(
  'verify_system_pass',
  'error',
  verifySystemPass,
  'Verification signal (verify-system.signal.json) has verdict: "PASS"',
  fs.existsSync(verifySystemPath)
    ? (verifySystemPass
      ? 'verify-system.signal.json verdict is PASS'
      : `verify-system.signal.json verdict is ${safeParseJson(verifySystemPath)?.verdict || 'MISSING'}`)
    : 'verify-system.signal.json not found'
);

// ─── Compute verdict ────────────────────────────────────────────────────

const failCount = findings.filter(f => f.status === 'FAIL' && f.severity === 'error').length;
const warnCount = findings.filter(f => f.status === 'FAIL' && f.severity === 'warning').length;
const passCount = findings.filter(f => f.status === 'PASS').length;

let verdict;
if (failCount > 0) {
  verdict = 'FAIL';
} else if (warnCount > 0) {
  verdict = 'WARN';
} else {
  verdict = 'PASS';
}

// ─── Output ─────────────────────────────────────────────────────────────

const result = {
  verifier: 'verify-artifact-completeness',
  scope: effectiveScope,
  timestamp: new Date().toISOString(),
  verdict,
  summary: {
    total: findings.length,
    passed: passCount,
    failed: failCount + warnCount,
    warned: warnCount
  },
  findings
};

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const label = verdict === 'PASS' ? 'PASS' : verdict === 'WARN' ? 'WARN' : 'FAIL';
  console.log(`\n${label}: verify-artifact-completeness — scope: ${effectiveScope}`);
  console.log(`  ${passCount}/${findings.length} checks passed`);

  const failures = findings.filter(f => f.status === 'FAIL');
  if (failures.length > 0) {
    console.log(`\n  Failures (${failures.length}):`);
    for (const f of failures) {
      console.log(`    - [${f.severity}] ${f.message}`);
      if (f.detail) console.log(`      ${f.detail}`);
    }
  }

  const passes = findings.filter(f => f.status === 'PASS');
  if (passes.length > 0) {
    console.log(`\n  Passed (${passes.length}):`);
    for (const p of passes) {
      console.log(`    - ${p.message}`);
      if (p.detail) console.log(`      ${p.detail}`);
    }
  }

  console.log(`\n  Verdict: ${verdict}`);
}

process.exit(verdict === 'FAIL' ? 1 : 0);
