'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  evaluateHostState,
  parseSwapUsage,
  runHostStatePreflight
} = require('../host-state.cjs');

test('parseSwapUsage extracts macOS swap numbers', () => {
  const parsed = parseSwapUsage('vm.swapusage: total = 2048.00M  used = 512.00M  free = 1536.00M');
  assert.equal(parsed.total_mb, 2048);
  assert.equal(parsed.used_mb, 512);
  assert.equal(parsed.free_mb, 1536);
  assert.equal(parsed.used_ratio, 0.25);
});

test('evaluateHostState blocks extreme load and low memory', () => {
  const result = evaluateHostState({
    cpu_count: 2,
    loadavg_1m: 10,
    free_memory_ratio: 0.02,
    swap: { used_ratio: 0.9 },
    thermal: { raw: '' }
  });
  assert.ok(result.blockers.some((entry) => /load average/.test(entry)));
  assert.ok(result.blockers.some((entry) => /free memory/.test(entry)));
  assert.ok(result.blockers.some((entry) => /swap usage/.test(entry)));
});

test('runHostStatePreflight uses injected command runner for deterministic host probes', () => {
  const report = runHostStatePreflight({
    platform: 'darwin',
    runner(command, args) {
      if (command === 'sysctl' && args[0] === 'vm.swapusage') {
        return { ok: true, stdout: 'vm.swapusage: total = 1024.00M  used = 0.00M  free = 1024.00M', error: '' };
      }
      if (command === 'pmset') return { ok: true, stdout: 'CPU_Scheduler_Limit = 100', error: '' };
      return { ok: false, stdout: '', error: 'unexpected command' };
    }
  });
  assert.equal(report.schema, 'HostStatePreflight/1.0');
  assert.equal(report.observations.swap.used_mb, 0);
  assert.equal(report.commands.swap.ok, true);
  assert.equal(report.commands.thermal.ok, true);
});
