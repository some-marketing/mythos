#!/usr/bin/env node
'use strict';

const path = require('node:path');
const {
  initializeRegistry,
  promoteNative,
  rollbackToClaude,
  protocolView
} = require('./enforcement-home-registry.cjs');
const { validatePromotionGate } = require('./native-promotion-gate.cjs');

function value(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const root = path.resolve(value('root') || process.cwd());
const action = value('action') || 'status';
const reason = value('reason') || undefined;
const gate = value('gate') || undefined;
let mutation = null;

if (action === 'init') mutation = initializeRegistry(root);
else if (action === 'promote-native') {
  const validation = validatePromotionGate(root, gate);
  if (!validation.ok) {
    process.stderr.write(`native promotion blocked: ${validation.errors.join('; ')}\n`);
    process.exit(3);
  }
  mutation = promoteNative(root, { reason: reason || `accepted-gate:${gate}` });
}
else if (action === 'rollback-claude') mutation = rollbackToClaude(root, { reason });
else if (action !== 'status') {
  process.stderr.write(`unknown action: ${action}\n`);
  process.exit(2);
}

const view = protocolView(root);
process.stdout.write(`${JSON.stringify({
  schema: 'EnforcementHomeManagementResult/1.0',
  action,
  mutation,
  blocking_owner: view.protocol.blocking_owner,
  claude_hook: view.protocol.claude_hook,
  native_fork: view.protocol.native_fork,
  registry_source: view.source,
  fail_safe_active: view.degraded
}, null, 2)}\n`);
