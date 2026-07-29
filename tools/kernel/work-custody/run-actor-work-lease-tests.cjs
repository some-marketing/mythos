#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCHEMA = 'ActorWorkCustodyTestReceipt/1.0';
const OUTPUT = '_dev/reports/analysis/sovereign-core-harness-actor-custody-tests.json';
const SOURCES = Object.freeze([
  'tools/kernel/work-custody/actor-work-lease.cjs',
  'tools/kernel/work-custody/actor-work-lease.schema.json',
  'tools/kernel/work-custody/__tests__/actor-work-lease.test.cjs'
]);

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function binding(root, rel) {
  const bytes = fs.readFileSync(path.join(root, rel));
  return { path: rel, sha256: sha256(bytes), bytes: bytes.length };
}
function writeAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, target);
}
function run(root = process.cwd(), output = OUTPUT) {
  const startedAt = new Date().toISOString();
  const command = ['node', '--test', 'tools/kernel/work-custody/__tests__/actor-work-lease.test.cjs'];
  const child = spawnSync(process.execPath, command.slice(1), { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const stdout = String(child.stdout || '');
  const stderr = String(child.stderr || '');
  const passMatch = stdout.match(/ℹ pass (\d+)/);
  const failMatch = stdout.match(/ℹ fail (\d+)/);
  const receipt = {
    schema: SCHEMA,
    task_id: 'sovereign-core-harness',
    status: child.status === 0 && Number(failMatch && failMatch[1]) === 0 ? 'complete' : 'failed',
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    command,
    result: {
      exit_code: child.status,
      signal: child.signal || null,
      error: child.error ? child.error.message : null,
      pass_count: Number(passMatch && passMatch[1]),
      fail_count: Number(failMatch && failMatch[1]),
      stdout_sha256: sha256(stdout),
      stderr_sha256: sha256(stderr),
      stdout_tail: stdout.slice(-32 * 1024),
      stderr_tail: stderr.slice(-32 * 1024)
    },
    source_bindings: SOURCES.map((rel) => binding(root, rel)),
    falsifiers: [
      'simultaneous-conflicting-claims', 'conflicting-write-denial-receipt', 'non-overlapping-coexistence',
      'heartbeat-retention', 'heartbeat-expiry', 'completion-release', 'explicit-handoff-lineage',
      'crash-reclamation', 'stale-epoch-write-denial', 'cross-model-provider-agent-takeover',
      'parent-child-no-implied-ownership', 'corrupt-state-fail-closed-reclamation', 'replay-idempotency',
      'durable-transition-lineage'
    ]
  };
  writeAtomic(path.join(root, output), receipt);
  return receipt;
}

if (require.main === module) {
  const receipt = run();
  process.stdout.write(`${JSON.stringify({ ok: receipt.status === 'complete', output: OUTPUT, pass_count: receipt.result.pass_count }, null, 2)}\n`);
  if (receipt.status !== 'complete') process.exitCode = 1;
}

module.exports = { SCHEMA, OUTPUT, SOURCES, binding, run, writeAtomic };
