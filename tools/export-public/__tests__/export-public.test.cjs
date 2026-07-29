#!/usr/bin/env node
'use strict';
// Tests for the export-public genericization engine (public fixture variant — all
// denylist terms below are FAKE examples; seed config/denylist.json with your own).
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildSubstitutions, applySubstitutions, scanForDenylist, validateStagedFramework, globToRegex } = require('../export-public.cjs');

const denylist = {
  client_codes: [
    { term: 'ACMECO', replacement: '{CLIENT_CODE}' },
    { term: 'XX', replacement: '{CLIENT_CODE}', regex: '(?<![\\w:-])XX(?![\\w:-])' },
  ],
  domains: [{ term: 'acme-client.com', replacement: 'example-client.com' }],
  identifiers: [{ term: '000011112222333', replacement: '{AD_ACCOUNT_ID}' }],
  patterns: [{ regex: '[a-zA-Z0-9._%+-]+@(?!example\\.com|example-)[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', flags: 'g', replacement: 'user@example.com', description: 'emails' }],
};
const subs = buildSubstitutions(denylist);
let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; } catch (e) { failed++; console.error('FAIL', name, '-', e.message); } }

t('client code stripped word-boundary', () => {
  const { text } = applySubstitutions('The ACMECO account and ACMECO-adjacent work', subs);
  assert.ok(!/\bACMECO\b/.test(text), text);
});
t('code inside hyphen/colon placeholder NOT stripped (adjacency negation)', () => {
  const probe = 'Use YYYY-' + 'XX' + '-DD and hh:' + 'XX' + ' format';
  const { text } = applySubstitutions(probe, subs);
  assert.strictEqual(text, probe);
});
t('standalone code stripped', () => {
  const { text } = applySubstitutions('the ' + 'XX' + ' account poll', subs);
  assert.ok(text.includes('{CLIENT_CODE}'), text);
});
t('domain stripped case-insensitive substring', () => {
  const { text } = applySubstitutions('see https://WWW.Acme-Client.com/login', subs);
  assert.ok(!/acme-client/i.test(text), text);
});
t('identifier stripped', () => {
  const { text } = applySubstitutions("const ACCT='000011112222333';", subs);
  assert.ok(text.includes('{AD_ACCOUNT_ID}'));
});
t('email replaced, example.com preserved', () => {
  const { text } = applySubstitutions('mail jane' + '@acme-corp' + '.net or user@example.com', subs);
  assert.ok(!text.includes('acme-corp' + '.net'), text);
  assert.ok(text.includes('user@example.com'));
});
t('scan catches planted contamination', () => {
  const hits = scanForDenylist('clean line\nleaked 000011112222333 here\n', denylist, 'f.md');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].line, 2);
});
t('scan clean on generic text incl. dates', () => {
  const hits = scanForDenylist('Timestamp YYYY-MM-DDThh:mm:ssZ is fine\n{CLIENT_CODE} placeholder ok\n', denylist, 'f.md');
  assert.deepStrictEqual(hits, []);
});
t('glob ** matches nested, * stays in segment', () => {
  assert.ok(globToRegex('**').test('a/b/c.md'));
  assert.ok(globToRegex('prompts/*.md').test('prompts/01.md'));
  assert.ok(!globToRegex('prompts/*.md').test('prompts/sub/01.md'));
});
t('manifest validation: missing key + prompt_count mismatch detected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-test-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ service_category: 'x', framework_name: 'y', version: '1', prompt_count: 3 }));
  fs.mkdirSync(path.join(dir, 'prompts'));
  fs.writeFileSync(path.join(dir, 'prompts', '01.md'), 'p');
  const problems = validateStagedFramework(dir);
  assert.ok(problems.some((p) => p.includes('execution_modes')));
  assert.ok(problems.some((p) => p.includes('prompt_count=3')));
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`export-public: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
