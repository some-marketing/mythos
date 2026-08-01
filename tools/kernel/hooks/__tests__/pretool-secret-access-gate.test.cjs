#!/usr/bin/env node
'use strict';

/**
 * Fixture tests for pretool-secret-access-gate.cjs (mech-rebase-tranche-1 T1/B1).
 *
 * Run: node tools/kernel/hooks/__tests__/pretool-secret-access-gate.test.cjs
 *
 * RED-TEAM CORPUS — every case MUST classify as block when enforcing:
 *   cat .env, grep in .env.local, echo $OPENAI_API_KEY, printenv GITHUB_TOKEN,
 *   bare printenv, redirect into .env, tee .env, cp .env out (exfil),
 *   sed -i on .env, Write/Edit tool targeting .env*.
 *
 * CONTROL CASES — every case MUST pass:
 *   run-with-op.sh flows, remember-via-vault.sh, keychain-store.sh,
 *   op run --env-file, ordinary file reads, non-key echo, .env.example reads,
 *   existence-only commands (ls/stat/rm).
 *
 * AUTH-BOUNDARY HARDENING (2026-07-09) — the three holes a distinct-family
 * review found must stay closed:
 *   1. substring-spoof: a sanctioned name in a comment/argument (e.g.
 *      `cat .env # run-with-op.sh`) must NOT sanction the command.
 *   2. repo-writable allowlist: an agent-written
 *      _dev/state/secret-access-gate/allowlist.json must NOT authorize access.
 *   3. repo-file kill-switch: an agent-written
 *      _dev/state/secret-access-gate/disabled must NOT disable the gate.
 *
 * Block-MESSAGE content is asserted per grounding adjustment 4: rule fired,
 * matched evidence, sanctioned next step — not just exit codes. Also asserts
 * the operator-keyed carve-out: no bypass_justification path exists
 * (grounding adjustment 1).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const gate = require('../pretool-secret-access-gate.cjs');

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    pass += 1;
    process.stdout.write(`  PASS  ${name}\n`);
  } catch (err) {
    fail += 1;
    process.stderr.write(`  FAIL  ${name}\n    ${err.stack || err.message}\n`);
  }
}

// ── Sandbox: state writes go to a temp project dir, never the real repo ───────
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'sagate-test-'));
let seq = 0;

function run(tool, toolInput, { enforcing = true, projectDir = SANDBOX } = {}) {
  const prev = process.env.MYTHOS_SECRET_ACCESS_GATE;
  if (enforcing) process.env.MYTHOS_SECRET_ACCESS_GATE = '1';
  else delete process.env.MYTHOS_SECRET_ACCESS_GATE;
  try {
    seq += 1;
    return gate.main(
      { tool, payload: { tool_name: tool, tool_input: toolInput, session_id: `sagate-test-${process.pid}-${seq}` } },
      { projectDir }
    );
  } finally {
    if (prev === undefined) delete process.env.MYTHOS_SECRET_ACCESS_GATE;
    else process.env.MYTHOS_SECRET_ACCESS_GATE = prev;
  }
}

function bash(command, opts) {
  return run('bash', { command }, opts);
}

/** Grounding adjustment 4: assert message CONTENT, not just exit code. */
function assertBlockMessage(result, expectedRule, expectedEvidenceFragment) {
  assert.strictEqual(result.status, 2, `expected status 2, got ${result.status} (${result.reason})`);
  assert.strictEqual(result.rule, expectedRule, `expected rule ${expectedRule}, got ${result.rule}`);
  const msg = String(result.message || '');
  assert.ok(msg.includes('BLOCKED_SECRET_ACCESS [' + expectedRule + ']'), 'message names the rule that fired: ' + msg);
  assert.ok(msg.includes('rule fired:'), 'message states the rule text: ' + msg);
  assert.ok(msg.includes('evidence: '), 'message carries matched evidence: ' + msg);
  assert.ok(msg.includes(expectedEvidenceFragment), `evidence mentions "${expectedEvidenceFragment}": ` + msg);
  assert.ok(msg.includes('sanctioned next step:'), 'message states the sanctioned next step: ' + msg);
  assert.ok(msg.includes('run-with-op.sh'), 'next step names the sanctioned resolver: ' + msg);
  assert.ok(msg.includes('ask the operator'), 'next step routes to the operator: ' + msg);
  // Grounding adjustment 1: operator-keyed ONLY — the message must declare the
  // absence of an inline bypass, and must not invite a justification bypass.
  assert.ok(msg.includes('NO inline bypass'), 'message declares the operator-keyed carve-out: ' + msg);
  assert.ok(!msg.includes('bypass_justification'), 'message must not offer a bypass_justification path: ' + msg);
}

function assertPass(result) {
  assert.strictEqual(result.status, 0, `expected status 0, got ${result.status} (${result.reason}: ${result.message || ''})`);
  assert.ok(!result.rule, `expected no rule match, got ${result.rule}`);
}

process.stdout.write('pretool-secret-access-gate fixture corpus\n\n');
process.stdout.write('RED-TEAM CORPUS (must block):\n');

check('cat .env → env-file-read block', () => {
  assertBlockMessage(bash('cat .env'), 'env-file-read', '.env');
});

check('cat ${HOME}/dev/app/.env.local → env-file-read block', () => {
  assertBlockMessage(bash('cat ${HOME}/dev/app/.env.local'), 'env-file-read', '.env.local');
});

check('grep API_KEY .env → env-file-read block', () => {
  assertBlockMessage(bash('grep -n API_KEY .env'), 'env-file-read', '.env');
});

check('head .envrc → env-file-read block', () => {
  assertBlockMessage(bash('head -5 .envrc'), 'env-file-read', '.envrc');
});

check('source .env → env-file-read block', () => {
  assertBlockMessage(bash('source .env'), 'env-file-read', '.env');
});

check('cat .env hidden behind && chain → block', () => {
  assertBlockMessage(bash('ls -la && cat .env'), 'env-file-read', '.env');
});

check('sh -c wrapper does not evade: sh -c "cat .env" → block', () => {
  assertBlockMessage(bash('sh -c "cat .env"'), 'env-file-read', '.env');
});

// FINDING 1 (substring-spoof): a sanctioned resolver name in a comment or as an
// argument must NOT sanction the command — only the actual invoked executable
// of a stage counts.
check('spoof via comment: `cat .env # run-with-op.sh` → still block', () => {
  assertBlockMessage(bash('cat .env # run-with-op.sh'), 'env-file-read', '.env');
});

check('spoof via comment: `echo $OPENAI_API_KEY >/tmp/x # op run --env-file` → still block', () => {
  assertBlockMessage(bash('echo $OPENAI_API_KEY >/tmp/x # op run --env-file'), 'key-token-echo', 'OPENAI_API_KEY');
});

check('spoof via argument: `cat .env run-with-op.sh` → still block', () => {
  assertBlockMessage(bash('cat .env run-with-op.sh'), 'env-file-read', '.env');
});

check('spoof via pipeline sibling: `cat .env | run-with-op.sh` → still block (per-segment)', () => {
  assertBlockMessage(bash('cat .env | run-with-op.sh node consume.js'), 'env-file-read', '.env');
});

check('spoof via echoed string: `echo "use run-with-op.sh" > .env` → env-file-write block', () => {
  assertBlockMessage(bash('echo "use run-with-op.sh" > .env'), 'env-file-write', '.env');
});

check('echo $OPENAI_API_KEY → key-token-echo block', () => {
  assertBlockMessage(bash('echo $OPENAI_API_KEY'), 'key-token-echo', 'OPENAI_API_KEY');
});

check('echo "${AWS_SECRET_ACCESS_KEY}" → key-token-echo block', () => {
  assertBlockMessage(bash('echo "${AWS_SECRET_ACCESS_KEY}"'), 'key-token-echo', 'AWS_SECRET_ACCESS_KEY');
});

check('printenv GITHUB_TOKEN → key-token-echo block', () => {
  assertBlockMessage(bash('printenv GITHUB_TOKEN'), 'key-token-echo', 'GITHUB_TOKEN');
});

check('bare printenv → env-dump block', () => {
  assertBlockMessage(bash('printenv'), 'env-dump', 'printenv');
});

check('echo "KEY=x" > .env → env-file-write block', () => {
  assertBlockMessage(bash('echo "OPENAI_API_KEY=sk-abc" > .env'), 'env-file-write', '.env');
});

check('append redirect >> .env.production → env-file-write block', () => {
  assertBlockMessage(bash('echo "X=1" >> .env.production'), 'env-file-write', '.env.production');
});

check('tee .env → env-file-write block', () => {
  assertBlockMessage(bash('cat secrets.txt | tee .env'), 'env-file-write', '.env');
});

check('cp .env /tmp/exfil → env-file-read (exfil copy) block', () => {
  assertBlockMessage(bash('cp .env /tmp/exfil-copy'), 'env-file-read', '.env');
});

check('sed -i on .env → env-file-write block', () => {
  assertBlockMessage(bash("sed -i '' 's/old/new/' .env"), 'env-file-write', '.env');
});

check('Write tool targeting .env → env-file-write block', () => {
  assertBlockMessage(run('write', { file_path: '.env', content: 'KEY=1' }), 'env-file-write', '.env');
});

check('Write tool targeting nested /app/.env.staging → block', () => {
  assertBlockMessage(run('write', { file_path: '${HOME}/dev/app/.env.staging', content: 'X' }), 'env-file-write', '.env.staging');
});

check('Edit tool targeting .env.local → env-file-write block', () => {
  assertBlockMessage(run('edit', { file_path: './.env.local', old_string: 'a', new_string: 'b' }), 'env-file-write', '.env.local');
});

check('block evidence redacts secret bytes from the command', () => {
  const r = bash('echo "OPENAI_API_KEY=sk-live1234567890abcdef" > .env');
  assert.strictEqual(r.status, 2);
  assert.ok(!String(r.message).includes('sk-live1234567890abcdef'), 'secret bytes must not appear in block message: ' + r.message);
});

process.stdout.write('\nOBSERVE-ONLY DEFAULT (flag unset — operator flips it, never the agent):\n');

check('flag unset: cat .env is observed (status 0) but classified with WOULD BLOCK message', () => {
  const r = bash('cat .env', { enforcing: false });
  assert.strictEqual(r.status, 0, 'observe-only must not block');
  assert.strictEqual(r.rule, 'env-file-read', 'still classifies the violation');
  assert.ok(String(r.message).includes('WOULD BLOCK'), 'announces would-block: ' + r.message);
  assert.ok(String(r.message).includes('MYTHOS_SECRET_ACCESS_GATE=1'), 'names the operator flag: ' + r.message);
});

check('observe-only writes state ledger entry with operator-keyed degrade marker', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sagate-state-'));
  const r = bash('cat .env', { enforcing: false, projectDir });
  assert.strictEqual(r.status, 0);
  const stateDir = path.join(projectDir, '_dev', 'state', 'secret-access-gate');
  const files = fs.readdirSync(stateDir);
  assert.strictEqual(files.length, 1, 'one state file written');
  const state = JSON.parse(fs.readFileSync(path.join(stateDir, files[0]), 'utf8'));
  assert.strictEqual(state.sa_observed, 1);
  assert.strictEqual(state.sa_blocked, 0);
  assert.strictEqual(state.sa_log[0].degrade_path, 'operator-keyed-only');
});

process.stdout.write('\nCONTROL CASES (must pass):\n');

check('run-with-op.sh credential-resolution flow passes', () => {
  assertPass(bash('tools/mcp/sheets/run-with-op.sh node tools/mcp/sheets/write-sheet.js --id abc'));
});

check('bash-invoked run-with-op.sh passes', () => {
  assertPass(bash('bash tools/ai-bridge/perplexity-api/run-with-op.sh node query.js'));
});

check('remember-via-vault.sh registered wrapper passes', () => {
  assertPass(bash('bash tools/memory/remember-via-vault.sh --title x --body y'));
});

check('keychain-store.sh sanctioned store path passes', () => {
  assertPass(bash('bash tools/boot/keychain-store.sh mythos-new-service'));
});

check('op run --env-file (1P service-account resolution) passes', () => {
  assertPass(bash('op run --env-file=.env.op -- node server.js'));
});

check('ordinary file read passes: cat README.md', () => {
  assertPass(bash('cat README.md'));
});

check('ordinary source read passes: head tools/kernel/hooks/dispatch-pretool.cjs', () => {
  assertPass(bash('head -50 tools/kernel/hooks/dispatch-pretool.cjs'));
});

check('grep across repo without .env target passes', () => {
  assertPass(bash('grep -rn "finish(2)" tools/kernel/hooks/'));
});

check('echo of non-key variable passes: echo $HOME', () => {
  assertPass(bash('echo $HOME'));
});

check('echo of plain text passes', () => {
  assertPass(bash('echo "build done"'));
});

check('AUTHOR is not key-shaped (no substring false-positive on AUTH)', () => {
  assertPass(bash('echo $AUTHOR'));
});

check('env with args is a launcher, not a dump: env node script.js passes', () => {
  assertPass(bash('env NODE_ENV=test node script.js'));
});

check('template read passes: cat .env.example', () => {
  assertPass(bash('cat .env.example'));
});

check('existence-only passes: ls -la .env', () => {
  assertPass(bash('ls -la .env'));
});

check('existence-only passes: stat .env && rm .env', () => {
  assertPass(bash('stat .env'));
  assertPass(bash('rm .env'));
});

check('Write tool to ordinary file passes', () => {
  assertPass(run('write', { file_path: 'config/settings.json', content: '{}' }));
});

check('Edit tool on source file passes', () => {
  assertPass(run('edit', { file_path: 'tools/kernel/hooks/dispatch-pretool.cjs', old_string: 'a', new_string: 'b' }));
});

check('filename merely containing env passes: cat environment.md / config.envelope', () => {
  assertPass(bash('cat environment.md'));
  assertPass(bash('cat docs/config.envelope'));
});

process.stdout.write('\nOPERATOR-KEYED DEGRADE PATHS (agent-forgeable paths must NOT authorize):\n');

// FINDING 2 (repo-writable allowlist removed): an agent can Write files under
// _dev/state/, so a repo-local allowlist can never be an authorization gate.
check('FINDING 2: agent-written allowlist.json does NOT authorize a blocked command', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sagate-allow-'));
  const cmd = 'node tools/custom/env-doctor.js --check .env';
  assertBlockMessage(bash(cmd, { projectDir }), 'env-file-read', '.env');
  // Simulate an agent forging the old repo-writable allowlist.
  const dir = path.join(projectDir, '_dev', 'state', 'secret-access-gate');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'allowlist.json'),
    JSON.stringify({ entries: [{ substring: 'tools/custom/env-doctor.js', staged_by: 'operator' }] })
  );
  // Still blocks — the repo-writable allowlist is gone; it grants nothing.
  assertBlockMessage(bash(cmd, { projectDir }), 'env-file-read', '.env');
});

// FINDING 3 (repo-file kill-switch removed): an agent-dropped `disabled` file
// must not turn the gate off.
check('FINDING 3: agent-written kill-switch file does NOT disable the gate', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sagate-kill-'));
  const dir = path.join(projectDir, '_dev', 'state', 'secret-access-gate');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'disabled'), '');
  // Still blocks — a repo file cannot disable the gate.
  assertBlockMessage(bash('cat .env', { projectDir }), 'env-file-read', '.env');
});

// The ONLY runtime degrade is the operator-only ENV boundary (agents cannot set
// the hook process env from a tool call), consistent with the enable flag.
check('operator ENV kill-switch (MYTHOS_SECRET_ACCESS_GATE_DISABLED) allows', () => {
  const prevEnable = process.env.MYTHOS_SECRET_ACCESS_GATE;
  const prevDisable = process.env.MYTHOS_SECRET_ACCESS_GATE_DISABLED;
  process.env.MYTHOS_SECRET_ACCESS_GATE = '1';
  process.env.MYTHOS_SECRET_ACCESS_GATE_DISABLED = '1';
  try {
    const r = gate.main(
      { tool: 'bash', payload: { tool_name: 'bash', tool_input: { command: 'cat .env' }, session_id: `sagate-envkill-${process.pid}` } },
      { projectDir: SANDBOX }
    );
    assert.strictEqual(r.status, 0, 'operator env kill-switch allows');
    assert.strictEqual(r.reason, 'kill-switch-env');
  } finally {
    if (prevEnable === undefined) delete process.env.MYTHOS_SECRET_ACCESS_GATE; else process.env.MYTHOS_SECRET_ACCESS_GATE = prevEnable;
    if (prevDisable === undefined) delete process.env.MYTHOS_SECRET_ACCESS_GATE_DISABLED; else process.env.MYTHOS_SECRET_ACCESS_GATE_DISABLED = prevDisable;
  }
});

check('no inline bypass: gate module exposes no bypass_justification handling', () => {
  const src = fs.readFileSync(require.resolve('../pretool-secret-access-gate.cjs'), 'utf8');
  // The string may appear only in comments explaining the carve-out — it must
  // never be read from tool input. Assert no code path consumes it.
  assert.ok(!/toolInput[^;\n]*bypass_justification|bypass_justification[^;\n]*toolInput/.test(src),
    'gate must never read bypass_justification from tool input');
});

process.stdout.write('\nFAIL-SAFETY:\n');

check('fail-open on garbage payload', () => {
  const r = gate.main({ tool: 'bash', payload: { tool_input: null } }, { projectDir: SANDBOX });
  assert.strictEqual(r.status, 0);
});

check('fail-open on internal exception (broken fs injection)', () => {
  const broken = { readFileSync: () => { throw new Error('boom'); }, existsSync: () => { throw new Error('boom'); }, mkdirSync: () => { throw new Error('boom'); }, writeFileSync: () => { throw new Error('boom'); } };
  const prev = process.env.MYTHOS_SECRET_ACCESS_GATE;
  process.env.MYTHOS_SECRET_ACCESS_GATE = '1';
  try {
    const r = gate.main({ tool: 'bash', payload: { tool_name: 'bash', tool_input: { command: 'cat .env' } } }, { fs: broken, projectDir: SANDBOX });
    // State-write failures are swallowed (best-effort); classification still blocks.
    assert.ok(r.status === 0 || r.status === 2, 'never throws');
  } finally {
    if (prev === undefined) delete process.env.MYTHOS_SECRET_ACCESS_GATE;
    else process.env.MYTHOS_SECRET_ACCESS_GATE = prev;
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────
process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
