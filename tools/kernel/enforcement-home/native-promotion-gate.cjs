'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const GATE_SCHEMA = 'NativePromotionGate/1.0';
const SOAK_RECEIPT_SCHEMA = 'DebriefCloseSoakReceipt/1.0';
const REQUIRED_COUNT = 25;
const REQUIRED_ELAPSED_MS = 24 * 60 * 60 * 1000;
const REQUIRED_FAMILIES = Object.freeze([
  'interactive',
  'replacement',
  'print-json',
  'sigterm-sighup',
  'denied-close',
  'allowed-close',
  'loss-reconciliation'
]);

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function resolveArtifact(root, rel, label) {
  if (typeof rel !== 'string' || !rel.trim() || path.isAbsolute(rel)) throw new Error(`${label} path must be relative`);
  const canonicalRoot = fs.realpathSync(root);
  const target = path.resolve(canonicalRoot, rel);
  const relative = path.relative(canonicalRoot, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`${label} escapes project root`);
  let cursor = canonicalRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) break;
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`${label} contains a symbolic link`);
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error(`${label} does not exist: ${rel}`);
  const realTarget = fs.realpathSync(target);
  const realRelative = path.relative(canonicalRoot, realTarget);
  if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) throw new Error(`${label} resolves outside project root`);
  return target;
}

function readBoundArtifact(root, binding, label) {
  if (!binding || typeof binding !== 'object') throw new Error(`${label} binding is required`);
  const target = resolveArtifact(root, binding.path, label);
  const bytes = fs.readFileSync(target);
  if (!/^[a-f0-9]{64}$/.test(binding.sha256 || '') || sha256(bytes) !== binding.sha256) throw new Error(`${label} sha256 mismatch`);
  return { target, bytes, text: bytes.toString('utf8') };
}

function assertedVerdict(text) {
  let value = text;
  try {
    const parsed = JSON.parse(text);
    value = parsed.response_text || parsed.verdict || parsed.decision || text;
  } catch (_) {}
  const normalized = String(value).trim();
  const disposition = '(APPROVE|APPROVED|BLOCK|BLOCKED|REJECT|REJECTED|NEEDS[-_ ]AMENDMENT)';
  const leading = normalized.match(new RegExp(`^${disposition}\\b`, 'i'));
  if (leading) return /^APPROVE/i.test(leading[1]) ? 'approved' : 'not-approved';
  const explicit = normalized.match(new RegExp(`\\bVerdict:\\s*\\*{0,2}${disposition}\\b`, 'i'));
  return explicit && /^APPROVE/i.test(explicit[1]) ? 'approved' : 'not-approved';
}

function validateSoak(root, receipt) {
  const errors = [];
  if (receipt.schema !== SOAK_RECEIPT_SCHEMA) errors.push(`soak receipt schema must be ${SOAK_RECEIPT_SCHEMA}`);
  if (receipt.soak_schema !== 'DebriefCloseSoak/1.0') errors.push('soak state schema must be DebriefCloseSoak/1.0');
  if (receipt.status !== 'complete') errors.push('soak status must be complete');
  if (receipt.ready !== true) errors.push('soak receipt must assert ready=true');
  if (receipt.event_count < REQUIRED_COUNT) errors.push(`soak requires at least ${REQUIRED_COUNT} events`);
  if (receipt.elapsed_ms < REQUIRED_ELAPSED_MS) errors.push('soak requires at least 24 real elapsed hours');
  if (receipt.unexplained_mismatch_count !== 0) errors.push('soak has unexplained mismatches');
  for (const family of REQUIRED_FAMILIES) if (!receipt.family_counts || receipt.family_counts[family] < 1) errors.push(`soak missing workload family ${family}`);
  if (!receipt.registry_pre_retirement || receipt.registry_pre_retirement.blocking_owner !== 'claude_hook') errors.push('soak did not preserve Claude as blocking owner');
  if (!receipt.paired_events || receipt.paired_events.count !== receipt.event_count || !Array.isArray(receipt.paired_events.events) || receipt.paired_events.events.length !== receipt.event_count) errors.push('soak receipt does not preserve every paired event');
  try {
    const paired = readBoundArtifact(root, receipt.paired_events && receipt.paired_events.evidence, 'paired event evidence');
    const rows = paired.text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    if (rows.length !== receipt.event_count) errors.push('paired event evidence count differs from receipt');
    for (const [index, row] of rows.entries()) {
      if (!row.actual_runtime_session_ids || !row.actual_runtime_session_ids.claude_hook || !row.actual_runtime_session_ids.native) errors.push(`paired event ${index + 1} lacks actual runtime IDs`);
      if (!String(row.native_emit_source || '').startsWith('pi-fork:')) errors.push(`paired event ${index + 1} lacks native production provenance`);
      if (!row.comparison || row.comparison.ok !== true) errors.push(`paired event ${index + 1} is not a parity match`);
    }
  } catch (error) { errors.push(error.message); }
  if (!Array.isArray(receipt.mismatch_explanations) || receipt.mismatch_explanations.length !== receipt.mismatch_count) errors.push('mismatch explanation count differs from mismatch count');
  if (!receipt.unpaired_live_traffic || receipt.unpaired_live_traffic.classification !== 'segregated-health-evidence-only' || receipt.unpaired_live_traffic.included_in_acceptance_pairs !== false) errors.push('unpaired live traffic is not segregated from acceptance pairs');
  try { readBoundArtifact(root, receipt.unpaired_live_traffic && receipt.unpaired_live_traffic.evidence, 'unpaired live health evidence'); } catch (error) { errors.push(error.message); }
  for (const name of ['spans', 'observations', 'failures']) {
    try { readBoundArtifact(root, receipt.telemetry_evidence && receipt.telemetry_evidence[name], `${name} telemetry evidence`); } catch (error) { errors.push(error.message); }
  }
  return errors;
}

function validatePromotionGate(root, gateRel) {
  const errors = [];
  let gate;
  let gatePath;
  try {
    gatePath = resolveArtifact(root, gateRel, 'promotion gate');
    gate = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  } catch (error) {
    return { ok: false, errors: [error.message], gate: null, gate_path: null };
  }
  const expectedKeys = ['actor_custody', 'decision', 'generated_at', 'operator_authority', 'plan', 'projection_parity', 'protocol', 'reviews', 'schema', 'soak_receipt'];
  if (JSON.stringify(Object.keys(gate).sort()) !== JSON.stringify(expectedKeys)) errors.push('promotion gate top-level key set is not closed');
  if (gate.schema !== GATE_SCHEMA) errors.push(`promotion gate schema must be ${GATE_SCHEMA}`);
  if (gate.protocol !== 'debrief_before_closeout') errors.push('promotion gate protocol must be debrief_before_closeout');
  if (gate.decision !== 'approve-native-promotion') errors.push('promotion gate decision must approve native promotion');
  if (!Number.isFinite(Date.parse(gate.generated_at))) errors.push('promotion gate generated_at must be an ISO timestamp');
  try {
    const soakArtifact = readBoundArtifact(root, gate.soak_receipt, 'soak receipt');
    errors.push(...validateSoak(root, JSON.parse(soakArtifact.text)));
  } catch (error) { errors.push(error.message); }
  let planJsonHash = null;
  let custodyReceiptHash = null;
  try {
    const planJson = readBoundArtifact(root, gate.plan && gate.plan.json, 'plan JSON');
    readBoundArtifact(root, gate.plan && gate.plan.markdown, 'plan Markdown');
    planJsonHash = gate.plan.json.sha256;
    const parsedPlan = JSON.parse(planJson.text);
    if (parsedPlan.task_id !== 'sovereign-core-harness') errors.push('promotion plan task_id mismatch');
    if (!JSON.stringify(parsedPlan.bounded_plan || {}).includes('exclusive, expiring lease keyed to the actor invocation')) errors.push('promotion plan lacks actor-portable custody contract');
  } catch (error) { errors.push(error.message); }
  try {
    const receiptArtifact = readBoundArtifact(root, gate.actor_custody && gate.actor_custody.receipt, 'actor custody receipt');
    custodyReceiptHash = gate.actor_custody.receipt.sha256;
    const receipt = JSON.parse(receiptArtifact.text);
    if (receipt.schema !== 'ActorWorkCustodyTestReceipt/1.0' || receipt.status !== 'complete' || receipt.result.exit_code !== 0 || receipt.result.fail_count !== 0 || receipt.result.pass_count < 9) errors.push('actor custody receipt is not a passing closed receipt');
    const boundSources = new Map((receipt.source_bindings || []).map((item) => [item.path, item.sha256]));
    for (const [key, label] of [['implementation', 'actor custody implementation'], ['schema', 'actor custody schema'], ['tests', 'actor custody tests']]) {
      const artifact = readBoundArtifact(root, gate.actor_custody && gate.actor_custody[key], label);
      if (boundSources.get(gate.actor_custody[key].path) !== gate.actor_custody[key].sha256) errors.push(`${label} differs from the custody test receipt binding`);
      if (!artifact.bytes.length) errors.push(`${label} is empty`);
    }
  } catch (error) { errors.push(error.message); }
  try {
    const parity = readBoundArtifact(root, gate.projection_parity, 'projection parity receipt');
    if (!/P4-S2|parity/i.test(parity.text)) errors.push('projection parity receipt does not identify the accepted parity stage');
  } catch (error) { errors.push(error.message); }
  const families = new Set();
  if (!Array.isArray(gate.reviews) || gate.reviews.length < 2) errors.push('promotion gate requires at least two independent reviews');
  for (const [index, review] of (gate.reviews || []).entries()) {
    const label = `review ${index + 1}`;
    if (!review || review.verdict !== 'approved') errors.push(`${label} verdict must be approved`);
    if (!review || review.producer_family !== 'codex') errors.push(`${label} must name codex as producer family`);
    if (review && review.reviewer_family === review.producer_family) errors.push(`${label} reviewer must be producer-distinct`);
    if (review && review.reviewer_family) families.add(review.reviewer_family);
    try {
      const artifact = readBoundArtifact(root, review, label);
      if (assertedVerdict(artifact.text) !== 'approved') errors.push(`${label} artifact does not assert approval`);
      if (planJsonHash && !artifact.text.includes(planJsonHash)) errors.push(`${label} does not bind the current plan JSON hash`);
      if (custodyReceiptHash && !artifact.text.includes(custodyReceiptHash)) errors.push(`${label} does not bind the actor custody receipt hash`);
    } catch (error) { errors.push(error.message); }
  }
  if (!families.has('gemini')) errors.push('Gemini-family approval is required');
  if (!families.has('fable')) errors.push('Fable-family approval is required');
  try {
    const authority = readBoundArtifact(root, gate.operator_authority, 'operator authority');
    if (gate.operator_authority.status !== 'approved') errors.push('operator authority status must be approved');
    let approved = /operator[\s_-]*(approval|approved)|approved[\s_-]*by[\s_-]*(the[\s_-]*)?operator/i.test(authority.text);
    try {
      const marker = JSON.parse(authority.text);
      approved = approved || (marker.last_event === 'post_review_approved' && marker.post_review && marker.post_review.decision === 'approved');
    } catch (_) {}
    if (!approved) errors.push('operator authority artifact does not record approved plan state');
  } catch (error) { errors.push(error.message); }
  return { ok: errors.length === 0, errors, gate, gate_path: gatePath };
}

module.exports = { GATE_SCHEMA, SOAK_RECEIPT_SCHEMA, REQUIRED_COUNT, REQUIRED_ELAPSED_MS, REQUIRED_FAMILIES, sha256, resolveArtifact, assertedVerdict, validateSoak, validatePromotionGate };
