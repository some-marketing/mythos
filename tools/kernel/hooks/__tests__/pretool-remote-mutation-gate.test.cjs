#!/usr/bin/env node
'use strict';

/**
 * Fixture tests for the mechanical G-REMOTE-MUTATION gate.
 * Run: node _dev/staged/kernel-hooks/__tests__/pretool-remote-mutation-gate.test.cjs
 *
 * No test touches orwell. Every case is a synthetic PreToolUse Bash payload.
 * Stamp state lives in a temp sandbox project dir except where a case explicitly
 * exercises the REAL backfilled sidecars.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const gate = require('../pretool-remote-mutation-gate.cjs');
const { resolveStampSecret, signStamp } = require('../lib/stamp-mac.cjs');

const REAL_PROJECT = path.resolve(__dirname, '../../../..');

// Codex PR#20 F1: stamps are now HMAC-signed, so every fixture this suite
// writes must be signed too or it reads as invalid regardless of which
// scenario the fixture is meant to exercise. Signing a deliberately-invalid
// fixture (voided/expired/broad-scope) is harmless -- those checks fire
// before the MAC check in stampInvalidReason() -- and required for every
// fixture meant to be VALID.
const STAMP_SECRET = resolveStampSecret();
if (!STAMP_SECRET) {
  process.stderr.write('FATAL: no operator secret resolvable -- cannot sign test fixtures\n');
  process.exit(2);
}

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; process.stdout.write(`  PASS  ${name}\n`); }
  catch (err) { fail += 1; process.stderr.write(`  FAIL  ${name}\n    ${err.stack || err.message}\n`); }
}

// ── Sandbox project dir ──────────────────────────────────────────────────────
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'rmgate-test-'));
fs.mkdirSync(path.join(SANDBOX, '_dev/reports/analysis'), { recursive: true });
fs.mkdirSync(path.join(SANDBOX, '_dev/state/remote-mutation-stamps'), { recursive: true });
fs.mkdirSync(path.join(SANDBOX, '_dev/sim-runs/vm/orwell'), { recursive: true });
// Mirror the real read-only scripts so drift detection has something to read.
for (const s of ['check-provisioning.ps1', 'watch-turn-health.ps1']) {
  const src = path.join(REAL_PROJECT, '_dev/sim-runs/vm/orwell', s);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(SANDBOX, '_dev/sim-runs/vm/orwell', s));
}

const DOC = '_dev/reports/analysis/g-remote-mutation-prestamp__sandbox__20260805T0400Z.md';
fs.writeFileSync(path.join(SANDBOX, DOC), '# sandbox stamp\n\nOperator: authorized.\n');

function writeStamp(id, overrides) {
  const stamp = Object.assign({
    schema: 'RemoteMutationStamp/1.0',
    stamp_id: id,
    source_doc: DOC,
    granted_at: '2026-08-05T03:05:00Z',
    operator_authorization: '"consider it stamped" — operator, sandbox fixture',
    scope: ['load-courier.ps1'],
    conditions: ['sandbox condition'],
    expires_at: null,
    voided: false,
    superseded_by: null,
  }, overrides || {});
  signStamp(STAMP_SECRET, stamp);
  fs.writeFileSync(
    path.join(SANDBOX, '_dev/state/remote-mutation-stamps', id + '.json'),
    JSON.stringify(stamp, null, 2) + '\n'
  );
}
function clearStamps() {
  const d = path.join(SANDBOX, '_dev/state/remote-mutation-stamps');
  for (const f of fs.readdirSync(d)) if (f.endsWith('.json')) fs.unlinkSync(path.join(d, f));
}
function auditLines(projectDir) {
  const f = path.join(projectDir, '_dev/state/remote-mutation-stamps/audit.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

let seq = 0;
function run(command, projectDir = SANDBOX) {
  seq += 1;
  return gate.main(
    { tool: 'Bash', payload: { tool_name: 'Bash', tool_input: { command }, session_id: `rmgate-test-${seq}` } },
    { projectDir, nowMs: Date.parse('2026-08-05T04:00:00Z') }
  );
}

process.stdout.write('\n=== DENY: no stamp ===\n');
clearStamps();
check('psrunfile load-courier with NO stamp is denied', () => {
  const r = run('bash psrunfile.sh load-courier.ps1 -ExpectedSha256 x');
  assert.strictEqual(r.status, 2, 'expected deny');
  assert.strictEqual(r.reason, 'no-covering-stamp');
  assert.ok(r.message.includes('load-courier.ps1'), 'names what was blocked');
  assert.ok(r.message.includes('(none — no valid stamp sidecar exists)'), 'names available scopes');
  assert.ok(r.message.includes('HOW THE OPERATOR GRANTS ONE'), 'names how to grant');
  process.stdout.write('\n--- deny message (no stamp) ---\n' + r.message + '\n--- end ---\n');
});

process.stdout.write('\n=== DENY: scope mismatch ===\n');
clearStamps();
writeStamp('scope-excludes', { scope: ['refresh-seed.ps1'] });
check('stamp whose scope excludes load-courier is denied', () => {
  const r = run('bash psrunfile.sh load-courier.ps1 -ExpectedSha256 x');
  assert.strictEqual(r.status, 2);
  assert.deepStrictEqual(r.keys, ['load-courier.ps1']);
  assert.ok(r.message.includes('scope-excludes'), 'lists the existing stamp');
  assert.ok(r.message.includes('refresh-seed.ps1'), 'lists its scope');
  process.stdout.write('\n--- deny message (scope mismatch) ---\n' + r.message + '\n--- end ---\n');
});

process.stdout.write('\n=== DENY: voided / expired / unparseable ===\n');
clearStamps();
writeStamp('voided-stamp', { voided: true });
check('voided stamp is denied', () => {
  const r = run('bash psrunfile.sh load-courier.ps1 -ExpectedSha256 x');
  assert.strictEqual(r.status, 2);
  assert.ok(r.message.includes('voided'), 'names the void reason: ' + r.message);
});
clearStamps();
writeStamp('expired-stamp', { expires_at: '2026-08-04T00:00:00Z' });
check('expired stamp is denied', () => {
  const r = run('bash psrunfile.sh load-courier.ps1 -ExpectedSha256 x');
  assert.strictEqual(r.status, 2);
  assert.ok(/expired at/.test(r.message));
});
clearStamps();
writeStamp('superseded-stamp', { superseded_by: 'some-newer-stamp' });
check('superseded stamp is denied', () => {
  assert.strictEqual(run('bash psrunfile.sh load-courier.ps1').status, 2);
});
clearStamps();
fs.writeFileSync(path.join(SANDBOX, '_dev/state/remote-mutation-stamps/broken.json'), '{not json');
check('unparseable sidecar is denied (never allow-on-error)', () => {
  const r = run('bash psrunfile.sh load-courier.ps1');
  assert.strictEqual(r.status, 2);
  assert.ok(r.message.includes('unparseable JSON'));
});
fs.unlinkSync(path.join(SANDBOX, '_dev/state/remote-mutation-stamps/broken.json'));
clearStamps();
writeStamp('no-conditions', { conditions: [] });
check('stamp naming no conditions is invalid', () => {
  const r = run('bash psrunfile.sh load-courier.ps1');
  assert.strictEqual(r.status, 2);
  assert.ok(r.message.includes('no conditions named'));
});
clearStamps();
writeStamp('no-auth-line', { operator_authorization: '   ' });
check('stamp with no operator authorization line is invalid', () => {
  const r = run('bash psrunfile.sh load-courier.ps1');
  assert.strictEqual(r.status, 2);
  assert.ok(r.message.includes('missing explicit operator authorization line'));
});
clearStamps();
writeStamp('ghost-doc', { source_doc: '_dev/reports/analysis/g-remote-mutation-packet__ghost__20260101T0000Z.md' });
check('stamp whose source doc is missing on disk is invalid', () => {
  const r = run('bash psrunfile.sh load-courier.ps1');
  assert.strictEqual(r.status, 2);
  assert.ok(r.message.includes('source_doc missing on disk'));
});

process.stdout.write('\n=== DENY: other mutating lanes, unstamped ===\n');
clearStamps();
for (const [label, cmd, key] of [
  ['inbound-push.sh', 'bash inbound-push.sh', 'inbound-push.sh'],
  ['ssh Start-VM', 'ssh orwell "powershell -NoProfile -Command \\"Start-VM -Name ant\\""', 'ssh:mutate'],
  ['ssh Remove-Item D:\\HyperV', 'ssh orwell "powershell -Command \\"Remove-Item D:\\HyperV\\AntWorld\\x\\""', 'ssh:mutate'],
  ['ssh Mount-VHD', 'ssh orwell powershell -Command "Mount-VHD -Path D:\\HyperV\\c.vhdx"', 'ssh:mutate'],
  ['scp push', 'scp ./payload.tar.gz orwell:D:/HyperV/AntWorld/Staging/In/', 'scp:push'],
  ['unknown remote script', 'bash psrunfile.sh teardown-vm.ps1', 'teardown-vm.ps1'],
  ['unlisted script (fail closed)', 'bash psrunfile.sh some-new-thing.ps1', 'some-new-thing.ps1'],
  ['build-export chained to push', 'bash build-export.sh && bash inbound-push.sh', 'build-export.sh'],
  ['verify-membrane (mutates: Start-VM)', 'bash psrunfile.sh verify-membrane.ps1', 'verify-membrane.ps1'],
  ['console-capture (mutates: Stop-VM)', 'bash psrunfile.sh console-capture.ps1', 'console-capture.ps1'],
  ['ssh interactive', 'ssh orwell', 'ssh:interactive'],
  ['rsync push', 'rsync -avz ./payload/ orwell:D:/HyperV/AntWorld/Staging/In/', 'rsync:push'],
]) {
  check(`${label} unstamped is denied`, () => {
    const r = run(cmd);
    assert.strictEqual(r.status, 2, `expected deny for: ${cmd}`);
    assert.ok(r.keys.includes(key), `expected key ${key}, got ${JSON.stringify(r.keys)}`);
  });
}

process.stdout.write('\n=== DENY: TT-R4-001 classification-hole cases ===\n');
clearStamps();
check('unknown remote reference (unrecognized exe naming orwell directly) is denied', () => {
  // No recognized exe classifies "nc"/"curl" etc. — the catch-all must still
  // fail closed rather than let the gate say "does not apply".
  const r = run('nc orwell 5985');
  assert.strictEqual(r.status, 2, JSON.stringify(r));
  assert.ok(r.keys.some((k) => k.startsWith('unknown:')), `expected an unknown: key, got ${JSON.stringify(r.keys)}`);
});
check('unknown remote reference via a D:\\HyperV path is denied', () => {
  const r = run('some-tool.exe --target "D:\\HyperV\\AntWorld\\Golden"');
  assert.strictEqual(r.status, 2, JSON.stringify(r));
  assert.ok(r.keys.some((k) => k.startsWith('unknown:')), `expected an unknown: key, got ${JSON.stringify(r.keys)}`);
});

// Wrapper-script detection: an unrecognized script (not psrun/psrunfile, not
// on READ_ONLY_SCRIPTS) invoked directly, whose body shells to ssh orwell
// without the invoking command line ever mentioning orwell itself.
fs.writeFileSync(
  path.join(SANDBOX, 'rogue-wrapper.sh'),
  '#!/usr/bin/env bash\nset -euo pipefail\nssh orwell "powershell -Command \\"Start-VM -Name ant\\""\n'
);
check('unknown script whose body shells to ssh orwell is denied (wrapper detection)', () => {
  const r = run('bash rogue-wrapper.sh');
  assert.strictEqual(r.status, 2, JSON.stringify(r));
  assert.ok(r.keys.includes('wrapper:rogue-wrapper.sh'), `expected wrapper:rogue-wrapper.sh, got ${JSON.stringify(r.keys)}`);
  assert.ok(
    r.message.includes('shells to the orwell remote host') || r.message.includes('mutating token'),
    r.message
  );
});

fs.writeFileSync(
  path.join(SANDBOX, 'quiet-wrapper.sh'),
  '#!/usr/bin/env bash\nset -euo pipefail\nssh orwell "powershell -Command \\"Get-Item C:\\\\x\\"" > out.txt\n'
);
check('unknown script whose body shells to ssh orwell with no hard-mutation token is still denied', () => {
  // No HARD_MUTATION_TOKENS hit here (Get-Item isn't one) — this exercises the
  // ssh/scp/rsync + orwell-reference branch of scanUnknownScript on its own.
  const r = run('bash quiet-wrapper.sh');
  assert.strictEqual(r.status, 2, JSON.stringify(r));
  assert.ok(r.keys.includes('wrapper:quiet-wrapper.sh'), JSON.stringify(r.keys));
  assert.ok(r.message.includes('shells to the orwell remote host'), r.message);
});

fs.writeFileSync(path.join(SANDBOX, 'unreadable-marker.sh'), '#!/usr/bin/env bash\necho hi\n');
check('unknown script that cannot be resolved on disk at all is denied (fail closed)', () => {
  const r = run('bash totally-nonexistent-wrapper.sh');
  assert.strictEqual(r.status, 2, JSON.stringify(r));
  assert.ok(r.keys.includes('wrapper:totally-nonexistent-wrapper.sh'), JSON.stringify(r.keys));
  assert.ok(r.message.includes('not resolvable'), r.message);
});
check('unknown local script with a clean body is NOT flagged as remote-mutating', () => {
  const r = run('bash unreadable-marker.sh');
  assert.strictEqual(r.status, 0, JSON.stringify(r));
  assert.strictEqual(r.reason, 'read-only-lane');
});

process.stdout.write('\n=== DENY: B1 variable-expansion bypass (convene 20260805T130427Z) ===\n');
clearStamps();
for (const [label, cmd, key] of [
  ['ssh with a quoted variable host and variable payload', 'ssh "$REMOTE_HOST" "$REMOTE_CMD"', 'ssh:unexpanded-host'],
  ['assignment then ssh $TARGET in the same command line', 'TARGET=orwell; ssh $TARGET stop-vm', 'ssh:unexpanded-host'],
  ['inline assignment feeding ssh $TARGET', 'TARGET=orwell ssh $TARGET stop-vm', 'ssh:unexpanded-host'],
  ['ssh with a ${BRACED} host', 'ssh ${MY_HOST} whoami', 'ssh:unexpanded-host'],
  ['ssh with a command-substituted host', 'ssh $(cat /tmp/host.txt) Start-VM', 'ssh:unexpanded-host'],
  ['ssh with a backtick-substituted host', 'ssh `cat /tmp/host.txt` whoami', 'ssh:unexpanded-host'],
  ['ssh to the literal host with a variable payload', 'ssh orwell "$REMOTE_CMD"', 'ssh:mutate'],
  ['scp to a variable destination', 'scp ./payload.tar.gz "$DEST"', 'scp:unexpanded-dest'],
  ['rsync to a variable destination', 'rsync -avz ./payload/ $DEST', 'rsync:unexpanded-dest'],
  ['sftp to a variable target', 'sftp $TARGET', 'sftp:unexpanded-target'],
  ['psrunfile with a variable script argument', 'bash psrunfile.sh $SCRIPT', 'psrunfile.sh:inline'],
]) {
  check(`B1: ${label} is denied`, () => {
    const r = run(cmd);
    assert.strictEqual(r.status, 2, `expected deny for: ${cmd} — got ${JSON.stringify(r)}`);
    assert.ok(r.keys.includes(key), `expected key ${key}, got ${JSON.stringify(r.keys)}`);
    assert.ok(/unexpanded|cannot see what actually runs/.test(r.message), r.message);
  });
}
check('B1 no over-block: a purely local scp between two local paths is untouched', () => {
  const r = run('scp ./a.txt ./b.txt');
  assert.strictEqual(r.status, 0, JSON.stringify(r));
  assert.strictEqual(r.reason, 'not-remote');
});
check('B1 no over-block: an ordinary command using a variable is untouched', () => {
  const r = run('echo "$HOME/notes.txt" > /tmp/x');
  assert.strictEqual(r.status, 0, JSON.stringify(r));
  assert.strictEqual(r.reason, 'not-remote');
});
check('B1 no over-block: rsync FROM a variable source into a local dir is not denied', () => {
  const r = run('rsync -avz $SRC ./local/');
  assert.strictEqual(r.status, 0, JSON.stringify(r));
});

process.stdout.write('\n=== F2: unquoted-backslash-escape bypass (codex PR#20, kernel-triad convene 20260817T184138Z) ===\n');
check('tokenize: an escaped letter is consumed literally (backslash dropped)', () => {
  assert.deepStrictEqual(gate.tokenize('orw\\ell'), ['orwell']);
});
check('tokenize: an escaped whitespace character stays part of the SAME token, not a delimiter split', () => {
  assert.deepStrictEqual(gate.tokenize('foo\\ bar'), ['foo bar']);
});
check('tokenize: an escaped @ is consumed literally', () => {
  assert.deepStrictEqual(gate.tokenize('admin\\@orwell'), ['admin@orwell']);
});
check('tokenize: a trailing unquoted backslash (nothing to escape) is conservatively retained, not silently dropped', () => {
  assert.deepStrictEqual(gate.tokenize('orwell\\'), ['orwell\\']);
});
check('tokenize: backslash handling does not change inside single quotes (still literal, unescaped by the quote logic)', () => {
  assert.deepStrictEqual(gate.tokenize("'orw\\ell'"), ['orw\\ell']);
});
check('tokenize: an ordinary unescaped command is unaffected', () => {
  assert.deepStrictEqual(gate.tokenize('ssh orwell whoami'), ['ssh', 'orwell', 'whoami']);
});
check('F2 end-to-end: a shell-lexically-escaped hostname no longer bypasses the strict REMOTE_HOST equality check', () => {
  clearStamps();
  const r = run('ssh orw\\ell "Stop-VM -Name X"');
  assert.strictEqual(r.status, 2, `expected deny, got ${JSON.stringify(r)}`);
  assert.ok(r.keys.includes('ssh:mutate'), JSON.stringify(r.keys));
});
check('F2 end-to-end: a shell-lexically-escaped scp destination host no longer bypasses the remote-host regex match', () => {
  clearStamps();
  const r = run('scp ./payload.tar.gz orw\\ell:D:/HyperV/X');
  assert.strictEqual(r.status, 2, `expected deny, got ${JSON.stringify(r)}`);
  assert.ok(r.keys.includes('scp:push'), JSON.stringify(r.keys));
});

process.stdout.write('\n=== DENY: B2 interpreter-wrapper blindness (convene 20260805T130427Z) ===\n');
clearStamps();
fs.writeFileSync(
  path.join(SANDBOX, 'rogue-mutator.js'),
  "const { execSync } = require('child_process');\n" +
  'execSync(\'ssh orwell "powershell -Command \\\\"Stop-VM -Name ant\\\\""\');\n'
);
check('B2: node script whose body shells to ssh orwell is denied', () => {
  const r = run('node rogue-mutator.js');
  assert.strictEqual(r.status, 2, JSON.stringify(r));
  assert.ok(r.keys.includes('wrapper:rogue-mutator.js'), JSON.stringify(r.keys));
});
fs.mkdirSync(path.join(SANDBOX, 'tools'), { recursive: true });
fs.writeFileSync(
  path.join(SANDBOX, 'tools/quiet-mutator.py'),
  'import subprocess\nsubprocess.run(["ssh", "orwell", "hostname"])\n'
);
check('B2: python script that shells to orwell with no hard-mutation token is denied', () => {
  const r = run('python3 tools/quiet-mutator.py');
  assert.strictEqual(r.status, 2, JSON.stringify(r));
  assert.ok(r.keys.includes('wrapper:quiet-mutator.py'), JSON.stringify(r.keys));
  assert.ok(r.message.includes('shells to the orwell remote host'), r.message);
});
check('B2: a named .js script that cannot be resolved on disk is denied (fail closed)', () => {
  const r = run('node totally-nonexistent-mutator.js');
  assert.strictEqual(r.status, 2, JSON.stringify(r));
  assert.ok(r.keys.includes('wrapper:totally-nonexistent-mutator.js'), JSON.stringify(r.keys));
  assert.ok(r.message.includes('not resolvable'), r.message);
});
check('B2: inline node -e code carrying a mutation token is denied', () => {
  const r = run('node -e "run(\'Stop-VM -Name ant\')"');
  assert.strictEqual(r.status, 2, JSON.stringify(r));
  assert.ok(r.keys.includes('interpreter:node:inline'), JSON.stringify(r.keys));
});
check('B2: a .ps1 handed to pwsh that cannot be resolved is denied', () => {
  const r = run('pwsh -File nonexistent-teardown.ps1');
  assert.strictEqual(r.status, 2, JSON.stringify(r));
  assert.ok(r.keys.includes('wrapper:nonexistent-teardown.ps1'), JSON.stringify(r.keys));
});

process.stdout.write('\n=== F3: local-vs-remote script classification (codex PR#20, kernel-triad convene 20260817T184138Z corrected fix) ===\n');
// The four combinations codex asked for: {hard-mutation-token, remote-transport-evidence} x {present, absent}.
fs.writeFileSync(
  path.join(SANDBOX, 'gpu-preflight.ps1'),
  "New-Item -ItemType Directory -Path 'C:\\gpu-cache' -Force | Out-Null\n"
);
check('F3 (hard=true, remote=false): a purely-local script with a mutation verb but ZERO remote-transport evidence is NOT gated (fixes the real false positive)', () => {
  const r = run('pwsh -File gpu-preflight.ps1');
  assert.strictEqual(r.status, 0, `expected proceed (not-remote), got ${JSON.stringify(r)}`);
});
fs.writeFileSync(
  path.join(SANDBOX, 'custom-remote-action.ps1'),
  'ssh orwell "./revert-to-golden.ps1"\n'
);
check('F3 (hard=false, remote=true): a script that shells to orwell running a CUSTOM action name (no HARD_MUTATION_TOKENS match) is STILL gated -- remote-transport evidence alone remains fully sufficient (this is the bypass gemini caught in the first proposed AND-based fix)', () => {
  const r = run('bash custom-remote-action.ps1');
  assert.strictEqual(r.status, 2, `expected deny, got ${JSON.stringify(r)}`);
  assert.ok(r.keys.includes('wrapper:custom-remote-action.ps1'), JSON.stringify(r.keys));
});
fs.writeFileSync(
  path.join(SANDBOX, 'both-signals.ps1'),
  "ssh orwell \"Stop-VM -Name X\"\nNew-Item -ItemType Directory -Path 'C:\\local-cache' -Force | Out-Null\n"
);
check('F3 (hard=true, remote=true): both signals present is still gated', () => {
  const r = run('bash both-signals.ps1');
  assert.strictEqual(r.status, 2, `expected deny, got ${JSON.stringify(r)}`);
  assert.ok(r.keys.includes('wrapper:both-signals.ps1'), JSON.stringify(r.keys));
});
fs.writeFileSync(
  path.join(SANDBOX, 'genuinely-clean.ps1'),
  "Write-Host 'nothing to see here'\n"
);
check('F3 (hard=false, remote=false): a genuinely clean script is not gated', () => {
  const r = run('pwsh -File genuinely-clean.ps1');
  assert.strictEqual(r.status, 0, `expected proceed, got ${JSON.stringify(r)}`);
});
check('F3: inline eval code (node -e) is UNCHANGED by the narrowing -- a hard-mutation token alone still gates, since inline code is transient and impossible to pre-audit as a stable repo artifact', () => {
  const r = run('node -e "run(\'Stop-VM -Name ant\')"');
  assert.strictEqual(r.status, 2, JSON.stringify(r));
  assert.ok(r.keys.includes('interpreter:node:inline'), JSON.stringify(r.keys));
});

fs.writeFileSync(
  path.join(SANDBOX, 'escaped-hostname-in-script-body.ps1'),
  'ssh orw\\ell "./revert-to-golden.ps1"\n'
);
check('F2 (codex re-review): a shell-lexically-escaped hostname INSIDE A SCRIPT FILE BODY no longer bypasses scanScriptBody -- the command-line tokenize() fix alone did not cover this second, separate raw-text match', () => {
  const r = run('bash escaped-hostname-in-script-body.ps1');
  assert.strictEqual(r.status, 2, `expected deny, got ${JSON.stringify(r)}`);
  assert.ok(r.keys.includes('wrapper:escaped-hostname-in-script-body.ps1'), JSON.stringify(r.keys));
});
check('F2 (codex re-review, round 2): a shell-lexically-escaped hostname behind an UNRECOGNIZED command/wrapper no longer bypasses the catch-all fail-closed check -- a THIRD, separate raw-text haystack match (unknown-exe fallback path), unpatched by both the tokenize() and scanScriptBody() fixes', () => {
  const r = run('unknown-wrapper ssh orw\\ell "Remove-Item D:\\HyperV\\x"');
  assert.strictEqual(r.status, 2, `expected deny, got ${JSON.stringify(r)}`);
  assert.ok(r.keys.some((k) => k.startsWith('unknown:')), JSON.stringify(r.keys));
});
check('F2 (codex re-review, round 3): touchesRemoteSurface() -- the module\'s own EXPORTED fallback predicate, consulted when the gate module fails to load -- no longer misses a shell-lexically-escaped hostname (a FOURTH raw-text match site)', () => {
  assert.strictEqual(gate.touchesRemoteSurface('ssh orw\\ell "Remove-Item D:\\HyperV\\x"'), true);
});
check('F2 (codex re-review, round 3 self-correction): touchesRemoteSurface() still correctly detects a REAL (non-escaped) D:\\HyperV path reference -- proves the backslash-stripped projection was NOT also (wrongly) applied to the HyperV regex, which would have made that arm permanently unmatchable', () => {
  assert.strictEqual(gate.touchesRemoteSurface('type D:\\HyperV\\notes.txt'), true);
});
check('the catch-all fix (round 2) also still correctly detects a REAL (non-escaped) D:\\HyperV path reference, same self-correction as touchesRemoteSurface', () => {
  const r = run('unknown-wrapper type D:\\HyperV\\notes.txt');
  assert.strictEqual(r.status, 2, `expected deny, got ${JSON.stringify(r)}`);
});

fs.writeFileSync(path.join(SANDBOX, 'build.mjs'), "console.log('building the local bundle');\n");
fs.writeFileSync(path.join(SANDBOX, 'tools/report.py'), 'print("local report")\n');
check('B2 no over-block: an ordinary local node script is not flagged', () => {
  const r = run('node build.mjs');
  assert.strictEqual(r.status, 0, JSON.stringify(r));
});
check('B2 no over-block: an ordinary local python script is not flagged', () => {
  const r = run('python3 tools/report.py');
  assert.strictEqual(r.status, 0, JSON.stringify(r));
});
check('B2 no over-block: python3 -m module invocation is not treated as a script', () => {
  const r = run('python3 -m pytest -q');
  assert.strictEqual(r.status, 0, JSON.stringify(r));
  assert.strictEqual(r.reason, 'not-remote');
});
check('B2 no over-block: node --version is not treated as a script', () => {
  const r = run('node --version');
  assert.strictEqual(r.status, 0, JSON.stringify(r));
  assert.strictEqual(r.reason, 'not-remote');
});
check('B2 documented boundary: an extensionless unresolvable interpreter arg is not denied', () => {
  const r = run('node scripts/missing-tool');
  assert.strictEqual(r.status, 0, JSON.stringify(r));
  assert.strictEqual(r.reason, 'not-remote');
});

process.stdout.write('\n=== B3: one authoritative surface predicate ===\n');
check('B3: touchesRemoteSurface is exported and covers the D:\\HyperV representation the old fallback regex missed', () => {
  assert.strictEqual(typeof gate.touchesRemoteSurface, 'function');
  assert.strictEqual(gate.touchesRemoteSurface('scp artifact D:\\HyperV\\AntWorld\\In\\'), true);
  assert.strictEqual(gate.touchesRemoteSurface('ssh "$REMOTE_HOST" "$REMOTE_CMD"'), true);
  assert.strictEqual(gate.touchesRemoteSurface('git status'), false);
  // The old dispatcher fallback regex, kept here as the negative control that
  // proves why the fallback must not carry its own copy of the taxonomy.
  const oldFallback = /orwell|psrun|psrunfile|inbound-push|build-export|pull-results/i;
  assert.strictEqual(oldFallback.test('scp artifact D:\\HyperV\\AntWorld\\In\\'), false);
});

process.stdout.write('\n=== AMBIGUITY-DEFAULT INVERSION (convene 20260811T1950Z) ===\n');
clearStamps();
check('INVERSION: timeout-wrapped psrunfile teardown is denied (unresolvable-remote-adjacent)', () => {
  // The reported bypass: `timeout` is not a peeled wrapper, so no segment rule
  // resolves — touchesRemote true, applicable []. Pre-fix this fell into the
  // read-only lane; the inverted default denies it.
  const r = run('timeout 30 bash psrunfile.sh teardown-vm.ps1');
  assert.strictEqual(r.status, 2, JSON.stringify(r));
  assert.strictEqual(r.reason, 'unresolvable-remote-adjacent');
  assert.ok(/ambiguity refuses/.test(r.message), r.message);
});
check('INVERSION general case: the NEXT unenumerated wrapper is denied too, not just timeout', () => {
  const r = run('chronic bash psrunfile.sh teardown-vm.ps1');
  assert.strictEqual(r.status, 2, JSON.stringify(r));
  assert.strictEqual(r.reason, 'unresolvable-remote-adjacent');
});
check('INVERSION invariant: the trigger is applicable.length === 0, observable via classifyCommand', () => {
  const cls = gate.classifyCommand('timeout 30 bash psrunfile.sh teardown-vm.ps1', { projectDir: SANDBOX, fs });
  assert.strictEqual(cls.touchesRemote, true);
  assert.strictEqual(cls.applicable.length, 0);
});
check('INVERSION no-regress: proven read-only scp pull (applicable > 0, mutating 0) is still ALLOWED', () => {
  // The correction two independent reviews demanded: deny on
  // applicable.length === 0, NOT on mutating.length === 0 — a positively
  // proven read-only remote command must keep passing without a stamp.
  const r = run('scp -q orwell:D:/HyperV/AntWorld/Out/result.json ./local/');
  assert.strictEqual(r.status, 0, JSON.stringify(r));
  assert.strictEqual(r.reason, 'read-only-lane');
});
check('INVERSION no-regress: proven read-only rsync pull is still ALLOWED', () => {
  const r = run('rsync -avz orwell:D:/HyperV/AntWorld/Out/ ./local/');
  assert.strictEqual(r.status, 0, JSON.stringify(r));
  assert.strictEqual(r.reason, 'read-only-lane');
});
check('INVERSION no-regress: build-export alone now carries a POSITIVE read-only verdict and stays allowed', () => {
  const r = run('bash build-export.sh');
  assert.strictEqual(r.status, 0, JSON.stringify(r));
  assert.strictEqual(r.reason, 'read-only-lane');
});
check('INVERSION no-regress: rsync from an unexpanded source into a literal local dir stays allowed', () => {
  const r = run('rsync -avz $SRC ./local/');
  assert.strictEqual(r.status, 0, JSON.stringify(r));
  assert.strictEqual(r.reason, 'read-only-lane');
});

process.stdout.write('\n=== ALLOW: valid matching stamp ===\n');
clearStamps();
writeStamp('sandbox-valid', {
  scope: ['inbound-push.sh', 'load-courier.ps1', 'refresh-seed.ps1', 'first-boot.ps1'],
});
check('load-courier WITH a valid matching stamp is allowed', () => {
  const r = run('bash psrunfile.sh load-courier.ps1 -ExpectedSha256 x');
  assert.strictEqual(r.status, 0, 'expected allow, got: ' + JSON.stringify(r));
  assert.strictEqual(r.reason, 'stamped');
  assert.strictEqual(r.stamp_id, 'sandbox-valid');
  process.stdout.write('    -> ' + JSON.stringify(r) + '\n');
});
check('full stamped deploy chain is allowed', () => {
  const r = run('bash inbound-push.sh && bash psrunfile.sh load-courier.ps1 -ExpectedSha256 abc && bash psrunfile.sh refresh-seed.ps1 && bash psrunfile.sh first-boot.ps1 -ExpectedSha256 abc');
  assert.strictEqual(r.status, 0, JSON.stringify(r));
  assert.deepStrictEqual(r.keys.sort(), ['first-boot.ps1', 'inbound-push.sh', 'load-courier.ps1', 'refresh-seed.ps1']);
  process.stdout.write('    -> ' + JSON.stringify(r) + '\n');
});
check('a chain with ONE out-of-scope member is denied as a whole', () => {
  const r = run('bash psrunfile.sh load-courier.ps1 && bash psrunfile.sh run-job.ps1 -Mode turn');
  assert.strictEqual(r.status, 2);
  assert.deepStrictEqual(r.keys, ['run-job.ps1']);
});

process.stdout.write('\n=== ALLOW: read-only lanes need no stamp ===\n');
clearStamps();
for (const [label, cmd] of [
  ['check-provisioning', 'bash psrunfile.sh check-provisioning.ps1'],
  ['watch-turn-health', 'bash psrunfile.sh watch-turn-health.ps1'],
  ['pull-results', 'bash pull-results.sh'],
  ['scp pull from remote', 'scp -q -r orwell:D:/HyperV/AntWorld/Out/. ./local/'],
  ['rsync pull from remote', 'rsync -avz orwell:D:/HyperV/AntWorld/Out/ ./local/'],
  ['ssh read-only Get-ChildItem', 'ssh orwell "powershell -NoProfile -Command \\"Get-ChildItem -LiteralPath D:\\HyperV | Sort-Object LastWriteTime | Format-Table\\""'],
  ['build-export alone (local build)', 'bash build-export.sh'],
]) {
  check(`${label} allowed with NO stamp`, () => {
    const r = run(cmd);
    assert.strictEqual(r.status, 0, `expected allow for: ${cmd} — got ${JSON.stringify(r)}`);
    process.stdout.write('    -> ' + JSON.stringify(r) + '\n');
  });
}

process.stdout.write('\n=== Non-remote commands are untouched ===\n');
check('ordinary command is not-remote', () => {
  const r = run('git status');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.reason, 'not-remote');
});
check('non-Bash tool is ignored', () => {
  const r = gate.main(
    { tool: 'Write', payload: { tool_name: 'Write', tool_input: { file_path: '/tmp/x' } } },
    { projectDir: SANDBOX }
  );
  assert.strictEqual(r.reason, 'not-bash');
});

process.stdout.write('\n=== No agent-settable bypass ===\n');
check('gate source contains no DISABLED/bypass env switch', () => {
  const src = fs.readFileSync(path.join(__dirname, '../pretool-remote-mutation-gate.cjs'), 'utf8');
  assert.ok(!/process\.env\.[A-Z_]*DISABLED/.test(src), 'no kill-switch env');
  assert.ok(!/bypass_justification/.test(src), 'no inline bypass');
  assert.ok(!/MYTHOS_REMOTE_MUTATION_GATE\b/.test(src), 'no observe-only flip');
});

process.stdout.write('\n=== AUDIT LOG (sandbox) ===\n');
check('audit log records both deny and allow with reason and stamp id', () => {
  const lines = auditLines(SANDBOX);
  assert.ok(lines.length > 0, 'audit log non-empty');
  const denies = lines.filter((l) => l.decision === 'deny');
  const allows = lines.filter((l) => l.decision === 'allow');
  assert.ok(denies.length > 0, 'has denies');
  assert.ok(allows.length > 0, 'has allows');
  assert.ok(denies.every((l) => l.reason && 'stamp_id' in l && Array.isArray(l.keys)), 'deny rows well-formed');
  assert.ok(allows.some((l) => l.reason === 'stamped' && l.stamp_id === 'sandbox-valid'), 'stamped allow carries stamp id');
  assert.ok(allows.some((l) => l.reason === 'read-only-lane'), 'read-only allow recorded');
  assert.ok(!lines.some((l) => /git status/.test(l.command || '')), 'non-remote commands not logged');
  process.stdout.write('  audit rows: ' + lines.length + ' (deny ' + denies.length + ' / allow ' + allows.length + ')\n');
  for (const l of lines.slice(-6)) process.stdout.write('    ' + JSON.stringify(l) + '\n');
});

process.stdout.write('\n=== BACKFILLED-STAMP INTEGRATION (synthetic, portable) ===\n');
// This section originally asserted directly against THIS repo's live
// _dev/state/remote-mutation-stamps/ directory (real operator-granted
// stamps, hardcoded by their real stamp IDs). That made the section two
// things a shared/exported copy of this suite must never be: (1) coupled to
// real client-named operational state (a stamp ID embedding a real client
// short-code), which the membrane rule forbids leaking into a shared
// repo, and (2) inherently non-portable -- it could only ever pass on this
// exact machine's exact checkout, and would hard-fail on any fresh clone or
// CI runner that doesn't carry this repo's live stamp directory (which is
// operational state, correctly never included in a portable export).
//
// Replaced with an equivalent SYNTHETIC backfill sandbox that exercises the
// identical code paths and shapes the real one did -- an exhaustive,
// explicitly-inventoried mix of valid narrowly-scoped stamps, a voided
// stamp, and an overly-broad-scope stamp -- with generic, non-identifying
// names. Same assertions, same intent, portable anywhere. (kernel-triad
// convene 20260817T171933Z, scope tt-graft-parity-fixes: reviewed and
// confirmed to preserve the original's full protective coverage.)
const BACKFILL_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'rmgate-backfill-test-'));
fs.mkdirSync(path.join(BACKFILL_SANDBOX, '_dev/reports/analysis'), { recursive: true });
fs.mkdirSync(path.join(BACKFILL_SANDBOX, '_dev/state/remote-mutation-stamps'), { recursive: true });
fs.writeFileSync(path.join(BACKFILL_SANDBOX, DOC), '# backfill sandbox stamp\n\nOperator: authorized.\n');
function writeBackfillStamp(id, overrides) {
  const stamp = Object.assign({
    schema: 'RemoteMutationStamp/1.0',
    stamp_id: id,
    source_doc: DOC,
    granted_at: '2026-08-05T03:05:00Z',
    operator_authorization: '"consider it stamped" — operator, backfill fixture',
    scope: ['load-courier.ps1'],
    conditions: ['backfill fixture condition'],
    expires_at: null,
    voided: false,
    superseded_by: null,
  }, overrides || {});
  signStamp(STAMP_SECRET, stamp);
  fs.writeFileSync(
    path.join(BACKFILL_SANDBOX, '_dev/state/remote-mutation-stamps', id + '.json'),
    JSON.stringify(stamp, null, 2) + '\n'
  );
}
writeBackfillStamp('continuity-lane__20260805T0306Z', { scope: ['run-job.ps1'] });
writeBackfillStamp('courier-lane__20260805T1600Z', { scope: ['load-courier.ps1'] });
writeBackfillStamp('broad-scope-capture__20260816T200541Z', { scope: ['scp'] });
writeBackfillStamp('example-task-pause__20260812T1420Z', { voided: true });

check('backfilled sidecars load as valid, with invalid ones explicitly inventoried', () => {
  const { valid, invalid } = gate.loadStamps(BACKFILL_SANDBOX, fs, Date.parse('2026-08-17T04:00:00Z'));
  // Deliberately an exhaustive hardcoded inventory, not a count or a filter:
  // every valid entry is a standing authorization to run something the gate
  // would otherwise deny, so an unaccounted-for stamp is exactly the drift
  // worth catching -- adding a stamp to the sandbox above without updating
  // this list is SUPPOSED to turn this red.
  assert.deepStrictEqual(invalid, [
    {
      file: 'broad-scope-capture__20260816T200541Z.json',
      stamp_id: 'broad-scope-capture__20260816T200541Z',
      reason: "scope too broad: bare generic shell verb 'scp' -- name a specific script or artifact instead of a category of tool, per the guard spec",
    },
    {
      file: 'example-task-pause__20260812T1420Z.json',
      stamp_id: 'example-task-pause__20260812T1420Z',
      reason: 'voided',
    },
  ], 'invalid sidecars must be explicitly inventoried: ' + JSON.stringify(invalid));
  const ids = valid.map((s) => s.stamp_id).sort();
  assert.deepStrictEqual(ids, [
    'continuity-lane__20260805T0306Z',
    'courier-lane__20260805T1600Z',
  ]);
  process.stdout.write('    valid stamps: ' + ids.join(', ') + '\n');
});
check('a scoped lane is allowed against the backfilled stamps', () => {
  const r = run('bash psrunfile.sh run-job.ps1 -Mode turn -ResumeFrom gen42', BACKFILL_SANDBOX);
  assert.strictEqual(r.status, 0, JSON.stringify(r));
  assert.strictEqual(r.stamp_id, 'continuity-lane__20260805T0306Z');
  process.stdout.write('    -> ' + JSON.stringify(r) + '\n');
});
check('a second scoped lane is allowed against the backfilled stamps', () => {
  const r = run('bash psrunfile.sh load-courier.ps1 -ExpectedSha256 c5ba85c6af404bcbc23dcff540bb765d0ffa116e77269be7fdfd91f728c257ff', BACKFILL_SANDBOX);
  assert.strictEqual(r.status, 0, JSON.stringify(r));
  process.stdout.write('    -> ' + JSON.stringify(r) + '\n');
});
check('an UNSTAMPED lane is still denied against the backfilled stamps', () => {
  const r = run('bash psrunfile.sh teardown-vm.ps1', BACKFILL_SANDBOX);
  assert.strictEqual(r.status, 2);
  assert.deepStrictEqual(r.keys, ['teardown-vm.ps1']);
  process.stdout.write('    -> denied, scopes offered: ' +
    r.message.split('STAMP SCOPES CURRENTLY AVAILABLE:')[1].split('HOW THE OPERATOR')[0].trim() + '\n');
});
check('backfilled audit log recorded the backfill-stamp decisions', () => {
  const lines = auditLines(BACKFILL_SANDBOX).slice(-4);
  assert.ok(lines.some((l) => l.decision === 'allow' && l.stamp_id === 'continuity-lane__20260805T0306Z'));
  assert.ok(lines.some((l) => l.decision === 'deny' && l.keys.includes('teardown-vm.ps1')));
  for (const l of lines) process.stdout.write('    ' + JSON.stringify(l) + '\n');
});

process.stdout.write('\n=== BACKSLASH-NEWLINE LINE CONTINUATION (kernel-gate-backslash-newline-fix, 20260818) ===\n');
check('a multi-line, backslash-continued command collapses to ONE segment, not one per line', () => {
  // The reproduced bug: a normal multi-flag CLI invocation written the usual
  // way (each flag on its own line, trailing backslash) used to shred into
  // one fragment PER LINE, each of which fell into the unrecognized-command
  // catch-all independently. Any single line mentioning "orwell" (describing
  // what a stamp authorizes, say) then poisoned every OTHER line's harmless
  // fragment via the whole-command haystack check, making the gate's own
  // documented remedy (the stamp-mint command) self-blocking.
  const multiLine = [
    'node tools/kernel/hooks/mint-remote-mutation-stamp.cjs \\',
    '  --item "Mythos Convene Approval" \\',
    '  --stamp-id "example__20260818T0000Z" \\',
    '  --conditions "Scoped to orwell setup, read-only recon only." \\',
    '  --expires-hours 4',
  ].join('\n');
  const segments = gate.splitSegments(multiLine);
  assert.strictEqual(segments.length, 1, `expected one merged segment, got ${segments.length}: ${JSON.stringify(segments)}`);
});
check('the mint-remote-mutation-stamp.cjs self-blocking bug is fixed end to end: ONE coherent, stampable key instead of five nonsense per-flag keys', () => {
  // Before the fix, this exact shape of command (real, reproduced this
  // session) denied with FIVE separate keys -- unknown:node, unknown:--item,
  // unknown:--stamp-id, unknown:--conditions, unknown:--expires-hours --
  // each independently "denied", none of which named the actual thing being
  // run or could sensibly be granted a stamp scope (what would a stamp
  // scoped to the literal string "--conditions" even authorize?). That
  // fragmentation, not the fact of being denied at all, was the actual bug:
  // a command that legitimately touches the remote surface SHOULD still
  // require a stamp -- it should just require ONE sensible one.
  //
  // After the fix, this correctly remains a fail-closed denial (this is a
  // genuinely unrecognized command whose text mentions the remote host --
  // the conservative catch-all firing here is CORRECT, not a bug), but now
  // as exactly ONE classified segment with ONE coherent key naming the real
  // executable (`unknown:node`), which an operator can actually reason
  // about and grant a real stamp scope against.
  const multiLine = [
    'node tools/kernel/hooks/mint-remote-mutation-stamp.cjs \\',
    '  --item "Mythos Convene Approval" \\',
    '  --stamp-id "example__20260818T0000Z" \\',
    '  --conditions "Scoped to orwell setup, read-only recon only." \\',
    '  --expires-hours 4',
  ].join('\n');
  const result = gate.classifyCommand(multiLine, { projectDir: REAL_PROJECT });
  process.stdout.write('    -> ' + JSON.stringify(result.mutatingKeys) + '\n');
  assert.strictEqual(result.applicable.length, 1, `expected exactly one classified segment (was 5, one per line, before the fix), got ${result.applicable.length}: ${JSON.stringify(result.applicable.map((r) => r.key))}`);
  assert.deepStrictEqual(result.mutatingKeys, ['unknown:node'], 'the single key should name the real executable, not a bogus per-flag fragment');
  assert.ok(!result.mutatingKeys.some((k) => k.startsWith('unknown:--')), 'no key should be a bogus flag-shaped fragment like "unknown:--item"');
});
check('a hostname split across a backslash-newline is NOT an evasion path -- the merged text is exactly what a real shell would execute', () => {
  // OMEGA/gemini's counter-example from the convene review: the FIRST,
  // rejected version of this fix (collapse to a space) would have let
  // `admin@or\<newline>well` evade the host-substring check by turning one
  // token into two ("admin@or" + "well", neither containing "orwell").
  // Collapsing to NOTHING (matching real POSIX shell deletion of
  // backslash-newline) must instead produce the single, contiguous host
  // substring, so this remains fail-closed exactly as before the fix.
  const evasionAttempt = 'echo admin@or\\\nwell';
  const segments = gate.splitSegments(evasionAttempt);
  assert.strictEqual(segments.length, 1);
  assert.strictEqual(segments[0], 'echo admin@orwell', `expected the shell-accurate merge, got "${segments[0]}"`);
});
check('a genuine command separator (&&) after a removed continuation still splits into separate segments', () => {
  // Sanity check (codex's own verification case, convene review): the fix
  // must not accidentally swallow REAL segment boundaries that happen to
  // follow a continuation -- only the backslash-newline itself is removed,
  // not the semantics of whatever comes after it.
  const cmd = 'echo hi && \\\necho bye';
  const segments = gate.splitSegments(cmd);
  assert.deepStrictEqual(segments, ['echo hi', 'echo bye']);
});

process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
