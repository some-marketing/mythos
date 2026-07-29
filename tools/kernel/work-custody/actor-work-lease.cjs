#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'ActorWorkLease/1.0';
const RECEIPT_SCHEMA = 'ActorWorkLeaseTransition/1.0';
const STATES = Object.freeze(['available', 'active', 'handed_off', 'completed', 'expired', 'abandoned', 'reclaimed', 'conflicting']);
const DEFAULT_ROOT = '_dev/state/actor-work-custody';
const DEFAULT_TTL_MS = 60_000;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function nowMs(options = {}) {
  const value = options.now ? options.now() : Date.now();
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('clock returned an invalid time');
  return parsed;
}

function iso(ms) { return new Date(ms).toISOString(); }

function normalizeArtifacts(values) {
  if (!Array.isArray(values) || values.length === 0) throw new Error('bounded_artifacts must be a non-empty array');
  const normalized = [...new Set(values.map((value) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('bounded artifact paths must be non-empty strings');
    const clean = value.replace(/\\/g, '/').replace(/^\.\//, '');
    if (path.posix.isAbsolute(clean) || clean === '..' || clean.startsWith('../') || clean.includes('/../')) throw new Error(`bounded artifact escapes repository: ${value}`);
    return clean;
  }))].sort();
  return normalized;
}

function requireActor(actor) {
  if (!actor || typeof actor !== 'object' || typeof actor.invocation_id !== 'string' || !actor.invocation_id.trim()) {
    throw new Error('actor.invocation_id is required');
  }
  return {
    invocation_id: actor.invocation_id.trim(),
    session_id: typeof actor.session_id === 'string' && actor.session_id.trim() ? actor.session_id.trim() : actor.invocation_id.trim(),
    provenance: actor.provenance && typeof actor.provenance === 'object' && !Array.isArray(actor.provenance) ? { ...actor.provenance } : {}
  };
}

function stateDir(root, options = {}) { return path.resolve(root, options.stateRoot || DEFAULT_ROOT); }
function leasesDir(root, options = {}) { return path.join(stateDir(root, options), 'leases'); }
function ledgerPath(root, options = {}) { return path.join(stateDir(root, options), 'transitions.jsonl'); }
function lockPath(root, options = {}) { return path.join(stateDir(root, options), '.mutation-lock'); }
function leasePath(root, workUnitId, options = {}) { return path.join(leasesDir(root, options), `${sha256(workUnitId)}.json`); }

function atomicWrite(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(temp, target);
}

function withLock(root, options, fn) {
  const lock = lockPath(root, options);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + (options.lockTimeoutMs || 1_000);
  while (true) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) return { ok: false, reason: 'mutation-lock-timeout', reclaimable: true };
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    }
  }
  try { return fn(); } finally { fs.rmdirSync(lock); }
}

function appendReceipt(root, receipt, options = {}) {
  const target = ledgerPath(root, options);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, `${JSON.stringify(receipt)}\n`, 'utf8');
  return target;
}

function validateState(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['state must be an object'] };
  const keys = Object.keys(value).sort();
  const expected = ['bounded_artifacts', 'current_lease', 'epoch', 'schema', 'status', 'updated_at', 'work_unit_id'];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) errors.push('state key set is not closed');
  if (value.schema !== SCHEMA) errors.push(`schema must be ${SCHEMA}`);
  if (typeof value.work_unit_id !== 'string' || !value.work_unit_id) errors.push('work_unit_id required');
  if (!STATES.includes(value.status)) errors.push('status invalid');
  if (!Number.isInteger(value.epoch) || value.epoch < 0) errors.push('epoch must be a non-negative integer');
  try { normalizeArtifacts(value.bounded_artifacts); } catch (error) { errors.push(error.message); }
  if (!Number.isFinite(Date.parse(value.updated_at))) errors.push('updated_at invalid');
  if (value.status === 'active') {
    const lease = value.current_lease;
    if (!lease || typeof lease !== 'object') errors.push('active state requires current_lease');
    else {
      const leaseKeys = Object.keys(lease).sort();
      const expectedLeaseKeys = ['actor', 'expires_at', 'heartbeat_at', 'lease_id', 'started_at'];
      if (JSON.stringify(leaseKeys) !== JSON.stringify(expectedLeaseKeys)) errors.push('current_lease key set is not closed');
      if (typeof lease.lease_id !== 'string' || !lease.lease_id) errors.push('lease_id required');
      try { requireActor(lease.actor); } catch (error) { errors.push(error.message); }
      for (const key of ['started_at', 'heartbeat_at', 'expires_at']) if (!Number.isFinite(Date.parse(lease[key]))) errors.push(`${key} invalid`);
    }
  } else if (value.current_lease !== null) errors.push(`${value.status} state cannot retain current_lease`);
  return { ok: errors.length === 0, errors };
}

function readState(root, workUnitId, options = {}) {
  const target = leasePath(root, workUnitId, options);
  try {
    const value = JSON.parse(fs.readFileSync(target, 'utf8'));
    const validation = validateState(value);
    if (!validation.ok) throw new Error(validation.errors.join('; '));
    if (value.work_unit_id !== workUnitId) throw new Error('work unit hash collision or identity mismatch');
    return { kind: 'valid', state: value, path: target, error: null };
  } catch (error) {
    if (!fs.existsSync(target)) return { kind: 'missing', state: null, path: target, error: 'lease state missing' };
    return { kind: 'corrupt', state: null, path: target, error: error.message };
  }
}

function receiptFor(workUnitId, from, to, epoch, detail, at) {
  return { schema: RECEIPT_SCHEMA, receipt_id: crypto.randomUUID(), work_unit_id: workUnitId, from, to, epoch, at, ...detail };
}

function persist(root, state, receipt, options) {
  const validation = validateState(state);
  if (!validation.ok) throw new Error(`refusing invalid lease state: ${validation.errors.join('; ')}`);
  atomicWrite(leasePath(root, state.work_unit_id, options), state);
  appendReceipt(root, receipt, options);
}

function availableState(workUnitId, artifacts, epoch, at) {
  return { schema: SCHEMA, work_unit_id: workUnitId, bounded_artifacts: artifacts, status: 'available', epoch, current_lease: null, updated_at: at };
}

function artifactsOverlap(left, right) { return left.some((item) => right.includes(item)); }

function activeStates(root, atMs, options) {
  const dir = leasesDir(root, options);
  if (!fs.existsSync(dir)) return { states: [], corrupt: [] };
  const states = [];
  const corrupt = [];
  for (const name of fs.readdirSync(dir).filter((value) => value.endsWith('.json')).sort()) {
    const target = path.join(dir, name);
    try {
      const value = JSON.parse(fs.readFileSync(target, 'utf8'));
      const valid = validateState(value);
      if (!valid.ok) throw new Error(valid.errors.join('; '));
      if (value.status === 'active' && Date.parse(value.current_lease.expires_at) > atMs) states.push(value);
    } catch (error) { corrupt.push({ path: target, error: error.message }); }
  }
  return { states, corrupt };
}

function activate(root, prior, actor, ttlMs, atMs, transition, options) {
  const epoch = prior.epoch + 1;
  const leaseId = options.leaseId ? options.leaseId() : crypto.randomUUID();
  const at = iso(atMs);
  const state = {
    schema: SCHEMA, work_unit_id: prior.work_unit_id, bounded_artifacts: prior.bounded_artifacts,
    status: 'active', epoch,
    current_lease: { lease_id: leaseId, actor, started_at: at, heartbeat_at: at, expires_at: iso(atMs + ttlMs) },
    updated_at: at
  };
  const receipt = receiptFor(prior.work_unit_id, transition, 'active', epoch, { lease_id: leaseId, actor, bounded_artifacts: prior.bounded_artifacts }, at);
  persist(root, state, receipt, options);
  return { ok: true, state, receipt };
}

function claim(root, input, options = {}) {
  const workUnitId = String(input.work_unit_id || '').trim();
  if (!workUnitId) throw new Error('work_unit_id is required');
  const actor = requireActor(input.actor);
  const artifacts = normalizeArtifacts(input.bounded_artifacts);
  const ttlMs = input.ttl_ms || DEFAULT_TTL_MS;
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new Error('ttl_ms must be a positive integer');
  return withLock(root, options, () => {
    const atMs = nowMs(options);
    const existing = readState(root, workUnitId, options);
    if (existing.kind === 'corrupt') return { ok: false, reason: 'corrupt-state-requires-explicit-reclamation', reclaimable: true, error: existing.error };
    let prior = existing.state;
    if (!prior) {
      prior = availableState(workUnitId, artifacts, 0, iso(atMs));
      persist(root, prior, receiptFor(workUnitId, null, 'available', 0, { bounded_artifacts: artifacts }, iso(atMs)), options);
    } else if (JSON.stringify(prior.bounded_artifacts) !== JSON.stringify(artifacts)) {
      return { ok: false, reason: 'bounded-artifact-set-mismatch', reclaimable: false };
    }
    if (prior.status === 'active' && Date.parse(prior.current_lease.expires_at) <= atMs) {
      const expired = { ...prior, status: 'expired', current_lease: null, updated_at: iso(atMs) };
      persist(root, expired, receiptFor(workUnitId, 'active', 'expired', prior.epoch, { expired_lease_id: prior.current_lease.lease_id }, iso(atMs)), options);
      prior = expired;
    }
    const inventory = activeStates(root, atMs, options);
    if (inventory.corrupt.length) return { ok: false, reason: 'corrupt-custody-surface', reclaimable: true, corrupt: inventory.corrupt };
    const conflict = inventory.states.find((state) => state.work_unit_id !== workUnitId && artifactsOverlap(state.bounded_artifacts, artifacts));
    if (prior.status === 'active' || conflict) {
      const blocking = conflict || prior;
      appendReceipt(root, receiptFor(workUnitId, prior.status, 'conflicting', prior.epoch, { actor, conflicting_work_unit_id: blocking.work_unit_id, conflicting_lease_id: blocking.current_lease.lease_id }, iso(atMs)), options);
      return { ok: false, reason: 'conflicting-active-lease', reclaimable: false, conflicting_work_unit_id: blocking.work_unit_id };
    }
    const transition = ['expired', 'abandoned'].includes(prior.status) ? 'reclaimed' : prior.status;
    if (transition === 'reclaimed') appendReceipt(root, receiptFor(workUnitId, prior.status, 'reclaimed', prior.epoch, { actor }, iso(atMs)), options);
    return activate(root, prior, actor, ttlMs, atMs, transition, options);
  });
}

function mutateActive(root, input, options, action) {
  const workUnitId = String(input.work_unit_id || '').trim();
  const actor = requireActor(input.actor);
  return withLock(root, options, () => {
    const atMs = nowMs(options);
    const read = readState(root, workUnitId, options);
    if (read.kind !== 'valid') return { ok: false, reason: `${read.kind}-state`, reclaimable: true };
    const prior = read.state;
    if (prior.status === 'active' && Date.parse(prior.current_lease.expires_at) <= atMs) {
      const expired = { ...prior, status: 'expired', current_lease: null, updated_at: iso(atMs) };
      persist(root, expired, receiptFor(workUnitId, 'active', 'expired', prior.epoch, { expired_lease_id: prior.current_lease.lease_id }, iso(atMs)), options);
      return { ok: false, reason: 'lease-expired', reclaimable: true, state: expired };
    }
    if (prior.status !== 'active' || prior.epoch !== input.epoch || prior.current_lease.lease_id !== input.lease_id || prior.current_lease.actor.invocation_id !== actor.invocation_id) {
      appendReceipt(root, receiptFor(workUnitId, prior.status, 'conflicting', prior.epoch, { actor, attempted_lease_id: input.lease_id, attempted_epoch: input.epoch, action }, iso(atMs)), options);
      return { ok: false, reason: 'stale-or-foreign-lease', reclaimable: prior.status !== 'active' };
    }
    if (action === 'authorize') return { ok: true, reason: 'active-lease-authorized', state: prior };
    if (action === 'heartbeat') {
      const ttlMs = input.ttl_ms || DEFAULT_TTL_MS;
      const state = { ...prior, current_lease: { ...prior.current_lease, heartbeat_at: iso(atMs), expires_at: iso(atMs + ttlMs) }, updated_at: iso(atMs) };
      persist(root, state, receiptFor(workUnitId, 'active', 'active', state.epoch, { lease_id: input.lease_id, actor, action: 'heartbeat' }, iso(atMs)), options);
      return { ok: true, state };
    }
    const status = action === 'complete' ? 'completed' : 'abandoned';
    const state = { ...prior, status, current_lease: null, updated_at: iso(atMs) };
    persist(root, state, receiptFor(workUnitId, 'active', status, state.epoch, { released_lease_id: input.lease_id, actor }, iso(atMs)), options);
    return { ok: true, state };
  });
}

function authorizeWrite(root, input, options = {}) { return mutateActive(root, input, options, 'authorize'); }
function heartbeat(root, input, options = {}) { return mutateActive(root, input, options, 'heartbeat'); }
function complete(root, input, options = {}) { return mutateActive(root, input, options, 'complete'); }
function abandon(root, input, options = {}) { return mutateActive(root, input, options, 'abandon'); }

function handoff(root, input, options = {}) {
  const recipient = requireActor(input.to_actor);
  const source = requireActor(input.actor);
  return withLock(root, options, () => {
    const atMs = nowMs(options);
    const read = readState(root, input.work_unit_id, options);
    if (read.kind !== 'valid') return { ok: false, reason: `${read.kind}-state`, reclaimable: true };
    const prior = read.state;
    if (prior.status !== 'active' || prior.epoch !== input.epoch || prior.current_lease.lease_id !== input.lease_id || prior.current_lease.actor.invocation_id !== source.invocation_id) return { ok: false, reason: 'stale-or-foreign-lease' };
    const handed = { ...prior, status: 'handed_off', current_lease: null, updated_at: iso(atMs) };
    persist(root, handed, receiptFor(input.work_unit_id, 'active', 'handed_off', prior.epoch, { from_actor: source, to_actor: recipient, released_lease_id: input.lease_id }, iso(atMs)), options);
    return activate(root, handed, recipient, input.ttl_ms || DEFAULT_TTL_MS, atMs, 'handed_off', options);
  });
}

function reclaimCorrupt(root, input, options = {}) {
  const actor = requireActor(input.actor);
  const artifacts = normalizeArtifacts(input.bounded_artifacts);
  return withLock(root, options, () => {
    const atMs = nowMs(options);
    const read = readState(root, input.work_unit_id, options);
    if (read.kind !== 'corrupt') return { ok: false, reason: 'state-is-not-corrupt' };
    const archiveDir = path.join(stateDir(root, options), 'corrupt');
    fs.mkdirSync(archiveDir, { recursive: true });
    const archived = path.join(archiveDir, `${sha256(input.work_unit_id)}.${atMs}.json`);
    fs.renameSync(read.path, archived);
    const reclaimed = availableState(input.work_unit_id, artifacts, 0, iso(atMs));
    appendReceipt(root, receiptFor(input.work_unit_id, 'conflicting', 'reclaimed', 0, { actor, corrupt_archive: path.relative(root, archived).replace(/\\/g, '/'), error: read.error }, iso(atMs)), options);
    return activate(root, reclaimed, actor, input.ttl_ms || DEFAULT_TTL_MS, atMs, 'reclaimed', options);
  });
}

module.exports = {
  SCHEMA, RECEIPT_SCHEMA, STATES, DEFAULT_ROOT, DEFAULT_TTL_MS,
  normalizeArtifacts, validateState, readState, claim, authorizeWrite, heartbeat, complete, abandon, handoff, reclaimCorrupt,
  leasePath, ledgerPath
};
