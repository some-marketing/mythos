#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateSpan } = require('./cascade-span.js');
const { validateProjection } = require('./debrief-close-span-projection.cjs');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function latestDecisionFile(dir) {
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.name || null;
}

function readJsonLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

function main() {
  const root = path.resolve(arg('root') || process.cwd());
  const decisionDir = path.join(root, '_dev/state/debrief-closeout/decisions');
  const sessionId = arg('session') || latestDecisionFile(decisionDir)?.replace(/\.jsonl$/, '');
  if (!sessionId) throw new Error('no native decision session found');
  const decisions = readJsonLines(path.join(decisionDir, `${sessionId}.jsonl`));
  const decision = decisions[decisions.length - 1];
  const actionId = decision && decision.telemetry_context && decision.telemetry_context.action_id;
  if (!actionId) throw new Error('decision has no telemetry_context.action_id');
  const observationFile = path.join(root, '_dev/state/debrief-closeout/span-observations.jsonl');
  const matches = readJsonLines(observationFile).filter((row) => row.home === 'native' && row.projection && row.projection.action_id === actionId);
  const errors = [];
  if (matches.length !== 1) errors.push(`expected one native observation for action_id ${actionId}, found ${matches.length}`);
  const observation = matches[0];
  if (observation) {
    const spanResult = validateSpan(observation.span);
    const projectionResult = validateProjection(observation.projection);
    if (!spanResult.ok) errors.push(...spanResult.errors.map((error) => `span:${error}`));
    if (!projectionResult.ok) errors.push(...projectionResult.errors.map((error) => `projection:${error}`));
    if (observation.actual_runtime_session_id !== decision.session_id) errors.push('runtime session mismatch');
    if (observation.projection.logical_session_id !== decision.telemetry_context.logical_session_id) errors.push('logical session mismatch');
    if (observation.projection.outcome !== decision.outcome) errors.push('outcome mismatch');
    if (observation.projection.enforced !== decision.enforced) errors.push('enforced mismatch');
    if (observation.span.trace_id !== decision.telemetry_context.trace_id) errors.push('trace_id mismatch');
  }
  const result = {
    schema: 'DebriefCloseDecisionSpanJoinValidation/1.0',
    ok: errors.length === 0,
    session_id: sessionId,
    action_id: actionId,
    decision_id: decision.decision_id,
    matched_observations: matches.length,
    errors
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
