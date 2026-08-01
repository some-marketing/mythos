#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const manifestPath = path.resolve(process.argv[2] || path.join(ROOT, 'parity/host-activation.json'));
const apply = process.argv.includes('--apply');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const selected = manifest.entries.filter(entry => entry.selection === 'selected');
const state = new Map();

function absolute(relative) {
  const resolved = path.resolve(ROOT, relative);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) throw new Error(`path escapes Mythos root: ${relative}`);
  return resolved;
}
function run(argv, options = {}) {
  const command = argv[0].includes('/') ? absolute(argv[0]) : argv[0];
  const result = spawnSync(command, argv.slice(1), { cwd: ROOT, encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${argv[0]} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}
function backupDir(entry) {
  const dir = absolute(`_dev/state/host-activation/backups/${entry.id}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
function execute(entry, action) {
  const [first, second] = action.args;
  const entryState = state.get(entry.id) || {};
  state.set(entry.id, entryState);
  switch (action.op) {
    case 'no-op': return first || 'no-op';
    case 'assert-file':
      if (!fs.existsSync(absolute(first))) throw new Error(`missing prerequisite: ${first}`);
      return 'present';
    case 'run': return run(action.args);
    case 'validate-project-hooks': {
      const settings = JSON.parse(fs.readFileSync(absolute('.claude/settings.json'), 'utf8'));
      for (const event of action.args) if (!settings.hooks?.[event]) throw new Error(`missing project hook event: ${event}`);
      return `${action.args.length} hook events`;
    }
    case 'backup-git-config': {
      const result = spawnSync('git', ['config', '--get', first], { cwd: ROOT, encoding: 'utf8' });
      entryState.gitConfig = result.status === 0 ? result.stdout.trim() : null;
      return 'captured';
    }
    case 'git-config-set': return run(['git', 'config', first, second]);
    case 'git-config-equals': {
      const value = run(['git', 'config', '--get', first]);
      if (value !== second) throw new Error(`${first} health check failed`);
      return value;
    }
    case 'restore-git-config':
      return entryState.gitConfig === null
        ? run(['git', 'config', '--unset-all', first])
        : run(['git', 'config', first, entryState.gitConfig]);
    case 'backup-file': {
      const source = absolute(first);
      const destination = path.join(backupDir(entry), path.basename(first));
      fs.copyFileSync(source, destination);
      entryState.fileBackup = destination;
      return 'captured';
    }
    case 'restore-file':
      if (entryState.fileBackup) fs.copyFileSync(entryState.fileBackup, absolute(first));
      return 'restored';
    case 'backup-launchd-plist': {
      const destination = path.join(os.homedir(), 'Library', 'LaunchAgents', `org.mythos.portable.${first}.plist`);
      entryState.launchdDestination = destination;
      if (fs.existsSync(destination)) {
        const backup = path.join(backupDir(entry), path.basename(destination));
        fs.copyFileSync(destination, backup);
        entryState.launchdBackup = backup;
      }
      return entryState.launchdBackup ? 'captured existing plist' : 'no existing plist';
    }
    case 'launchctl-kickstart': return run(['launchctl', 'kickstart', '-k', `gui/${process.getuid()}/${first}`]);
    case 'launchctl-print': return run(['launchctl', 'print', `gui/${process.getuid()}/${first}`]);
    case 'rollback-launchd': {
      const label = `org.mythos.portable.${first}`;
      spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { encoding: 'utf8' });
      if (entryState.launchdBackup) {
        fs.copyFileSync(entryState.launchdBackup, entryState.launchdDestination);
        run(['launchctl', 'bootstrap', `gui/${process.getuid()}`, entryState.launchdDestination]);
      } else if (entryState.launchdDestination && fs.existsSync(entryState.launchdDestination)) {
        const quarantined = path.join(backupDir(entry), `${label}.rolled-back.plist`);
        fs.renameSync(entryState.launchdDestination, quarantined);
      }
      return 'rolled back';
    }
    case 'mcp-preflight':
      return run(['node', '--check', `tools/mcp/${first}/server.js`]);
    case 'adapter-preflight':
      if (!fs.existsSync(absolute(`tools/mcp/${first}/creds.config.json`))) throw new Error(`missing adapter ${first}`);
      return 'adapter present';
    case 'backup-codex-mcp': {
      const config = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
      entryState.codexConfig = config;
      if (fs.existsSync(config)) {
        const backup = path.join(backupDir(entry), 'codex-config.toml');
        fs.copyFileSync(config, backup);
        entryState.codexBackup = backup;
      }
      return entryState.codexBackup ? 'captured Codex MCP configuration' : 'no existing Codex configuration';
    }
    case 'codex-mcp-add':
      spawnSync('codex', ['mcp', 'remove', first], { cwd: ROOT, encoding: 'utf8' });
      return run(['codex', 'mcp', 'add', first, '--', 'node', absolute(second)]);
    case 'codex-mcp-get': return run(['codex', 'mcp', 'get', first]);
    case 'restore-codex-mcp':
      if (entryState.codexBackup) fs.copyFileSync(entryState.codexBackup, entryState.codexConfig);
      else spawnSync('codex', ['mcp', 'remove', first], { cwd: ROOT, encoding: 'utf8' });
      return 'restored';
    case 'record-tcc-state':
    case 'tcc-preflight':
    case 'operator-gate':
      throw new Error('operator-visible TCC action requires interactive continuation');
    default: throw new Error(`unsupported activation operation: ${action.op}`);
  }
}
function writeReceipt(entry, status, evidence, error = null) {
  const destination = absolute(entry.receipt);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.writeFileSync(destination, JSON.stringify({
    schema: 'MythosActivationReceipt/2.0',
    plan_sha256: manifest.plan_sha256,
    entry: entry.id,
    status,
    evidence,
    error,
    recorded_at: new Date().toISOString(),
  }, null, 2) + '\n', { mode: 0o600 });
}

if (!apply) {
  const preflightEvidence = [];
  for (const entry of selected) {
    for (const action of entry.preflight) {
      preflightEvidence.push({ entry: entry.id, op: action.op, result: execute(entry, action) });
    }
  }
  console.log(JSON.stringify({
    schema: 'MythosHostActivationDryRun/1.0',
    plan_sha256: manifest.plan_sha256,
    selected: selected.map(entry => ({ id: entry.id, preflight: entry.preflight, install: entry.install, healthcheck: entry.healthcheck, rollback: entry.rollback })),
    not_applicable: manifest.entries.filter(entry => entry.selection === 'not_applicable').map(entry => ({ id: entry.id, reason: entry.not_applicable_reason })),
    preflight_evidence: preflightEvidence,
    mutation_performed: false,
  }, null, 2));
  process.exit(0);
}
if (manifest.operator_approval !== 'approved' || manifest.approval_manifest_sha256 !== manifest.plan_sha256) {
  throw new Error('host activation requires operator approval stamped against the exact plan_sha256');
}
for (const entry of selected) for (const action of entry.preflight) execute(entry, action);
for (const entry of selected) {
  const evidence = [];
  try {
    for (const action of [...entry.backup, ...entry.install, ...entry.kickstart, ...entry.healthcheck]) {
      evidence.push({ op: action.op, result: execute(entry, action) });
    }
    writeReceipt(entry, 'active_verified', evidence);
  } catch (error) {
    const rollback = [];
    for (const action of entry.rollback) {
      try { rollback.push({ op: action.op, result: execute(entry, action) }); }
      catch (rollbackError) { rollback.push({ op: action.op, error: rollbackError.message }); }
    }
    writeReceipt(entry, 'failed_rolled_back', [...evidence, ...rollback], error.message);
    throw error;
  }
}
