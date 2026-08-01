#!/usr/bin/env node
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const emitter = require('../session-start-contract-emitter.cjs');

function makeMemoryDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-mem-'));
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# Memory Index\n');
  // A feedback-class lesson (should surface).
  fs.writeFileSync(
    path.join(dir, 'feedback_coordinator-never-executes-on-main-chain.md'),
    [
      '---',
      'name: coordinator-never-executes-on-main-chain',
      'description: "main chain = read/route/write-artifacts ONLY; every leaf to a worker"',
      'metadata:',
      '  type: feedback',
      '---',
      '',
      'body'
    ].join('\n')
  );
  // A reference-class file (should NOT surface as contract).
  fs.writeFileSync(
    path.join(dir, 'reference_google-ads-customer-ids.md'),
    [
      '---',
      'name: google-ads-customer-ids',
      'description: "client={ADS_CUSTOMER_ID} etc"',
      'metadata:',
      '  type: reference',
      '---',
      '',
      'body'
    ].join('\n')
  );
  return dir;
}

test('buildContract surfaces feedback lessons with falsifier + temporal stamp', () => {
  const memoryDir = makeMemoryDir();
  const c = emitter.buildContract({ memoryDir });
  assert.ok(c, 'contract built');
  assert.match(c.text, /FALSIFIER: Operator instruction this session overrides any of these/);
  assert.match(c.text, /behavioral contract as of \d{4}-\d{2}-\d{2}/);
  assert.match(c.text, /coordinator-never-executes-on-main-chain/);
  // reference-class memory must NOT appear in the behavioral contract
  assert.doesNotMatch(c.text, /google-ads-customer-ids/);
  assert.equal(c.lessons.length, 1);
  fs.rmSync(memoryDir, { recursive: true, force: true });
});

test('buildContract returns null when no memory dir resolves', () => {
  const c = emitter.buildContract({ memoryDir: '/nonexistent/path/xyz' });
  assert.equal(c, null);
});

test('logOverrideCandidates appends a candidate when operator overrides a surfaced lesson', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-override-'));
  const surfacedSetPath = path.join(tmp, 'surfaced.json');
  const ledgerPath = path.join(tmp, 'lesson-revisions.jsonl');
  fs.writeFileSync(
    surfacedSetPath,
    JSON.stringify({
      session_id: 's1',
      contract_as_of: '2026-06-23',
      lessons: [
        { slug: 'coordinator-never-executes-on-main-chain', description: 'x' }
      ]
    })
  );
  const appended = emitter.logOverrideCandidates(
    {
      session_id: 's1',
      prompt: 'Ignore the lesson about coordinator never executes on main chain for this task.'
    },
    { surfacedSetPath, ledgerPath, now: '2026-06-23T00:00:00.000Z' }
  );
  assert.equal(appended.length, 1);
  assert.equal(appended[0].trigger, 'operator-override');
  assert.equal(appended[0].status, 'candidate');
  assert.equal(appended[0].lesson, 'coordinator-never-executes-on-main-chain');
  const ledger = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n');
  assert.equal(ledger.length, 1);
  assert.equal(JSON.parse(ledger[0]).schema, 'LessonRevision/1.0');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('logOverrideCandidates is a no-op without an override phrase', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-override-noop-'));
  const surfacedSetPath = path.join(tmp, 'surfaced.json');
  const ledgerPath = path.join(tmp, 'lesson-revisions.jsonl');
  fs.writeFileSync(
    surfacedSetPath,
    JSON.stringify({
      session_id: 's1',
      lessons: [{ slug: 'coordinator-never-executes-on-main-chain', description: 'x' }]
    })
  );
  const appended = emitter.logOverrideCandidates(
    { session_id: 's1', prompt: 'Please run the coordinator workflow as usual.' },
    { surfacedSetPath, ledgerPath }
  );
  assert.equal(appended.length, 0);
  assert.equal(fs.existsSync(ledgerPath), false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('logOverrideCandidates is a no-op when nothing was surfaced', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-override-none-'));
  const appended = emitter.logOverrideCandidates(
    { session_id: 's1', prompt: 'Ignore the lesson about anything.' },
    { surfacedSetPath: path.join(tmp, 'missing.json'), ledgerPath: path.join(tmp, 'l.jsonl') }
  );
  assert.equal(appended.length, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});
