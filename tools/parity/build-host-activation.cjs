#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const safeBindings = file => {
  if (!file || !fs.existsSync(file)) return {};
  const doc = readJson(file);
  const bindings = doc.bindings || {};
  for (const [key, value] of Object.entries(bindings)) {
    if (!/^[a-z0-9-]+$/.test(key) || typeof value !== 'boolean') {
      throw new Error('local bindings may contain only kebab-case boolean capability flags');
    }
  }
  return bindings;
};
const selection = (binding, bindings) => (
  !binding || bindings[binding]
    ? { selection: 'selected', not_applicable_reason: null }
    : { selection: 'not_applicable', not_applicable_reason: `local binding "${binding}" is absent` }
);
const action = (op, args = []) => ({ op, args });
const receipt = id => `_dev/state/host-activation/receipts/${id}.json`;

function main() {
  const output = path.resolve(option('--output') || path.join(ROOT, 'parity/host-activation.json'));
  const bindings = safeBindings(option('--bindings'));
  const launchd = readJson(path.join(ROOT, 'tools/launchd/services.json')).services;
  const settings = readJson(path.join(ROOT, '.claude/settings.json'));
  const hookEvents = Object.keys(settings.hooks || {}).sort();
  const mcpRoot = path.join(ROOT, 'tools/mcp');
  const adapterDirs = fs.readdirSync(mcpRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(mcpRoot, entry.name, 'creds.config.json')))
    .map(entry => entry.name).sort();
  const mcpServers = adapterDirs.filter(id => fs.existsSync(path.join(mcpRoot, id, 'server.js')));
  const helpers = adapterDirs.filter(id => !mcpServers.includes(id));
  const entries = [];

  entries.push({
    id: 'git-hooks',
    kind: 'git-hooks',
    selection: 'selected',
    not_applicable_reason: null,
    binding: null,
    prerequisites: ['git', '.githooks/pre-push'],
    backup: [action('backup-git-config', ['core.hooksPath'])],
    preflight: [action('assert-file', ['.githooks/pre-push']), action('run', ['npm', 'run', 'verify:parity'])],
    install: [action('git-config-set', ['core.hooksPath', '.githooks'])],
    kickstart: [],
    healthcheck: [action('git-config-equals', ['core.hooksPath', '.githooks'])],
    rollback: [action('restore-git-config', ['core.hooksPath'])],
    receipt: receipt('git-hooks'),
  });
  entries.push({
    id: 'claude-project-hooks',
    kind: 'project-hooks',
    selection: 'selected',
    not_applicable_reason: null,
    binding: null,
    prerequisites: ['node', '.claude/settings.json', ...hookEvents.map(event => `hook-event:${event}`)],
    backup: [action('backup-file', ['.claude/settings.json'])],
    preflight: [action('validate-project-hooks', hookEvents)],
    install: [action('no-op', ['repository-local hooks require no host copy'])],
    kickstart: [],
    healthcheck: [action('validate-project-hooks', hookEvents)],
    rollback: [action('restore-file', ['.claude/settings.json'])],
    receipt: receipt('claude-project-hooks'),
  });
  for (const service of launchd) {
    const chosen = selection(service.binding, bindings);
    entries.push({
      id: `launchd-${service.id}`,
      kind: 'launchd',
      ...chosen,
      binding: service.binding,
      prerequisites: ['node', 'launchctl', 'plutil', service.runner],
      backup: [action('backup-launchd-plist', [service.id])],
      preflight: [action('run', ['tools/launchd/install.sh', service.id, '--dry-run'])],
      install: [action('run', ['tools/launchd/install.sh', service.id])],
      kickstart: [action('launchctl-kickstart', [`org.mythos.portable.${service.id}`])],
      healthcheck: [action('launchctl-print', [`org.mythos.portable.${service.id}`])],
      rollback: [action('rollback-launchd', [service.id])],
      receipt: receipt(`launchd-${service.id}`),
    });
  }
  for (const id of mcpServers) {
    const chosen = selection(id, bindings);
    entries.push({
      id: `mcp-${id}`,
      kind: 'mcp-registration',
      ...chosen,
      binding: id,
      prerequisites: ['node', 'codex', `tools/mcp/${id}/server.js`, `tools/mcp/${id}/creds.config.json`],
      backup: [action('backup-codex-mcp', [`mythos-${id}`])],
      preflight: [action('mcp-preflight', [id])],
      install: [action('codex-mcp-add', [`mythos-${id}`, `tools/mcp/${id}/server.js`])],
      kickstart: [],
      healthcheck: [action('codex-mcp-get', [`mythos-${id}`])],
      rollback: [action('restore-codex-mcp', [`mythos-${id}`])],
      receipt: receipt(`mcp-${id}`),
    });
  }
  for (const id of helpers) {
    const chosen = selection(id, bindings);
    entries.push({
      id: `adapter-${id}`,
      kind: 'credentialed-adapter',
      ...chosen,
      binding: id,
      prerequisites: ['node', `tools/mcp/${id}/creds.config.json`],
      backup: [action('no-op', ['binding configuration remains local and is never copied'])],
      preflight: [action('adapter-preflight', [id])],
      install: [action('no-op', ['adapter is repository-local'])],
      kickstart: [],
      healthcheck: [action('adapter-preflight', [id])],
      rollback: [action('no-op', ['no host mutation'])],
      receipt: receipt(`adapter-${id}`),
    });
  }
  const tcc = selection('macos-tcc-helper', bindings);
  entries.push({
    id: 'macos-tcc-helper',
    kind: 'operator-gated-tcc',
    ...tcc,
    binding: 'macos-tcc-helper',
    prerequisites: ['macOS', 'operator-present'],
    backup: [action('record-tcc-state', [])],
    preflight: [action('tcc-preflight', [])],
    install: [action('operator-gate', ['complete visible macOS permission prompts'])],
    kickstart: [],
    healthcheck: [action('tcc-preflight', [])],
    rollback: [action('operator-gate', ['revoke only permissions granted by this activation'])],
    receipt: receipt('macos-tcc-helper'),
  });

  const planSha256 = crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  const manifest = {
    schema: 'MythosHostActivation/2.0',
    secret_free: true,
    plan_sha256: planSha256,
    operator_approval: 'pending',
    approval_manifest_sha256: null,
    activation_status: 'planned',
    local_binding_policy: 'boolean capability presence only; values and credentials remain in ignored local configuration',
    entries,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`WROTE ${path.relative(ROOT, output)} (${entries.length} entries, plan sha256 ${planSha256})`);
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
