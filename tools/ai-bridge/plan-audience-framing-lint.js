#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { lintPlanAudienceFraming } = require('./lib/plan-audience-framing-lint.cjs');

function usage() {
  console.log(`
Usage:
  node tools/ai-bridge/plan-audience-framing-lint.js <plan.json> [--json]

Deterministically lints TaskPlan audiences.*.what/why voicings for observational
framing, per-item provenance, fact-subset, and claim-type constancy.
`.trim());
}

function parseArgs(argv) {
  const args = { json: false, help: false, planPath: '' };
  for (const arg of argv.slice(2)) {
    if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (!args.planPath) args.planPath = arg;
  }
  return args;
}

function formatText(result, planPath) {
  const lines = [
    `Plan audience framing lint: ${planPath}`,
    `Status: ${result.ok ? 'PASS' : 'FAIL'}`,
    `Checked steps: ${result.checked_steps}`,
    `Checked audience fields: ${result.checked_audience_fields}`,
    `Findings: ${result.findings.length}`
  ];
  for (const item of result.findings) {
    lines.push(
      `- ${item.severity.toUpperCase()} ${item.code} ` +
      `[${item.step_id || '(missing-step)'}/${item.audience}/${item.field}]: ${item.message}` +
      (item.value ? ` (${item.value})` : '')
    );
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }
  if (!args.planPath) {
    usage();
    process.exit(2);
  }

  const planPath = path.resolve(args.planPath);
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  } catch (error) {
    console.error(`ERROR: Could not read plan JSON: ${error.message}`);
    process.exit(2);
  }

  const result = lintPlanAudienceFraming(plan, { plan_path: args.planPath });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatText(result, args.planPath));
  process.exit(result.ok ? 0 : 1);
}

main();
