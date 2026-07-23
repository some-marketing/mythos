#!/usr/bin/env node
'use strict';

/**
 * S3 tests: the opt-in enforcing delegation-altitude breaker.
 * Runs the real hook in an isolated temp CLAUDE_PROJECT_DIR so state + emitted
 * signals stay out of the real repo. Asserts: default-OFF never blocks, enforcing
 * blocks at the hard cap, override and below-cap do not block, and a block emits
 * an attention-request signal.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '../../../..');
const HOOK = path.join(REPO, 'tools/kernel/hooks/pretool-delegation-altitude.cjs');

let pass = 0, fail = 0;
function check(label, cond) { if (cond) pass++; else { fail++; console.error(`  FAIL: ${label}`); } }

// Build an isolated project dir with the libs the hook lazily requires on block.
function makeProjectDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dab-'));
  fs.mkdirSync(path.join(dir, 'tools/verify/lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tools/kernel/lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, '_dev/state/delegation-altitude'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'tools/verify/lib/signal.cjs'), path.join(dir, 'tools/verify/lib/signal.cjs'));
  fs.copyFileSync(path.join(REPO, 'tools/kernel/lib/bubble-up-gates.cjs'), path.join(dir, 'tools/kernel/lib/bubble-up-gates.cjs'));
  return dir;
}

function seedState(dir, sid, edits) {
  const p = path.join(dir, '_dev/state/delegation-altitude', sid + '.json');
  fs.writeFileSync(p, JSON.stringify({ spawns: 0, edits, lastWarnAt: 0, editsAtLastSpawn: 0, lastBlockAt: 0, paths: [] }));
}

// Returns { status, stderr }.
function runHook(dir, sid, env) {
  const payload = JSON.stringify({ session_id: sid, tool_input: { file_path: '/tmp/x.js' } });
  try {
    execFileSync('node', [HOOK, '--tool', 'edit'], {
      input: payload, encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env },
    });
    return { status: 0, stderr: '' };
  } catch (e) {
    return { status: e.status, stderr: String(e.stderr || '') };
  }
}

// 1. DEFAULT OFF: even far past the cap, never blocks.
(() => {
  const dir = makeProjectDir(); seedState(dir, 's1', 50);
  const r = runHook(dir, 's1', {});
  check('default-off never blocks (exit 0)', r.status === 0);
})();

// 2. ENFORCING ON via env + cap crossed: blocks (exit 2) with BREAKER reason.
(() => {
  const dir = makeProjectDir(); seedState(dir, 's2', 20);
  const r = runHook(dir, 's2', { SMOS_DELEGATION_ALTITUDE_ENFORCE: '1' });
  check('enforcing + over cap blocks (exit 2)', r.status === 2);
  check('block reason names the breaker', /BREAKER/.test(r.stderr));
  // attention-request signal emitted in the isolated signals dir
  const sigDir = path.join(dir, '_dev/reports/signals');
  const emitted = fs.existsSync(sigDir) && fs.readdirSync(sigDir).some((f) => /^attention-request__.*__delegation-altitude\.json$/.test(f));
  check('block emits an attention-request signal', emitted);
})();

// 3. ENFORCING ON but OVERRIDDEN: does not block.
(() => {
  const dir = makeProjectDir(); seedState(dir, 's3', 20);
  const r = runHook(dir, 's3', { SMOS_DELEGATION_ALTITUDE_ENFORCE: '1', SMOS_DELEGATION_ALTITUDE_OVERRIDE: '1' });
  check('override prevents block (exit 0)', r.status === 0);
})();

// 4. ENFORCING ON but BELOW cap: does not block.
(() => {
  const dir = makeProjectDir(); seedState(dir, 's4', 0);
  const r = runHook(dir, 's4', { SMOS_DELEGATION_ALTITUDE_ENFORCE: '1' });
  check('below cap does not block (exit 0)', r.status === 0);
})();

// 5. ENFORCING via MARKER FILE: blocks.
(() => {
  const dir = makeProjectDir(); seedState(dir, 's5', 20);
  fs.writeFileSync(path.join(dir, '_dev/state/delegation-altitude/enforce'), '');
  const r = runHook(dir, 's5', {});
  check('marker-file enforce blocks (exit 2)', r.status === 2);
})();

// 6. OVERRIDE via MARKER FILE: does not block even with enforce marker.
(() => {
  const dir = makeProjectDir(); seedState(dir, 's6', 20);
  fs.writeFileSync(path.join(dir, '_dev/state/delegation-altitude/enforce'), '');
  fs.writeFileSync(path.join(dir, '_dev/state/delegation-altitude/override'), '');
  const r = runHook(dir, 's6', {});
  check('override marker prevents block (exit 0)', r.status === 0);
})();

// 7. FALSE-LIKE env values must NOT enable the breaker (Codex S3 HIGH finding).
(() => {
  const dir = makeProjectDir(); seedState(dir, 's7a', 20);
  check('ENFORCE=0 does not enable (exit 0)', runHook(dir, 's7a', { SMOS_DELEGATION_ALTITUDE_ENFORCE: '0' }).status === 0);
  const dir2 = makeProjectDir(); seedState(dir2, 's7b', 20);
  check('ENFORCE=false does not enable (exit 0)', runHook(dir2, 's7b', { SMOS_DELEGATION_ALTITUDE_ENFORCE: 'false' }).status === 0);
  // and a false-like OVERRIDE must NOT prevent a real block
  const dir3 = makeProjectDir(); seedState(dir3, 's7c', 20);
  check('OVERRIDE=0 does not override (still blocks)', runHook(dir3, 's7c', { SMOS_DELEGATION_ALTITUDE_ENFORCE: '1', SMOS_DELEGATION_ALTITUDE_OVERRIDE: '0' }).status === 2);
})();

// 8. Repeated blocked attempts in the SAME episode emit only ONE signal (dedup).
(() => {
  const dir = makeProjectDir(); seedState(dir, 's8', 20);
  runHook(dir, 's8', { SMOS_DELEGATION_ALTITUDE_ENFORCE: '1' }); // block #1 (emits)
  runHook(dir, 's8', { SMOS_DELEGATION_ALTITUDE_ENFORCE: '1' }); // block #2 (same episode, no emit)
  const sigDir = path.join(dir, '_dev/reports/signals');
  const n = fs.existsSync(sigDir) ? fs.readdirSync(sigDir).filter((f) => /attention-request__.*__delegation-altitude\.json$/.test(f)).length : 0;
  check('repeated blocks in one episode emit exactly one signal', n === 1);
})();

console.log(`\ndelegation-altitude breaker: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
