#!/usr/bin/env node
'use strict';

/**
 * T2 promotion-readiness fixture — write-boundary gate soak-ledger replay.
 * Plan: _dev/reports/analysis/task-plans/mech-rebase-tranche-1__plan.json (T2)
 *
 * Run: node tools/kernel/hooks/__tests__/pretool-write-boundary-gate.soak-replay.test.cjs
 *
 * Proves, on the frozen real soak corpus (fixtures/write-boundary-soak-replay.json,
 * extracted from _dev/state/write-boundary-gate/ observe-only history):
 *   1. FROZEN CORPUS PIN — event_count matches the embedded events (no drift).
 *   2. ZERO CLASSIFICATION CHANGE — for every historical would-block event,
 *      observe-mode replay yields the same classification recorded in history,
 *      and enforcing-mode replay yields the IDENTICAL classification; only the
 *      status mapping changes (0/loud-warn -> 2/block).
 *   3. BLOCK-MESSAGE CONTENT — enforcing blocks state rule / evidence /
 *      next-step (grounding adjustment 4), not just an exit code.
 *   4. BYPASS CYCLE — one real blocked target: block (exit 2) -> re-issue with
 *      bypass_justification -> exit-0 LOUD-WARN + bypass-ledger entry flagged
 *      pending-async-review (A1-class inline escape hatch).
 *
 * NOTE: does NOT flip MYTHOS_WRITE_BOUNDARY_GATE anywhere durable — the env var
 * is toggled only inside this fixture process. The settings flip is operator-only.
 *
 * Replay notes:
 *   - wb_log records the RESOLVED target, not the original bash command, so
 *     bash-tool events are replayed as write-tool calls on the resolved target
 *     (identical path-classification core).
 *   - Allowlist/denylist are injected in their production shape (real Mythos
 *     root) while CLAUDE_PROJECT_DIR points at a sandbox so state/ledger writes
 *     stay out of the real _dev/state.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const gate = require('../pretool-write-boundary-gate.cjs');
const corpus = require('./fixtures/write-boundary-soak-replay.json');

const MYTHOS_ROOT = '/Users/admin/dev/Mythos-recovered';

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

// ── Sandbox: state + ledger writes go here, never into real _dev/state ────────
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'wbgate-soak-replay-'));
process.env.CLAUDE_PROJECT_DIR = sandbox;
delete process.env.CLAUDE_SUBAGENT_ID; // corpus events are all subagent:false
const SESSION = 'wb-soak-replay-fixture';
const sandboxStateDir = path.join(sandbox, '_dev', 'state', 'write-boundary-gate');

// Production-shape classification config (matches the observe-mode soak env)
const inject = {
  allowlist: [
    path.resolve(MYTHOS_ROOT),
    path.resolve('/Users/admin/dev/Mythos-recovered'),
    path.resolve('/tmp'),
    path.resolve('/private/tmp'),
    path.resolve(os.homedir(), 'Desktop'),
  ],
  denylist: gate.getDenylist(),
};

// stderr capture (replay emits one line per event)
let stderrLines = [];
const realStderrWrite = process.stderr.write.bind(process.stderr);
function captureStderr(fn) {
  stderrLines = [];
  process.stderr.write = (chunk) => { stderrLines.push(String(chunk)); return true; };
  try { return fn(); } finally { process.stderr.write = realStderrWrite; }
}

function runGate(target, tool, extraInput, enforcing) {
  if (enforcing) process.env.MYTHOS_WRITE_BOUNDARY_GATE = '1';
  else delete process.env.MYTHOS_WRITE_BOUNDARY_GATE;
  const payload = {
    session_id: SESSION,
    tool_name: tool,
    tool_input: Object.assign({ file_path: target }, extraInput || {}),
  };
  try {
    return gate.main({ tool, payload }, inject);
  } finally {
    delete process.env.MYTHOS_WRITE_BOUNDARY_GATE;
  }
}

// ── 1. Frozen corpus pin ──────────────────────────────────────────────────────
process.stdout.write('[1] Frozen corpus pin\n');

check(`corpus event_count (${corpus.event_count}) matches embedded events`, () => {
  assert.strictEqual(corpus.events.length, corpus.event_count);
  assert.ok(corpus.event_count > 0, 'corpus must not be empty');
});

check('corpus is real soak history (source dir + observe-only rule pinned)', () => {
  assert.strictEqual(corpus.source_dir, path.join(MYTHOS_ROOT, '_dev', 'state', 'write-boundary-gate'));
  assert.ok(corpus.extraction_rule.includes("observe-only"));
});

// ── 2. Zero classification change: observe vs enforcing replay ────────────────
process.stdout.write('\n[2] Soak-ledger replay: observe vs enforcing classification\n');

const mismatches = [];
let replayed = 0;
captureStderr(() => {
  for (const ev of corpus.events) {
    // bash events: ledger holds the resolved target, not the command — replay
    // through the same path-classification core as a write-tool call.
    const tool = ev.tool === 'bash' ? 'write' : ev.tool;

    const obs = runGate(ev.target, tool, null, false);
    const enf = runGate(ev.target, tool, null, true);
    replayed += 1;

    const obsBase = String(obs.reason || '').replace(/-observed$/, '');
    const historyMatch = obs.status === 0 && obsBase === ev.reason && obs.target === ev.target;
    const enfMatch = enf.status === 2 && enf.reason === ev.reason && enf.target === ev.target;
    const identical = obsBase === enf.reason;
    if (!historyMatch || !enfMatch || !identical) {
      mismatches.push({ ev, obs, enf });
    }
  }
});

check(`replayed all ${corpus.event_count} historical would-block events`, () => {
  assert.strictEqual(replayed, corpus.event_count);
});

check('observe-mode replay reproduces recorded history for every event', () => {
  const bad = mismatches.filter((m) => !(m.obs.status === 0 && String(m.obs.reason || '').replace(/-observed$/, '') === m.ev.reason));
  assert.strictEqual(bad.length, 0, 'history mismatches: ' + JSON.stringify(bad.slice(0, 3)));
});

check('ZERO classification change: enforcing == observe classification, status 2', () => {
  assert.strictEqual(
    mismatches.length, 0,
    `${mismatches.length} classification changes, e.g. ` + JSON.stringify(mismatches.slice(0, 3))
  );
});

// ── 3. Block-message content: rule / evidence / next-step ─────────────────────
process.stdout.write('\n[3] Block-message content (rule/evidence/next-step)\n');

const sampleEvent = corpus.events[0];
check('enforcing block emits rule, evidence (target), and next-step', () => {
  const res = captureStderr(() => runGate(sampleEvent.target, 'write', null, true));
  assert.strictEqual(res.status, 2);
  const msg = stderrLines.join('');
  assert.ok(msg.includes('rule:'), 'must state the rule: ' + msg);
  assert.ok(msg.includes('evidence:'), 'must state the evidence: ' + msg);
  assert.ok(msg.includes(sampleEvent.target), 'evidence must name the target: ' + msg);
  assert.ok(msg.includes('next-step:'), 'must state the next step: ' + msg);
});

// ── 4. Bypass cycle: block -> bypass_justification -> loud-warn + ledger ──────
process.stdout.write('\n[4] Inline bypass degrade cycle (A1-class escape hatch)\n');

const JUSTIFICATION = 'T2 soak-replay fixture: demonstrating mandated A1-class inline bypass degrade';
const ledgerFile = path.join(sandboxStateDir, gate.BYPASS_LEDGER_FILENAME);

check('step 1 — enforcing block without justification: exit 2', () => {
  const res = captureStderr(() => runGate(sampleEvent.target, 'write', null, true));
  assert.strictEqual(res.status, 2);
  assert.strictEqual(res.reason, sampleEvent.reason);
});

check('step 2 — same call with bypass_justification: exit 0 loud-warn', () => {
  const res = captureStderr(() =>
    runGate(sampleEvent.target, 'write', { bypass_justification: JUSTIFICATION }, true)
  );
  assert.strictEqual(res.status, 0, 'bypass must degrade to allow: ' + JSON.stringify(res));
  assert.strictEqual(res.reason, sampleEvent.reason + '-bypassed');
  const warn = stderrLines.join('');
  assert.ok(warn.includes('LOUD-WARN'), 'must loud-warn: ' + warn);
  assert.ok(warn.includes('ASYNC REVIEW'), 'must flag async review: ' + warn);
  assert.ok(warn.includes(JUSTIFICATION), 'must echo the justification: ' + warn);
});

check('step 3 — bypass event ledgered, flagged pending-async-review', () => {
  assert.ok(fs.existsSync(ledgerFile), 'bypass ledger must exist: ' + ledgerFile);
  const entries = fs.readFileSync(ledgerFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(entries.length, 1);
  const e = entries[0];
  assert.strictEqual(e.gate, 'write-boundary');
  assert.strictEqual(e.target, sampleEvent.target);
  assert.strictEqual(e.reason, sampleEvent.reason);
  assert.strictEqual(e.bypass_justification, JUSTIFICATION);
  assert.strictEqual(e.review_status, 'pending-async-review');
  assert.strictEqual(e.session_id, SESSION);
});

check('step 4 — bypass in observe-only mode is a no-op (classification unchanged)', () => {
  const res = captureStderr(() =>
    runGate(sampleEvent.target, 'write', { bypass_justification: JUSTIFICATION }, false)
  );
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.reason, sampleEvent.reason + '-observed');
  const entries = fs.readFileSync(ledgerFile, 'utf8').trim().split('\n');
  assert.strictEqual(entries.length, 1, 'observe-only must not append to the bypass ledger');
});

// ── Final report ──────────────────────────────────────────────────────────────
process.stdout.write(`\nsoak-replay: ${pass} passed, ${fail} failed ` +
  `(corpus: ${corpus.event_count} real would-block events from ${corpus.source_file_count} sessions)\n`);
process.exit(fail === 0 ? 0 : 1);
