#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    signal: '',
    result: '',
    output: '',
    json: false,
    help: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--signal') { args.signal = argv[++i] || ''; continue; }
    if (arg === '--result') { args.result = argv[++i] || ''; continue; }
    if (arg === '--output') { args.output = argv[++i] || ''; continue; }
    if (arg === '--json') { args.json = true; continue; }
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function usage() {
  return [
    'Validate Mythos dispatch model/mind disclosure.',
    '',
    'Usage:',
    '  node tools/signals/validate-dispatch-disclosure.cjs --signal <signal.json> --result <run-result.json> [--json] [--output <report.json>]'
  ].join('\n');
}

function hasAllActorKernelParts(text) {
  const s = String(text || '');
  return /Current State\s*:/i.test(s) &&
    /Question\s*\/\s*Work\s*:/i.test(s) &&
    /Desired State\s*:/i.test(s);
}

function addIssue(issues, severity, code, message, refs = []) {
  issues.push({ severity, code, message, refs });
}

function validate(signalPath, resultPath) {
  const signal = readJson(signalPath);
  const result = readJson(resultPath);
  const issues = [];

  const actor = signal.recommended_next_actor || signal.target_actor || '';
  const model = result.execution_options && result.execution_options.model;
  const task = signal.task_summary || signal.next_prompt_stub || '';

  if (!actor) {
    addIssue(issues, 'error', 'missing-target-actor', 'Dispatch signal does not disclose the target actor.', [signalPath]);
  }
  if (!model) {
    addIssue(issues, 'error', 'missing-model', 'Run result does not disclose the model/mind used by the target actor.', [resultPath]);
  }
  if (!hasAllActorKernelParts(task)) {
    addIssue(issues, 'error', 'missing-actor-kernel', 'Dispatch task summary must include Current State, Question / Work, and Desired State.', [signalPath]);
  }
  if (!signal.recommended_next_command && !signal.next_prompt_stub) {
    addIssue(issues, 'error', 'missing-work-unit', 'Dispatch signal must disclose a command or bounded prompt work-unit.', [signalPath]);
  }
  if (!Array.isArray(result.artifacts_produced) || result.artifacts_produced.length === 0) {
    addIssue(issues, 'error', 'missing-return-evidence', 'Run result must list durable artifacts produced by the target actor.', [resultPath]);
  }
  if (!signal.grounding_mode || signal.grounding_mode === 'none') {
    addIssue(issues, 'warning', 'grounding-mode-absent', 'Dispatch signal has no grounding bundle. This may be acceptable for low-risk work but should be explicit for system-tier work.', [signalPath]);
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  return {
    schema: 'DispatchDisclosureValidation/1.0',
    timestamp: new Date().toISOString(),
    ok: errors.length === 0,
    signal: signalPath,
    result: resultPath,
    actor: actor || null,
    model: model || null,
    summary: {
      errors: errors.length,
      warnings: issues.length - errors.length
    },
    issues
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.signal || !args.result) {
    console.log(usage());
    process.exit(args.help ? 0 : 2);
  }
  const report = validate(args.signal, args.result);
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Dispatch disclosure validation: ${report.ok ? 'PASS' : 'FAIL'} (${report.summary.errors} errors, ${report.summary.warnings} warnings)`);
    for (const issue of report.issues) {
      console.log(`- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
    }
  }
  process.exit(report.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  hasAllActorKernelParts,
  validate
};
