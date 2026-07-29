#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = '_dev/reports/analysis/sovereign-core-harness-validation__final.json';
const MAX_CAPTURE = 256 * 1024;

const COMMANDS = Object.freeze([
  {
    id: 'p0-cascade-span-and-tombstone',
    cwd: '.',
    argv: ['node', '--test', 'tools/kernel/cascade-span/__tests__/cascade-span.test.cjs', 'tools/kernel/cascade-span/__tests__/span-parity.test.cjs', 'tools/sessions/lib/__tests__/active-session-registry-cascade-span.test.js', 'tools/sessions/lib/__tests__/active-session-registry.test.js']
  },
  {
    id: 'p1-sovereign-hook-self-test-contract',
    cwd: '.',
    argv: ['node', '--test', 'tools/pi/__tests__/smos-hooks-self-test.test.cjs']
  },
  {
    id: 'p2-p3-tool-broker',
    cwd: '.',
    argv: ['node', '--test', 'tools/broker/__tests__/broker.test.cjs', 'tools/broker/__tests__/phase3-acceptance.test.cjs']
  },
  {
    id: 'p4-outer-enforcement',
    cwd: '.',
    argv: ['node', '--test', 'tools/kernel/cascade-span/__tests__/debrief-close-span-projection.test.cjs', 'tools/kernel/cascade-span/__tests__/debrief-close-parity-driver.test.cjs', 'tools/kernel/enforcement-home/__tests__/debrief-soak-runner.test.cjs', 'tools/kernel/enforcement-home/__tests__/enforcement-home-registry.test.cjs', 'tools/kernel/enforcement-home/__tests__/native-promotion-gate.test.cjs', 'tools/kernel/enforcement-home/__tests__/execute-native-rollback-proof.test.cjs', 'tools/kernel/work-custody/__tests__/actor-work-lease.test.cjs', 'tools/kernel/hooks/__tests__/stop-closeout-evidence-gate.test.cjs']
  },
  {
    id: 'p4-fork-focused',
    cwd: '_dev/forks/pi-mono/packages/coding-agent',
    argv: ['npm', 'test', '--', 'test/debrief-close-decision.test.ts', 'test/agent-session-runtime-events.test.ts', 'test/print-mode.test.ts', 'test/suite/regressions/5080-signal-shutdown-extension-cleanup.test.ts', 'test/suite/regressions/5724-sigterm-signal-exit.test.ts']
  },
  {
    id: 'p4-fork-build',
    cwd: '_dev/forks/pi-mono/packages/coding-agent',
    argv: ['npm', 'run', 'build']
  },
  {
    id: 'p5-hardening-gradient',
    cwd: '.',
    argv: ['node', '--test', 'tools/instructions/__tests__/detect-hardening-descent-candidates.test.cjs', 'tools/instructions/__tests__/report-hardening-gradient.test.cjs']
  },
  {
    id: 'p5-protocol-parity',
    cwd: '.',
    argv: ['npm', 'run', 'harness:protocol:validate']
  },
  {
    id: 'instructions-parity',
    cwd: '.',
    argv: ['npm', 'run', 'instructions:validate:skip-claude']
  }
]);

function resolveExecutable(command) {
  if (path.isAbsolute(command)) return command;
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    const target = path.join(dir, command);
    if (fs.existsSync(target)) return target;
  }
  throw new Error(`executable not found: ${command}`);
}

function run(root = ROOT, opts = {}) {
  const startedAt = new Date().toISOString();
  const results = [];
  for (const command of COMMANDS) {
    const started = Date.now();
    const child = spawnSync(resolveExecutable(command.argv[0]), command.argv.slice(1), {
      cwd: path.resolve(root, command.cwd),
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      env: process.env
    });
    const stdout = String(child.stdout || '');
    const stderr = String(child.stderr || '');
    results.push({
      id: command.id,
      cwd: command.cwd,
      argv: command.argv,
      exit_code: typeof child.status === 'number' ? child.status : null,
      signal: child.signal || null,
      error: child.error ? child.error.message : null,
      duration_ms: Date.now() - started,
      stdout_sha256: crypto.createHash('sha256').update(stdout).digest('hex'),
      stderr_sha256: crypto.createHash('sha256').update(stderr).digest('hex'),
      stdout_tail: stdout.slice(-MAX_CAPTURE),
      stderr_tail: stderr.slice(-MAX_CAPTURE)
    });
    if (results.at(-1).exit_code !== 0 || results.at(-1).error) break;
  }
  const report = {
    schema: 'SovereignCoreHarnessValidation/1.0',
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    ok: results.length === COMMANDS.length && results.every((result) => result.exit_code === 0 && !result.error),
    command_count: COMMANDS.length,
    completed_count: results.length,
    results
  };
  if (opts.output !== false) {
    const output = path.resolve(root, opts.output || OUTPUT);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

function main() {
  if (process.argv.includes('--list')) {
    process.stdout.write(`${JSON.stringify({ schema: 'SovereignCoreHarnessValidationPlan/1.0', commands: COMMANDS }, null, 2)}\n`);
    return;
  }
  if (!process.argv.includes('--run')) {
    process.stderr.write('refusing to execute validation without --run; use --list to inspect commands\n');
    process.exitCode = 2;
    return;
  }
  const report = run();
  process.stdout.write(`${JSON.stringify({ ok: report.ok, output: OUTPUT, completed_count: report.completed_count, failed: report.results.filter((result) => result.exit_code !== 0 || result.error).map((result) => result.id) }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { COMMANDS, OUTPUT, resolveExecutable, run };
