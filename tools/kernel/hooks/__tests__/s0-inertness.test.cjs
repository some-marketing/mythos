#!/usr/bin/env node
'use strict';

// S0 adversarial fixtures — every case demanded by authorization review
// 20260805T174845Z (codex 6 findings / gemini 2), plus the pre-existing
// exemption branches codex found reaching a read-only verdict with no grammar
// proof.
//
// THE POINT: before this change, a read-only ACTION carrying a mutating
// REDIRECT reached the read-only lane. `pull-results.sh > D:\HyperV\x` was
// allowed. These fixtures fail if that ever becomes true again.

const assert = require('node:assert');
const path = require('path');
const gate = require('../pretool-remote-mutation-gate.cjs');

const PROJECT_DIR = path.resolve(__dirname, '..', '..', '..');
const NOW = Date.parse('2026-08-05T18:00:00Z');

let pass = 0;
let fail = 0;

function verdictFor(command) {
  return gate.main(
    { tool: 'Bash', payload: { tool_name: 'Bash', tool_input: { command }, session_id: 's0-fixture' } },
    { projectDir: PROJECT_DIR, nowMs: NOW }
  );
}

function denies(label, command) {
  const r = verdictFor(command);
  const ok = r && r.status === 2;
  if (ok) { pass += 1; console.log(`  PASS  deny   ${label}`); }
  else { fail += 1; console.log(`  FAIL  deny   ${label} -> status=${r && r.status} reason=${r && r.reason}`); }
}

// ── The predicate itself, in isolation ──────────────────────────────────────
console.log('S0 predicate — every construct rejected in isolation:');
const NON_INERT = [
  ['output redirect', 'cmd > out.txt'],
  ['append redirect', 'cmd >> out.txt'],
  ['input redirect', 'cmd < in.txt'],
  ['here-string', 'cmd <<< text'],
  ['heredoc', 'cmd << EOF'],
  ['fd redirect', 'cmd >& 2'],
  ['all-output redirect', 'cmd &> out.txt'],
  ['command substitution', 'cmd $(other)'],
  ['backtick substitution', 'cmd `other`'],
  ['process substitution in', 'cmd <(other)'],
  ['process substitution out', 'cmd >(other)'],
  ['variable expansion', 'cmd $VAR'],
  ['braced expansion', 'cmd ${VAR}'],
  ['find -exec', 'find . -exec rm {} ;'],
  ['find -execdir', 'find . -execdir rm {} ;'],
  ['find -ok', 'find . -ok rm {} ;'],
];
for (const [label, s] of NON_INERT) {
  const inert = gate.segmentIsSyntacticallyInert(s);
  if (!inert) { pass += 1; console.log(`  PASS  reject ${label}`); }
  else { fail += 1; console.log(`  FAIL  reject ${label} — predicate called it inert`); }
}

console.log('\nS0 predicate — genuinely inert segments are NOT rejected:');
const INERT = [
  ['plain command', 'ls -la /tmp'],
  ['quoted arg', 'grep "hello world" file.txt'],
  ['flags and paths', 'pull-results.sh --dest ./out'],
  ['scp pull', 'scp orwell:/a/b ./local'],
];
for (const [label, s] of INERT) {
  const inert = gate.segmentIsSyntacticallyInert(s);
  if (inert) { pass += 1; console.log(`  PASS  accept ${label}`); }
  else { fail += 1; console.log(`  FAIL  accept ${label} — predicate wrongly rejected it`); }
}

// ── The four pre-existing exemption branches ────────────────────────────────
// Each of these reached a READ-ONLY verdict before this change.
console.log('\nPre-existing read-only exemptions now gated on S0 (all must DENY):');
denies('pull-results.sh + redirect onto the remote surface', 'pull-results.sh > D:\\HyperV\\owned.txt');
denies('pull-results.sh + command substitution', 'pull-results.sh $(scp ./x orwell:/y)');
denies('scp pull + redirect', 'scp orwell:/a/b ./local > D:\\HyperV\\x');
denies('rsync pull + substitution', 'rsync -av orwell:/a/ ./local $(touch /tmp/x)');
denies('build-export.sh + redirect', 'build-export.sh > D:\\HyperV\\x');
denies('ssh read-verb payload + redirect', 'ssh orwell "Get-VM > D:\\HyperV\\owned.txt"');
denies('ssh read-verb payload + substitution', 'ssh orwell "Get-VM $(Remove-Item x)"');

// ── Regressions: genuine mutations must STILL deny ──────────────────────────
console.log('\nGenuine mutations still deny (no loosening):');
denies('unstamped scp push', 'scp ./payload.tar.gz orwell:D:/HyperV/Staging/In/');
denies('unstamped remote script', 'bash psrunfile.sh teardown-vm.ps1');
denies('ssh with mutating verb', 'ssh orwell "Remove-Item D:\\HyperV\\x"');

console.log(`\n--------------------------------------------------`);
console.log(`pass=${pass}  fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
