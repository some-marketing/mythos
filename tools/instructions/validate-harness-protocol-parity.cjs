#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_MATRIX = '_dev/reports/analysis/harness-protocol-parity__matrix.json';
const DEFAULT_PROPAGATION = '_dev/config/harness-protocol-propagation.json';
const REQUIRED_HARNESSES = ['claude', 'codex', 'codewhale', 'gemini', 'opencode', 'pi', 'hermes'];
const REQUIRED_PROTOCOLS = [
  'owl_orchestrate_loop_routing',
  'distinct_minds_review',
  'convene_callout',
  'dispatch_model_disclosure_tiering',
  'actor_continuity_return_contract',
  'plan_review_gate',
  'lifecycle_hook_emulation',
  'destructive_command_and_credential_gates',
  'debrief_before_closeout',
  'target_command_compatibility'
];
const ENFORCEMENT_TIERS = new Set([
  'model-behavior',
  'command-mediated',
  'hybrid',
  'mechanical-validator',
  'mechanical-hook',
  'broker-sandbox',
  'native-core',
  'absent',
  'unknown'
]);
const MECHANIZED_TIERS = new Set(['mechanical-validator', 'mechanical-hook', 'broker-sandbox', 'native-core']);

function parseArgs(argv) {
  const args = {
    matrix: DEFAULT_MATRIX,
    propagation: DEFAULT_PROPAGATION,
    json: false,
    output: '',
    help: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--matrix') { args.matrix = argv[++i] || args.matrix; continue; }
    if (arg === '--propagation') { args.propagation = argv[++i] || args.propagation; continue; }
    if (arg === '--output') { args.output = argv[++i] || ''; continue; }
    if (arg === '--json') { args.json = true; continue; }
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
  }
  return args;
}

function help() {
  console.log(`
Validate harness protocol parity evidence.

Usage:
  node tools/instructions/validate-harness-protocol-parity.cjs [options]

Options:
  --matrix <path>        Matrix JSON path. Default ${DEFAULT_MATRIX}
  --propagation <path>   Propagation manifest path. Default ${DEFAULT_PROPAGATION}
  --output <path>        Write JSON report.
  --json                 Print full JSON report.
  --help                 Show help.
`.trim());
}

function abs(relOrAbs) {
  return path.isAbsolute(relOrAbs) ? relOrAbs : path.join(PROJECT_ROOT, relOrAbs);
}

function rel(filePath) {
  return path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(abs(filePath), 'utf8'));
}

function exists(relPath) {
  return fs.existsSync(abs(relPath));
}

function readText(relPath) {
  return fs.readFileSync(abs(relPath), 'utf8');
}

function commandWiresUserPromptHook(commands, scriptName, opts = {}) {
  if (commands.some((command) => command.includes(scriptName))) return true;

  const dispatcherPath = opts.dispatcherPath || 'tools/kernel/hooks/dispatch-userprompt.cjs';
  const hasDispatcher = commands.some((command) => command.includes('dispatch-userprompt.cjs'));
  if (!hasDispatcher || !exists(dispatcherPath)) return false;

  return readText(dispatcherPath).includes(scriptName);
}

function addIssue(list, severity, code, message, refs = []) {
  list.push({ severity, code, message, refs });
}

function evidenceExists(ref) {
  if (!ref || typeof ref !== 'string') return false;
  const first = ref.split(/\s+/)[0].replace(/[:;,)]$/, '');
  if (!first) return false;
  if (first.includes('*')) return true;
  return exists(first);
}

function validateMatrix(matrix, issues) {
  if (matrix.schema !== 'HarnessProtocolParityMatrix/1.0') {
    addIssue(issues, 'error', 'matrix-schema', `Unsupported matrix schema ${matrix.schema || '(missing)'}`);
  }
  for (const protocol of REQUIRED_PROTOCOLS) {
    if (!matrix.protocols || !matrix.protocols[protocol]) {
      addIssue(issues, 'error', 'missing-protocol', `Matrix missing protocol ${protocol}`);
      continue;
    }
    for (const harness of REQUIRED_HARNESSES) {
      const cell = matrix.protocols[protocol][harness];
      if (!cell) {
        addIssue(issues, 'error', 'missing-harness-cell', `Matrix missing ${protocol}.${harness}`);
        continue;
      }
      if (!cell.tier) {
        addIssue(issues, 'error', 'missing-tier', `Matrix cell ${protocol}.${harness} has no tier`);
      }
      if (!ENFORCEMENT_TIERS.has(cell.enforcement_tier)) {
        addIssue(issues, 'error', 'missing-enforcement-tier', `Matrix cell ${protocol}.${harness} has invalid enforcement_tier ${cell.enforcement_tier || '(missing)'}`);
      }
      if (typeof cell.mechanized !== 'boolean') {
        addIssue(issues, 'error', 'missing-mechanized-state', `Matrix cell ${protocol}.${harness} has no boolean mechanized state`);
      } else if (ENFORCEMENT_TIERS.has(cell.enforcement_tier) && cell.mechanized !== MECHANIZED_TIERS.has(cell.enforcement_tier)) {
        addIssue(issues, 'error', 'mechanized-tier-mismatch', `Matrix cell ${protocol}.${harness} mechanized state disagrees with ${cell.enforcement_tier}`);
      }
      if (cell.completed_descent === true) {
        if (!Array.isArray(cell.tier_history) || cell.tier_history.length < 2) {
          addIssue(issues, 'error', 'descent-history-missing', `Matrix cell ${protocol}.${harness} claims completed descent without tier history`);
        }
        if (!cell.descent_candidate_evidence || !evidenceExists(cell.descent_candidate_evidence)) {
          addIssue(issues, 'error', 'descent-candidate-evidence-missing', `Matrix cell ${protocol}.${harness} claims completed descent without candidate evidence`);
        }
      }
      if ((String(cell.tier).includes('structural') || String(cell.tier).includes('target')) && (!Array.isArray(cell.evidence) || cell.evidence.length === 0)) {
        addIssue(issues, 'error', 'structural-without-evidence', `${protocol}.${harness} claims ${cell.tier} without evidence`);
      }
      for (const ref of cell.evidence || []) {
        if (!evidenceExists(ref)) {
          addIssue(issues, 'warning', 'evidence-ref-not-found', `${protocol}.${harness} evidence ref may not exist: ${ref}`);
        }
      }
    }
  }
}

function validateEnforcementTierCoverage(matrix) {
  const issues = [];
  validateMatrix(matrix, issues);
  return issues.filter((issue) => issue.code.includes('enforcement-tier') || issue.code.includes('mechanized') || issue.code.includes('descent-'));
}

function validateKnownGates(issues) {
  validateSmosRuntimeContract(issues);

  if (!exists('.claude/settings.json')) {
    addIssue(issues, 'error', 'claude-settings-missing', '.claude/settings.json is missing');
  } else {
    const settings = readJson('.claude/settings.json');
    const commands = [];
    for (const entry of ((settings.hooks || {}).UserPromptSubmit || [])) {
      for (const hook of entry.hooks || []) commands.push(String(hook.command || ''));
    }
    if (!commandWiresUserPromptHook(commands, 'userpromptsubmit-ambient-router.cjs')) {
      addIssue(issues, 'error', 'claude-ambient-router-unwired', 'Claude UserPromptSubmit does not wire userpromptsubmit-ambient-router.cjs', ['.claude/settings.json', 'tools/kernel/hooks/dispatch-userprompt.cjs']);
    }
    if (!commandWiresUserPromptHook(commands, 'userprompt-plan-review-gate.cjs')) {
      addIssue(issues, 'error', 'claude-plan-review-gate-unwired', 'Claude UserPromptSubmit does not wire userprompt-plan-review-gate.cjs', ['.claude/settings.json', 'tools/kernel/hooks/dispatch-userprompt.cjs']);
    }
  }

  if (exists('tools/signals/lib/target-command-policy.cjs')) {
    const policy = readText('tools/signals/lib/target-command-policy.cjs');
    if (/MANAGED_COMMAND_TARGETS\s*=\s*Object\.freeze\([^)]*['"]pi['"]/.test(policy) || /FREEFORM_PROMPT_TARGETS\s*=\s*Object\.freeze\([^)]*['"]pi['"]/.test(policy)) {
      addIssue(issues, 'error', 'pi-target-premature', 'Pi appears registered as a dispatch target before this task proves invocation truth.', ['tools/signals/lib/target-command-policy.cjs']);
    }
    if (/MANAGED_COMMAND_TARGETS\s*=\s*Object\.freeze\([^)]*['"]hermes['"]/.test(policy) || /FREEFORM_PROMPT_TARGETS\s*=\s*Object\.freeze\([^)]*['"]hermes['"]/.test(policy)) {
      addIssue(issues, 'error', 'hermes-target-premature', 'Hermes appears registered as a dispatch target before this task proves invocation truth.', ['tools/signals/lib/target-command-policy.cjs']);
    }
  }
}

function validateSmosRuntimeContract(issues) {
  const contractPath = 'instructions/canonical/harness-runtime-contract.md';
  if (!exists(contractPath)) {
    addIssue(issues, 'error', 'runtime-contract-missing', 'SM_OS harness runtime contract is missing.', [contractPath]);
    return;
  }

  const contract = readText(contractPath);
  for (const token of ['BLOCKING', 'ADVISORY', 'ABSENT', 'UNKNOWN']) {
    if (!contract.includes(token)) {
      addIssue(issues, 'error', 'runtime-contract-tier-missing', `Runtime contract does not define capability tier ${token}.`, [contractPath]);
    }
  }
  for (const token of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SubagentStop', 'SessionEnd']) {
    if (!contract.includes(token)) {
      addIssue(issues, 'error', 'runtime-contract-event-missing', `Runtime contract does not name lifecycle event ${token}.`, [contractPath]);
    }
  }

  for (const relPath of [
    'tools/smos-runtime/managed-runtime.js',
    'tools/smos-runtime/hook-emulation.js',
    'tools/codex/lib/managed-runtime.js',
    'tools/codex/lib/hook-emulation.js',
    'tools/signals/validate-dispatch-disclosure.cjs',
    '_dev/reports/analysis/smos-managed-runtime-first-slice__source-review.md'
  ]) {
    if (!exists(relPath)) {
      addIssue(issues, 'error', 'runtime-surface-missing', `Expected SM_OS runtime first-slice surface is missing: ${relPath}`, [relPath]);
    }
  }

  if (exists('package.json')) {
    const pkg = readJson('package.json');
    const scripts = pkg.scripts || {};
    for (const scriptName of ['smos:boot', 'smos:hook', 'smos:runtime', 'codex:boot', 'codex:hook', 'codex:smos', 'signals:dispatch-disclosure']) {
      if (!scripts[scriptName]) {
        addIssue(issues, 'error', 'runtime-script-missing', `package.json missing script ${scriptName}`, ['package.json']);
      }
    }
  }
}

function validatePropagationManifest(manifest, issues) {
  if (manifest.schema !== 'HarnessProtocolPropagation/1.0') {
    addIssue(issues, 'error', 'propagation-schema', `Unsupported propagation schema ${manifest.schema || '(missing)'}`);
  }
  const sourceKinds = manifest.source_kinds || {};
  for (const kind of ['hooks', 'skills', 'commands', 'framework_harnesses']) {
    const entry = sourceKinds[kind];
    if (!entry) {
      addIssue(issues, 'error', 'missing-source-kind', `Propagation manifest missing source kind ${kind}`);
      continue;
    }
    for (const harness of REQUIRED_HARNESSES) {
      const fanout = entry.fanout && entry.fanout[harness];
      if (!fanout) {
        addIssue(issues, 'error', 'missing-fanout-rule', `${kind} has no fanout rule for ${harness}`);
        continue;
      }
      if (fanout.rule === 'not_applicable' && !fanout.reason) {
        addIssue(issues, 'error', 'missing-not-applicable-reason', `${kind}.${harness} is not_applicable without a reason`);
      }
      if (fanout.rule !== 'not_applicable' && (!Array.isArray(fanout.targets) || fanout.targets.length === 0)) {
        addIssue(issues, 'error', 'fanout-targets-missing', `${kind}.${harness} rule ${fanout.rule} has no targets`);
      }
    }
  }
}

function buildReport(args) {
  const issues = [];
  const matrix = readJson(args.matrix);
  const propagation = readJson(args.propagation);
  validateMatrix(matrix, issues);
  validateKnownGates(issues);
  validatePropagationManifest(propagation, issues);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return {
    schema: 'HarnessProtocolParityValidation/1.0',
    timestamp: new Date().toISOString(),
    matrix: args.matrix,
    propagation_manifest: args.propagation,
    ok: errors.length === 0,
    summary: {
      errors: errors.length,
      warnings: warnings.length
    },
    issues,
    next_command: errors.length === 0
      ? 'node tools/instructions/harness-protocol-propagation.cjs --check'
      : 'repair the listed harness parity validation errors'
  };
}

function writeReport(report, outputPath) {
  if (!outputPath) return null;
  const target = abs(outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    help();
    return;
  }
  const report = buildReport(args);
  const outputPath = writeReport(report, args.output);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Harness protocol parity validation: ${report.ok ? 'PASS' : 'FAIL'} (${report.summary.errors} errors, ${report.summary.warnings} warnings)`);
    if (outputPath) console.log(`Report: ${rel(outputPath)}`);
    if (report.issues.length) {
      for (const issue of report.issues.slice(0, 20)) {
        console.log(`- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
      }
      if (report.issues.length > 20) console.log(`... ${report.issues.length - 20} more issues`);
    }
    console.log(`Next: ${report.next_command}`);
  }
  process.exit(report.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  buildReport,
  commandWiresUserPromptHook,
  parseArgs,
  validateEnforcementTierCoverage
};
