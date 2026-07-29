#!/usr/bin/env node
'use strict';

const assert = require('assert');
const g = require('../bubble-up-gates.cjs');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  try { assert.deepStrictEqual(actual, expected); pass++; }
  catch { fail++; console.error(`  FAIL: ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); }
}

// Exactly seven gates, stable ids.
check('seven gates', g.GATES.length, 7);
check('gate ids', g.GATE_IDS, [
  'human_judgment', 'explicit_approval', 'budget_scope_timeline_commitment',
  'client_facing_risk', 'irreversible_destructive', 'credential_access',
  'same_rank_authority_conflict',
]);

// every gate carries summary + guardrail_phrase
check('all gates documented', g.GATES.every((x) => x.id && x.summary && x.guardrail_phrase), true);

// isValidGate: seven + none are valid; junk is not
check('valid: a real gate', g.isValidGate('credential_access'), true);
check('valid: none sentinel', g.isValidGate('none'), true);
check('invalid: junk', g.isValidGate('whatever'), false);
check('invalid: empty', g.isValidGate(''), false);
check('invalid: undefined', g.isValidGate(undefined), false);

// isBubbleUpGate: only the seven; none does NOT bubble
check('bubble: real gate', g.isBubbleUpGate('irreversible_destructive'), true);
check('bubble: none does not', g.isBubbleUpGate('none'), false);
check('bubble: junk does not', g.isBubbleUpGate('nope'), false);

// describeGate
check('describe known', g.describeGate('human_judgment').guardrail_phrase, 'human judgment');
check('describe unknown', g.describeGate('xyz'), null);

console.log(`\nbubble-up-gates: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
