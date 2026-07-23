#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readRule, writeSessionTier } = require('../hooks/lib/process-tier.cjs');
const { runPairedObservation } = require('../cascade-span/debrief-close-parity-driver.cjs');
const { emitDebriefCloseObservation, compareProjections } = require('../cascade-span/debrief-close-span-projection.cjs');
const { initializeRegistry, promoteNative, protocolView } = require('./enforcement-home-registry.cjs');

const SOAK_SCHEMA = 'DebriefCloseSoak/1.0';
const EVENT_SCHEMA = 'DebriefCloseSoakEvent/1.0';
const RECEIPT_SCHEMA = 'DebriefCloseSoakReceipt/1.0';
const REQUIRED_COUNT = 25;
const REQUIRED_ELAPSED_MS = 24 * 60 * 60 * 1000;
const FAMILIES = Object.freeze([
  'interactive',
  'replacement',
  'print-json',
  'sigterm-sighup',
  'denied-close',
  'allowed-close',
  'loss-reconciliation'
]);

function paths(root) {
  const dir = path.join(root, '_dev/state/debrief-closeout/soak');
  return {
    dir,
    state: path.join(dir, 'p4-s3-soak.json'),
    events: path.join(dir, 'p4-s3-events.jsonl'),
    spans: path.join(dir, 'p4-s3-spans.jsonl'),
    observations: path.join(dir, 'p4-s3-observations.jsonl'),
    failures: path.join(dir, 'p4-s3-telemetry-failures.jsonl'),
    unpairedHealth: path.join(dir, 'p4-s3-unpaired-live-health.jsonl'),
    receiptJson: path.join(root, '_dev/reports/analysis/sovereign-core-harness-p4-s3-soak-receipt.json'),
    receiptMd: path.join(root, '_dev/reports/analysis/sovereign-core-harness-p4-s3-soak-receipt.md'),
    workerState: path.join(dir, 'p4-s3-worker.json'),
    workerLog: path.join(dir, 'p4-s3-worker.log')
  };
}

function readJsonLines(target) {
  if (!fs.existsSync(target)) return [];
  return fs.readFileSync(target, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function evidenceBinding(root, target) {
  const bytes = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0);
  return {
    path: path.relative(root, target).replace(/\\/g, '/'),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length
  };
}

function snapshotUnpairedLiveTraffic(root, startedAt) {
  const p = paths(root);
  const source = path.join(root, '_dev/state/debrief-closeout/span-observations.jsonl');
  const started = Date.parse(startedAt);
  const rows = readJsonLines(source).filter((row) => Number.isFinite(Date.parse(row.emitted_at)) && Date.parse(row.emitted_at) >= started);
  fs.writeFileSync(p.unpairedHealth, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
  const homeCounts = {};
  for (const row of rows) homeCounts[row.home || 'unknown'] = (homeCounts[row.home || 'unknown'] || 0) + 1;
  return { count: rows.length, home_counts: homeCounts, evidence: evidenceBinding(root, p.unpairedHealth) };
}

function atomicJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, target);
}

function readState(root) {
  return JSON.parse(fs.readFileSync(paths(root).state, 'utf8'));
}

function startSoak(root, opts = {}) {
  const p = paths(root);
  fs.mkdirSync(p.dir, { recursive: true });
  if (fs.existsSync(p.state) && !opts.force) return readState(root);
  const now = opts.now || new Date().toISOString();
  const owner = protocolView(root).protocol.blocking_owner;
  if (owner !== 'claude_hook') throw new Error(`soak must start before retirement; current owner is ${owner}`);
  const state = {
    schema: SOAK_SCHEMA,
    status: 'running',
    started_at: now,
    required_count: REQUIRED_COUNT,
    required_elapsed_ms: REQUIRED_ELAPSED_MS,
    event_count: 0,
    mismatch_count: 0,
    unexplained_mismatch_count: 0,
    family_counts: Object.fromEntries(FAMILIES.map((family) => [family, 0])),
    last_event_at: null
  };
  atomicJson(p.state, state);
  return state;
}

function archiveAndRestartSoak(root, opts = {}) {
  const p = paths(root);
  const stamp = String(opts.stamp || new Date().toISOString()).replace(/[^0-9A-Za-z]/g, '');
  const reason = String(opts.reason || 'invalid-driver').replace(/[^0-9A-Za-z._-]/g, '-');
  const archive = path.join(p.dir, 'archive', `${reason}-soak-${stamp}`);
  fs.mkdirSync(archive, { recursive: true });
  const workerTermination = stopManagedWorker(root);
  for (const target of [p.state, p.events, p.spans, p.observations, p.failures, p.unpairedHealth, p.receiptJson, p.receiptMd, p.workerState, p.workerLog]) {
    if (!fs.existsSync(target)) continue;
    fs.renameSync(target, path.join(archive, path.basename(target)));
  }
  const state = startSoak(root, { now: opts.now || new Date().toISOString() });
  atomicJson(path.join(archive, 'restart-receipt.json'), {
    schema: 'DebriefCloseSoakRestart/1.0',
    reason,
    archived_at: opts.now || new Date().toISOString(),
    worker_termination: workerTermination,
    replacement_started_at: state.started_at
  });
  return { archive: path.relative(root, archive).replace(/\\/g, '/'), worker_termination: workerTermination, state };
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function stopManagedWorker(root) {
  const target = paths(root).workerState;
  if (!fs.existsSync(target)) return { found: false, stopped: true, pid: null, signal: null };
  try {
    const state = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (state.schema !== 'DebriefCloseSoakWorker/1.0' || !Number.isInteger(state.pid) || state.pid <= 1) return { found: true, stopped: false, pid: null, signal: null, reason: 'invalid-worker-state' };
    if (!processAlive(state.pid)) return { found: true, stopped: true, pid: state.pid, signal: null, reason: 'already-exited' };
    process.kill(state.pid, 'SIGTERM');
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    for (let attempt = 0; attempt < 20 && processAlive(state.pid); attempt += 1) Atomics.wait(sleeper, 0, 0, 50);
    let signal = 'SIGTERM';
    if (processAlive(state.pid)) {
      process.kill(state.pid, 'SIGKILL');
      signal = 'SIGKILL';
      for (let attempt = 0; attempt < 20 && processAlive(state.pid); attempt += 1) Atomics.wait(sleeper, 0, 0, 50);
    }
    return { found: true, stopped: !processAlive(state.pid), pid: state.pid, signal };
  } catch (error) {
    return { found: true, stopped: false, pid: null, signal: null, reason: error.message };
  }
}

function fixtureSandbox(outcome) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-s3-soak-root-'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-s3-soak-state-'));
  const sessionId = `claude-soak-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeSessionTier({ sessionId, model: 'gpt-5.5', tier: 'associate', tierProvenance: 'resolved-model', source: 'p4-s3-soak' }, { stateDir });
  const authoredDir = path.join(root, '_dev/state/delegation-altitude');
  fs.mkdirSync(authoredDir, { recursive: true });
  const authoredPath = path.join(authoredDir, `${sessionId}.json`);
  fs.writeFileSync(authoredPath, JSON.stringify({ edits: 1, spawns: 0, paths: [] }));
  function evidence(dirRel, name) {
    const file = path.join(root, dirRel, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'soak evidence\n');
    const state = JSON.parse(fs.readFileSync(authoredPath, 'utf8'));
    state.paths.push(file);
    fs.writeFileSync(authoredPath, JSON.stringify(state));
  }
  evidence('_dev/reports/analysis/task-plan-reviews', 'soak-review.md');
  if (outcome === 'allow') evidence('_dev/reports/debriefs', 'soak-debrief.md');
  return { root, stateDir, sessionId, cleanup() { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(stateDir, { recursive: true, force: true }); } };
}

function actionContext(index, now) {
  const actionId = `p4-s3-${now.replace(/[^0-9]/g, '')}-${index}`;
  return {
    action_id: actionId,
    trace_id: `trace-${actionId}`,
    parent_span_id: `parent-${actionId}`,
    logical_session_id: `logical-${actionId}`,
    scope_identity: 'sovereign-core-harness',
    work_unit: 'debrief-before-closeout',
    lineage_root: `lineage-${actionId}`,
    layer_depth: 2
  };
}

function nativeProductionObservation(root, fixtureRoot, family, outcome, context, now, index) {
  const p = paths(root);
  const projectRoot = path.resolve(__dirname, '../../..');
  initializeRegistry(fixtureRoot, { now });
  promoteNative(fixtureRoot, { now, reason: 'p4-s3-production-observation-fixture' });
  const requestPath = path.join(os.tmpdir(), `native-close-production-${process.pid}-${crypto.randomUUID()}.json`);
  const sessionId = crypto.randomUUID();
  const request = {
    project_root: projectRoot,
    root: fixtureRoot,
    session_id: sessionId,
    scope: context.scope_identity,
    reason: family === 'sigterm-sighup' ? (index % 2 ? 'sigterm' : 'sighup') : family === 'print-json' ? (index % 2 ? 'print' : 'json') : family === 'replacement' ? 'new' : 'quit',
    outcome,
    started_at: now,
    context,
    env: {
      MYTHOS_DEBRIEF_GATE_MODE: 'report-only',
      MYTHOS_DEBRIEF_SCOPE: context.scope_identity,
      MYTHOS_DEBRIEF_STATE_DIR: '_dev/state/debrief-closeout',
      MYTHOS_DEBRIEF_SPAN_ADAPTER: path.join(projectRoot, 'tools/kernel/cascade-span/debrief-close-span-projection.cjs'),
      MYTHOS_ENFORCEMENT_HOME_ADAPTER: path.join(projectRoot, 'tools/kernel/enforcement-home/enforcement-home-registry.cjs'),
      MYTHOS_CASCADE_SPAN_LOG: p.spans,
      MYTHOS_DEBRIEF_ACTION_ID: context.action_id,
      MYTHOS_DEBRIEF_LOGICAL_SESSION_ID: context.logical_session_id,
      MYTHOS_TRACE_ID: context.trace_id,
      MYTHOS_SPAN_ID: context.parent_span_id,
      MYTHOS_WORKSTREAM_SCOPE: context.scope_identity,
      MYTHOS_STEP_ID: context.work_unit,
      MYTHOS_LINEAGE_ROOT_SESSION_ID: context.lineage_root,
      MYTHOS_LAYER_DEPTH: String(context.layer_depth)
    }
  };
  fs.writeFileSync(requestPath, `${JSON.stringify(request)}\n`, 'utf8');
  try {
    const child = spawnSync(process.execPath, [path.join(projectRoot, 'tools/kernel/enforcement-home/native-close-production-probe.mjs'), requestPath], {
      cwd: projectRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024
    });
    if (child.status !== 0) throw new Error(`native production probe failed: ${String(child.stderr || child.stdout).trim()}`);
    const result = JSON.parse(child.stdout);
    if (!result.observation || !String(result.observation.emit_source || '').startsWith('pi-fork:')) throw new Error('native production probe returned non-production observation');
    fs.appendFileSync(p.observations, `${JSON.stringify(result.observation)}\n`, 'utf8');
    return result.observation;
  } finally { fs.rmSync(requestPath, { force: true }); }
}

function appendEvent(root, event) {
  const p = paths(root);
  fs.appendFileSync(p.events, `${JSON.stringify(event)}\n`, 'utf8');
  const state = readState(root);
  state.event_count += 1;
  state.family_counts[event.workload_family] += 1;
  state.last_event_at = event.observed_at;
  if (!event.comparison.ok) {
    state.mismatch_count += 1;
    if (!event.explanation) state.unexplained_mismatch_count += 1;
  }
  atomicJson(p.state, state);
  return state;
}

function recordTombstonePair(root, family, context, now, index, opts = {}) {
  const p = paths(root);
  const common = {
    root,
    scopeIdentity: context.scope_identity,
    closeReason: 'sigkill-equivalent-loss',
    outcome: 'tombstone',
    enforced: false,
    startedAt: now,
    endedAt: now,
    context,
    spanLogPath: p.spans,
    observationLogPath: p.observations,
    failureLogPath: p.failures
  };
  const claude = emitDebriefCloseObservation({ ...common, home: 'claude-hook', runtimeSessionId: `claude-loss-${index}`, emitSource: 'p4-s3-soak:claude-loss-production-interface' });
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-s3-native-loss-'));
  let native;
  try { native = nativeProductionObservation(root, fixtureRoot, family, 'tombstone', context, now, index); }
  finally { fs.rmSync(fixtureRoot, { recursive: true, force: true }); }
  if (!claude.ok || !native.projection) throw new Error(`tombstone observation failed: ${claude.error || 'native projection missing'}`);
  return {
    schema: EVENT_SCHEMA,
    action_id: context.action_id,
    workload_family: family,
    outcome: 'tombstone',
    observed_at: now,
    actual_runtime_session_ids: { claude_hook: `claude-loss-${index}`, native: native.actual_runtime_session_id },
    native_emit_source: native.emit_source,
    comparison: compareProjections(claude.projection, native.projection),
    explanation: opts.explanation || null
  };
}

function recordSample(root, opts = {}) {
  const state = fs.existsSync(paths(root).state) ? readState(root) : startSoak(root, opts);
  if (state.status !== 'running') throw new Error(`soak is not running: ${state.status}`);
  const index = state.event_count + 1;
  const family = opts.family || FAMILIES[(index - 1) % FAMILIES.length];
  if (!FAMILIES.includes(family)) throw new Error(`unknown workload family: ${family}`);
  const outcome = opts.outcome || (family === 'loss-reconciliation' ? 'tombstone' : index % 2 === 0 ? 'allow' : 'deny');
  const now = opts.now || new Date().toISOString();
  const context = actionContext(index, now);
  let event;
  if (outcome === 'tombstone') {
    event = recordTombstonePair(root, family, context, now, index, opts);
  } else {
    const fixture = fixtureSandbox(outcome);
    const nativeFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-s3-native-close-'));
    try {
      const p = paths(root);
      const nativeObservation = nativeProductionObservation(root, nativeFixtureRoot, family, outcome, context, now, index);
      const run = runPairedObservation({
        root: fixture.root,
        context,
        workloadFamily: family,
        claudePayload: { session_id: fixture.sessionId, stop_reason: family },
        claudeOptions: { stateDir: fixture.stateDir, rule: readRule() },
        nativeObservation,
        spanLogPath: p.spans,
        observationLogPath: p.observations,
        failureLogPath: p.failures
      });
      event = {
        schema: EVENT_SCHEMA,
        action_id: context.action_id,
        workload_family: family,
        outcome,
        observed_at: now,
        actual_runtime_session_ids: run.result.actual_runtime_session_ids,
        native_emit_source: nativeObservation.emit_source,
        comparison: run.result.comparison,
        explanation: opts.explanation || null
      };
    } finally {
      fixture.cleanup();
      fs.rmSync(nativeFixtureRoot, { recursive: true, force: true });
    }
  }
  appendEvent(root, event);
  return event;
}

function status(root, opts = {}) {
  const state = readState(root);
  const now = Date.parse(opts.now || new Date().toISOString());
  const started = Date.parse(state.started_at);
  const elapsedMs = Number.isFinite(now) && Number.isFinite(started) ? Math.max(0, now - started) : 0;
  const missingFamilies = FAMILIES.filter((family) => state.family_counts[family] < 1);
  return {
    ...state,
    elapsed_ms: elapsedMs,
    elapsed_hours: elapsedMs / (60 * 60 * 1000),
    missing_families: missingFamilies,
    ready: state.event_count >= REQUIRED_COUNT && elapsedMs >= REQUIRED_ELAPSED_MS && state.unexplained_mismatch_count === 0 && missingFamilies.length === 0
  };
}

function finishSoak(root, opts = {}) {
  const result = status(root, opts);
  if (!result.ready) throw new Error(`soak not ready: ${JSON.stringify({ event_count: result.event_count, elapsed_hours: result.elapsed_hours, unexplained: result.unexplained_mismatch_count, missing_families: result.missing_families })}`);
  result.status = 'complete';
  result.completed_at = opts.now || new Date().toISOString();
  result.registry_pre_retirement = protocolView(root).protocol;
  const p = paths(root);
  const events = readJsonLines(p.events);
  if (events.length !== result.event_count) throw new Error(`paired event artifact count ${events.length} does not match state ${result.event_count}`);
  for (const [index, event] of events.entries()) {
    if (event.schema !== EVENT_SCHEMA) throw new Error(`paired event ${index + 1} has invalid schema`);
    if (!event.actual_runtime_session_ids || !event.actual_runtime_session_ids.claude_hook || !event.actual_runtime_session_ids.native) throw new Error(`paired event ${index + 1} lacks actual runtime session IDs`);
    if (!String(event.native_emit_source || '').startsWith('pi-fork:')) throw new Error(`paired event ${index + 1} lacks native production provenance`);
    if (!event.comparison || typeof event.comparison.ok !== 'boolean') throw new Error(`paired event ${index + 1} lacks comparison evidence`);
    if (!event.comparison.ok && !event.explanation) throw new Error(`paired event ${index + 1} mismatch lacks durable explanation`);
  }
  const mismatches = events.filter((event) => !event.comparison.ok).map((event) => ({ action_id: event.action_id, workload_family: event.workload_family, explanation: event.explanation }));
  const unpaired = snapshotUnpairedLiveTraffic(root, result.started_at);
  for (const target of [p.spans, p.observations, p.failures]) if (!fs.existsSync(target)) fs.writeFileSync(target, '', 'utf8');
  const receipt = {
    schema: RECEIPT_SCHEMA,
    soak_schema: SOAK_SCHEMA,
    status: result.status,
    ready: result.ready,
    started_at: result.started_at,
    completed_at: result.completed_at,
    required_count: result.required_count,
    required_elapsed_ms: result.required_elapsed_ms,
    elapsed_ms: result.elapsed_ms,
    elapsed_hours: result.elapsed_hours,
    event_count: result.event_count,
    mismatch_count: result.mismatch_count,
    unexplained_mismatch_count: result.unexplained_mismatch_count,
    family_counts: result.family_counts,
    registry_pre_retirement: result.registry_pre_retirement,
    paired_events: {
      count: events.length,
      evidence: evidenceBinding(root, p.events),
      events
    },
    mismatch_explanations: mismatches,
    unpaired_live_traffic: {
      ...unpaired,
      classification: 'segregated-health-evidence-only',
      included_in_acceptance_pairs: false
    },
    telemetry_evidence: {
      spans: evidenceBinding(root, p.spans),
      observations: evidenceBinding(root, p.observations),
      failures: evidenceBinding(root, p.failures)
    }
  };
  atomicJson(p.state, result);
  atomicJson(p.receiptJson, receipt);
  const counts = FAMILIES.map((family) => `- ${family}: ${result.family_counts[family]}`).join('\n');
  const pairs = events.map((event) => `- ${event.action_id}: family=${event.workload_family}; outcome=${event.outcome}; claude_runtime=${event.actual_runtime_session_ids.claude_hook}; native_runtime=${event.actual_runtime_session_ids.native}; parity=${event.comparison.ok ? 'match' : 'mismatch'}`).join('\n');
  fs.writeFileSync(p.receiptMd, `# Sovereign Core Harness P4-S3 Soak Receipt\n\n- Status: COMPLETE\n- Started: ${result.started_at}\n- Completed: ${result.completed_at}\n- Elapsed hours: ${result.elapsed_hours.toFixed(3)}\n- Matched pairs: ${result.event_count}\n- Unexplained mismatches: ${result.unexplained_mismatch_count}\n- Blocking owner during soak: ${result.registry_pre_retirement.blocking_owner}\n- Unpaired live observations, segregated as health evidence: ${unpaired.count}\n\n## Workload counts\n\n${counts}\n\n## Paired evidence\n\n${pairs}\n`, 'utf8');
  return receipt;
}

async function worker(root, opts = {}) {
  if (!fs.existsSync(paths(root).state)) startSoak(root);
  const intervalMs = Number(opts.intervalMs || 60 * 60 * 1000);
  if (opts.workerId) await new Promise((resolve) => setTimeout(resolve, 100));
  while (true) {
    if (opts.workerId && !workerClaimIsCurrent(root, opts.workerId)) return { status: 'superseded', worker_id: opts.workerId };
    const current = status(root);
    if (current.ready) return finishSoak(root);
    recordSample(root);
    const after = status(root);
    if (after.ready) return finishSoak(root);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function workerClaimIsCurrent(root, workerId, pid = process.pid) {
  try {
    const current = JSON.parse(fs.readFileSync(paths(root).workerState, 'utf8'));
    return current.schema === 'DebriefCloseSoakWorker/1.0'
      && current.worker_id === workerId
      && current.pid === pid;
  } catch (_) {
    return false;
  }
}

function launchWorker(root) {
  const p = paths(root);
  if (fs.existsSync(p.workerState)) {
    try {
      const existing = JSON.parse(fs.readFileSync(p.workerState, 'utf8'));
      process.kill(existing.pid, 0);
      return { launched: false, reason: 'already-running', ...existing };
    } catch (_) {}
  }
  fs.mkdirSync(p.dir, { recursive: true });
  const logFd = fs.openSync(p.workerLog, 'a');
  const workerId = crypto.randomUUID();
  const child = require('node:child_process').spawn(process.execPath, [__filename, '--root', root, '--action', 'worker', '--worker-id', workerId], {
    cwd: root, detached: true, stdio: ['ignore', logFd, logFd]
  });
  child.unref();
  fs.closeSync(logFd);
  const state = { schema: 'DebriefCloseSoakWorker/1.0', worker_id: workerId, pid: child.pid, launched_at: new Date().toISOString(), interval_ms: 60 * 60 * 1000, log: path.relative(root, p.workerLog).replace(/\\/g, '/') };
  atomicJson(p.workerState, state);
  return { launched: true, ...state };
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function cli() {
  const root = path.resolve(arg('root') || process.cwd());
  const action = arg('action') || 'status';
  let result;
  if (action === 'start') result = startSoak(root);
  else if (action === 'restart-production') result = archiveAndRestartSoak(root, { reason: arg('reason') || 'invalid-driver' });
  else if (action === 'sample') result = recordSample(root, { family: arg('family'), outcome: arg('outcome'), explanation: arg('explanation') });
  else if (action === 'status') result = status(root);
  else if (action === 'finish') result = finishSoak(root);
  else if (action === 'worker') result = await worker(root, { intervalMs: Number(arg('interval-ms') || 60 * 60 * 1000), workerId: arg('worker-id') });
  else if (action === 'launch-worker') result = launchWorker(root);
  else throw new Error(`unknown action: ${action}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  cli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { SOAK_SCHEMA, EVENT_SCHEMA, RECEIPT_SCHEMA, REQUIRED_COUNT, REQUIRED_ELAPSED_MS, FAMILIES, paths, startSoak, archiveAndRestartSoak, stopManagedWorker, recordSample, status, finishSoak, worker, workerClaimIsCurrent, launchWorker, readJsonLines, evidenceBinding, snapshotUnpairedLiveTraffic };
