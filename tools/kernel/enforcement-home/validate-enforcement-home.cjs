#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { protocolView, validateRegistry } = require('./enforcement-home-registry.cjs');

const rootIndex = process.argv.indexOf('--root');
const root = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : process.cwd());
const view = protocolView(root);
const validation = validateRegistry(view.registry);
const result = {
  schema: 'EnforcementHomeValidation/1.0',
  ok: validation.ok,
  protocol: 'debrief_before_closeout',
  blocking_owner: view.protocol.blocking_owner,
  claude_hook: view.protocol.claude_hook,
  native_fork: view.protocol.native_fork,
  registry_source: view.source,
  fail_safe_active: view.degraded,
  errors: validation.errors
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
