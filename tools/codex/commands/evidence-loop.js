'use strict';

const { buildNextTraceEnv } = require('../../telemetry/dispatches/lib/trace-context.cjs');

function parseArgs(argsText = '') {
  const tokens = String(argsText).match(/"[^"]*"|'[^']*'|\S+/g) || [];
  const cleaned = tokens.map((token) => {
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) return token.slice(1, -1);
    return token;
  });
  return {
    dryRun: cleaned.includes('--dry-run'),
    target: cleaned.filter((token) => token !== '--dry-run').join(' ').trim()
  };
}

function evidenceLoop(projectRoot, argsText, options = {}) {
  const parsed = parseArgs(argsText);
  if (!parsed.target) {
    return { exitCode: 1, stdout: '', stderr: 'Missing Evidence Loop target.' };
  }
  const trace = buildNextTraceEnv({ scope: 'evidence-loop', executionMode: 'managed' });
  const result = {
    command: '/evidence-loop',
    profile: 'evidence-loop',
    target: parsed.target,
    dry_run: parsed.dryRun,
    authority: 'instructions/canonical/commands/evidence-loop.yaml',
    controller: '/orchestrate-loop',
    next_command: `/orchestrate-loop ${parsed.target}`,
    rules: {
      independent_state: false,
      research_substrate_counts_as_family: false,
      validate_ledger_before_reentry: true
    },
    telemetry: { trace_id: trace.MYTHOS_TRACE_ID, span_id: trace.MYTHOS_SPAN_ID }
  };
  return {
    exitCode: 0,
    stdout: options.json === false
      ? `EVIDENCE LOOP PROFILE ACTIVE\nTarget: ${parsed.target}\nController: /orchestrate-loop\nNext: ${result.next_command}`
      : JSON.stringify(result, null, 2),
    stderr: ''
  };
}

module.exports = { evidenceLoop, parseArgs };
