'use strict';

// Proves S3 of projection-build-integrity: readDeployStateTurnIds() must
// respect append-only correction records (corrected_turn_id, never
// turn_id) and their supersession by a later, actually-verified deploy.
// See _dev/reports/analysis/task-plans/projection-build-integrity__plan.json.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readDeployStateTurnIds } = require('../watch-imports.js');

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wi-deploy-state-'));
}

function writeLines(deployStatePath, lines) {
  fs.writeFileSync(deployStatePath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

test('OK line + correction line for the same turn -> NOT deployed', () => {
  const dir = sandbox();
  const p = path.join(dir, 'deploy-state.jsonl');
  writeLines(p, [
    { turn_id: 'tA', deployed_at: '2026-08-12T15:25:07.622Z', target: 'orwell' },
    { corrected_turn_id: 'tA', correction: 'crashed, no report', corrected_at: '2026-08-13T02:47:00Z' }
  ]);
  const seen = readDeployStateTurnIds(dir, p);
  assert.equal(seen.has('tA'), false);
});

test('OK + correction + a NEWER verified OK -> deployed (supersession)', () => {
  const dir = sandbox();
  const p = path.join(dir, 'deploy-state.jsonl');
  writeLines(p, [
    { turn_id: 'tB', deployed_at: '2026-08-12T15:26:26.918Z', target: 'orwell' },
    { corrected_turn_id: 'tB', correction: 'crashed, no report', corrected_at: '2026-08-13T02:47:00Z' },
    { turn_id: 'tB', deployed_at: '2026-08-13T03:10:00.000Z', target: 'orwell', build_verified: true }
  ]);
  const seen = readDeployStateTurnIds(dir, p);
  assert.equal(seen.has('tB'), true);
});

test('an uncorrected turn stays deployed', () => {
  const dir = sandbox();
  const p = path.join(dir, 'deploy-state.jsonl');
  writeLines(p, [{ turn_id: 'tC', deployed_at: '2026-08-12T15:25:07.622Z', target: 'orwell' }]);
  const seen = readDeployStateTurnIds(dir, p);
  assert.equal(seen.has('tC'), true);
});

// The seven S3-corrected turn_ids, in journal order.
const S3_CORRECTED_TURN_IDS = [
  'baseline-3000-r6',
  'baseline-3000-r7',
  'cc-turn1',
  'cc-turn2',
  'cc-turn3',
  'tt-run-001-09a6c88b',
  'tt-run-002r2-6028d083'
];

test('FROZEN pre-sweep snapshot (7 OKs + 7 corrections, the journal as of 02:47Z) excludes all seven corrected turn_ids', () => {
  // Codewhale impl-review finding 1 (2026-08-13): the previous version of
  // this test read the LIVE journal, whose state legitimately moved when the
  // corrected turns were re-deployed verified at 02:53-02:57Z. The exclusion
  // proof belongs to the frozen pre-sweep snapshot, reconstructed here.
  const dir = sandbox();
  const p = path.join(dir, 'deploy-state.jsonl');
  const okLines = S3_CORRECTED_TURN_IDS.map((t, i) => ({
    turn_id: t,
    deployed_at: `2026-08-12T15:2${5 + (i % 2)}:0${i}.000Z`,
    target: 'orwell'
  }));
  const correctionLines = S3_CORRECTED_TURN_IDS.map((t) => ({
    corrected_turn_id: t,
    correction: 'rebuild reported OK on trigger exit but the build crashed (D3D12 headless, no report)',
    corrected_at: '2026-08-13T02:47:00Z'
  }));
  writeLines(p, [...okLines, ...correctionLines]);
  const seen = readDeployStateTurnIds(dir, p);
  for (const t of S3_CORRECTED_TURN_IDS) {
    assert.equal(seen.has(t), false, `${t} should be corrected out of the deployed set`);
  }
});

test('the real repo deploy-state.jsonl marks all seven corrected turns deployed again — each has a later verified re-deploy (live supersession)', () => {
  // Post-sweep truth: the 02:53-02:57Z sweep re-deployed every corrected
  // turn with build_verified:true, so supersession re-adds them. This holds
  // as long as these turns' record suffix in the append-only journal stays
  // as-is (watch-imports skips already-deployed turns, so it will).
  const realPath = path.join(__dirname, '..', 'deploy-state.jsonl');
  const outDir = path.dirname(realPath);
  const seen = readDeployStateTurnIds(outDir, realPath);
  for (const t of S3_CORRECTED_TURN_IDS) {
    assert.equal(seen.has(t), true, `${t} should be re-added by its later verified re-deploy`);
  }
});
