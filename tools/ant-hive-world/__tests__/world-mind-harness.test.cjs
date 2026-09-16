'use strict';

// tools/ant-hive-world/__tests__/world-mind-harness.test.cjs -- A3 regression
// test (plan sim-foundation-repairs, S7). world-mind-harness.cjs:67-93 used to
// interpolate argv-derived --guest-state-path/--guest-decision-path/
// --guest-distro into bash -lc STRINGS (`cat ${GUEST_STATE_PATH}` etc.) -- a
// host command-injection surface: a path containing `;`, `$(...)`, or
// backticks would execute on the host. S7 converts pullWorldState/pushDecision
// to execFileSync with argv ARRAYS: a FIXED literal script receives the
// variable path as a QUOTED POSITIONAL bound inside the script as "$1" (and
// "$2" for the push payload). Env-var transport and blacklists are REJECTED;
// the accepted input grammar is the gate:
//   path   = /^[A-Za-z0-9_./-]+$/   (no spaces, quotes, $, ;, backticks, newlines)
//   distro = /^[A-Za-z0-9_.-]+$/    (no '/', no spaces, no metacharacters)
//
// HOW THIS PROVES "NO COMMAND EXECUTES": the harness is loaded in a child
// process whose PATH puts a FAKE `wsl`/`ssh` first. The fake appends every
// argv element it receives to a log (one per line) and touches an
// EXECUTED.marker file. For a malicious input the harness must refuse BEFORE
// execFileSync is ever called, so the fake never runs: no marker, empty argv
// log. For an accepted input the fake DOES run, and the logged argv is the
// ground truth that the path arrived as its own positional element, verbatim,
// and that the script was the fixed literal -- never a concatenated string.
//
// RED on HEAD (interpolating harness): malicious paths reach execFileSync, the
// fake wsl runs, the marker appears, and the argv shows the path glued into
// the script element. GREEN after S7.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Overridable so the suite can be pointed at a pre-fix copy of the harness to
// demonstrate the red state (see the RED-NOTES block above).
const HARNESS = process.env.WMH_HARNESS_PATH || path.join(__dirname, '..', 'world-mind-harness.cjs');

const GOOD_STATE_PATH = '/opt/antworld/_dev/state/ant-hive-world-run/shared/world-state.json';
const GOOD_DECISION_PATH = '/opt/antworld/_dev/state/ant-hive-world-run/world-mind-decision.json';
const GOOD_DISTRO = 'Ubuntu-24.04';

const PAYLOAD = Buffer.from(JSON.stringify({ verb: 'idle', rationale: 'test' })).toString('base64');

function setupFakeBin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmh-a3-'));
  const marker = path.join(dir, 'EXECUTED.marker');
  const log = path.join(dir, 'argv.log');
  const fake = `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${log}"; done\ntouch "${marker}"\necho '{}'\n`;
  fs.writeFileSync(path.join(dir, 'wsl'), fake, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'ssh'), fake, { mode: 0o755 });
  const driver = path.join(dir, 'driver.cjs');
  fs.writeFileSync(driver,
    "'use strict';\n" +
    `const h = require(${JSON.stringify(HARNESS)});\n` +
    "const mode = process.env.WMH_MODE;\n" +
    "let r = mode === 'push' ? h.pushDecision({ verb: 'idle', rationale: 'test' }) : h.pullWorldState();\n" +
    "process.stdout.write('RESULT=' + (r === null ? 'null' : (r === true || r === false ? String(r) : JSON.stringify(r))) + '\\n');\n");
  return { dir, marker, log, driver };
}

function runHarness({ transport, distro, statePath, decisionPath, mode }) {
  const fake = setupFakeBin();
  const args = ['--guest-transport', transport];
  if (distro !== undefined) args.push('--guest-distro', distro);
  if (statePath !== undefined) args.push('--guest-state-path', statePath);
  if (decisionPath !== undefined) args.push('--guest-decision-path', decisionPath);
  const res = spawnSync(process.execPath, [fake.driver, ...args], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      WMH_MODE: mode,
      WMH_HARNESS_PATH: HARNESS,
      PATH: fake.dir + path.delimiter + process.env.PATH
    },
    encoding: 'utf8',
    timeout: 15000
  });
  const argvLines = fs.existsSync(fake.log)
    ? fs.readFileSync(fake.log, 'utf8').split('\n').filter(Boolean)
    : [];
  return { res, dir: fake.dir, marker: fake.marker, argvLines };
}

function assertRefused(r, which) {
  assert.equal(r.res.status, 0, `driver should exit 0; stderr: ${r.res.stderr}`);
  assert.match(r.res.stdout, new RegExp(`RESULT=${which === 'push' ? 'false' : 'null'}`));
  assert.match(r.res.stderr, new RegExp(`REFUSED guest ${which === 'push' ? 'decision push' : 'state pull'}`));
  // THE core A3 assertion: the fake binary never executed.
  assert.ok(!fs.existsSync(r.marker), `no command may execute for a refused ${which} input`);
  assert.equal(r.argvLines.length, 0, 'no argv may be handed to any binary for a refused input');
}

// ---- malicious inputs: refused, no command executes ------------------------
const MALICIOUS_PATHS = [
  'x;touch /tmp/wmh-a3-pwned',          // semicolon (command separator)
  '$(touch /tmp/wmh-a3-pwned)',         // command substitution
  '`touch /tmp/wmh-a3-pwned`',          // backticks
  '/opt/ant world/state.json',          // space
  "/opt/ant'world/state.json",          // single quote
  '/opt/ant"world/state.json',          // double quote
  'x$HOME/state.json',                  // dollar expansion
  'x&touch /tmp/wmh-a3-pwned',          // background operator
  'x|cat /etc/passwd',                  // pipe
  'x> /tmp/wmh-a3-pwned'                // redirect
];

for (const bad of MALICIOUS_PATHS) {
  test(`pull local: REFUSES malicious state path ${JSON.stringify(bad)} -- no command executes`, () => {
    const r = runHarness({ transport: 'local', distro: GOOD_DISTRO, statePath: bad, mode: 'pull' });
    try { assertRefused(r, 'pull'); } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
  });
}

const MALICIOUS_DISTROS = [
  'Ubuntu-24.04;reboot',
  'Ubuntu 24.04',
  "Ub'untu",
  'ubuntu/24',
  'Ubuntu-24.04$(id)'
];

for (const bad of MALICIOUS_DISTROS) {
  test(`pull local: REFUSES malicious distro ${JSON.stringify(bad)} -- no command executes`, () => {
    const r = runHarness({ transport: 'local', distro: bad, statePath: GOOD_STATE_PATH, mode: 'pull' });
    try { assertRefused(r, 'pull'); } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
  });
}

test('push local: REFUSES malicious decision path -- no command executes', () => {
  const r = runHarness({ transport: 'local', distro: GOOD_DISTRO, decisionPath: 'x;rm -rf /tmp/wmh-a3-pwned', mode: 'push' });
  try { assertRefused(r, 'push'); } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('push ssh: REFUSES malicious decision path -- no command executes', () => {
  const r = runHarness({ transport: 'ssh', distro: GOOD_DISTRO, decisionPath: 'x`id`', mode: 'push' });
  try { assertRefused(r, 'push'); } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('pull ssh: REFUSES malicious state path -- no command executes', () => {
  const r = runHarness({ transport: 'ssh', distro: GOOD_DISTRO, statePath: 'x;touch /tmp/wmh-a3-pwned', mode: 'pull' });
  try { assertRefused(r, 'pull'); } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

// ---- accepted grammar: path passed verbatim as a positional ----------------
test('pull local: accepted path passed VERBATIM as "$1" positional, fixed literal script', () => {
  const r = runHarness({ transport: 'local', distro: GOOD_DISTRO, statePath: GOOD_STATE_PATH, mode: 'pull' });
  try {
    assert.equal(r.res.status, 0, r.res.stderr);
    assert.ok(r.res.stdout.includes('RESULT={}'), `fake wsl echoed '{}'; stdout: ${r.res.stdout}`);
    assert.ok(fs.existsSync(r.marker), 'accepted grammar should reach the fake binary');
    // local wsl argv: -d <distro> -- bash -lc <FIXED_SCRIPT> world-mind-pull <path>
    assert.deepEqual(r.argvLines.slice(0, 5), ['-d', GOOD_DISTRO, '--', 'bash', '-lc']);
    assert.equal(r.argvLines[5], 'cat "$1"', 'script must be the fixed literal, verbatim');
    assert.equal(r.argvLines[6], 'world-mind-pull', '$0 placeholder');
    assert.equal(r.argvLines[7], GOOD_STATE_PATH, 'path must arrive verbatim as its own positional');
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('pull ssh: accepted path passed VERBATIM as last positional; remote command is fixed literal', () => {
  const r = runHarness({ transport: 'ssh', distro: GOOD_DISTRO, statePath: GOOD_STATE_PATH, mode: 'pull' });
  try {
    assert.equal(r.res.status, 0, r.res.stderr);
    assert.ok(r.res.stdout.includes('RESULT={}'), r.res.stdout);
    assert.ok(fs.existsSync(r.marker), 'accepted grammar should reach the fake binary');
    // ssh argv: -o ConnectTimeout=10 -o BatchMode=yes -o UpdateHostKeys=no <host> <REMOTE_COMMAND> <path>
    assert.deepEqual(r.argvLines.slice(0, 6), ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', '-o', 'UpdateHostKeys=no']);
    assert.equal(r.argvLines[6], 'orwell', 'ssh alias');
    assert.equal(r.argvLines[7], `wsl -d ${GOOD_DISTRO} -- bash -lc 'cat "$1"' world-mind-pull`, 'remote command must be the fixed literal');
    assert.ok(!r.argvLines[7].includes(GOOD_STATE_PATH), 'path must NOT be interpolated into the remote command');
    assert.equal(r.argvLines[8], GOOD_STATE_PATH, 'path must arrive verbatim as its own positional');
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('push local: payload as "$1", path verbatim as "$2", fixed literal script', () => {
  const r = runHarness({ transport: 'local', distro: GOOD_DISTRO, decisionPath: GOOD_DECISION_PATH, mode: 'push' });
  try {
    assert.equal(r.res.status, 0, r.res.stderr);
    assert.ok(r.res.stdout.includes('RESULT=true'), r.res.stdout);
    assert.ok(fs.existsSync(r.marker), 'accepted grammar should reach the fake binary');
    assert.deepEqual(r.argvLines.slice(0, 5), ['-d', GOOD_DISTRO, '--', 'bash', '-lc']);
    assert.equal(r.argvLines[5], 'printf %s "$1" | base64 -d > "$2"', 'script must be the fixed literal, verbatim');
    assert.equal(r.argvLines[6], 'world-mind-push', '$0 placeholder');
    assert.equal(r.argvLines[7], PAYLOAD, 'base64 payload as $1');
    assert.equal(r.argvLines[8], GOOD_DECISION_PATH, 'decision path verbatim as $2');
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('push ssh: payload as "$1", path verbatim as "$2", fixed literal remote command', () => {
  const r = runHarness({ transport: 'ssh', distro: GOOD_DISTRO, decisionPath: GOOD_DECISION_PATH, mode: 'push' });
  try {
    assert.equal(r.res.status, 0, r.res.stderr);
    assert.ok(r.res.stdout.includes('RESULT=true'), r.res.stdout);
    assert.ok(fs.existsSync(r.marker), 'accepted grammar should reach the fake binary');
    assert.deepEqual(r.argvLines.slice(0, 6), ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', '-o', 'UpdateHostKeys=no']);
    assert.equal(r.argvLines[6], 'orwell', 'ssh alias');
    assert.equal(r.argvLines[7], `wsl -d ${GOOD_DISTRO} -- bash -lc 'printf %s "$1" | base64 -d > "$2"' world-mind-push`, 'remote command must be the fixed literal');
    assert.ok(!r.argvLines[7].includes(GOOD_DECISION_PATH), 'path must NOT be interpolated into the remote command');
    assert.equal(r.argvLines[8], PAYLOAD, 'base64 payload as $1');
    assert.equal(r.argvLines[9], GOOD_DECISION_PATH, 'decision path verbatim as $2');
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});
