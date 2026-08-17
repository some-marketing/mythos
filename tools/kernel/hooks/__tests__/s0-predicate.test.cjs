#!/usr/bin/env node
'use strict';

// S0 predicate unit fixtures — the syntactic-inertness logic ONLY.
//
// DELIBERATELY SPLIT from the end-to-end denial fixtures. The gate classifies a
// script by scanning its BODY for mutation tokens, so any test file containing
// the strings needed to test denial is itself denied. That is why the gate's own
// suite (pretool-remote-mutation-gate.test.cjs) was refused earlier today, and it
// is recorded as denial #9 in the classifier plan. This file therefore contains
// NO mutating tokens and NO remote-host references, so it can actually run.
//
// The end-to-end fixtures live in s0-inertness.test.cjs and require a stamp
// scoping the gate's own test files. Until that exists, the S0 wiring into the
// four exemption branches is WRITTEN BUT NOT END-TO-END VERIFIED, and must be
// reported that way.

const gate = require('../pretool-remote-mutation-gate.cjs');

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  if (actual === expected) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${expected}, got ${actual}`); }
}

console.log('S0 — constructs that must be rejected as NOT inert:');
const NON_INERT = [
  ['output redirect', 'cmd > out.txt'],
  ['append redirect', 'cmd >> out.txt'],
  ['input redirect', 'cmd < in.txt'],
  ['here-string', 'cmd <<< text'],
  ['heredoc', 'cmd << EOF'],
  ['fd duplication', 'cmd >& 2'],
  ['all-output redirect', 'cmd &> out.txt'],
  ['command substitution', 'cmd $(other)'],
  ['backtick substitution', 'cmd `other`'],
  ['process substitution in', 'cmd <(other)'],
  ['process substitution out', 'cmd >(other)'],
  ['variable expansion', 'cmd $VAR'],
  ['braced expansion', 'cmd ${VAR}'],
  ['positional parameter', 'cmd $1'],
  ['find -exec', 'find . -exec something {} ;'],
  ['find -execdir', 'find . -execdir something {} ;'],
  ['find -ok', 'find . -ok something {} ;'],
  ['redirect after a quoted arg', 'grep "a b" file >> log'],
  ['substitution nested in an arg', 'grep --pattern=$(gen) file'],
];
for (const [label, s] of NON_INERT) check(label, gate.segmentIsSyntacticallyInert(s), false);

console.log('\nS0 — genuinely inert segments must NOT be rejected:');
const INERT = [
  ['plain command', 'ls -la /tmp'],
  ['quoted argument', 'grep "hello world" file.txt'],
  ['flags and paths', 'some-script.sh --dest ./out'],
  ['equals-style flag', 'tool --mode=read file.txt'],
  ['numeric arg', 'head -n 20 file.txt'],
  ['hyphenated path', 'cat ./a-b/c-d.txt'],
];
for (const [label, s] of INERT) check(label, gate.segmentIsSyntacticallyInert(s), true);

console.log('\nS0 — describeNonInert names the construct it found:');
const d1 = gate.describeNonInert('cmd > out.txt');
check('redirect is named', typeof d1 === 'string' && /redirection/.test(d1), true);
const d2 = gate.describeNonInert('cmd $(x)');
check('substitution is named', typeof d2 === 'string' && /expansion|substitution/.test(d2), true);
check('inert returns null', gate.describeNonInert('ls -la'), null);

console.log('\nS0 — guardReadOnlyVerdict withdraws on a non-inert segment:');
const ro = { applies: true, mutating: false, key: 'k', evidence: 'e', raw: 'r' };
const kept = gate.guardReadOnlyVerdict(ro, 'ls -la', 'k');
check('inert segment keeps the read-only verdict', kept.mutating, false);
const withdrawn = gate.guardReadOnlyVerdict(ro, 'ls -la > out.txt', 'k');
check('non-inert segment flips to mutating', withdrawn.mutating, true);
check('withdrawal explains itself', /WITHDRAWN/.test(withdrawn.evidence), true);

console.log(`\n--------------------------------------------------`);
console.log(`pass=${pass}  fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
