#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildReceipt,
  normalizeAuthorizedPath,
  parseArgs,
  verifyOnePasswordItem,
  writeReceipt
} = require('../../convene-unlock.cjs');

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    fail++;
    console.error(`FAIL: ${label} — ${err.message}`);
  }
}

check('parseArgs captures repeatable paths', () => {
  const args = parseArgs([
    '--item', 'SMOS Unlock',
    '--vault', 'Private',
    '--path', 'instructions/canonical/',
    '--path', '.claude/settings.json',
    '--convene-run', '_dev/reports/analysis/convene-runs/x',
    '--ttl-hours', '12'
  ]);
  assert.equal(args.item, 'SMOS Unlock');
  assert.equal(args.vault, 'Private');
  assert.deepEqual(args.paths, ['instructions/canonical/', '.claude/settings.json']);
  assert.equal(args.ttlHours, 12);
});

check('normalizeAuthorizedPath rejects traversal', () => {
  assert.throws(() => normalizeAuthorizedPath('../x'), /Invalid --path/);
});

check('verifyOnePasswordItem parses op item output without exposing secrets', () => {
  const item = verifyOnePasswordItem(
    { item: 'unlock', vault: 'ops' },
    (cmd, args) => {
      assert.equal(cmd, 'op');
      assert.deepEqual(args, ['item', 'get', 'unlock', '--format', 'json', '--vault', 'ops']);
      return JSON.stringify({
        id: 'item-123',
        title: 'SMOS Convene Unlock',
        vault: { id: 'vault-1' },
        fields: [{ label: 'secret', value: 'do-not-copy' }]
      });
    }
  );
  assert.deepEqual(item, {
    id: 'item-123',
    title: 'SMOS Convene Unlock',
    vault: 'vault-1'
  });
});

check('buildReceipt creates path-scoped 1Password-backed receipt', () => {
  const receipt = buildReceipt(
    {
      paths: ['instructions/canonical/', '.claude/settings.json'],
      conveneRun: '_dev/reports/analysis/convene-runs/run',
      ttlHours: 24
    },
    { id: 'item-123', title: 'Unlock', vault: 'vault-1' },
    new Date('2026-06-10T18:00:00Z')
  );
  assert.equal(receipt.schema, 'ConveneReceipt/1.0');
  assert.equal(receipt.operator_ratified, true);
  assert.deepEqual(receipt.authorized_paths, ['instructions/canonical/', '.claude/settings.json']);
  assert.equal(receipt.authorization.type, '1password');
  assert.equal(receipt.authorization.item_id, 'item-123');
  assert.equal(receipt.expires, '2026-06-11T18:00:00.000Z');
  assert.equal(JSON.stringify(receipt).includes('do-not-copy'), false);
});

check('writeReceipt writes json file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convene-unlock-test-'));
  try {
    const receipt = buildReceipt(
      { paths: ['instructions/canonical/'], conveneRun: 'run', ttlHours: 1 },
      { id: 'item-123', title: 'Unlock', vault: null },
      new Date('2026-06-10T18:00:00Z')
    );
    const file = writeReceipt(receipt, dir);
    assert.equal(fs.existsSync(file), true);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(parsed.schema, 'ConveneReceipt/1.0');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\nconvene unlock: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
