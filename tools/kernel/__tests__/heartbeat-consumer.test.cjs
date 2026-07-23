#!/usr/bin/env node
'use strict';

/**
 * Tests for heartbeat-consumer.cjs
 * Stdlib only (assert + fs + os + path + child_process). Self-tallying check()
 * runner, matching tools/state/__tests__/rotate-jsonl.test.cjs.
 *
 * Covers:
 *  - registry-only dispatch: an unregistered class is REFUSED with no command
 *  - registered command class resolves to the FIXED registry command (not built
 *    from anomaly text); notify class never yields a command
 *  - classifyAnomalies: stale pulse / low disk / unreachable lane detection, and
 *    a healthy pulse yields zero detections
 *  - every class classifyAnomalies can emit is in the closed registered vocab
 *  - dry-run default and kill-switch behavior via spawn (no dispatch)
 *  - --apply over a notify-only fixture executes no shell command (exit 0)
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TOOL = path.resolve(__dirname, '..', 'heartbeat-consumer.cjs');
const {
  REGISTRY,
  classifyAnomalies,
  decideDispatch,
  parseAvailableGiB,
  STALE_PULSE_MS,
  PROJECT_ROOT
} = require('../heartbeat-consumer.cjs');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (err) { fail++; console.error(`FAIL  ${name}`); console.error(err.stack || err.message); }
}

function tmpPulse(pulse) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbc-'));
  const file = path.join(dir, 'pulse.json');
  fs.writeFileSync(file, JSON.stringify(pulse));
  return { dir, file };
}

const DAY = 24 * 60 * 60 * 1000;

// ── registry-only dispatch invariant ───────────────────────────────────────
check('unregistered anomaly class is refused with no command', () => {
  const d = decideDispatch('totally_made_up_class', { apply: true });
  assert.strictEqual(d.registered, false);
  assert.strictEqual(d.command, null, 'a refused class must never carry a command');
  assert.strictEqual(d.decision, 'refused-unregistered');
});

check('registered command class resolves to the FIXED registry command', () => {
  const d = decideDispatch('disk_low', { apply: false });
  assert.strictEqual(d.registered, true);
  assert.strictEqual(d.actuator_type, 'command');
  assert.deepStrictEqual(d.command, { bin: REGISTRY.disk_low.bin, argv: REGISTRY.disk_low.argv });
  assert.strictEqual(d.decision, 'would-dispatch');
  // apply flips the label but not the (fixed) command.
  const applied = decideDispatch('disk_low', { apply: true });
  assert.strictEqual(applied.decision, 'dispatched');
  assert.deepStrictEqual(applied.command.argv, REGISTRY.disk_low.argv);
});

check('notify class never yields a command even under apply', () => {
  for (const cls of ['stale_heartbeat', 'lane_unreachable']) {
    const d = decideDispatch(cls, { apply: true });
    assert.strictEqual(d.registered, true);
    assert.strictEqual(d.actuator_type, 'notify');
    assert.strictEqual(d.command, null, `${cls} must be notify-only`);
    assert.strictEqual(d.decision, 'notify-only');
  }
});

// The ONLY exec branch in main requires actuator_type === 'command'; refused and
// notify decisions both have command===null, so no anomaly can reach a shell
// command that is not the fixed registry entry.
check('every emittable class is either refused or a registered command/notify', () => {
  const now = Date.now();
  const pulse = {
    timestamp: new Date(now - 10 * DAY).toISOString(),
    host: { disk: { available: '2Gi', used_percent: '98%' } },
    lanes: [{ name: 'ollama', state: 'not-reachable' }]
  };
  for (const det of classifyAnomalies(pulse, now)) {
    const d = decideDispatch(det.class, { apply: true });
    if (!d.registered) assert.strictEqual(d.command, null);
    if (d.actuator_type === 'notify') assert.strictEqual(d.command, null);
    // Every class the classifier emits is in the registered vocabulary.
    assert.ok(Object.prototype.hasOwnProperty.call(REGISTRY, det.class), `${det.class} must be registered`);
  }
});

// ── classification ──────────────────────────────────────────────────────────
check('classify: stale pulse -> stale_heartbeat', () => {
  const now = Date.now();
  const dets = classifyAnomalies({ timestamp: new Date(now - STALE_PULSE_MS - 1000).toISOString(), host: { disk: { available: '99Gi' } }, lanes: [] }, now);
  assert.ok(dets.some((d) => d.class === 'stale_heartbeat'));
});

check('classify: low disk -> disk_low', () => {
  const now = Date.now();
  const dets = classifyAnomalies({ timestamp: new Date(now).toISOString(), host: { disk: { available: '5Gi' } }, lanes: [] }, now);
  assert.ok(dets.some((d) => d.class === 'disk_low'));
});

check('classify: unreachable lane -> lane_unreachable', () => {
  const now = Date.now();
  const dets = classifyAnomalies({ timestamp: new Date(now).toISOString(), host: { disk: { available: '99Gi' } }, lanes: [{ name: 'ollama', state: 'not-reachable' }] }, now);
  assert.ok(dets.some((d) => d.class === 'lane_unreachable'));
});

check('classify: healthy pulse -> zero detections', () => {
  const now = Date.now();
  const dets = classifyAnomalies({ timestamp: new Date(now).toISOString(), host: { disk: { available: '99Gi', used_percent: '21%' } }, lanes: [{ name: 'ollama', state: 'verified-live' }] }, now);
  assert.deepStrictEqual(dets, []);
});

check('classify: missing/unparseable pulse -> stale_heartbeat', () => {
  assert.ok(classifyAnomalies(null).some((d) => d.class === 'stale_heartbeat'));
});

check('parseAvailableGiB handles df-style units', () => {
  assert.strictEqual(parseAvailableGiB('45Gi'), 45);
  assert.strictEqual(Math.round(parseAvailableGiB('1Ti')), 1024);
  assert.ok(parseAvailableGiB('512Mi') < 1);
  assert.strictEqual(parseAvailableGiB('garbage'), null);
});

// ── spawn: dry-run default, kill-switch, apply-notify-only ─────────────────
check('default run is dry-run and dispatches nothing', () => {
  const { dir, file } = tmpPulse({ timestamp: new Date(Date.now() - 10 * DAY).toISOString(), host: { disk: { available: '99Gi' } }, lanes: [] });
  try {
    const r = spawnSync('node', [TOOL, '--pulse', file], { encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(/DRY RUN/.test(r.stdout), 'must announce dry-run');
    assert.ok(!/APPLY MODE/.test(r.stdout));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

check('kill-switch halts before classifying or dispatching', () => {
  const swDir = path.join(PROJECT_ROOT, '_dev', 'state', 'heartbeat-consumer');
  const sw = path.join(swDir, 'disabled');
  const preexisting = fs.existsSync(sw);
  if (!preexisting) fs.mkdirSync(swDir, { recursive: true });
  fs.writeFileSync(sw, 'test');
  try {
    const r = spawnSync('node', [TOOL, '--apply'], { encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(r.status, 0);
    assert.ok(/kill-switch/i.test(r.stdout), 'kill-switch must short-circuit even under --apply');
  } finally {
    if (!preexisting) fs.rmSync(sw, { force: true });
  }
});

check('--apply over a notify-only pulse executes no shell command (exit 0)', () => {
  // stale + unreachable are both notify-only; no disk_low, so no command actuator.
  const { dir, file } = tmpPulse({
    timestamp: new Date(Date.now() - 10 * DAY).toISOString(),
    host: { disk: { available: '99Gi' } },
    lanes: [{ name: 'ollama', state: 'not-reachable' }]
  });
  try {
    const r = spawnSync('node', [TOOL, '--apply', '--json', '--pulse', file], { encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.ok(out.dispatches.length >= 2);
    for (const d of out.dispatches) {
      assert.notStrictEqual(d.decision, 'dispatched', 'no command should have been executed');
      assert.ok(d.exit_code == null, 'notify-only dispatch must not carry an exit code');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

console.log(`\nheartbeat-consumer: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
