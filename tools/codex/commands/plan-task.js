'use strict';

/**
 * plan-task.js — Codex-managed runner for /plan-task.
 */

const { buildNextTraceEnv } = require('../../telemetry/dispatches/lib/trace-context.cjs');
const {
  buildHarnessRoutingAdvisory,
  formatHarnessRoutingAdvisory
} = require('../../planning/lib/harness-routing-advisory');
const path = require('path');

function planTask(projectRoot, argsText, options = {}) {
  const nextEnv = buildNextTraceEnv({
    scope: 'planning',
    executionMode: 'managed'
  });
  const advisory = buildHarnessRoutingAdvisory(projectRoot, {
    task: argsText,
    now: options.now
  });
  const lines = [
    `[telemetry] trace_id=${nextEnv.MYTHOS_TRACE_ID} span_id=${nextEnv.MYTHOS_SPAN_ID}`,
    'Planning initialized.',
    '',
    formatHarnessRoutingAdvisory(advisory)
  ];

  return {
    exitCode: 0,
    stdout: lines.join('\n'),
    stderr: ''
  };
}

module.exports = { planTask };
