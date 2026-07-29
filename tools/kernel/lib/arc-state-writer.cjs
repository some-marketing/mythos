'use strict';

const fs = require('fs');
const path = require('path');
const { resolveCanonicalRoot } = require('../../lib/canonical-root.cjs');

// S0 canonical-root retrofit: repo root resolves LOCATION-RELATIVE via the one
// canonical resolver (mode:'hard' — anchors validated, throws ECANONROOT on a
// stale/foreign root) instead of __dirname re-derivation. Resolved lazily +
// memoized so that merely require()-ing this module (e.g. from the advisory
// pretool-arc-guard hook) can NEVER throw at load time on a broken root.
let _projectRoot = null;
function getProjectRoot() {
  if (_projectRoot === null) {
    _projectRoot = resolveCanonicalRoot({ mode: 'hard' });
  }
  return _projectRoot;
}
function getDefaultStateDir() {
  return path.join(getProjectRoot(), '_dev', 'state', 'actor-arc');
}
const SCHEMA_PATH = path.join(__dirname, 'arc-scope-snapshot.schema.json');

const VALID_AUTHORITY_KINDS = new Set([
  'operator-turn',
  'live-signal',
  'approved-plan',
  'worker-return',
  'coordinator-dispatch'
]);

const VALID_LIFECYCLE_STATES = new Set([
  'awaiting-authorization',
  'authorized-for-arc',
  'executing',
  'closing',
  'resting',
  'blocked',
  'arc-complete'
]);

const VALID_ACTOR_TIERS = new Set(['main-chain', 'subagent', 'bridge', 'unknown']);

function resolveActorId() {
  return (
    process.env.MYTHOS_ACTOR_ID ||
    process.env.CLAUDE_AGENT_ID ||
    process.env.CLAUDE_SUBAGENT_ID ||
    (process.env.CLAUDE_SESSION_ID
      ? `claude-main-chain-session:${process.env.CLAUDE_SESSION_ID}`
      : 'unknown-actor')
  );
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nowIso() {
  return new Date().toISOString();
}

function loadSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

function getStateDir() {
  return path.resolve(process.env.MYTHOS_ACTOR_ARC_DIR || getDefaultStateDir());
}

function actorIdToFileName(actorId) {
  return String(actorId || '')
    .trim()
    .replace(/[\\/]/g, '__') + '.json';
}

function getStatePathForActor(actorId) {
  if (!actorId || typeof actorId !== 'string') {
    throw new Error('getStatePathForActor requires actorId');
  }
  return path.join(getStateDir(), actorIdToFileName(actorId));
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

function validateArcSnapshot(snapshot) {
  const schema = loadSchema();
  const errors = [];

  if (!isPlainObject(snapshot)) {
    return {
      ok: false,
      errors: ['snapshot must be a plain object'],
      required_fields: schema.required || []
    };
  }

  for (const field of schema.required || []) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, field)) {
      errors.push(`missing required field: ${field}`);
    }
  }

  if (typeof snapshot.arc_id !== 'string' || !snapshot.arc_id.trim()) {
    errors.push('arc_id must be a non-empty string');
  }
  if (typeof snapshot.workstream_scope !== 'string' || !snapshot.workstream_scope.trim()) {
    errors.push('workstream_scope must be a non-empty string');
  }
  if (!isPlainObject(snapshot.scope_identity)) {
    errors.push('scope_identity must be a plain object');
  }
  if (!Array.isArray(snapshot.declared_write_set)) {
    errors.push('declared_write_set must be an array');
  }
  if (!Array.isArray(snapshot.forbidden_artifacts)) {
    errors.push('forbidden_artifacts must be an array');
  }
  if (!isPlainObject(snapshot.authority_source)) {
    errors.push('authority_source must be a plain object');
  } else {
    if (!VALID_AUTHORITY_KINDS.has(snapshot.authority_source.kind)) {
      errors.push(
        'authority_source.kind must be one of: ' +
          Array.from(VALID_AUTHORITY_KINDS).join(', ')
      );
    }
    if (
      typeof snapshot.authority_source.ref !== 'string' ||
      !snapshot.authority_source.ref.trim()
    ) {
      errors.push('authority_source.ref must be a non-empty string');
    }
  }
  if (
    snapshot.parent_arc_id !== null &&
    snapshot.parent_arc_id !== undefined &&
    (typeof snapshot.parent_arc_id !== 'string' || !snapshot.parent_arc_id.trim())
  ) {
    errors.push('parent_arc_id must be null or a non-empty string');
  }
  if (typeof snapshot.authorized_at !== 'string' || !snapshot.authorized_at.trim()) {
    errors.push('authorized_at must be a non-empty string');
  }
  if (!VALID_LIFECYCLE_STATES.has(snapshot.lifecycle_state)) {
    errors.push(
      'lifecycle_state must be one of: ' +
        Array.from(VALID_LIFECYCLE_STATES).join(', ')
    );
  }
  if (typeof snapshot.actor_id !== 'string' || !snapshot.actor_id.trim()) {
    errors.push('actor_id must be a non-empty string');
  }
  if (!VALID_ACTOR_TIERS.has(snapshot.actor_tier)) {
    errors.push(
      'actor_tier must be one of: ' + Array.from(VALID_ACTOR_TIERS).join(', ')
    );
  }
  if (
    snapshot.arc_ended_at !== null &&
    snapshot.arc_ended_at !== undefined &&
    (typeof snapshot.arc_ended_at !== 'string' || !snapshot.arc_ended_at.trim())
  ) {
    errors.push('arc_ended_at must be null or a non-empty string');
  }
  if (
    snapshot.end_reason !== null &&
    snapshot.end_reason !== undefined &&
    (typeof snapshot.end_reason !== 'string' || !snapshot.end_reason.trim())
  ) {
    errors.push('end_reason must be null or a non-empty string');
  }
  if (!Array.isArray(snapshot.history)) {
    errors.push('history must be an array');
  } else {
    snapshot.history.forEach((entry, index) => {
      if (!isPlainObject(entry)) {
        errors.push(`history[${index}] must be a plain object`);
        return;
      }
      if (
        entry.from_state !== null &&
        entry.from_state !== undefined &&
        (typeof entry.from_state !== 'string' || !entry.from_state.trim())
      ) {
        errors.push(`history[${index}].from_state must be null or a non-empty string`);
      }
      if (typeof entry.to_state !== 'string' || !entry.to_state.trim()) {
        errors.push(`history[${index}].to_state must be a non-empty string`);
      }
      if (typeof entry.trigger !== 'string' || !entry.trigger.trim()) {
        errors.push(`history[${index}].trigger must be a non-empty string`);
      }
      if (
        typeof entry.transitioned_at !== 'string' ||
        !entry.transitioned_at.trim()
      ) {
        errors.push(`history[${index}].transitioned_at must be a non-empty string`);
      }
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    required_fields: schema.required || []
  };
}

function writeJsonAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + '\n');
  fs.renameSync(tmpPath, filePath);
}

function normalizeInitialSnapshot(envelope) {
  const snapshot = Object.assign(
    {
      parent_arc_id: null,
      authorized_at: nowIso(),
      lifecycle_state: 'authorized-for-arc',
      actor_tier: 'unknown',
      arc_ended_at: null,
      end_reason: null,
      declared_write_set: [],
      forbidden_artifacts: [],
      history: []
    },
    envelope || {}
  );

  if (!Array.isArray(snapshot.history) || snapshot.history.length === 0) {
    snapshot.history = [
      {
        from_state: null,
        to_state: snapshot.lifecycle_state,
        trigger: 'createArc',
        transitioned_at: snapshot.authorized_at,
        evidence: snapshot.authority_source || null
      }
    ];
  }

  return snapshot;
}

function createArc(envelope) {
  const snapshot = normalizeInitialSnapshot(envelope);
  const validation = validateArcSnapshot(snapshot);
  if (!validation.ok) {
    throw new Error('createArc: invalid snapshot: ' + validation.errors.join('; '));
  }
  writeJsonAtomic(getStatePathForActor(snapshot.actor_id), snapshot);
  return snapshot;
}

function readCurrentArc(actorId) {
  if (!actorId || typeof actorId !== 'string') return null;
  return readJsonIfExists(getStatePathForActor(actorId));
}

function transitionArc(actorId, newState, trigger, evidence) {
  if (!VALID_LIFECYCLE_STATES.has(newState)) {
    throw new Error('transitionArc: invalid lifecycle state: ' + String(newState));
  }
  const current = readCurrentArc(actorId);
  if (!current) {
    throw new Error(`transitionArc: no current arc for actor ${actorId}`);
  }
  const next = Object.assign({}, current, {
    lifecycle_state: newState,
    history: Array.isArray(current.history) ? current.history.slice() : []
  });
  const transitionedAt = nowIso();
  next.history.push({
    from_state: current.lifecycle_state || null,
    to_state: newState,
    trigger: String(trigger || 'transitionArc'),
    transitioned_at: transitionedAt,
    evidence: evidence || null
  });
  if (newState === 'arc-complete') {
    next.arc_ended_at = transitionedAt;
    if (!next.end_reason) next.end_reason = 'arc-complete';
  }
  const validation = validateArcSnapshot(next);
  if (!validation.ok) {
    throw new Error('transitionArc: invalid snapshot: ' + validation.errors.join('; '));
  }
  writeJsonAtomic(getStatePathForActor(actorId), next);
  return next;
}

function markArcComplete(actorId, closeoutEvidence) {
  const current = readCurrentArc(actorId);
  if (!current) {
    throw new Error(`markArcComplete: no current arc for actor ${actorId}`);
  }
  const transitionedAt = nowIso();
  const next = Object.assign({}, current, {
    lifecycle_state: 'arc-complete',
    arc_ended_at: transitionedAt,
    end_reason:
      (closeoutEvidence && closeoutEvidence.reason) || current.end_reason || 'arc-complete',
    closeout_evidence: closeoutEvidence || null,
    history: Array.isArray(current.history) ? current.history.slice() : []
  });
  next.history.push({
    from_state: current.lifecycle_state || null,
    to_state: 'arc-complete',
    trigger: 'markArcComplete',
    transitioned_at: transitionedAt,
    evidence: closeoutEvidence || null
  });
  const validation = validateArcSnapshot(next);
  if (!validation.ok) {
    throw new Error('markArcComplete: invalid snapshot: ' + validation.errors.join('; '));
  }
  writeJsonAtomic(getStatePathForActor(actorId), next);
  return next;
}

module.exports = {
  getProjectRoot,
  getDefaultStateDir,
  SCHEMA_PATH,
  VALID_AUTHORITY_KINDS,
  VALID_LIFECYCLE_STATES,
  VALID_ACTOR_TIERS,
  loadSchema,
  getStateDir,
  actorIdToFileName,
  getStatePathForActor,
  validateArcSnapshot,
  resolveActorId,
  createArc,
  readCurrentArc,
  transitionArc,
  markArcComplete
};
