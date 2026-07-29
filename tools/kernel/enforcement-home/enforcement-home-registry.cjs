'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_ID = 'EnforcementHomeRegistry/1.0';
const TRANSITION_SCHEMA_ID = 'EnforcementHomeTransition/1.0';
const CLAIM_SCHEMA_ID = 'EnforcementHomeClaim/1.0';
const STALE_DENIAL_SCHEMA_ID = 'EnforcementHomeStaleClaimDenial/1.0';
const DEFAULT_REGISTRY_REL = '_dev/state/enforcement-home-registry.json';
const DEFAULT_LEDGER_REL = '_dev/state/enforcement-home-transitions.jsonl';
const DEFAULT_STALE_DENIAL_REL = '_dev/state/enforcement-home-stale-claim-denials.jsonl';

function registryPath(root, opts = {}) {
  return path.resolve(root, opts.registryPath || DEFAULT_REGISTRY_REL);
}

function transitionLedgerPath(root, opts = {}) {
  return path.resolve(root, opts.ledgerPath || DEFAULT_LEDGER_REL);
}

function defaultRegistry(now = new Date().toISOString()) {
  return {
    schema: SCHEMA_ID,
    revision: 0,
    updated_at: now,
    protocols: {
      debrief_before_closeout: {
        blocking_owner: 'claude_hook',
        claude_hook: { mode: 'blocking', health: 'healthy' },
        native_fork: { mode: 'report-only', health: 'healthy' },
        reason: 'fail-safe-default-claude-owner'
      }
    }
  };
}

function validateRegistry(registry) {
  const errors = [];
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) return { ok: false, errors: ['registry must be an object'] };
  const topKeys = Object.keys(registry).sort();
  const expectedTop = ['protocols', 'revision', 'schema', 'updated_at'];
  if (JSON.stringify(topKeys) !== JSON.stringify(expectedTop)) errors.push('top-level key set is not closed');
  if (registry.schema !== SCHEMA_ID) errors.push(`schema must be ${SCHEMA_ID}`);
  if (!Number.isInteger(registry.revision) || registry.revision < 0) errors.push('revision must be a non-negative integer');
  if (!Number.isFinite(Date.parse(registry.updated_at))) errors.push('updated_at must be an ISO timestamp');
  const protocol = registry.protocols && registry.protocols.debrief_before_closeout;
  if (!protocol || typeof protocol !== 'object') errors.push('debrief_before_closeout protocol is required');
  if (protocol) {
    const keys = Object.keys(protocol).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['blocking_owner', 'claude_hook', 'native_fork', 'reason'])) errors.push('protocol key set is not closed');
    if (!['claude_hook', 'native_fork'].includes(protocol.blocking_owner)) errors.push('blocking_owner invalid');
    const blocking = [];
    for (const home of ['claude_hook', 'native_fork']) {
      const state = protocol[home];
      if (!state || typeof state !== 'object') {
        errors.push(`${home} state required`);
        continue;
      }
      if (JSON.stringify(Object.keys(state).sort()) !== JSON.stringify(['health', 'mode'])) errors.push(`${home} key set is not closed`);
      if (!['blocking', 'report-only'].includes(state.mode)) errors.push(`${home}.mode invalid`);
      if (!['healthy', 'degraded'].includes(state.health)) errors.push(`${home}.health invalid`);
      if (state.mode === 'blocking') blocking.push(home);
    }
    if (blocking.length !== 1) errors.push(`exactly one blocking home required, found ${blocking.length}`);
    if (blocking.length === 1 && blocking[0] !== protocol.blocking_owner) errors.push('blocking_owner does not match blocking mode');
    if (typeof protocol.reason !== 'string' || !protocol.reason.trim()) errors.push('reason required');
  }
  return { ok: errors.length === 0, errors };
}

function readRegistry(root, opts = {}) {
  const target = registryPath(root, opts);
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    const validation = validateRegistry(parsed);
    if (!validation.ok) throw new Error(validation.errors.join('; '));
    return { registry: parsed, source: 'registry', degraded: false, error: null, path: target };
  } catch (error) {
    return {
      registry: defaultRegistry(opts.now),
      source: fs.existsSync(target) ? 'fail-safe-corrupt-or-unreadable' : 'fail-safe-missing',
      degraded: true,
      error: error instanceof Error ? error.message : String(error),
      path: target
    };
  }
}

function protocolView(root, opts = {}) {
  const read = readRegistry(root, opts);
  return { ...read, protocol: read.registry.protocols.debrief_before_closeout };
}

function issueEnforcementClaim(root, home, opts = {}) {
  if (!['claude_hook', 'native_fork'].includes(home)) throw new Error(`invalid enforcement home: ${home}`);
  const view = protocolView(root, opts);
  return {
    schema: CLAIM_SCHEMA_ID,
    protocol: 'debrief_before_closeout',
    home,
    epoch: view.registry.revision,
    issued_at: opts.now || new Date().toISOString()
  };
}

function validateEnforcementClaim(claim) {
  const errors = [];
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return { ok: false, errors: ['claim must be an object'] };
  if (JSON.stringify(Object.keys(claim).sort()) !== JSON.stringify(['epoch', 'home', 'issued_at', 'protocol', 'schema'])) errors.push('claim key set is not closed');
  if (claim.schema !== CLAIM_SCHEMA_ID) errors.push(`claim schema must be ${CLAIM_SCHEMA_ID}`);
  if (claim.protocol !== 'debrief_before_closeout') errors.push('claim protocol invalid');
  if (!['claude_hook', 'native_fork'].includes(claim.home)) errors.push('claim home invalid');
  if (!Number.isInteger(claim.epoch) || claim.epoch < 0) errors.push('claim epoch must be a non-negative integer');
  if (!Number.isFinite(Date.parse(claim.issued_at))) errors.push('claim issued_at must be an ISO timestamp');
  return { ok: errors.length === 0, errors };
}

function authorizeEnforcementClaim(root, claim, opts = {}) {
  const claimValidation = validateEnforcementClaim(claim);
  const view = protocolView(root, opts);
  const state = claimValidation.ok ? view.protocol[claim.home] : null;
  const ok = claimValidation.ok
    && claim.epoch === view.registry.revision
    && claim.home === view.protocol.blocking_owner
    && state.mode === 'blocking'
    && state.health === 'healthy';
  let reason = 'authorized';
  if (!claimValidation.ok) reason = `invalid-claim:${claimValidation.errors.join('; ')}`;
  else if (claim.epoch !== view.registry.revision) reason = 'stale-epoch';
  else if (claim.home !== view.protocol.blocking_owner) reason = 'non-owner';
  else if (state.mode !== 'blocking' || state.health !== 'healthy') reason = 'home-not-healthy-blocking';
  return {
    ok,
    reason,
    claimed_home: claim && claim.home || null,
    claimed_epoch: claim && claim.epoch,
    current_owner: view.protocol.blocking_owner,
    current_epoch: view.registry.revision,
    registry_source: view.source
  };
}

function recordStaleClaimDenial(root, claim, authorization, opts = {}) {
  const target = path.resolve(root, opts.denialPath || DEFAULT_STALE_DENIAL_REL);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const row = {
    schema: STALE_DENIAL_SCHEMA_ID,
    protocol: 'debrief_before_closeout',
    claimed_home: claim && claim.home || null,
    claimed_epoch: claim && Number.isInteger(claim.epoch) ? claim.epoch : null,
    current_owner: authorization.current_owner,
    current_epoch: authorization.current_epoch,
    reason: authorization.reason,
    at: opts.now || new Date().toISOString()
  };
  fs.appendFileSync(target, `${JSON.stringify(row)}\n`, 'utf8');
  return { row, path: target };
}

function writeTransition(root, transition, opts = {}) {
  const target = transitionLedgerPath(root, opts);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, `${JSON.stringify(transition)}\n`, 'utf8');
  return target;
}

function writeRegistryAtomic(root, nextRegistry, opts = {}) {
  const validation = validateRegistry(nextRegistry);
  if (!validation.ok) throw new Error(`invalid registry: ${validation.errors.join('; ')}`);
  const target = registryPath(root, opts);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  let fd;
  try {
    opts.faultInjector?.('before-temp-open');
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(nextRegistry, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    opts.faultInjector?.('before-rename');
    fs.renameSync(temp, target);
    try {
      const dirFd = fs.openSync(path.dirname(target), 'r');
      fs.fsyncSync(dirFd);
      fs.closeSync(dirFd);
    } catch (_) {}
    opts.faultInjector?.('after-rename');
    return target;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.rmSync(temp, { force: true }); } catch (_) {}
  }
}

function transitionRegistry(root, owner, reason, opts = {}) {
  if (!['claude_hook', 'native_fork'].includes(owner)) throw new Error(`invalid owner: ${owner}`);
  const prior = readRegistry(root, opts).registry;
  const now = opts.now || new Date().toISOString();
  const next = {
    schema: SCHEMA_ID,
    revision: prior.revision + 1,
    updated_at: now,
    protocols: {
      debrief_before_closeout: {
        blocking_owner: owner,
        claude_hook: {
          mode: owner === 'claude_hook' ? 'blocking' : 'report-only',
          health: 'healthy'
        },
        native_fork: {
          mode: owner === 'native_fork' ? 'blocking' : 'report-only',
          health: opts.nativeHealth || 'healthy'
        },
        reason
      }
    }
  };
  writeRegistryAtomic(root, next, opts);
  const transition = {
    schema: TRANSITION_SCHEMA_ID,
    protocol: 'debrief_before_closeout',
    from_owner: prior.protocols.debrief_before_closeout.blocking_owner,
    to_owner: owner,
    from_epoch: prior.revision,
    to_epoch: next.revision,
    revision: next.revision,
    reason,
    at: now
  };
  const ledgerPath = writeTransition(root, transition, opts);
  return { registry: next, transition, registryPath: registryPath(root, opts), ledgerPath };
}

function initializeRegistry(root, opts = {}) {
  const current = readRegistry(root, opts);
  if (current.source === 'registry') return { registry: current.registry, created: false, path: current.path };
  const initial = defaultRegistry(opts.now);
  writeRegistryAtomic(root, initial, opts);
  return { registry: initial, created: true, path: registryPath(root, opts) };
}

function promoteNative(root, opts = {}) {
  return transitionRegistry(root, 'native_fork', opts.reason || 'p4-s3-soak-accepted', opts);
}

function rollbackToClaude(root, opts = {}) {
  return transitionRegistry(root, 'claude_hook', opts.reason || 'restore-on-divergence', { ...opts, nativeHealth: 'degraded' });
}

module.exports = {
  SCHEMA_ID,
  TRANSITION_SCHEMA_ID,
  CLAIM_SCHEMA_ID,
  STALE_DENIAL_SCHEMA_ID,
  DEFAULT_REGISTRY_REL,
  DEFAULT_LEDGER_REL,
  DEFAULT_STALE_DENIAL_REL,
  registryPath,
  transitionLedgerPath,
  defaultRegistry,
  validateRegistry,
  readRegistry,
  protocolView,
  issueEnforcementClaim,
  validateEnforcementClaim,
  authorizeEnforcementClaim,
  recordStaleClaimDenial,
  writeRegistryAtomic,
  transitionRegistry,
  initializeRegistry,
  promoteNative,
  rollbackToClaude
};
