'use strict';

/**
 * Tests for L8 closure-requires-evidence (convene 20260610T175230Z):
 * artifact-contracted signals close only with evidence, a durable deferral,
 * or an obligation-preserving successor.
 * Run: node --test tools/signals/lib/__tests__/closure-evidence.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { closureEvidence, writeDeferralRecord, EXEMPT_REASONS } = require('../closure-evidence.cjs');

const CLI = path.resolve(__dirname, '../../close-signal.js');

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'closure-ev-'));
  fs.mkdirSync(path.join(root, '_dev', 'reports', 'signals'), { recursive: true });
  fs.mkdirSync(path.join(root, '_dev', 'reports', 'analysis'), { recursive: true });
  return root;
}

function writeLiveSignal(root, name, command) {
  const signal = {
    schema: 'HandoffSignal/1.0',
    signal_type: 'ready-for-review',
    lifecycle_state: 'live',
    source: 'codex',
    scope: 'lessons-reconciliation',
    timestamp: '2026-06-10T00:00:00Z',
    artifacts: [],
    validation: { ran: true, summary: 't' },
    recommended_next_actor: 'claude',
    recommended_next_command: command,
    next_step_detail: [],
    blocked_by: [],
    ready_for_clear: false,
    grounding_mode: 'none',
    signal_scope: 'lessons-reconciliation'
  };
  fs.writeFileSync(path.join(root, '_dev', 'reports', 'signals', name), JSON.stringify(signal));
  return signal;
}

function runCli(root, args) {
  return spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MYTHOS_PROJECT_ROOT: root }
  });
}

test('contracted command without artifacts -> evidence required, unsatisfied', () => {
  const root = makeRoot();
  const sig = writeLiveSignal(root, 's1.json', '/reconcile-lessons 2026-01-01');
  const ev = closureEvidence(sig, root);
  assert.strictEqual(ev.required, true);
  assert.strictEqual(ev.satisfied, false);
  assert.strictEqual(ev.missing.length, 2);
});

test('contracted command with artifacts -> satisfied', () => {
  const root = makeRoot();
  const sig = writeLiveSignal(root, 's1.json', '/reconcile-lessons 2026-02-02');
  fs.writeFileSync(path.join(root, '_dev', 'reports', 'analysis', 'lessons-reconciliation__2026-02-02.md'), 'x');
  fs.writeFileSync(path.join(root, '_dev', 'reports', 'analysis', 'lessons-reconciliation__2026-02-02.expectation-failures.json'), '{}');
  const ev = closureEvidence(sig, root);
  assert.strictEqual(ev.required, true);
  assert.strictEqual(ev.satisfied, true);
});

test('non-contracted command -> not required', () => {
  const root = makeRoot();
  const sig = writeLiveSignal(root, 's1.json', '/review-progress something');
  const ev = closureEvidence(sig, root);
  assert.strictEqual(ev.required, false);
});

test('CLI blocks closure without evidence', () => {
  const root = makeRoot();
  writeLiveSignal(root, 's1.json', '/reconcile-lessons 2026-01-01');
  const r = runCli(root, ['--file', 's1.json', '--execute']);
  assert.match(r.stderr + r.stdout, /BLOCKED/);
  assert.strictEqual(fs.existsSync(path.join(root, '_dev', 'reports', 'signals', 's1.json')), true);
});

test('CLI --defer writes durable record and closes', () => {
  const root = makeRoot();
  writeLiveSignal(root, 's1.json', '/reconcile-lessons 2026-01-01');
  const r = runCli(root, ['--file', 's1.json', '--defer', 'lane retired in test', '--execute']);
  assert.match(r.stdout, /deferral recorded/);
  assert.strictEqual(fs.existsSync(path.join(root, '_dev', 'reports', 'analysis', 'signal-deferrals', 's1.md')), true);
  assert.strictEqual(fs.existsSync(path.join(root, '_dev', 'reports', 'signals', 'closed', 's1.json')), true);
});

test('CLI superseded without --successor dies', () => {
  const root = makeRoot();
  writeLiveSignal(root, 's1.json', '/reconcile-lessons 2026-01-01');
  const r = runCli(root, ['--file', 's1.json', '--reason', 'superseded', '--execute']);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /--successor/);
});

test('writeDeferralRecord preserves the obligation text', () => {
  const root = makeRoot();
  const sig = writeLiveSignal(root, 's1.json', '/reconcile-lessons 2026-01-01');
  const rel = writeDeferralRecord(sig, { name: 's1.json' }, 'because test', root);
  const content = fs.readFileSync(path.join(root, rel), 'utf8');
  assert.match(content, /reconcile-lessons 2026-01-01/);
  assert.match(content, /because test/);
});

test('exempt reasons are superseded and duplicate', () => {
  assert.deepStrictEqual(Array.from(EXEMPT_REASONS).sort(), ['duplicate', 'superseded']);
});
