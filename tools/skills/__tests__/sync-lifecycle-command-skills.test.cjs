'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { LIFECYCLE_COMMANDS, syncLifecycle } = require('../sync-lifecycle-command-skills.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

test('compatibility wrapper selects the complete lifecycle family from the general projector', () => {
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-lifecycle-target-'));
  const candidateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-lifecycle-candidates-'));
  const result = syncLifecycle({ root: PROJECT_ROOT, targetDir, candidateDir, apply: true });
  const applied = result.candidates.filter((item) => item.receipt.application_status === 'applied_additive');
  assert.deepEqual(applied.map((item) => item.id).sort(), LIFECYCLE_COMMANDS.map((id) => `command-${id}`).sort());
  for (const id of LIFECYCLE_COMMANDS) {
    const content = fs.readFileSync(path.join(targetDir, `source-command-${id}`, 'SKILL.md'), 'utf8');
    assert.match(content, new RegExp(`instructions/canonical/commands/${id}\\.yaml`));
  }
});

test('compatibility wrapper is additive-only and reports existing drift', () => {
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-lifecycle-preserve-'));
  const candidateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-lifecycle-candidates-'));
  const boot = path.join(targetDir, 'source-command-boot', 'SKILL.md');
  fs.mkdirSync(path.dirname(boot), { recursive: true });
  fs.writeFileSync(boot, 'foreign\n');
  const result = syncLifecycle({ root: PROJECT_ROOT, targetDir, candidateDir, apply: true });
  assert.equal(fs.readFileSync(boot, 'utf8'), 'foreign\n');
  assert.equal(result.candidates.find((item) => item.id === 'command-boot').receipt.application_status, 'blocked_existing_preserved');
  const checked = syncLifecycle({ root: PROJECT_ROOT, targetDir, candidateDir, check: true });
  assert.equal(checked.drift, 1);
});
