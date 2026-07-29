#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const os = require('os');

function parseArgs(argv) {
  const args = { json: false, strict: false, help: false };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function runCommand(command, args, opts = {}) {
  try {
    const stdout = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: opts.timeout || 5000
    });
    return { ok: true, stdout: stdout.trim(), error: '' };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout ? String(err.stdout).trim() : '',
      error: err.message
    };
  }
}

function parseSwapUsage(text) {
  const out = { raw: text || '', total_mb: null, used_mb: null, free_mb: null, used_ratio: null };
  const unitToMb = (value, unit) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const normalized = String(unit || 'M').toUpperCase();
    if (normalized === 'G') return n * 1024;
    if (normalized === 'K') return n / 1024;
    return n;
  };
  for (const key of ['total', 'used', 'free']) {
    const re = new RegExp(`${key}\\s*=\\s*([0-9.]+)([KMG])`, 'i');
    const match = re.exec(text || '');
    if (match) out[`${key}_mb`] = unitToMb(match[1], match[2]);
  }
  if (out.total_mb && out.used_mb != null) out.used_ratio = out.used_mb / out.total_mb;
  return out;
}

function collectHostState(opts = {}) {
  const runner = opts.runner || runCommand;
  const platform = opts.platform || process.platform;
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const loadavg = os.loadavg();
  let uptimeSeconds = null;
  try {
    uptimeSeconds = os.uptime();
  } catch {
    uptimeSeconds = null;
  }
  const observations = {
    platform,
    hostname: os.hostname(),
    uptime_seconds: uptimeSeconds,
    cpu_count: cpus.length || 1,
    loadavg_1m: loadavg[0] || 0,
    loadavg_5m: loadavg[1] || 0,
    loadavg_15m: loadavg[2] || 0,
    total_memory_mb: Math.round(totalMem / 1024 / 1024),
    free_memory_mb: Math.round(freeMem / 1024 / 1024),
    free_memory_ratio: totalMem > 0 ? freeMem / totalMem : null,
    swap: null,
    thermal: null
  };
  const commands = {};

  if (platform === 'darwin') {
    commands.swap = runner('sysctl', ['vm.swapusage']);
    if (commands.swap.ok) observations.swap = parseSwapUsage(commands.swap.stdout);
    commands.thermal = runner('pmset', ['-g', 'therm']);
    observations.thermal = {
      available: commands.thermal.ok,
      raw: commands.thermal.ok ? commands.thermal.stdout : '',
      error: commands.thermal.ok ? '' : commands.thermal.error
    };
  }

  return { observations, commands };
}

function evaluateHostState(observations) {
  const warnings = [];
  const blockers = [];
  const cpuCount = observations.cpu_count || 1;
  const load1 = observations.loadavg_1m || 0;

  if (load1 > cpuCount * 4) blockers.push(`1m load average ${load1.toFixed(2)} is above ${cpuCount * 4} for ${cpuCount} CPU(s)`);
  else if (load1 > cpuCount * 2) warnings.push(`1m load average ${load1.toFixed(2)} is above ${cpuCount * 2} for ${cpuCount} CPU(s)`);

  if (observations.free_memory_ratio != null) {
    const pct = observations.free_memory_ratio * 100;
    if (observations.free_memory_ratio < 0.05) blockers.push(`free memory is critically low (${pct.toFixed(1)}%)`);
    else if (observations.free_memory_ratio < 0.10) warnings.push(`free memory is low (${pct.toFixed(1)}%)`);
  }

  const swap = observations.swap;
  if (swap && swap.used_ratio != null) {
    if (swap.used_ratio > 0.80) blockers.push(`swap usage is very high (${(swap.used_ratio * 100).toFixed(1)}%)`);
    else if (swap.used_ratio > 0.50) warnings.push(`swap usage is elevated (${(swap.used_ratio * 100).toFixed(1)}%)`);
  }

  const thermalRaw = observations.thermal && observations.thermal.raw ? observations.thermal.raw : '';
  if (/thermal warning|cpu_speed_limit\s*=\s*[0-7]\d\b|scheduler_limit\s*=\s*[0-7]\d\b/i.test(thermalRaw)) {
    warnings.push('thermal output suggests the host may be throttled');
  }

  return { warnings, blockers };
}

function runHostStatePreflight(opts = {}) {
  const collected = collectHostState(opts);
  const assessment = evaluateHostState(collected.observations);
  return {
    schema: 'HostStatePreflight/1.0',
    timestamp: new Date().toISOString(),
    ok: assessment.blockers.length === 0,
    warnings: assessment.warnings,
    blockers: assessment.blockers,
    observations: collected.observations,
    commands: collected.commands
  };
}

function printHuman(report) {
  const obs = report.observations;
  const lines = [
    `host-state preflight: ${report.ok ? 'ok' : 'blocked'}`,
    `platform: ${obs.platform}`,
    `cpu/load: ${obs.cpu_count} CPU(s), loadavg ${obs.loadavg_1m.toFixed(2)} ${obs.loadavg_5m.toFixed(2)} ${obs.loadavg_15m.toFixed(2)}`,
    `memory: ${obs.free_memory_mb}MB free / ${obs.total_memory_mb}MB total`
  ];
  if (obs.swap && obs.swap.used_mb != null) {
    lines.push(`swap: ${Math.round(obs.swap.used_mb)}MB used / ${Math.round(obs.swap.total_mb || 0)}MB total`);
  }
  if (report.warnings.length) lines.push(`warnings: ${report.warnings.join('; ')}`);
  if (report.blockers.length) lines.push(`blockers: ${report.blockers.join('; ')}`);
  return `${lines.join('\n')}\n`;
}

function help() {
  return `
Observe host pressure before local-model or heavy worker dispatch.

Usage:
  node tools/preflight/host-state.cjs [--json] [--strict]

Options:
  --json     Print the full HostStatePreflight/1.0 report.
  --strict   Exit 1 when blockers are present.
`.trim();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(help());
    return;
  }
  const report = runHostStatePreflight();
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(printHuman(report));
  if (args.strict && !report.ok) process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  collectHostState,
  evaluateHostState,
  parseArgs,
  parseSwapUsage,
  printHuman,
  runHostStatePreflight
};
