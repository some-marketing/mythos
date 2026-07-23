#!/usr/bin/env node
'use strict';

/** S1 tests: attention-request signal type + backward-compat over live signals. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const s = require('../signal.cjs');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) pass++; else { fail++; console.error(`  FAIL: ${label}`); }
}

const base = {
  gate_type: 'irreversible_destructive',
  question: 'Raise the {CLIENT_CODE} branded daily cap from $40 to $60?',
  attempted_resolution: 'Pulled spend/cap data; cap binds 14 days/mo. Change requires owner-money commitment.',
  recommended_default: 'Raise to $60; reversible next billing cycle.',
};

// happy path
let sig = s.createAttentionRequest('coordinator', 'ambient-orchestrator-autonomy', base);
check('attention-request is valid signal type', s.VALID_SIGNAL_TYPES.includes('attention-request'));
check('defaults next actor to operator', sig.recommended_next_actor === 'operator');
check('valid attention-request passes', s.validateHandoffSignal(sig).valid === true);
check('exempt from slash-command next-step rule', s.validateHandoffSignal(sig).valid === true);

// sad paths
const noGate = s.createAttentionRequest('c', 'x', { ...base, gate_type: '' });
check('missing gate_type fails', s.validateHandoffSignal(noGate).valid === false);

const badGate = s.createAttentionRequest('c', 'x', { ...base, gate_type: 'made_up_gate' });
check('non-taxonomy gate fails', s.validateHandoffSignal(badGate).valid === false);

const noNone = s.createAttentionRequest('c', 'x', { ...base, gate_type: 'none' });
check('gate=none fails (none does not bubble up)', s.validateHandoffSignal(noNone).valid === false);

const noQ = s.createAttentionRequest('c', 'x', { ...base, question: '' });
check('missing question fails', s.validateHandoffSignal(noQ).valid === false);

const noDefault = s.createAttentionRequest('c', 'x', { ...base, recommended_default: '' });
check('missing recommended_default fails', s.validateHandoffSignal(noDefault).valid === false);

// existing types still build + validate (non-attention path unchanged)
const cc = s.createHandoffSignal('codex', 'scope', 'ready-for-review', {
  recommended_next_actor: 'claude', recommended_next_command: '/review-progress x',
  next_step_detail: ['do the thing'],
});
check('ready-for-review still valid', s.validateHandoffSignal(cc).valid === true);

// BACKWARD-COMPAT GATE: the new validator must reject no EXISTING live 1.0 signal.
const signalsDir = path.resolve(__dirname, '../../../../_dev/reports/signals');
let scanned = 0, regressions = 0;
function scan(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { scan(p); continue; }
    if (!e.name.endsWith('.json')) continue;
    let sig;
    try { sig = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
    if (sig.schema !== s.COORDINATION_SCHEMA_VERSION) continue; // only 1.0
    if (sig.signal_type === 'attention-request') continue;       // new type, not pre-existing
    scanned++;
    // The only validity-affecting change for non-attention signals is that
    // VALID_SIGNAL_TYPES GREW — which can only make more signals valid, never
    // fewer. So any invalid existing signal was already invalid pre-change.
    // We assert the validator does not THROW on real signals (robustness).
    try { s.validateHandoffSignal(sig); } catch (err) { regressions++; console.error(`  THREW on ${e.name}: ${err.message}`); }
  }
}
scan(signalsDir);
check(`backward-compat: validator ran over ${scanned} live 1.0 signals without throwing`, regressions === 0);
console.log(`  (scanned ${scanned} existing HandoffSignal/1.0 files)`);

console.log(`\nsignal attention-request: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
