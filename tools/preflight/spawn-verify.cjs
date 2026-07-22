#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = { json: false, strict: false, help: false };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function verifySpawn(opts = {}) {
  const runner = opts.runner || spawnSync;
  const startedAt = Date.now();
  const result = runner(process.execPath, ['-e', 'process.stdout.write("spawn-ok")'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: opts.timeout || 5000
  });
  const stdout = result && result.stdout ? String(result.stdout) : '';
  const stderr = result && result.stderr ? String(result.stderr) : '';
  const blockers = [];
  if (result && result.error) blockers.push(`spawn error: ${result.error.message}`);
  if (result && result.signal) blockers.push(`spawn terminated by signal: ${result.signal}`);
  if (!result || result.status !== 0) blockers.push(`spawn exit status: ${result ? result.status : 'missing result'}`);
  if (stdout !== 'spawn-ok') blockers.push(`unexpected spawn stdout: ${JSON.stringify(stdout)}`);

  return {
    schema: 'SpawnPreflight/1.0',
    timestamp: new Date().toISOString(),
    ok: blockers.length === 0,
    duration_ms: Date.now() - startedAt,
    command: process.execPath,
    args: ['-e', 'process.stdout.write("spawn-ok")'],
    status: result ? result.status : null,
    signal: result ? result.signal || null : null,
    stdout,
    stderr,
    blockers
  };
}

function printHuman(report) {
  const lines = [`spawn preflight: ${report.ok ? 'ok' : 'blocked'}`];
  lines.push(`command: ${report.command}`);
  lines.push(`status: ${report.status == null ? 'null' : report.status}`);
  if (report.blockers.length) lines.push(`blockers: ${report.blockers.join('; ')}`);
  return `${lines.join('\n')}\n`;
}

function help() {
  return `
Verify this host can spawn a basic Node child process.

Usage:
  node tools/preflight/spawn-verify.cjs [--json] [--strict]
`.trim();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(help());
    return;
  }
  const report = verifySpawn();
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(printHuman(report));
  if (args.strict && !report.ok) process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  printHuman,
  verifySpawn
};
