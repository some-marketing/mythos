#!/usr/bin/env node
'use strict';

/**
 * next-step.js — CLI for the pipeline decision tree.
 *
 * Reads repo state and prints the deterministic next-step recommendation.
 * Skills and subagents call this instead of reasoning through handoff prose.
 *
 * Usage:
 *   node tools/signals/next-step.js [--json] [--help]
 */

const path = require('path');
const { resolveNextStep } = require('./lib/decision-tree');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node tools/signals/next-step.js [--json] [--help]

Reads repo state and prints the deterministic next-step recommendation.

Options:
  --json   Output structured JSON
  --help   Show this help`);
  process.exit(0);
}

const projectRoot = path.resolve(__dirname, '../..');
const result = resolveNextStep(projectRoot);

if (args.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Next: ${result.command || '(none)'}`);
  console.log(`Why:  ${result.reason}`);
  console.log(`From: ${result.source}`);
  if (result.blocked_by.length > 0) {
    console.log(`Blocked: ${result.blocked_by.join('; ')}`);
  }
  console.log(`Pipeline complete: ${result.context.pipeline_complete}`);
  console.log(`Live signals: ${result.context.live_signal_count}`);
  console.log(`Active workstreams: ${result.context.has_active_workstreams}`);
  console.log(`System verified: ${result.context.system_verified}`);
}
