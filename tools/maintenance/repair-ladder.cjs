#!/usr/bin/env node
'use strict';

/**
 * repair-ladder.cjs — S4 of adaptive-mind-router. DRY-RUN / PROPOSAL MODE ONLY.
 *
 * The ascent: automated-lane failures (success:false in _dev/state/<lane>/
 * runs.jsonl) are packaged into bounded repair contracts and — with
 * --propose — sent to a tier-1 local model for a PATCH PROPOSAL. Proposals
 * are artifacts for review; nothing here writes target files. Activating
 * live patch-writes is an operator-keyed switch outside this plan.
 *
 * Bindings:
 * - G1: proposals NEVER change failure lifecycle state. The lane's
 *   runs.jsonl stays the loud source of truth; a failure clears only when
 *   the lane actually succeeds again. Every proposal carries a disposition
 *   file (pending → applied-and-worked | applied-and-failed | rejected |
 *   ignored) building the evidence for any future activation decision.
 * - R5: every contract demands a blast-radius diagnostic FIRST (why did it
 *   fail, what depends on the failing line) and the verification command.
 * - R5 recurrence: the 3rd recurrence of the same (lane, error-class) is an
 *   improve signal, not another proposal — surfaced in scan output.
 * - R6: write bounds — failures whose implicated files match protected
 *   classes (tests/, tools/signals/, schemas/, migrations, hooks, cost-gate,
 *   routing, auth, canon + always_escalate) are marked tier-3 (frontier):
 *   no local proposal is ever requested for them.
 *
 * Usage:
 *   node tools/maintenance/repair-ladder.cjs --scan [--json]
 *   node tools/maintenance/repair-ladder.cjs --propose [--lane <name>] [--json]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { appendReceipt } = require('./lib/hygiene-lane-health.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const STATE_ROOT = path.join(PROJECT_ROOT, '_dev', 'state');
const PROPOSALS_DIR = path.join(STATE_ROOT, 'mind-matrix', 'repair-proposals');
const RECURRENCE_PATH = path.join(STATE_ROOT, 'mind-matrix', 'repair-recurrence.json');

const PROTECTED = [
  /(^|\/)tests?\//i, /(^|\/)__tests__\//i, /tools\/signals\//i,
  /(^|\/)schemas?\//i, /\.schema\.json/i, /migration/i, /(^|\/)hooks?\//i,
  /cost-gate/i, /tier-routing/i, /(^|\b)auth(\b|\/)/i,
  /instructions\/canonical/i, /\.claude\//i, /guardrails/i, /credentials|secrets?\.|\.env/i
];

function safeJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function lastRecord(runsPath) {
  try {
    const lines = fs.readFileSync(runsPath, 'utf8').trimEnd().split('\n');
    return JSON.parse(lines[lines.length - 1]);
  } catch { return null; }
}

/** Coarse error-class signature: first meaningful stderr/stdout line, normalized. */
function errorClass(record) {
  const steps = Array.isArray(record.steps) ? record.steps : [];
  const failing = steps.find((s) => s.exit_code !== 0);
  const text = failing
    ? `${failing.label}: ${(failing.stderr_preview || failing.stdout_preview || '').split('\n').find((l) => l.trim()) || 'no-output'}`
    : 'unknown-failure';
  return text.replace(/\d+/g, 'N').replace(/\s+/g, ' ').slice(0, 160);
}

/** Files implicated by a failing step: script path from the runner + paths in stderr. */
function implicatedFiles(record, lane) {
  const files = new Set();
  const steps = Array.isArray(record.steps) ? record.steps : [];
  for (const s of steps) {
    if (s.exit_code === 0) continue;
    const text = `${s.stderr_preview || ''}\n${s.stdout_preview || ''}`;
    for (const m of text.matchAll(/(?:\/Users\/[^\s:)]+|(?:tools|_dev|frameworks|tests)\/[^\s:)]+\.[a-z]{2,4})/g)) {
      files.add(m[0].replace(`${PROJECT_ROOT}/`, ''));
    }
  }
  if (files.size === 0) files.add(`tools/launchd/run-${lane}.cjs`);
  return [...files].slice(0, 8);
}

function tierFor(files) {
  return files.some((f) => PROTECTED.some((re) => re.test(f))) ? 'frontier' : 'tier-1-local';
}

function loadRecurrence() {
  return safeJson(RECURRENCE_PATH) || { schema: 'RepairRecurrence/1.0', classes: {} };
}

function scan() {
  const failures = [];
  const recurrence = loadRecurrence();
  let lanes = [];
  try { lanes = fs.readdirSync(STATE_ROOT); } catch { /* no state root */ }
  for (const lane of lanes) {
    const runsPath = path.join(STATE_ROOT, lane, 'runs.jsonl');
    if (!fs.existsSync(runsPath)) continue;
    const rec = lastRecord(runsPath);
    if (!rec || rec.success !== false) continue;
    const cls = errorClass(rec);
    const key = `${lane}::${cls}`;
    const seen = (recurrence.classes[key] && recurrence.classes[key].count) || 0;
    const files = implicatedFiles(rec, lane);
    failures.push({
      lane,
      runs_ledger: path.relative(PROJECT_ROOT, runsPath),
      failed_at: rec.ts || '',
      error_class: cls,
      recurrence_count: seen + 1,
      escalate_as_improve_signal: seen + 1 >= 3, // R5: 3rd recurrence = design defect
      implicated_files: files,
      tier: tierFor(files),
      verification_command: `node tools/launchd/run-${lane}.cjs`
    });
    recurrence.classes[key] = { count: seen + 1, last_seen: rec.ts || new Date().toISOString() };
  }
  fs.mkdirSync(path.dirname(RECURRENCE_PATH), { recursive: true });
  fs.writeFileSync(RECURRENCE_PATH, JSON.stringify(recurrence, null, 2) + '\n');
  return failures;
}

function buildContract(failure) {
  const schemaHint = failure.implicated_files.find((f) => f.endsWith('.json'))
    ? 'JSON artifacts in this lane carry a schema field; the patched output must validate against it.'
    : 'Lane outputs are schema-stamped JSONL records; preserve record shape exactly.';
  return {
    schema: 'RepairContract/1.0',
    lane: failure.lane,
    error_class: failure.error_class,
    failing_evidence: failure.runs_ledger,
    implicated_files: failure.implicated_files,
    verification_command: failure.verification_command,
    tier: failure.tier,
    prompt: [
      'You are proposing a repair PATCH for an automated maintenance lane. DO NOT assume you may write files — output a unified diff proposal only.',
      '',
      'STEP 1 — BLAST RADIUS (mandatory, before any patch): state (a) why the failure happened, citing the evidence, and (b) what depends on the failing line/file. If you cannot answer both, output NO-PROPOSAL with the reason.',
      `STEP 2 — PATCH: minimal unified diff against: ${failure.implicated_files.join(', ')}. ${schemaHint}`,
      `STEP 3 — VERIFY: state the exact command that must pass: ${failure.verification_command}`,
      '',
      `Failure evidence (${failure.runs_ledger}, error class): ${failure.error_class}`
    ].join('\n')
  };
}

async function propose(failures, opts = {}) {
  fs.mkdirSync(PROPOSALS_DIR, { recursive: true });
  const out = [];
  for (const f of failures) {
    const contract = buildContract(f);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
    const base = path.join(PROPOSALS_DIR, `${stamp}__${f.lane}`);
    let proposal = null;
    let status = 'contract-only';
    if (f.tier !== 'tier-1-local') {
      status = 'escalated-frontier'; // R6: protected files never get a local proposal
    } else if (f.escalate_as_improve_signal) {
      status = 'recurrence-improve-signal'; // R5: stop patching symptoms
    } else if (opts.invoke) {
      try {
        const { invoke } = require('../ai-bridge/adapters/ollama.js');
        const res = await invoke({
          provider: 'ollama',
          workflow_type: 'drafting',
          prompt: contract.prompt,
          options: { timeout_ms: 120000 }
        });
        proposal = (res && (res.response || res.output)) || null;
        status = proposal ? 'proposed' : 'proposal-unavailable';
      } catch (err) {
        status = `proposal-unavailable: ${String(err.message).slice(0, 120)}`;
      }
    }
    const recordPath = `${base}.json`;
    fs.writeFileSync(recordPath, JSON.stringify({
      ...contract,
      status,
      proposal,
      // G1: dispositions are how proposals earn (or lose) trust. The failure
      // itself stays live in the lane ledger regardless of this record.
      disposition: 'pending',
      disposition_note: 'set by reviewer: applied-and-worked | applied-and-failed | rejected | ignored',
      created_at: new Date().toISOString()
    }, null, 2) + '\n');
    out.push({ lane: f.lane, status, record: path.relative(PROJECT_ROOT, recordPath) });
  }
  return out;
}

/** True if any implicated file matches a protected write-bound class. */
function isProtected(files) {
  return (Array.isArray(files) ? files : []).some((f) => PROTECTED.some((re) => re.test(f)));
}

/**
 * Extract the target paths a unified diff would write, straight from its headers,
 * independent of what a proposal record claims in implicated_files. Parses
 * `diff --git a/<p> b/<p>` lines and `--- <p>` / `+++ <p>` file headers, strips
 * the a//b/ prefixes, and drops /dev/null. This is the write-bounds ground truth:
 * a patch can only touch what its headers name, so protected-path enforcement
 * must be computed over these, not over the (spoofable) record fields.
 *
 * @param {string} patch - unified diff text
 * @returns {string[]} repo-relative target paths named by the patch headers
 */
function patchHeaderPaths(patch) {
  if (!patch || typeof patch !== 'string') return [];
  const out = new Set();
  const strip = (p) => p.replace(/^[ab]\//, '');
  for (const raw of patch.split('\n')) {
    const line = raw.replace(/\r$/, '');
    let m;
    if ((m = line.match(/^diff --git\s+(\S+)\s+(\S+)/))) {
      out.add(strip(m[1]));
      out.add(strip(m[2]));
      continue;
    }
    // File headers: `--- a/x` and `+++ b/x` (a bare `-`/`+` content line has no
    // following space+path, so `\s+\S+` will not match a removed/added line).
    if ((m = line.match(/^(?:---|\+\+\+)\s+(\S+)/))) {
      const p = m[1];
      if (p === '/dev/null') continue;
      out.add(strip(p));
    }
  }
  return [...out];
}

/**
 * Default sandbox runner: apply the proposal patch inside a throwaway git
 * worktree at HEAD, run the verification command there, and report pass/fail.
 * NEVER touches the working tree. Best-effort + guarded; any failure to build
 * the sandbox reports passed:false with the reason.
 *
 * @param {object} record - proposal record ({ proposal, verification_command, ... })
 * @returns {{ passed: boolean, evidence: object }}
 */
function defaultSandboxRun(record) {
  let worktree = null;
  try {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-ladder-sbx-'));
    const add = spawnSync('git', ['worktree', 'add', '--detach', worktree, 'HEAD'],
      { cwd: PROJECT_ROOT, encoding: 'utf8' });
    if (add.status !== 0) {
      return { passed: false, evidence: { stage: 'worktree-add', stderr: (add.stderr || '').slice(0, 400) } };
    }
    const patchPath = path.join(worktree, '.repair-ladder-proposal.patch');
    fs.writeFileSync(patchPath, String(record.proposal || ''));
    const apply = spawnSync('git', ['apply', '--reject', patchPath], { cwd: worktree, encoding: 'utf8' });
    if (apply.status !== 0) {
      return { passed: false, evidence: { stage: 'git-apply', stderr: (apply.stderr || '').slice(0, 400) } };
    }
    const cmd = String(record.verification_command || '').trim();
    if (!cmd) return { passed: false, evidence: { stage: 'verify', reason: 'no verification_command' } };
    const parts = cmd.split(/\s+/);
    const verify = spawnSync(parts[0], parts.slice(1), { cwd: worktree, encoding: 'utf8', timeout: 120000 });
    return {
      passed: verify.status === 0,
      evidence: {
        stage: 'verify',
        command: cmd,
        exit_code: verify.status,
        stderr_preview: (verify.stderr || '').slice(0, 400),
      },
    };
  } catch (err) {
    return { passed: false, evidence: { stage: 'sandbox', error: String(err && err.message).slice(0, 200) } };
  } finally {
    if (worktree) {
      spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: PROJECT_ROOT, encoding: 'utf8' });
      try { fs.rmSync(worktree, { recursive: true, force: true }); } catch (_) { /* already gone */ }
    }
  }
}

/**
 * Decide the sandbox-verify disposition for a single proposal record.
 * A3: verified-sandbox is the MAXIMUM automation — the patch is NEVER applied
 * to the real tree. Protected-path write-bounds are enforced BEFORE any sandbox
 * run.
 *
 * @param {object} record - proposal record
 * @param {object} [opts] - { runSandbox } injectable sandbox runner (tests)
 * @returns {{ disposition: string, upgraded: boolean, ran: boolean, passed?: boolean, reason?: string, evidence?: object }}
 */
function verifyProposalRecord(record, opts = {}) {
  const claimed = (record && record.implicated_files) || [];
  // Write-bounds ground truth = the UNION of what the record claims AND what the
  // patch headers actually name. A patch that touches a protected path is refused
  // even if the record's implicated_files omits it (spoofed/incomplete record).
  const headerPaths = patchHeaderPaths(record && record.proposal);
  const files = [...claimed, ...headerPaths];
  // Write-bounds FIRST: protected or frontier-tier proposals never enter a sandbox.
  if (isProtected(files) || (record && record.tier && record.tier !== 'tier-1-local')) {
    return { disposition: record && record.disposition, upgraded: false, ran: false,
      reason: 'protected-path-or-frontier-tier: no sandbox run (write-bounds enforced)' };
  }
  if (!record || !record.proposal || record.status !== 'proposed') {
    return { disposition: record && record.disposition, upgraded: false, ran: false,
      reason: 'no applicable patch proposal to sandbox-verify' };
  }
  const runner = typeof opts.runSandbox === 'function' ? opts.runSandbox : defaultSandboxRun;
  let res;
  try { res = runner(record, opts); } catch (err) { res = { passed: false, evidence: { error: String(err && err.message) } }; }
  if (res && res.passed) {
    return { disposition: 'verified-sandbox', upgraded: true, ran: true, passed: true, evidence: res.evidence || {} };
  }
  return { disposition: record.disposition, upgraded: false, ran: true, passed: false,
    reason: 'sandbox verification did not pass', evidence: (res && res.evidence) || {} };
}

/**
 * --verify-sandbox mode: iterate committed proposal records and upgrade the
 * disposition of any whose verify command passes in a sandbox clone. Records a
 * lane-health receipt (A2) per decision. Never applies a patch to the tree.
 *
 * @param {object} [opts] - { proposalsDir, base, runSandbox, lane }
 * @returns {Array<object>} per-record results
 */
function runVerifySandbox(opts = {}) {
  const dir = opts.proposalsDir || PROPOSALS_DIR;
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return out; }
  for (const f of files) {
    const recordPath = path.join(dir, f);
    const record = safeJson(recordPath);
    if (!record) continue;
    if (opts.lane && record.lane !== opts.lane) continue;
    const outcome = verifyProposalRecord(record, opts);
    let decision = 'sandbox-verify-skipped';
    if (outcome.upgraded) {
      record.disposition = 'verified-sandbox';
      record.sandbox_verification = {
        verified_at: new Date().toISOString(),
        note: 'A3: verified in sandbox clone; patch NOT applied to the working tree.',
        evidence: outcome.evidence || {},
      };
      fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
      decision = 'upgraded-verified-sandbox';
    } else if (outcome.ran) {
      decision = 'sandbox-verify-no-pass';
    }
    // A2: receipt for every apply-mode decision that actually engaged the class
    // (ran a sandbox, or was blocked by write-bounds despite having a patch).
    const blockedWithPatch = !outcome.ran && record.proposal && record.status === 'proposed';
    if (outcome.ran || blockedWithPatch) {
      appendReceipt({
        tool: 'repair-ladder',
        decision: blockedWithPatch ? 'blocked-protected-path' : decision,
        target: path.relative(PROJECT_ROOT, recordPath),
        verification: {
          lane: record.lane,
          tier: record.tier,
          verification_command: record.verification_command,
          passed: outcome.passed === true,
          reason: outcome.reason,
          evidence: outcome.evidence,
        },
        outcome: outcome.upgraded ? 'verified-sandbox' : (outcome.ran ? 'not-verified' : 'blocked'),
      }, { base: opts.base });
    }
    out.push({ record: path.relative(PROJECT_ROOT, recordPath), disposition: outcome.disposition,
      upgraded: !!outcome.upgraded, ran: !!outcome.ran, reason: outcome.reason });
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const laneFlag = args.indexOf('--lane');
  const laneArg = laneFlag !== -1 ? args[laneFlag + 1] : undefined;
  if (args.includes('--verify-sandbox')) {
    const results = runVerifySandbox({ lane: laneArg });
    process.stdout.write(json ? JSON.stringify({ verify_sandbox: results }, null, 2) + '\n'
      : (results.length
        ? results.map((r) => `${r.record}: ${r.upgraded ? 'verified-sandbox' : (r.ran ? 'no-pass' : 'skipped')}${r.reason ? ' (' + r.reason + ')' : ''}`).join('\n') + '\n'
        : 'repair-ladder: no proposals to sandbox-verify\n'));
    return;
  }
  let failures = scan();
  if (laneFlag !== -1 && args[laneFlag + 1]) {
    failures = failures.filter((f) => f.lane === args[laneFlag + 1]);
  }
  if (args.includes('--propose')) {
    const results = await propose(failures, { invoke: true });
    process.stdout.write(json ? JSON.stringify({ failures, proposals: results }, null, 2) + '\n'
      : results.map((r) => `${r.lane}: ${r.status} -> ${r.record}`).join('\n') + '\n');
  } else {
    process.stdout.write(json ? JSON.stringify({ failures }, null, 2) + '\n'
      : (failures.length
        ? failures.map((f) => `${f.lane} [${f.tier}] x${f.recurrence_count}${f.escalate_as_improve_signal ? ' IMPROVE-SIGNAL' : ''}: ${f.error_class}`).join('\n') + '\n'
        : 'repair-ladder: no failing lanes\n'));
  }
}

if (require.main === module) main();

module.exports = { scan, buildContract, tierFor, errorClass, implicatedFiles,
  isProtected, patchHeaderPaths, verifyProposalRecord, runVerifySandbox };
