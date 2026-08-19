#!/usr/bin/env node
'use strict';

// tools/ticktock/test-write-review-decision.cjs -- executable tests for the
// --operator-stamp flag on write-review-decision.cjs.
//
// WHY THIS EXISTS. The night of 2026-08-12 named "stamp-as-prose" as a defect
// class: the operator's verbatim authorization landed in decided_by PROSE while
// decision.operator_stamp -- the FIELD the TT-007 activation gate reads -- was
// hardcoded null. These arms prove the flag lands the exact string, byte for
// byte, and that omitting the flag still writes an honest null.
//
// The tool is a standalone CLI that exits at module scope, so it is spawned,
// never require()d (same reasoning as cycle-driver.cjs's runNodeTool).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TOOL = path.join(__dirname, 'write-review-decision.cjs');

let passed = 0;
let failed = 0;

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function check(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`  ok   ${name}\n`); }
  catch (err) { failed += 1; process.stdout.write(`  FAIL ${name}: ${err.message}\n`); }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-wrd-stamp-'));

// Minimal charter fixture: the tool reads charter_id, charter_hash, and
// reviewer_roster (lanes + lane_binding_hash). Nothing else.
const charter = {
  charter_id: 'tt-wrd-stamp-fixture',
  charter_hash: 'b'.repeat(64),
  reviewer_roster: {
    lane_binding_hash: 'c'.repeat(64),
    lanes: [{ lane_id: 'lane-1', family: 'codex' }]
  }
};
const lanes = [{
  lane_id: 'lane-1',
  family: 'codex',
  model_pin_requested: 'gpt-5-codex',
  model_pin_observed: 'gpt-5-codex',
  pin_verified: true,
  status: 'clean',
  verdict: 'APPROVE',
  unresolved_findings: 0,
  review_artifact_path: '_dev/tmp/fixture-review.md'
}];

const charterPath = path.join(tmpRoot, 'charter.json');
const lanesPath = path.join(tmpRoot, 'lanes.json');
fs.writeFileSync(charterPath, JSON.stringify(charter, null, 2));
fs.writeFileSync(lanesPath, JSON.stringify(lanes, null, 2));

function run(extraArgs, outName) {
  const outPath = path.join(tmpRoot, outName);
  execFileSync('node', [
    TOOL,
    '--charter', charterPath,
    '--lanes', lanesPath,
    '--decided-by', 'stamp-flag test fixture',
    '--at', '2026-08-12T04:00:00Z',
    '--out', outPath,
    ...extraArgs
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(fs.readFileSync(outPath, 'utf8'));
}

process.stdout.write('write-review-decision --operator-stamp\n');

// The stamp contains digits, periods, and internal spacing on purpose -- the
// verbatim shape the operator actually types. Byte equality, not includes().
const VERBATIM = '1. rebaseline 2. Roster Approved. 3. Accepted 4. lets do this';

check('--operator-stamp lands the exact verbatim string in the FIELD', () => {
  const doc = run(['--operator-stamp', VERBATIM, '--cleared'], 'with-stamp.json');
  assert(doc.decision.operator_stamp === VERBATIM,
    `field must equal the verbatim string, got: ${JSON.stringify(doc.decision.operator_stamp)}`);
  assert(doc.decision.cleared === true, 'roster is clean, decision must be cleared');
});

check('omitting the flag still writes an honest null (never "", never absent)', () => {
  const doc = run(['--cleared'], 'no-stamp.json');
  assert('operator_stamp' in doc.decision, 'the field must be present');
  assert(doc.decision.operator_stamp === null,
    `field must be exactly null, got: ${JSON.stringify(doc.decision.operator_stamp)}`);
});

fs.rmSync(tmpRoot, { recursive: true, force: true });

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
