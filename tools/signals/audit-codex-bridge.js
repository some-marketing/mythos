#!/usr/bin/env node
'use strict';

const path = require('path');

const {
  auditCodexBridge,
  writeCodexBridgeHygieneArtifacts
} = require('./lib/codex-bridge-hygiene');

function printHelp() {
  console.log(`Usage: node tools/signals/audit-codex-bridge.js [all|<signal_scope>] [--json] [--stdout-only]

Audit the live Codex-targeted coordination-signal surface and classify each signal as:
  keep-live | close | reissue-with-exact-command

Options:
  all            Audit all live Codex-targeted signals (default)
  <signal_scope> Audit only one signal_scope/scope
  --json         Print structured JSON
  --stdout-only  Do not write durable report artifacts
  --help         Show this help
`);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

const json = args.includes('--json');
const stdoutOnly = args.includes('--stdout-only');
const positional = args.filter((arg) => !arg.startsWith('-'));
const scope = positional[0] && positional[0] !== 'all' ? positional[0] : '';

const projectRoot = path.resolve(__dirname, '../..');
const report = auditCodexBridge(projectRoot, { scope });

if (!stdoutOnly) {
  writeCodexBridgeHygieneArtifacts(projectRoot, report);
}

if (json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log('Codex Bridge Hygiene');
console.log('====================');
console.log(`Surface status: ${report.surface.status}`);
console.log(`Reason:         ${report.surface.reason}`);
console.log(`Next command:   ${report.surface.next_command || '(none)'}`);
console.log(`Exact command:  ${report.surface.exact_command || '(none)'}`);
console.log(`Signals:        ${report.summary.codex_target_signals} codex-targeted live / ${report.summary.live_coordination_signals} total live`);
console.log(`Classifications:${report.summary.keep_live} keep-live, ${report.summary.close} close, ${report.summary.reissue_with_exact_command} reissue`);
if (report.surface.blocked_by.length > 0) {
  console.log('Blocked by:');
  for (const blocker of report.surface.blocked_by) {
    console.log(`  - ${blocker}`);
  }
}
if (!stdoutOnly) {
  console.log(`Artifacts:      ${report.artifacts.markdown}, ${report.artifacts.json}`);
}
