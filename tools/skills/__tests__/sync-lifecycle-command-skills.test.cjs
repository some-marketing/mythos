'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { LIFECYCLE_COMMANDS, syncLifecycle } = require('../sync-lifecycle-command-skills.cjs');
const { sync } = require('../sync-codex-skills.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-lifecycle-root-'));
  const adapter = fs.readFileSync(path.join(PROJECT_ROOT, 'instructions', 'adapters', 'codex.yaml'));
  fs.mkdirSync(path.join(root, 'instructions', 'adapters'), { recursive: true });
  fs.writeFileSync(path.join(root, 'instructions', 'adapters', 'codex.yaml'), adapter);
  fs.mkdirSync(path.join(root, 'instructions', 'canonical', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(root, 'instructions', 'canonical', 'command-aliases.yaml'), '{"aliases":[]}\n');
  for (const id of LIFECYCLE_COMMANDS) {
    fs.copyFileSync(
      path.join(PROJECT_ROOT, 'instructions', 'canonical', 'commands', `${id}.yaml`),
      path.join(root, 'instructions', 'canonical', 'commands', `${id}.yaml`)
    );
  }
  return root;
}

test('compatibility wrapper selects the complete lifecycle family from the general projector', () => {
  const root = fixture();
  const targetDir = path.join(root, '.agents', 'skills');
  const result = syncLifecycle({ root, targetDir, handlerIds: new Set(), apply: true });
  const applied = result.candidates.filter((item) => item.receipt.application_status === 'applied_additive');
  assert.deepEqual(applied.map((item) => item.id).sort(), LIFECYCLE_COMMANDS.map((id) => `command-${id}`).sort());
  for (const id of LIFECYCLE_COMMANDS) {
    const content = fs.readFileSync(path.join(targetDir, `source-command-${id}`, 'SKILL.md'), 'utf8');
    assert.match(content, new RegExp(`instructions/canonical/commands/${id}\\.yaml`));
  }
  assert.equal(result.candidates.length, LIFECYCLE_COMMANDS.length);
  assert.equal(result.index.receipts.length, LIFECYCLE_COMMANDS.length);
  assert.equal(fs.readdirSync(path.join(result.candidateDir, 'receipts')).length, LIFECYCLE_COMMANDS.length);
  assert.equal(result.index.receipts.every((receipt) => receipt.startsWith('receipts/command-')), true);
});

test('compatibility wrapper is additive-only and reports existing drift', () => {
  const root = fixture();
  const targetDir = path.join(root, '.agents', 'skills');
  const boot = path.join(targetDir, 'source-command-boot', 'SKILL.md');
  fs.mkdirSync(path.dirname(boot), { recursive: true });
  fs.writeFileSync(boot, 'foreign\n');
  const result = syncLifecycle({ root, targetDir, handlerIds: new Set(), apply: true });
  assert.equal(fs.readFileSync(boot, 'utf8'), 'foreign\n');
  assert.equal(result.candidates.find((item) => item.id === 'command-boot').receipt.application_status, 'blocked_existing_preserved');
  sync({ root, targetDir, handlerIds: new Set(), apply: true });
  const checked = syncLifecycle({ root, targetDir, handlerIds: new Set(), check: true });
  assert.equal(checked.drift, 1);
});

test('compatibility check reuses the committed general projection evidence', () => {
  const root = fixture();
  const targetDir = path.join(root, '.agents', 'skills');
  sync({ root, targetDir, handlerIds: new Set(), apply: true });
  const checked = syncLifecycle({ root, targetDir, handlerIds: new Set(), check: true });
  assert.equal(checked.drift, 0);
  assert.ok(checked.candidates.length >= LIFECYCLE_COMMANDS.length);
});

test('lifecycle application merges custody into the canonical ledger', () => {
  const root = fixture();
  const targetDir = path.join(root, '.agents', 'skills');
  syncLifecycle({ root, targetDir, handlerIds: new Set(), apply: true });
  const ledgerPath = path.join(root, '_dev/reports/analysis/codex-skill-projections/managed-targets.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(ledger.targets.includes('.agents/skills/source-command-boot/SKILL.md'), true);
  fs.unlinkSync(path.join(root, 'instructions/canonical/commands/boot.yaml'));
  sync({ root, targetDir, handlerIds: new Set() });
  assert.ok(syncLifecycle({ root, targetDir, handlerIds: new Set(), check: true }).drift > 0);
});

test('lifecycle application preflights canonical custody before target writes', () => {
  const root = fixture();
  const targetDir = path.join(root, '.agents', 'skills');
  write(root, '_dev/reports/analysis/codex-skill-projections/managed-targets.json', 'malformed\n');
  assert.throws(() => syncLifecycle({ root, targetDir, handlerIds: new Set(), apply: true }));
  assert.equal(fs.existsSync(path.join(targetDir, 'source-command-boot', 'SKILL.md')), false);
});

test('lifecycle checks ignore unrelated installed package drift', () => {
  const root = fixture();
  const targetDir = path.join(root, '.agents', 'skills');
  fs.writeFileSync(path.join(root, 'instructions', 'canonical', 'commands', 'route.yaml'), '{"id":"route","description":"route","mode":"REVIEW_ONLY"}\n');
  sync({ root, targetDir, handlerIds: new Set(), apply: true });
  fs.writeFileSync(path.join(targetDir, 'source-command-route', 'SKILL.md'), 'foreign\n');
  assert.ok(sync({ root, targetDir, handlerIds: new Set(), check: true }).drift > 0);
  assert.equal(syncLifecycle({ root, targetDir, handlerIds: new Set(), check: true }).drift, 0);
  fs.writeFileSync(path.join(root, 'instructions', 'canonical', 'commands', 'route.yaml'), '{"id":"route","description":"changed route","mode":"REVIEW_ONLY"}\n');
  assert.equal(syncLifecycle({ root, targetDir, handlerIds: new Set(), check: true }).drift, 0);
});
