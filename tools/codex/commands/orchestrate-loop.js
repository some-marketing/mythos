'use strict';

/**
 * orchestrate-loop.js — Codex-managed runner for /orchestrate-loop.
 */

const { buildNextTraceEnv } = require('../../telemetry/dispatches/lib/trace-context.cjs');
const path = require('path');

function orchestrateLoop(projectRoot, argsText, options = {}) {
  const nextEnv = buildNextTraceEnv({
    scope: 'orchestrate-loop',
    executionMode: 'managed'
  });

  return {
    exitCode: 0,
    stdout: [
      `[telemetry] trace_id=${nextEnv.MYTHOS_TRACE_ID} span_id=${nextEnv.MYTHOS_SPAN_ID}`,
      '',
      'ORCHESTRATION LOOP ACTIVE.',
      'This unit of work is now being managed by the review-driven orchestrate-loop skill.',
      'Follow the skill instructions for actor boundaries and classification.'
    ].join('\n'),
    stderr: ''
  };
}

module.exports = { orchestrateLoop };
