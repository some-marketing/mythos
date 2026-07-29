#!/usr/bin/env node
'use strict';

/**
 * tick.js — Mythos Fleet Ticker
 *
 * Reads remote-hosts.json, SSHes to each host, runs fleet-probe.ps1,
 * collects JSON, and writes fleet-index.json.
 *
 * Usage: node tools/fleet/tick.js
 *        npm run fleet:tick
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const REMOTE_HOSTS_PATH = path.join(PROJECT_ROOT, '_dev', 'config', 'remote-hosts.json');
const FLEET_INDEX_PATH = path.join(PROJECT_ROOT, '_dev', 'config', 'fleet-index.json');
const PROBE_REMOTE_PATH = 'C:\\smos\\fleet-probe.ps1';

// Read prior index for stale-preservation
let priorIndex = { hosts: {} };
if (fs.existsSync(FLEET_INDEX_PATH)) {
  try { priorIndex = JSON.parse(fs.readFileSync(FLEET_INDEX_PATH, 'utf8')); } catch {}
}

// Read remote hosts config
if (!fs.existsSync(REMOTE_HOSTS_PATH)) {
  console.error('Remote hosts config not found:', REMOTE_HOSTS_PATH);
  process.exit(1);
}
const remoteHosts = JSON.parse(fs.readFileSync(REMOTE_HOSTS_PATH, 'utf8'));

const now = new Date().toISOString();
const fleetIndex = {
  last_updated: now,
  hosts: {}
};

let exitCode = 0;

for (const [alias, cfg] of Object.entries(remoteHosts.hosts || {})) {
  const sshTarget = `${cfg.user}@${cfg.host}`;
  console.log(`Probing ${alias} (${sshTarget})...`);

  const result = spawnSync('ssh', [
    '-o', 'ConnectTimeout=5',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'BatchMode=yes',
    sshTarget,
    `powershell -File "${PROBE_REMOTE_PATH}"`
  ], {
    timeout: 15000,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (result.error || result.status !== 0) {
    // Host unreachable — preserve prior state if available
    console.log(`  ${alias}: offline (${result.stderr?.trim() || result.error?.message || 'timeout'})`);
    exitCode = 1;

    if (priorIndex.hosts && priorIndex.hosts[alias]) {
      fleetIndex.hosts[alias] = { ...priorIndex.hosts[alias] };
      fleetIndex.hosts[alias].status = 'offline';
      fleetIndex.hosts[alias].stale_since = fleetIndex.hosts[alias].probed_at || priorIndex.last_updated;
      fleetIndex.hosts[alias].probed_at = now;
    } else {
      fleetIndex.hosts[alias] = {
        hostname: cfg.host,
        status: 'offline',
        probed_at: now,
        tags: cfg.tags || [],
        note: 'No prior index data available'
      };
    }
    continue;
  }

  // Parse JSON from probe output
  try {
    const stdout = result.stdout.trim();
    // Find the JSON block (skip any SSH warnings)
    const jsonStart = stdout.indexOf('{');
    const jsonEnd = stdout.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error('No JSON found in probe output');
    }
    const jsonStr = stdout.slice(jsonStart, jsonEnd + 1);
    const probeData = JSON.parse(jsonStr);

    fleetIndex.hosts[alias] = {
      ...probeData,
      status: 'ok',
      tags: cfg.tags || [],
      tailscale_ip: priorIndex.hosts?.[alias]?.tailscale_ip || null
    };
    console.log(`  ${alias}: ok (${probeData.ollama?.models?.length || 0} models, ${probeData.ram?.free_gb || '?'}GB free RAM, ${probeData.uptime_hours || '?'}h uptime)`);
  } catch (e) {
    console.log(`  ${alias}: parse error — ${e.message}`);
    exitCode = 1;
    fleetIndex.hosts[alias] = {
      hostname: cfg.host,
      status: 'parse_error',
      probed_at: now,
      error: e.message,
      raw_output: result.stdout.slice(0, 500)
    };
  }
}

// Write fleet index
fs.writeFileSync(FLEET_INDEX_PATH, JSON.stringify(fleetIndex, null, 2) + '\n');
console.log(`\nFleet index written: ${FLEET_INDEX_PATH}`);
console.log(`${Object.keys(fleetIndex.hosts).length} hosts, ${Object.values(fleetIndex.hosts).filter(h => h.status === 'ok').length} online`);

process.exit(exitCode);