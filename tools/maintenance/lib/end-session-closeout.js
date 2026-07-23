'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { sanitizeScope } = require('../../signals/lib/codex-bridge');
const { validateHandoffSignal } = require('../../verify/lib/signal.cjs');

const ANALYSIS_REL = path.join('_dev', 'reports', 'analysis');
const SIGNALS_REL = path.join('_dev', 'reports', 'signals');
// S3 operational-lane + receipt surfaces (plan session-boundary-leak-repairs).
const OPERATIONAL_DEBRIEF_REL = path.join('_dev', 'state', 'operational-debrief');
const MEMORY_MIRROR_PENDING_REL = path.join('_dev', 'state', 'memory-mirror-pending');
const BLOCKED_FIELDS_REL = path.join('_dev', 'state', 'session-boundary', 'blocked-fields');
const OPERATIONAL_DEBRIEF_SCHEMA = 'OperationalDebrief/1.0';

function ensureDir(dirPath) { fs.mkdirSync(dirPath, { recursive: true }); }
function safeReaddir(dirPath) { try { return fs.readdirSync(dirPath); } catch { return []; } }
function safeStat(filePath) { try { return fs.statSync(filePath); } catch { return null; } }
function safeReadJson(filePath) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; } }
function safeParseJsonText(text) { try { return JSON.parse(text); } catch { return null; } }
function toRel(projectRoot, filePath) { return path.relative(projectRoot, filePath); }

function artifactRecord(projectRoot, filePath, kind) {
  const stat = safeStat(filePath);
  if (!stat || !stat.isFile()) return null;
  return { kind, path: toRel(projectRoot, filePath), bytes: stat.size, mtime: stat.mtime.toISOString() };
}
function listFiles(projectRoot, relDir, predicate, kind) {
  const dirPath = path.join(projectRoot, relDir);
  return safeReaddir(dirPath).filter(predicate).sort().map((name) => artifactRecord(projectRoot, path.join(dirPath, name), kind)).filter(Boolean);
}
function listRecursive(projectRoot, relDir, predicate, kind) {
  const root = path.join(projectRoot, relDir);
  const records = [];
  function walk(dirPath) {
    for (const name of safeReaddir(dirPath)) {
      const fullPath = path.join(dirPath, name);
      const stat = safeStat(fullPath);
      if (!stat) continue;
      if (stat.isDirectory()) { walk(fullPath); continue; }
      const rel = toRel(projectRoot, fullPath);
      if (predicate(rel, name)) records.push(artifactRecord(projectRoot, fullPath, kind));
    }
  }
  if (safeStat(root)) walk(root);
  return records.sort((a, b) => a.path.localeCompare(b.path));
}

function resolveScope(input) {
  const hasSystem = Boolean(input.system);
  const client = input.client ? String(input.client).trim() : '';
  const scope = input.scope ? String(input.scope).trim() : '';
  const selected = [hasSystem ? 'system' : '', client ? 'client' : '', scope ? 'scope' : ''].filter(Boolean);
  if (selected.length !== 1) throw new Error('Exactly one scope selector is required: --system, --client CODE, or --scope <workstream>.');
  if (hasSystem) return { selector: '--system', scope_type: 'system', scope_value: 'system', scope_key: 'system' };
  if (client) return { selector: '--client', scope_type: 'client', scope_value: client, scope_key: `client-${sanitizeScope(client)}` };
  return { selector: '--scope', scope_type: 'workstream', scope_value: scope, scope_key: sanitizeScope(scope) };
}
function matchesScope(record, scopeInfo) {
  if (scopeInfo.scope_type === 'system') return !String(record.path).startsWith('clients/');
  if (record.kind === 'handoff' && scopeInfo.scope_type === 'workstream') {
    const basename = path.basename(record.path, '.md');
    const prefix = `next-session-handoff__${scopeInfo.scope_key}`;
    return basename === prefix || basename.startsWith(`${prefix}__`);
  }
  if (record.kind === 'handoff' && path.basename(record.path) === 'next-session-handoff.md') return false;
  const haystack = String(record.path || '').toLowerCase();
  const key = String(scopeInfo.scope_key || '').toLowerCase();
  const raw = String(scopeInfo.scope_value || '').toLowerCase();
  return haystack.includes(key) || (raw && haystack.includes(raw));
}
function verifierScope(scopeInfo) { return !scopeInfo || scopeInfo.scope_type === 'system' ? '' : scopeInfo.scope_value; }
function runVerifier(projectRoot, scopeInfo, opts = {}) {
  const runner = opts.runner || spawnSync;
  const scope = verifierScope(scopeInfo);
  const args = [path.join(projectRoot, 'tools', 'verify', 'verify-artifact-completeness.cjs'), '--project-root', projectRoot, '--json'];
  if (scope) args.push('--scope', scope);
  const result = runner(process.execPath, args, { cwd: projectRoot, encoding: 'utf8' });
  const stdout = String(result.stdout || '');
  return { command: `node tools/verify/verify-artifact-completeness.cjs${scope ? ` --scope ${scope}` : ''} --json`, status: result.status == null ? 1 : result.status, stdout, stderr: String(result.stderr || ''), parsed: safeParseJsonText(stdout) };
}
function inventoryArtifacts(projectRoot, scopeInfo) {
  const analysis = ANALYSIS_REL;
  const records = {
    debriefs: listFiles(projectRoot, analysis, (name) => /^run-debrief__.*\.(md|json)$/.test(name) || /^session-debrief__.*\.md$/.test(name) || /^closeout-debrief__.*\.md$/.test(name), 'debrief'),
    handoffs: [...listFiles(projectRoot, analysis, (name) => /^next-session-handoff.*\.md$/.test(name), 'handoff'), ...(scopeInfo.scope_type === 'client' ? listRecursive(projectRoot, path.join('clients', scopeInfo.scope_value), (_rel, name) => /^next-session-handoff.*\.md$/.test(name), 'handoff') : [])],
    task_plans: [...listRecursive(projectRoot, path.join(ANALYSIS_REL, 'task-plans'), (_rel, name) => /__(plan|amendment)__.*\.(json|md)$/.test(name) || /__plan\.(json|md)$/.test(name), 'task_plan'), ...(scopeInfo.scope_type === 'client' ? listRecursive(projectRoot, path.join('clients', scopeInfo.scope_value), (rel, name) => rel.includes('/plans/') && (/__plan\.(json|md)$/.test(name) || /__amendment__.*\.(json|md)$/.test(name)), 'task_plan') : [])],
    verifier_outputs: listFiles(projectRoot, analysis, (name) => /^closeout-validation__.*\.json$/.test(name) || /^verify-local__.*\.json$/.test(name) || /^openrouter-review-task-plan__.*\.json$/.test(name), 'verifier_output'),
    maintenance_outputs: listFiles(projectRoot, analysis, (name) => /^closeout-maintenance__.*\.(json|md)$/.test(name), 'maintenance_output'),
    analysis_reports: listFiles(projectRoot, analysis, (name) => /\.md$/.test(name) && !/^next-session-handoff/.test(name) && !/^run-debrief__/.test(name) && !/^session-debrief__/.test(name) && !/^closeout-debrief__/.test(name), 'analysis_report')
  };
  return Object.fromEntries(Object.entries(records).map(([kind, values]) => [kind, values.filter((record) => matchesScope(record, scopeInfo))]));
}
// Inventory-only receipts for VerificationSignal/* artifacts at the signals
// root. These are informational lifecycle receipts that normalization does not
// close (leak L6); the closeout counts and lists them so they are visible, but
// they never gate readiness and are never closed here.
function inventoryVerificationSignals(projectRoot) {
  const signalDir = path.join(projectRoot, SIGNALS_REL);
  const receipts = safeReaddir(signalDir).filter((name) => name.endsWith('.json')).sort().map((name) => {
    const fullPath = path.join(signalDir, name);
    const parsed = safeReadJson(fullPath);
    if (!parsed || typeof parsed.schema !== 'string' || !parsed.schema.startsWith('VerificationSignal/')) return null;
    const record = artifactRecord(projectRoot, fullPath, 'verification_signal');
    if (!record) return null;
    return { ...record, schema: parsed.schema, signal_type: parsed.signal_type || parsed.type || null, lifecycle_state: parsed.lifecycle_state || null };
  }).filter(Boolean);
  return { count: receipts.length, note: 'Inventory only — VerificationSignal/* receipts are informational and are not closed by end-session closeout.', receipts };
}
function redactedSignal(signal) { return { path: signal.path, schema: signal.schema, signal_type: signal.signal_type, signal_scope: signal.signal_scope, recommended_next_actor: signal.recommended_next_actor, recommended_next_command_present: Boolean(signal.recommended_next_command), ready_for_clear: signal.ready_for_clear, blocked_by_count: signal.blocked_by.length }; }
function signalMatchesExactScope(parsed, scopeInfo) {
  const declared = String(parsed.signal_scope || parsed.scope || '').trim();
  if (!declared) return false;
  if (scopeInfo.scope_type === 'system') return declared === 'system';
  if (scopeInfo.scope_type === 'client') {
    return declared === scopeInfo.scope_value || declared === scopeInfo.scope_key || declared === `client:${scopeInfo.scope_value}`;
  }
  return sanitizeScope(declared) === scopeInfo.scope_key;
}
function assessCloseoutAuthorization(projectRoot, parsed, scopeInfo) {
  const structural = validateHandoffSignal(parsed, {
    projectRoot,
    requireValidationEvidence: true
  });
  const command = String(parsed.recommended_next_command || '').trim();
  const blockers = Array.isArray(parsed.blocked_by) ? parsed.blocked_by.filter((entry) => String(entry || '').trim()) : [];
  const valid = structural.valid
    && parsed.signal_type === 'ready-for-clear'
    && parsed.lifecycle_state === 'live'
    && parsed.ready_for_clear === true
    && signalMatchesExactScope(parsed, scopeInfo)
    && Array.isArray(parsed.artifacts)
    && parsed.artifacts.length > 0
    && blockers.length === 0
    && command.startsWith('/');
  return { valid, errors: structural.errors };
}
function readLiveSignals(projectRoot, scopeInfo) {
  const signalDir = path.join(projectRoot, SIGNALS_REL);
  return safeReaddir(signalDir).filter((name) => name.endsWith('.json')).sort().map((name) => {
    const fullPath = path.join(signalDir, name);
    const parsed = safeReadJson(fullPath);
    if (!parsed) return null;
    if (parsed.schema !== 'HandoffSignal/1.0' && parsed.schema !== 'HandoffSignal/2.0') return null;
    if (parsed.lifecycle_state === 'closed') return null;
    const record = artifactRecord(projectRoot, fullPath, 'signal');
    const signalScope = String(parsed.signal_scope || '');
    const relevant = scopeInfo.scope_type === 'system' ? !record.path.startsWith('clients/') : signalScope.includes(scopeInfo.scope_key) || signalScope.includes(scopeInfo.scope_value) || name.includes(scopeInfo.scope_key);
    if (!relevant) return null;
    const authorization = assessCloseoutAuthorization(projectRoot, parsed, scopeInfo);
    return { ...record, schema: parsed.schema || null, signal_type: parsed.signal_type || parsed.type || null, signal_scope: signalScope || null, recommended_next_actor: parsed.recommended_next_actor || null, recommended_next_command: parsed.recommended_next_command || null, ready_for_clear: parsed.ready_for_clear === true, blocked_by: Array.isArray(parsed.blocked_by) ? parsed.blocked_by : [], closeout_authorization: authorization.valid, closeout_authorization_errors: authorization.errors };
  }).filter(Boolean);
}
function classifyPendingActions(signals) {
  const pending = { human_operator_actions: [], Codex_agent_actions: [], Claude_agent_actions: [], external_reviewer_gates: [], active_dispatches: [], unresolved_review_findings: [], unconsumed_signals: [] };
  for (const signal of signals) {
    if (signal.closeout_authorization) continue;
    const actor = String(signal.recommended_next_actor || '').toLowerCase();
    const entry = redactedSignal(signal);
    pending.unconsumed_signals.push(entry);
    if (actor === 'operator' || actor === 'human') pending.human_operator_actions.push(entry);
    else if (actor === 'codex') pending.Codex_agent_actions.push(entry);
    else if (actor === 'claude') pending.Claude_agent_actions.push(entry);
    else if (actor) pending.external_reviewer_gates.push(entry);
    if (signal.signal_type === 'ready-for-review') pending.active_dispatches.push(entry);
    if (signal.blocked_by.length > 0) pending.unresolved_review_findings.push(entry);
  }
  return pending;
}
function detectNamingDrift(inventory) { return inventory.debriefs.filter((record) => path.basename(record.path).startsWith('session-debrief__') || path.basename(record.path).startsWith('closeout-debrief__')).map((record) => ({ path: record.path, observation: 'Legacy closeout/debrief prefix is present; v1 reads it for compatibility but does not treat it as canonical output.' })); }
function detectHandoffCollisions(inventory, scopeInfo) {
  const handoffs = inventory.handoffs || [];
  const singleton = handoffs.filter((record) => path.basename(record.path) === 'next-session-handoff.md');
  const scoped = handoffs.filter((record) => path.basename(record.path) !== 'next-session-handoff.md');
  const collisions = [];
  if (scopeInfo.scope_type === 'workstream' && scoped.length > 1) collisions.push({ type: 'duplicate_workstream_handoffs', paths: scoped.map((record) => record.path) });
  if (scopeInfo.scope_type === 'client' && singleton.length > 0) collisions.push({ type: 'singleton_handoff_in_client_closeout', paths: singleton.map((record) => record.path) });
  if (scopeInfo.scope_type === 'system' && singleton.length > 0 && scoped.length > 0) collisions.push({ type: 'system_singleton_with_scoped_handoffs', paths: [...singleton, ...scoped].map((record) => record.path) });
  return collisions;
}
function summarizeVerifier(verifier) {
  const findings = verifier.parsed && Array.isArray(verifier.parsed.findings) ? verifier.parsed.findings : [];
  return { command: verifier.command, status: verifier.status, verdict: verifier.parsed && verifier.parsed.verdict ? verifier.parsed.verdict : 'UNKNOWN', findings: findings.map((finding) => ({ id: finding.id, severity: finding.severity, status: finding.status, message: finding.message, detail: finding.detail })) };
}
// The lightweight OPERATIONAL-DEBRIEF marker for an unplanned session (no
// run_id). It carries a debrief/learning-journal pointer and an (initially
// empty) candidate_sweep_receipts slot so the future shutdown-kernel-candidate-
// sweep concept has a place to deposit its receipts WITHOUT this slice
// implementing the sweep.
function readOperationalDebriefMarker(projectRoot, scopeInfo) {
  const filePath = path.join(projectRoot, OPERATIONAL_DEBRIEF_REL, `${scopeInfo.scope_key}.json`);
  const payload = safeReadJson(filePath);
  if (!payload || payload.schema !== OPERATIONAL_DEBRIEF_SCHEMA) return null;
  return { ...payload, path: toRel(projectRoot, filePath) };
}

// Additive writer so /debrief-run (runner-side) and tests can record an
// operational-debrief marker. Read-only callers never touch this.
function writeOperationalDebriefMarker(projectRoot, fields) {
  const scopeKey = fields.scope_key || sanitizeScope(String(fields.scope || 'system'));
  const dir = path.join(projectRoot, OPERATIONAL_DEBRIEF_REL);
  ensureDir(dir);
  const payload = {
    schema: OPERATIONAL_DEBRIEF_SCHEMA,
    scope: fields.scope || scopeKey,
    scope_key: scopeKey,
    session_id: fields.session_id || null,
    // The lane is privilege-reducing: it exists ONLY for a session with no plan
    // run. run_id MUST be null — a non-null run_id is a self-declared planned
    // session and disqualifies the marker from the lightweight lane.
    run_id: fields.run_id || null,
    debrief_path: fields.debrief_path || null,
    learning_journal_entry: fields.learning_journal_entry || null,
    candidate_sweep_receipts: Array.isArray(fields.candidate_sweep_receipts) ? fields.candidate_sweep_receipts : [],
    created_at: fields.created_at || new Date().toISOString()
  };
  const filePath = path.join(dir, `${scopeKey}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return toRel(projectRoot, filePath);
}

// Inventory the durable memory-mirror pending receipts (leak L7). Loud, never
// silent: the closeout counts + lists them so a credential-locked mirror is
// visible. Inventory only — never closes or blocks.
function inventoryMemoryMirrorPending(projectRoot) {
  const dir = path.join(projectRoot, MEMORY_MIRROR_PENDING_REL);
  const receipts = safeReaddir(dir).filter((name) => name.endsWith('.json')).sort().map((name) => {
    const full = path.join(dir, name);
    const payload = safeReadJson(full);
    if (!payload) return null;
    return { path: toRel(projectRoot, full), memory_file: payload.memory_file || null, reason: payload.reason || null, next_command: payload.next_command || null, created_at: payload.created_at || null };
  }).filter(Boolean);
  return { count: receipts.length, note: 'Memory-mirror writes that could not reach the vault (op unauthenticated). Re-run the guard once op is authed; see next_command on each receipt.', receipts };
}

function findingFailed(verifier, id) {
  const f = (verifier.findings || []).find((x) => x.id === id);
  return !f || f.status === 'FAIL';
}

// Positive planned-run detection. The operational lane is privilege-reducing,
// so it may open ONLY when we can positively confirm no plan run exists for the
// scope — absence of the three verifier surfaces is NOT enough (a planned
// session whose framework-grade verifier FAILED also lacks them, and must not
// be able to bypass validation by dropping a marker). Returns the evidence that
// a plan run DID happen; a non-empty result disqualifies the lightweight lane.
const ACTIVE_PLAN_STATUSES = new Set(['planned', 'executing', 'in_progress', 'active', 'in-progress']);
function findPlannedRunEvidence(projectRoot, scopeInfo, inventory, plannedSurfaceAbsent) {
  const evidence = [];
  // (1) A framework-grade run artifact is PRESENT -> a planned run occurred.
  if (!plannedSurfaceAbsent) evidence.push({ type: 'planned_run_artifact', detail: 'closeout-validation / closeout-reflection / clear-readiness present' });
  // (2) An ACTIVE (planned/executing) scope-matched task plan -> a plan is in flight.
  for (const rec of inventory.task_plans || []) {
    if (!String(rec.path).endsWith('.json')) continue;
    const plan = safeReadJson(path.join(projectRoot, rec.path));
    const status = plan && String(plan.lifecycle_status || '').toLowerCase();
    if (status && ACTIVE_PLAN_STATUSES.has(status)) evidence.push({ type: 'active_task_plan', path: rec.path, lifecycle_status: status });
  }
  // (3) A scope-matched plan-task-review-state marker -> a plan was reviewed/run
  // (skipped for system scope, whose key/value are too broad to match precisely).
  if (scopeInfo.scope_type !== 'system') {
    const rsDir = path.join(projectRoot, '_dev', 'state', 'plan-task-review-state');
    const key = String(scopeInfo.scope_key || '').toLowerCase();
    const val = String(scopeInfo.scope_value || '').toLowerCase();
    for (const name of safeReaddir(rsDir)) {
      if (!name.endsWith('.json')) continue;
      const base = name.replace(/\.json$/, '').toLowerCase();
      if ((key && base.includes(key)) || (val && base.includes(val))) evidence.push({ type: 'review_state_marker', path: toRel(projectRoot, path.join(rsDir, name)) });
    }
  }
  return evidence;
}

// An unplanned/operational session validates through a lighter lane, but ONLY
// when the session positively has no plan run: the OperationalDebrief marker
// must self-declare run_id === null AND there must be NO planned-run evidence
// for the scope. Merely missing the three verifier surfaces is insufficient.
function assessOperationalLane(projectRoot, scopeInfo, verifier, inventory) {
  const marker = readOperationalDebriefMarker(projectRoot, scopeInfo);
  const plannedSurfaceAbsent = ['closeout_validation_exists', 'closeout_reflection_exists', 'clear_readiness_signal']
    .every((id) => findingFailed(verifier, id));
  const plannedRunEvidence = findPlannedRunEvidence(projectRoot, scopeInfo, inventory, plannedSurfaceAbsent);
  const markerDeclaresNoRun = Boolean(marker) && !marker.run_id;
  const applicable = Boolean(marker) && markerDeclaresNoRun && plannedRunEvidence.length === 0;
  const markerDebriefExists = Boolean(marker && marker.debrief_path && fs.existsSync(path.join(projectRoot, marker.debrief_path)));
  const debriefPresent = (inventory.debriefs || []).length > 0 || markerDebriefExists || Boolean(marker && marker.learning_journal_entry);
  return { applicable, satisfied: applicable && debriefPresent, marker: marker || null, planned_surface_absent: plannedSurfaceAbsent, planned_run_evidence: plannedRunEvidence, marker_declares_no_run: markerDeclaresNoRun, debrief_present: debriefPresent };
}

function verifierNextCommand(scopeInfo, opLane) {
  const scopeArg = scopeInfo.scope_type === 'system' ? '--system' : `--scope ${scopeInfo.scope_value}`;
  // Route to the operational debrief ONLY for a genuinely unplanned session (no
  // planned-run evidence). A planned session that failed its verifier is routed
  // to produce its framework-grade artifacts — never to the lightweight lane.
  const genuinelyUnplanned = (opLane.planned_run_evidence || []).length === 0 && (opLane.applicable || (opLane.planned_surface_absent && opLane.marker_declares_no_run !== false));
  if (genuinelyUnplanned) {
    return `/debrief-run ${scopeArg}  # unplanned/operational session: record a learning-journal debrief; the runner writes the OperationalDebrief/1.0 marker (run_id:null) that satisfies the operational validation lane`;
  }
  return `Produce the missing planned-closeout artifacts (a plan run is in flight for this scope), then re-run: node tools/verify/verify-artifact-completeness.cjs ${scopeArg} --json`;
}

// Route a still-failing verifier into an actionable, durable record (never a
// bare failure blob): a BoundaryBlockedFields/1.0 receipt with each blocker's
// exact next command. Written by runEndSessionCloseout.
function writeBlockedFieldsReceipt(projectRoot, closeout) {
  const routable = (closeout.blockers || []).filter((b) => b.next_command);
  if (routable.length === 0) return null;
  const dir = path.join(projectRoot, BLOCKED_FIELDS_REL);
  ensureDir(dir);
  const filePath = path.join(dir, `${closeout.scope.scope_key}.json`);
  const receipt = {
    schema: 'BoundaryBlockedFields/1.0',
    scope: closeout.scope.scope_key,
    generated_at: closeout.timestamp,
    verifier_verdict: closeout.verifiers.artifact_completeness.verdict,
    blocked_fields: routable.map((b) => ({ id: b.id, basis: b.basis, next_command: b.next_command })),
    note: 'Actionable routing for a failed closeout — run the next_command for each blocked field, then re-run the closeout.'
  };
  fs.writeFileSync(filePath, `${JSON.stringify(receipt, null, 2)}\n`);
  return toRel(projectRoot, filePath);
}

function buildCloseout(projectRoot, input, opts = {}) {
  const scopeInfo = resolveScope(input);
  const timestamp = opts.timestamp || new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const inventory = inventoryArtifacts(projectRoot, scopeInfo);
  const signals = readLiveSignals(projectRoot, scopeInfo);
  const pendingSignals = signals.filter((signal) => !signal.closeout_authorization);
  const authorizationSignals = signals.filter((signal) => signal.closeout_authorization);
  const recommendedNextCommand = authorizationSignals.length === 1
    ? String(authorizationSignals[0].recommended_next_command || '').trim()
    : '';
  const pendingActions = classifyPendingActions(signals);
  const actorPendingEntries = [...pendingActions.human_operator_actions, ...pendingActions.Codex_agent_actions, ...pendingActions.Claude_agent_actions, ...pendingActions.external_reviewer_gates, ...pendingActions.active_dispatches, ...pendingActions.unresolved_review_findings];
  const namingDrift = detectNamingDrift(inventory);
  const handoffCollisions = detectHandoffCollisions(inventory, scopeInfo);
  const verifier = summarizeVerifier(runVerifier(projectRoot, scopeInfo, opts));
  const operationalLane = assessOperationalLane(projectRoot, scopeInfo, verifier, inventory);
  const memoryMirrorPending = inventoryMemoryMirrorPending(projectRoot);
  const verifierFailed = verifier.verdict !== 'PASS' || verifier.status !== 0;
  const verifierAccepted = !verifierFailed || operationalLane.satisfied;
  const blockers = [];
  let verifierFailedBasis;
  if (operationalLane.marker && (operationalLane.planned_run_evidence || []).length > 0) {
    verifierFailedBasis = 'OperationalDebrief marker present but a PLAN RUN exists for this scope (active task plan / run artifact / review-state marker) — the privilege-reducing lane is disqualified; framework-grade validation is required.';
  } else if (operationalLane.marker && operationalLane.marker_declares_no_run === false) {
    verifierFailedBasis = 'OperationalDebrief marker carries a non-null run_id (self-declared planned session) — the lightweight lane requires run_id === null.';
  } else if (operationalLane.applicable) {
    verifierFailedBasis = 'Operational-lane marker present but no debrief/learning-journal entry — the operational validation lane is not satisfied.';
  } else {
    verifierFailedBasis = 'tools/verify/verify-artifact-completeness.cjs did not return PASS.';
  }
  if (verifierFailed && !operationalLane.satisfied) blockers.push({ id: 'verifier_failed', basis: verifierFailedBasis, evidence: verifier.findings.filter((finding) => finding.status === 'FAIL'), next_command: verifierNextCommand(scopeInfo, operationalLane), routed_to: toRel(projectRoot, path.join(projectRoot, BLOCKED_FIELDS_REL, `${scopeInfo.scope_key}.json`)) });
  if (pendingSignals.length > 0) blockers.push({ id: 'unconsumed_signals', basis: 'Live actionable or invalid signals remain for this scope', evidence: pendingSignals.map(redactedSignal) });
  if (authorizationSignals.length > 1) blockers.push({ id: 'clear_authorization_conflict', basis: 'Multiple valid same-scope clear-readiness signals compete for closeout authority', evidence: authorizationSignals.map(redactedSignal) });
  if (actorPendingEntries.length > 0) blockers.push({ id: 'actor_specific_pending_actions', basis: 'Actor-specific pending actions remain unresolved', evidence: actorPendingEntries });
  if (namingDrift.length > 0) blockers.push({ id: 'legacy_naming_drift', basis: 'Legacy closeout/debrief naming is present on the scoped surface', evidence: namingDrift });
  if (handoffCollisions.length > 0) blockers.push({ id: 'handoff_collision_risk', basis: 'Singleton or mixed handoff outputs create scoped closeout collision risk', evidence: handoffCollisions });
  const outputBase = `end-session-closeout__${scopeInfo.scope_key}__${safeTimestamp}__index`;
  const outputDir = path.join(projectRoot, ANALYSIS_REL);
  const outputPaths = { json: toRel(projectRoot, path.join(outputDir, `${outputBase}.json`)), markdown: toRel(projectRoot, path.join(outputDir, `${outputBase}.md`)), evidence_dir: toRel(projectRoot, path.join(outputDir, `end-session-closeout__${scopeInfo.scope_key}__${safeTimestamp}`)) };
  const closeout = { schema: 'EndSessionCloseout/1.0', timestamp, scope: scopeInfo, command_input: { argv: input.argv || [], selector: scopeInfo.selector, system: Boolean(input.system), client: input.client || null, scope: input.scope || null }, router_metadata: { task_type: 'end_session_closeout', risk_class: 'medium', required_capabilities: ['artifact_inventory', 'verifier_execution', 'signal_reading', 'operator_gate_detection'], artifact_refs: [], sensitivity_flags: ['no_credentials', 'no_client_framework_writes'], post_execution_review_expectation: 'codex-bridge', must_escalate_if: ['verifier_failed', 'unconsumed_signals', 'actor_specific_pending_actions', 'clear_authorization_conflict', 'legacy_naming_drift', 'handoff_collision_risk', 'missing_required_artifacts'] }, artifact_inventory: inventory, signals: signals.map(redactedSignal), closeout_authorizations: authorizationSignals.map(redactedSignal), recommended_next_command: recommendedNextCommand, verification_signal_receipts: inventoryVerificationSignals(projectRoot), memory_mirror_pending: memoryMirrorPending, operational_lane: operationalLane, verifiers: { artifact_completeness: verifier }, maintenance: { outputs: inventory.maintenance_outputs, note: 'Maintenance closeout output is inventoried as hygiene evidence only; it is not the EndSessionCloseout readiness authority.' }, observations: [`Inventoried ${Object.values(inventory).reduce((sum, records) => sum + records.length, 0)} scoped artifact reference(s).`, `Found ${pendingSignals.length} pending live signal(s) and ${authorizationSignals.length} valid clear-readiness authorization signal(s) for scope ${scopeInfo.scope_key}.`, `Artifact completeness verifier verdict: ${verifier.verdict}.`, operationalLane.satisfied ? 'Operational validation lane SATISFIED (unplanned session: operational-debrief marker + debrief present); framework-grade verifier failure accepted.' : (operationalLane.applicable ? 'Operational-lane marker present but NOT satisfied (no debrief/learning-journal entry) — see verifier_failed blocker next_command.' : 'Operational validation lane not applicable (planned-run surface present or no operational-debrief marker).'), memoryMirrorPending.count > 0 ? `LOUD: ${memoryMirrorPending.count} memory-mirror write(s) pending (op unauthenticated) — see memory_mirror_pending receipts; re-run the guard once op is authed.` : 'No pending memory-mirror receipts.'], unknowns: verifier.verdict === 'UNKNOWN' ? ['Artifact completeness verifier output could not be parsed.'] : [], interpretations: ['ready_for_clear is a derived gate from verifier status, pending live signals, actor-specific pending actions, naming drift, and handoff collision checks. A structurally valid same-scope ready-for-clear signal is authorization evidence, not pending work.'], unverified_signals: pendingSignals.map(redactedSignal), readiness_basis: { verifier_passed: verifierAccepted, verifier_passed_via_operational_lane: operationalLane.satisfied, no_live_unconsumed_signals: pendingSignals.length === 0, no_actor_specific_pending_actions: actorPendingEntries.length === 0, one_or_zero_clear_authorizations: authorizationSignals.length <= 1, no_legacy_naming_drift: namingDrift.length === 0, no_handoff_collision_risk: handoffCollisions.length === 0, maintenance_only_not_used_as_authority: true, trust_gate: 'probationary_v1_requires_targeted_fixture_replays_or_repeated_successful_scoped_runs' }, pending_actions: pendingActions, ready_for_clear: blockers.length === 0, blockers, output_paths: outputPaths };
  closeout.router_metadata.artifact_refs = [outputPaths.json, outputPaths.markdown, ...Object.values(inventory).flat().map((record) => record.path)];
  return closeout;
}
function writeMarkdown(filePath, closeout) {
  const lines = ['# End Session Closeout', '', `- Schema: ${closeout.schema}`, `- Timestamp: ${closeout.timestamp}`, `- Scope: ${closeout.scope.scope_type} ${closeout.scope.scope_value}`, `- Ready for clear: ${closeout.ready_for_clear ? 'true' : 'false'}`, `- Review lane: ${closeout.router_metadata.post_execution_review_expectation}`, '', '## Readiness Basis', ''];
  for (const [key, value] of Object.entries(closeout.readiness_basis)) lines.push(`- ${key}: ${value}`);
  lines.push('', '## Blockers', '');
  if (closeout.blockers.length === 0) lines.push('- None'); else for (const blocker of closeout.blockers) { lines.push(`- ${blocker.id}: ${blocker.basis}`); if (blocker.next_command) lines.push(`  - NEXT: ${blocker.next_command}`); }
  lines.push('', '## Artifact Inventory', '');
  for (const [kind, records] of Object.entries(closeout.artifact_inventory)) { lines.push(`### ${kind}`); if (records.length === 0) lines.push('- None'); else for (const record of records.slice(0, 40)) lines.push(`- ${record.path}`); if (records.length > 40) lines.push(`- ... ${records.length - 40} more`); lines.push(''); }
  lines.push('## Pending Actions', '');
  for (const [kind, entries] of Object.entries(closeout.pending_actions)) { lines.push(`### ${kind}`); if (entries.length === 0) lines.push('- None'); else for (const entry of entries) lines.push(`- ${entry.path}: ${entry.recommended_next_actor || '(no actor)'}`); lines.push(''); }
  lines.push('## Observations', ''); for (const observation of closeout.observations) lines.push(`- ${observation}`);
  lines.push('', '## Unknowns', ''); if (closeout.unknowns.length === 0) lines.push('- None'); else for (const unknown of closeout.unknowns) lines.push(`- ${unknown}`);
  lines.push('', '## Interpretations', ''); for (const interpretation of closeout.interpretations) lines.push(`- ${interpretation}`);
  const vsr = closeout.verification_signal_receipts || { count: 0, receipts: [] };
  lines.push('', '## Verification Signal Receipts', '', `- Count: ${vsr.count}`);
  if (!vsr.receipts || vsr.receipts.length === 0) lines.push('- None'); else for (const receipt of vsr.receipts) lines.push(`- ${receipt.path} (${receipt.schema})`);
  const ol = closeout.operational_lane || {};
  lines.push('', '## Operational Validation Lane', '', `- Applicable: ${Boolean(ol.applicable)}`, `- Satisfied: ${Boolean(ol.satisfied)}`);
  if (ol.marker) lines.push(`- Marker: ${ol.marker.path || '(in-memory)'}`);
  const mmp = closeout.memory_mirror_pending || { count: 0, receipts: [] };
  lines.push('', '## Memory Mirror Pending', '', `- Count: ${mmp.count}`);
  if (!mmp.receipts || mmp.receipts.length === 0) lines.push('- None'); else for (const receipt of mmp.receipts) lines.push(`- ${receipt.path} — NEXT: ${receipt.next_command || '(re-run guard once op is authed)'}`);
  ensureDir(path.dirname(filePath)); fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}
function writeCloseout(projectRoot, closeout) { const jsonPath = path.join(projectRoot, closeout.output_paths.json); const mdPath = path.join(projectRoot, closeout.output_paths.markdown); ensureDir(path.dirname(jsonPath)); ensureDir(path.join(projectRoot, closeout.output_paths.evidence_dir)); fs.writeFileSync(jsonPath, `${JSON.stringify(closeout, null, 2)}\n`); writeMarkdown(mdPath, closeout); return closeout.output_paths; }
function runEndSessionCloseout(projectRoot, input, opts = {}) { const closeout = buildCloseout(projectRoot, input, opts); writeCloseout(projectRoot, closeout); closeout.blocked_fields_receipt = writeBlockedFieldsReceipt(projectRoot, closeout); return closeout; }
module.exports = { buildCloseout, classifyPendingActions, detectHandoffCollisions, detectNamingDrift, inventoryArtifacts, inventoryVerificationSignals, inventoryMemoryMirrorPending, assessOperationalLane, readOperationalDebriefMarker, writeOperationalDebriefMarker, writeBlockedFieldsReceipt, readLiveSignals, resolveScope, runEndSessionCloseout, writeCloseout };
