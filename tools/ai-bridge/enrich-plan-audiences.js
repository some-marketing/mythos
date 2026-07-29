#!/usr/bin/env node
'use strict';

const { enrichPlanFile } = require('./lib/plan-audience-enrichment.cjs');

function usage() {
  return [
    'Usage: node tools/ai-bridge/enrich-plan-audiences.js --plan <task-id|path> [--write|--output <path>] [--json]',
    '',
    'Offline-enriches missing TaskPlan audiences.owner/media_buyer what/why fields from source plan text.',
    'Writing is opt-in and fail-closed: the enriched plan must pass the S3 audience framing lint first.',
    'This deterministic source-derived mode does not call an LLM.'
  ].join('\n');
}

function parseArgs(argv) {
  const args = { plan: '', write: false, outputPath: '', json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--plan') {
      args.plan = argv[i + 1];
      i += 1;
    } else if (arg === '--write') {
      args.write = true;
    } else if (arg === '--output') {
      args.outputPath = argv[i + 1];
      i += 1;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (!args.plan && !arg.startsWith('--')) {
      args.plan = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function formatText(result) {
  const lines = [
    `Plan audience enrichment: ${result.source_plan}`,
    `Status: ${result.ok ? 'PASS' : 'FAIL'}`,
    `Mode: ${result.write ? 'write source plan' : result.output_plan ? `write copy ${result.output_plan}` : 'dry run'}`,
    `Changed fields: ${result.changed}`,
    `Checked audience fields: ${result.lint.checked_audience_fields}`,
    `Findings: ${result.lint.findings.length}`
  ];
  for (const item of result.lint.findings) {
    lines.push(`- ${item.severity.toUpperCase()} ${item.code} [${item.step_id}/${item.audience}/${item.field}] ${item.message}`);
  }
  return lines.join('\n');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }

  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.plan) {
    console.error('--plan is required.');
    console.error(usage());
    process.exit(2);
  }
  if (args.write && args.outputPath) {
    console.error('Use only one of --write or --output.');
    process.exit(2);
  }

  try {
    const result = enrichPlanFile(process.cwd(), args);
    if (args.json) {
      const { plan, ...summary } = result;
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(formatText(result));
    }
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, main };
