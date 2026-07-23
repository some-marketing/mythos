#!/usr/bin/env node
'use strict';

/**
 * Tests for safety-family-tier-blind-lint.cjs
 * (tier-enforcement-implementation slice 2, step tier-s2a-safety-family-lint;
 * convene 20260611T130035Z condition 5).
 *
 * The FAILING FIXTURE required by the plan gate ("the lint demonstrably fails
 * on the fixture") is authored in a temp dir at test time and removed with it
 * — it never lands in the repo hook tree (plan convention: prove, then remove).
 *
 * Run: node tools/maintenance/__tests__/safety-family-tier-blind-lint.test.cjs
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const LINT = path.join(ROOT, 'tools/maintenance/safety-family-tier-blind-lint.cjs');

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (err) {
    fail += 1;
    console.error(`FAIL ${name}`);
    console.error(err.stack || err.message);
  }
}

function runLint(args) {
  return spawnSync(process.execPath, [LINT, ...args], { cwd: ROOT, encoding: 'utf8' });
}

// G5 / plan-gate fixture: a SAFETY-family hook that reads session tier MUST
// fail the lint. This is the failing fixture, created and destroyed in tmp.
check('FAILING FIXTURE: safety-family hook reading session tier is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safety-lint-fixture-'));
  fs.writeFileSync(path.join(dir, 'evil-safety-hook.cjs'), [
    "'use strict';",
    '// ENFORCEMENT_FAMILY: safety',
    "const { readSessionTier } = require('../lib/process-tier.cjs');",
    "if (readSessionTier(process.env.CLAUDE_SESSION_ID) === 'scaffold') process.exit(0);",
    ''
  ].join('\n'));
  const res = runLint(['--no-default-scan', '--hooks-dir', dir, '--json']);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  const out = JSON.parse(res.stdout);
  const hit = out.findings.find((f) => f.type === 'safety-family-reads-tier');
  assert.ok(hit, 'expected a safety-family-reads-tier finding');
  assert.match(hit.file, /evil-safety-hook\.cjs/);
  assert.match(hit.reason, /tier-blind by construction/);
  fs.rmSync(dir, { recursive: true, force: true });
});

check('tier consumer without a family declaration is a finding', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safety-lint-undeclared-'));
  fs.writeFileSync(path.join(dir, 'undeclared-consumer.cjs'), [
    "'use strict';",
    "const { readSessionAdds } = require('../lib/process-tier.cjs');",
    "readSessionAdds('x');",
    ''
  ].join('\n'));
  const res = runLint(['--no-default-scan', '--hooks-dir', dir, '--json']);
  assert.equal(res.status, 1);
  const out = JSON.parse(res.stdout);
  assert.ok(out.findings.some((f) => f.type === 'tier-consumer-missing-family-declaration'));
  fs.rmSync(dir, { recursive: true, force: true });
});

check('quality-process-declared tier consumer is clean; tier-blind safety hook is clean', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safety-lint-clean-'));
  fs.writeFileSync(path.join(dir, 'good-consumer.cjs'), [
    "'use strict';",
    '// ENFORCEMENT_FAMILY: quality-process',
    "const { readSessionAdds } = require('../lib/process-tier.cjs');",
    "readSessionAdds('x');",
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'good-safety.cjs'), [
    "'use strict';",
    '// ENFORCEMENT_FAMILY: safety',
    "process.stdout.write('no tier reads here');",
    ''
  ].join('\n'));
  const res = runLint(['--no-default-scan', '--hooks-dir', dir, '--json']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

check('registered safety surface declaring quality-process is a family conflict', () => {
  const lint = require(LINT);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safety-lint-conflict-'));
  const file = path.join(dir, 'conflicted.cjs');
  fs.writeFileSync(file, "// ENFORCEMENT_FAMILY: quality-process\n");
  const findings = lint.lintFile(file, 'conflicted.cjs', { isRegisteredSafety: true });
  assert.ok(findings.some((f) => f.type === 'family-conflict'));
  fs.rmSync(dir, { recursive: true, force: true });
});

check('live repo scan is clean (safety family tier-blind; consumers declared)', () => {
  const res = runLint([]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

check('registered safety surfaces all exist on disk', () => {
  const { SAFETY_SURFACES } = require(LINT);
  for (const rel of SAFETY_SURFACES) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `missing safety surface: ${rel}`);
  }
});

console.log(`\nsafety-family-tier-blind-lint: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
