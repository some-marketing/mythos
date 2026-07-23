'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const reflex = require(path.join(REPO_ROOT, 'tools/kernel/doctrine-reflex.cjs'));

const FIXTURE_PASS = path.join(__dirname, 'fixtures', 'envelope-pass.json');
const FIXTURE_BRIDGE = path.join(__dirname, 'fixtures', 'envelope-bridge.json');

function loadFixture(p) {
  // fixture-source immutability: read once, parse, NEVER mutate the file
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

test('reflex returns a verdict in <50ms for typical envelopes', () => {
  const env = loadFixture(FIXTURE_PASS);
  const t0 = process.hrtime.bigint();
  const result = reflex.runReflex(env);
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;
  assert.ok(['pass', 'warn', 'stall'].includes(result.verdict), 'valid verdict');
  assert.ok(ms < 50, `reflex must run <50ms, was ${ms.toFixed(2)}ms`);
});

test('reflex is deterministic — identical input yields identical output', () => {
  const env = loadFixture(FIXTURE_PASS);
  const a = reflex.runReflex(env);
  const b = reflex.runReflex(env);
  assert.deepEqual(a, b);
});

test('reflex performs zero network calls during check execution', () => {
  // Patch http/https/dns modules to throw on any outbound call.
  const http = require('http');
  const https = require('https');
  const dns = require('dns');
  const origGet = http.get;
  const origReq = http.request;
  const origGetS = https.get;
  const origReqS = https.request;
  const origLookup = dns.lookup;
  http.get = () => { throw new Error('http.get called'); };
  http.request = () => { throw new Error('http.request called'); };
  https.get = () => { throw new Error('https.get called'); };
  https.request = () => { throw new Error('https.request called'); };
  dns.lookup = () => { throw new Error('dns.lookup called'); };
  try {
    const result = reflex.runReflex(loadFixture(FIXTURE_PASS));
    assert.ok(result);
    const bridgeResult = reflex.runReflex(loadFixture(FIXTURE_BRIDGE));
    assert.ok(bridgeResult);
  } finally {
    http.get = origGet;
    http.request = origReq;
    https.get = origGetS;
    https.request = origReqS;
    dns.lookup = origLookup;
  }
});

test('each of the seven check functions is exported and callable', () => {
  const checks = [
    'check1KernelFrontmatter',
    'check2AcceptanceReview',
    'check3ConfidenceEvidence',
    'check4BridgePromptContract',
    'check5ObservedWrap',
    'check6WriteSetSubset',
    'check7StallOnContradiction'
  ];
  const env = loadFixture(FIXTURE_PASS);
  for (const name of checks) {
    assert.equal(typeof reflex[name], 'function', `${name} exported`);
    const out = reflex[name](env);
    assert.ok(Array.isArray(out), `${name} returns array`);
  }
});
