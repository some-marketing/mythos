'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REVIEW_SCHEMA = 'BrokerPatchReview/1.0';
const CLOSEOUT_SCHEMA = 'BrokerPhase3Closeout/1.0';
const SIGNAL_SCHEMA = 'BrokerPhase3Signal/1.0';
const TRUST_SCHEMA = 'BrokerTrustedReviewers/1.0';
const MAX_OUTPUT = 64 * 1024;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function proposalDigest(args = {}) {
  return sha256(stableJson({
    tool: 'fs.write',
    path: args.path,
    content: args.content,
    sandbox_cwd: args.sandbox_cwd,
    test_argv: args.test_argv,
    timeout_ms: args.timeout_ms
  }));
}

function within(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function resolveInside(root, rel, label, opts = {}) {
  if (typeof rel !== 'string' || !rel.trim() || path.isAbsolute(rel)) throw new Error(`${label} must be a non-empty relative path`);
  const canonicalRoot = fs.realpathSync(root);
  const abs = path.resolve(canonicalRoot, rel);
  if (!within(canonicalRoot, abs)) throw new Error(`${label} escapes project root: ${rel}`);
  const relativeParts = path.relative(canonicalRoot, abs).split(path.sep).filter(Boolean);
  let cursor = canonicalRoot;
  for (let index = 0; index < relativeParts.length; index += 1) {
    cursor = path.join(cursor, relativeParts[index]);
    if (!fs.existsSync(cursor)) {
      if (!opts.allowMissingLeaf && index === relativeParts.length - 1) throw new Error(`${label} does not exist: ${rel}`);
      break;
    }
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`${label} contains a symbolic link: ${rel}`);
    if (!within(canonicalRoot, fs.realpathSync(cursor))) throw new Error(`${label} resolves outside project root: ${rel}`);
  }
  return { abs, rel: path.relative(canonicalRoot, abs).replace(/\\/g, '/') };
}

function readReview(projectRoot, reviewRel, args, modelFamily, trustedReviewersPath) {
  const reviewPath = resolveInside(projectRoot, reviewRel, 'review_record');
  const review = JSON.parse(fs.readFileSync(reviewPath.abs, 'utf8'));
  const errors = [];
  if (review.schema !== REVIEW_SCHEMA) errors.push(`schema must be ${REVIEW_SCHEMA}`);
  if (review.verdict !== 'approved' || review.status !== 'clean') errors.push('review must be clean and approved');
  if (review.proposal_sha256 !== proposalDigest(args)) errors.push('review proposal hash does not match the requested patch');
  if (!Array.isArray(review.allowed_paths) || !review.allowed_paths.includes(args.path)) errors.push('target path is not review-approved');
  if (review.sandbox_cwd !== args.sandbox_cwd) errors.push('sandbox cwd differs from reviewed cwd');
  if (stableJson(review.test_argv) !== stableJson(args.test_argv)) errors.push('test argv differs from reviewed argv');
  if (review.timeout_ms !== args.timeout_ms) errors.push('timeout differs from reviewed timeout');
  const reviewerFamily = review.reviewed_by && review.reviewed_by.model_family;
  if (!reviewerFamily) errors.push('reviewer model family is required');
  if (modelFamily && reviewerFamily === modelFamily) errors.push('reviewer must be a distinct model family from the proposing model');
  const trustRel = path.relative(projectRoot, trustedReviewersPath).replace(/\\/g, '/');
  const trustPath = resolveInside(projectRoot, trustRel, 'trusted_reviewers');
  const trust = JSON.parse(fs.readFileSync(trustPath.abs, 'utf8'));
  if (trust.schema !== TRUST_SCHEMA || !Array.isArray(trust.keys)) errors.push(`trusted reviewer store must use ${TRUST_SCHEMA}`);
  const attestation = review.attestation || {};
  const key = Array.isArray(trust.keys) ? trust.keys.find((entry) => entry.key_id === attestation.key_id && entry.status === 'active') : null;
  if (!key) errors.push('review attestation key is not active and trusted');
  else {
    if (attestation.algorithm !== 'ed25519' || key.algorithm !== 'ed25519') errors.push('review attestation must use ed25519');
    if (key.model_family !== reviewerFamily || key.actor_id !== review.reviewed_by.actor_id) errors.push('reviewer identity does not match the trusted attestation key');
    const unsigned = { ...review };
    delete unsigned.attestation;
    let verified = false;
    try {
      verified = crypto.verify(null, Buffer.from(stableJson(unsigned)), key.public_key_pem, Buffer.from(attestation.signature_base64 || '', 'base64'));
    } catch (_) {
      verified = false;
    }
    if (!verified) errors.push('review attestation signature is invalid');
  }
  if (errors.length) throw new Error(`review gate failed: ${errors.join('; ')}`);
  return { review, reviewPath, trustPath };
}

function writeAtomic(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(descriptor, content, typeof content === 'string' ? 'utf8' : undefined);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temp, target);
    const directory = fs.openSync(path.dirname(target), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function sandboxProfile(cwd, projectRoot, executable) {
  const escaped = cwd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedRoot = projectRoot.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedExec = executable.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedExecDir = path.dirname(executable).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const ancestorPaths = new Set();
  for (const start of [projectRoot, cwd, executable]) {
    let cursor = path.resolve(start);
    while (cursor !== path.dirname(cursor)) {
      ancestorPaths.add(cursor);
      cursor = path.dirname(cursor);
    }
  }
  const metadataAncestors = [...ancestorPaths]
    .map((entry) => `(literal "${entry.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`)
    .join(' ');
  const sensitive = [];
  const visit = (dir, depth) => {
    if (depth > 5 || sensitive.length >= 512) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (['.git', 'node_modules', 'vendor'].includes(entry.name)) continue;
      const candidate = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(candidate, depth + 1);
      else if (/^\.env(?:\.|$)|credentials?|secrets?|password|private[-_]?key|\.pem$|\.key$/i.test(entry.name)) sensitive.push(candidate);
    }
  };
  visit(projectRoot, 0);
  const sensitiveRules = sensitive.map((entry) => `(deny file-read* (literal "${entry.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"))`);
  return [
    '(version 1)',
    '(deny default)',
    '(import "system.sb")',
    `(allow process-exec (literal "${escapedExec}"))`,
    '(allow process-fork)',
    '(allow signal (target self))',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    `(allow file-read-metadata ${metadataAncestors})`,
    '(allow file-read* (literal "/dev/null") (subpath "/System") (subpath "/usr/lib") (subpath "/usr/share") (subpath "/Library/Apple") (subpath "/opt/homebrew") (subpath "/usr/local") ' +
      `(subpath "${escapedExecDir}") (subpath "${escapedRoot}"))`,
    `(allow file-write* (subpath "${escaped}"))`,
    '(deny network*)',
    ...sensitiveRules
  ].join('\n');
}

function resolveExecutable(command) {
  if (path.isAbsolute(command)) return fs.realpathSync(command);
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(dir, command);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
  }
  throw new Error(`test executable not found: ${command}`);
}

function runSandboxedTest(cwd, argv, timeoutMs, projectRoot = cwd) {
  if (!Array.isArray(argv) || argv.length < 1 || argv.some((part) => typeof part !== 'string' || !part)) {
    return { ok: false, reason: 'test_argv must be a non-empty string array', exit_code: null, timed_out: false };
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 10 * 60 * 1000) {
    return { ok: false, reason: 'timeout_ms must be an integer from 10 to 600000', exit_code: null, timed_out: false };
  }
  if (process.platform !== 'darwin' || !fs.existsSync('/usr/bin/sandbox-exec')) {
    return { ok: false, reason: 'sandbox-exec unavailable; hard-degrade denies phase-3 execution', exit_code: null, timed_out: false };
  }
  let executable;
  try {
    executable = resolveExecutable(argv[0]);
  } catch (error) {
    return { ok: false, reason: error.message, exit_code: null, timed_out: false };
  }
  const payload = Buffer.from(JSON.stringify({ cwd, argv: [executable, ...argv.slice(1)], timeout_ms: timeoutMs, profile: sandboxProfile(cwd, projectRoot, executable) })).toString('base64url');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'sandbox-test-runner.cjs'), payload], {
    timeout: timeoutMs + 5000,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT
  });
  if (result.error) return { ok: false, reason: result.error.message, exit_code: null, timed_out: result.error.code === 'ETIMEDOUT' };
  try { return JSON.parse(String(result.stdout || '').trim()); }
  catch (_) { return { ok: false, reason: `sandbox runner returned invalid output: ${String(result.stderr || '').slice(0, MAX_OUTPUT)}`, exit_code: result.status, timed_out: false }; }
}

function appendSignal(signalPath, value) {
  fs.appendFileSync(signalPath, `${JSON.stringify(value)}\n`, 'utf8');
}

function createPhase3Executor(opts = {}) {
  const projectRoot = fs.realpathSync(path.resolve(opts.projectRoot || process.cwd()));
  const modelFamily = opts.modelFamily || null;
  const runsDir = path.resolve(opts.runsDir || path.join(projectRoot, '_dev/reports/broker/phase3-runs'));
  const signalsPath = path.resolve(opts.signalsPath || path.join(projectRoot, '_dev/state/broker/phase3-signals.jsonl'));
  const trustedReviewersPath = path.resolve(opts.trustedReviewersPath || path.join(projectRoot, 'tools/broker/trusted-reviewers.json'));
  const pending = new Map();

  function reconcileInterruptedRuns() {
    const reconciled = [];
    fs.mkdirSync(runsDir, { recursive: true });
    fs.mkdirSync(path.dirname(signalsPath), { recursive: true });
    const signalRows = fs.existsSync(signalsPath)
      ? fs.readFileSync(signalsPath, 'utf8').split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch (_) { return []; } })
      : [];
    for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const closeoutPath = path.join(runsDir, entry.name, 'closeout.json');
      if (!fs.existsSync(closeoutPath) || fs.lstatSync(closeoutPath).isSymbolicLink()) continue;
      let closeout;
      try { closeout = JSON.parse(fs.readFileSync(closeoutPath, 'utf8')); } catch (_) { continue; }
      if (closeout.status === 'complete') {
        if (!signalRows.some((row) => row.run_id === closeout.run_id && row.state === 'complete')) {
          appendSignal(signalsPath, { schema: SIGNAL_SCHEMA, run_id: closeout.run_id, state: 'complete', closeout: path.relative(projectRoot, closeoutPath).replace(/\\/g, '/'), span_id: closeout.span && closeout.span.span_id, trace_id: closeout.span && closeout.span.trace_id, at: new Date().toISOString(), reconciled: true });
          reconciled.push({ run_id: closeout.run_id, action: 'completed_signal_repaired' });
        }
        continue;
      }
      if (!['in_progress', 'patch_and_test_complete_pending_span', 'span_attached_pending_emit'].includes(closeout.status)) continue;
      try {
        const target = resolveInside(projectRoot, closeout.target_path, 'reconcile_target', { allowMissingLeaf: true });
        if (closeout.original_existed) {
          const backup = resolveInside(projectRoot, closeout.backup_artifact, 'reconcile_backup');
          const bytes = fs.readFileSync(backup.abs);
          if (sha256(bytes) !== closeout.original_sha256) throw new Error('reconciliation backup hash mismatch');
          writeAtomic(target.abs, bytes);
        } else if (fs.existsSync(target.abs)) {
          fs.rmSync(target.abs, { force: true });
        }
        const at = new Date().toISOString();
        writeAtomic(closeoutPath, `${JSON.stringify({ ...closeout, status: 'failed_reconciled_rolled_back', completed_at: at, error: 'startup reconciler rolled back interrupted phase-3 run', span: null }, null, 2)}\n`);
        appendSignal(signalsPath, { schema: SIGNAL_SCHEMA, run_id: closeout.run_id, state: 'failed_reconciled_rolled_back', closeout: path.relative(projectRoot, closeoutPath).replace(/\\/g, '/'), at, reconciled: true });
        reconciled.push({ run_id: closeout.run_id, action: 'rolled_back' });
      } catch (error) {
        const at = new Date().toISOString();
        writeAtomic(closeoutPath, `${JSON.stringify({ ...closeout, status: 'reconciliation_failed', completed_at: at, error: error.message }, null, 2)}\n`);
        appendSignal(signalsPath, { schema: SIGNAL_SCHEMA, run_id: closeout.run_id, state: 'reconciliation_failed', closeout: path.relative(projectRoot, closeoutPath).replace(/\\/g, '/'), at, reason: error.message, reconciled: true });
        reconciled.push({ run_id: closeout.run_id, action: 'failed', reason: error.message });
      }
    }
    return reconciled;
  }

  const reconciled = reconcileInterruptedRuns();

  function execute(args = {}, ctx = {}) {
    const now = ctx.now || new Date().toISOString();
    const target = resolveInside(projectRoot, args.path, 'path', { allowMissingLeaf: true });
    const sandbox = resolveInside(projectRoot, args.sandbox_cwd, 'sandbox_cwd');
    if (!fs.existsSync(sandbox.abs) || !fs.statSync(sandbox.abs).isDirectory()) throw new Error('sandbox_cwd must exist and be a directory');
    if (typeof args.content !== 'string') throw new Error('content must be a string');
    const reviewed = readReview(projectRoot, args.review_record, args, modelFamily, trustedReviewersPath);
    const runId = `phase3-${now.replace(/[^0-9]/g, '')}-${crypto.randomUUID()}`;
    const runDir = path.join(runsDir, runId);
    const closeoutPath = path.join(runDir, 'closeout.json');
    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(path.dirname(signalsPath), { recursive: true });
    const existed = fs.existsSync(target.abs);
    const original = existed ? fs.readFileSync(target.abs) : null;
    const originalHash = existed ? sha256(original) : null;
    const backupPath = path.join(runDir, 'original.bin');
    if (existed) writeAtomic(backupPath, original);
    const base = {
      schema: CLOSEOUT_SCHEMA,
      run_id: runId,
      status: 'in_progress',
      proposal_sha256: reviewed.review.proposal_sha256,
      review_record: reviewed.reviewPath.rel,
      review_attestation_key_id: reviewed.review.attestation.key_id,
      trusted_reviewers: reviewed.trustPath.rel,
      target_path: target.rel,
      sandbox_cwd: sandbox.rel,
      test_argv: args.test_argv,
      timeout_ms: args.timeout_ms,
      original_existed: existed,
      original_sha256: originalHash,
      backup_artifact: existed ? path.relative(projectRoot, backupPath).replace(/\\/g, '/') : null,
      started_at: now,
      span: null
    };
    writeAtomic(closeoutPath, `${JSON.stringify(base, null, 2)}\n`);
    appendSignal(signalsPath, { schema: SIGNAL_SCHEMA, run_id: runId, state: 'in_progress', closeout: path.relative(projectRoot, closeoutPath).replace(/\\/g, '/'), at: now });

    let testResult;
    try {
      writeAtomic(target.abs, args.content);
      testResult = runSandboxedTest(sandbox.abs, args.test_argv, args.timeout_ms, projectRoot);
      if (!testResult.ok) throw new Error(testResult.reason);
    } catch (error) {
      if (existed) writeAtomic(target.abs, original);
      else fs.rmSync(target.abs, { force: true });
      const failed = { ...base, status: 'failed_rolled_back', completed_at: new Date().toISOString(), original_sha256: originalHash, test: testResult || { ok: false, reason: error.message }, error: error.message };
      writeAtomic(closeoutPath, `${JSON.stringify(failed, null, 2)}\n`);
      appendSignal(signalsPath, { schema: SIGNAL_SCHEMA, run_id: runId, state: 'failed_rolled_back', closeout: path.relative(projectRoot, closeoutPath).replace(/\\/g, '/'), at: failed.completed_at });
      return { ok: false, executed: true, rolled_back: true, reason: error.message, closeout_artifact: path.relative(projectRoot, closeoutPath).replace(/\\/g, '/'), signal_artifact: path.relative(projectRoot, signalsPath).replace(/\\/g, '/'), test: testResult || null };
    }
    const complete = {
      ...base,
      status: 'patch_and_test_complete_pending_span',
      completed_at: new Date().toISOString(),
      original_sha256: originalHash,
      result_sha256: sha256(fs.readFileSync(target.abs)),
      test: testResult
    };
    writeAtomic(closeoutPath, `${JSON.stringify(complete, null, 2)}\n`);
    pending.set(runId, { target, existed, original, originalHash, closeoutPath });
    return { ok: true, executed: true, rolled_back: false, path: target.rel, closeout_artifact: path.relative(projectRoot, closeoutPath).replace(/\\/g, '/'), signal_artifact: path.relative(projectRoot, signalsPath).replace(/\\/g, '/'), test: testResult };
  }

  function attachSpan(result, span) {
    if (!result || !result.closeout_artifact) return result;
    const target = resolveInside(projectRoot, result.closeout_artifact, 'closeout_artifact');
    const closeout = JSON.parse(fs.readFileSync(target.abs, 'utf8'));
    if (!result.ok) return result;
    const attached = {
      ...closeout,
      status: 'span_attached_pending_emit',
      span: {
        schema_id: span.schema_id,
        span_id: span.span_id,
        trace_id: span.trace_id,
        parent_span_id: span.parent_span_id,
        enforcement_home: span.enforcement_home
      }
    };
    writeAtomic(target.abs, `${JSON.stringify(attached, null, 2)}\n`);
    return { ...result, span_attached: true, pending_run_id: attached.run_id };
  }

  function commit(result, span) {
    const runId = result && result.pending_run_id;
    const pendingRun = runId && pending.get(runId);
    if (!pendingRun) return { ...result, ok: false, reason: 'phase-3 pending run missing before commit' };
    const closeout = JSON.parse(fs.readFileSync(pendingRun.closeoutPath, 'utf8'));
    const completedAt = new Date().toISOString();
    const final = { ...closeout, status: 'complete', completed_at: completedAt };
    writeAtomic(pendingRun.closeoutPath, `${JSON.stringify(final, null, 2)}\n`);
    appendSignal(signalsPath, { schema: SIGNAL_SCHEMA, run_id: runId, state: 'complete', closeout: path.relative(projectRoot, pendingRun.closeoutPath).replace(/\\/g, '/'), span_id: span.span_id, trace_id: span.trace_id, at: completedAt });
    pending.delete(runId);
    return { ...result, closeout_finalized: true };
  }

  function rollbackPending(result, reason) {
    const runId = result && result.pending_run_id;
    const pendingRun = runId && pending.get(runId);
    if (!pendingRun) return { ...result, ok: false, rolled_back: false, reason };
    if (pendingRun.existed) writeAtomic(pendingRun.target.abs, pendingRun.original);
    else fs.rmSync(pendingRun.target.abs, { force: true });
    const closeout = JSON.parse(fs.readFileSync(pendingRun.closeoutPath, 'utf8'));
    const completedAt = new Date().toISOString();
    const failed = { ...closeout, status: 'failed_rolled_back', completed_at: completedAt, error: reason, span: null };
    writeAtomic(pendingRun.closeoutPath, `${JSON.stringify(failed, null, 2)}\n`);
    appendSignal(signalsPath, { schema: SIGNAL_SCHEMA, run_id: runId, state: 'failed_rolled_back', closeout: path.relative(projectRoot, pendingRun.closeoutPath).replace(/\\/g, '/'), at: completedAt, reason });
    pending.delete(runId);
    return { ...result, ok: false, rolled_back: true, reason };
  }

  return { execute, attachSpan, commit, rollbackPending, reconcileInterruptedRuns, reconciled, projectRoot, runsDir, signalsPath };
}

module.exports = { REVIEW_SCHEMA, CLOSEOUT_SCHEMA, SIGNAL_SCHEMA, TRUST_SCHEMA, proposalDigest, createPhase3Executor, runSandboxedTest, sandboxProfile };
