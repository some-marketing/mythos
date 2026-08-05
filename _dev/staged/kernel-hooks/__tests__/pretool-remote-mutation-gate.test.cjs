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

const REAL_PROJECT = path.resolve(__dirname, '../../../..');

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

process.stdout.write('\n=== REAL backfilled stamps (repo state, read-only assertions) ===\n');
check('real sidecars load as valid', () => {
  const { valid, invalid } = gate.loadStamps(REAL_PROJECT, fs, Date.parse('2026-08-05T04:00:00Z'));
  assert.deepStrictEqual(invalid, [], 'no invalid sidecars: ' + JSON.stringify(invalid));
  const ids = valid.map((s) => s.stamp_id).sort();
  assert.deepStrictEqual(ids, [
    'ant-world-orwell-live-dashboard__20260804T2023Z',
    'continuity-control__20260805T0306Z',
  ]);
  process.stdout.write('    valid stamps: ' + ids.join(', ') + '\n');
});
check('tonight\'s continuity-control lane is allowed against the real stamps', () => {
  const r = run('bash psrunfile.sh run-job.ps1 -Mode turn -ResumeFrom gen42', REAL_PROJECT);
  assert.strictEqual(r.status, 0, JSON.stringify(r));
  assert.strictEqual(r.stamp_id, 'continuity-control__20260805T0306Z');
  process.stdout.write('    -> ' + JSON.stringify(r) + '\n');
});
check('08-04 packet lane is allowed against the real stamps', () => {
  const r = run('bash psrunfile.sh load-courier.ps1 -ExpectedSha256 c5ba85c6af404bcbc23dcff540bb765d0ffa116e77269be7fdfd91f728c257ff', REAL_PROJECT);
  assert.strictEqual(r.status, 0, JSON.stringify(r));
  process.stdout.write('    -> ' + JSON.stringify(r) + '\n');
});
check('an UNSTAMPED lane is still denied against the real stamps', () => {
  const r = run('bash psrunfile.sh teardown-vm.ps1', REAL_PROJECT);
  assert.strictEqual(r.status, 2);
  assert.deepStrictEqual(r.keys, ['teardown-vm.ps1']);
  process.stdout.write('    -> denied, scopes offered: ' +
    r.message.split('STAMP SCOPES CURRENTLY AVAILABLE:')[1].split('HOW THE OPERATOR')[0].trim() + '\n');
});
check('real audit log recorded the real-stamp decisions', () => {
  const lines = auditLines(REAL_PROJECT).slice(-4);
  assert.ok(lines.some((l) => l.decision === 'allow' && l.stamp_id === 'continuity-control__20260805T0306Z'));
  assert.ok(lines.some((l) => l.decision === 'deny' && l.keys.includes('teardown-vm.ps1')));
  for (const l of lines) process.stdout.write('    ' + JSON.stringify(l) + '\n');
});

process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
