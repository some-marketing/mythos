'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Relative path from project root to the system-level task-plan directory.
 * @type {string}
 */
const SYSTEM_PLAN_DIR = path.join('_dev', 'reports', 'analysis', 'task-plans');

/**
 * Return the absolute path to a client's plan directory.
 * @param {string} projectRoot - Absolute path to the Mythos repo root.
 * @param {string} clientCode - Client code (e.g. "CLIENTA").
 * @returns {string} Absolute path to `clients/{clientCode}/plans`.
 */
function clientPlanDir(projectRoot, clientCode) {
  return path.join(projectRoot, 'clients', clientCode, 'plans');
}

/**
 * Derive paired JSON and Markdown paths from a single resolved path.
 * Handles .json, .md, and bare (no-extension) references.
 * @param {string} resolved - Absolute path (may or may not have an extension).
 * @returns {{ jsonPath: string, markdownPath: string }}
 */
function pairedPaths(resolved) {
  if (resolved.endsWith('.md')) {
    return {
      jsonPath: resolved.slice(0, -3) + '.json',
      markdownPath: resolved
    };
  }
  if (resolved.endsWith('.json')) {
    return {
      jsonPath: resolved,
      markdownPath: resolved.slice(0, -5) + '.md'
    };
  }
  return {
    jsonPath: resolved + '.json',
    markdownPath: resolved + '.md'
  };
}

/**
 * Scan the clients/ directory for subdirectories that contain a plans/ folder.
 * Returns an array of { clientCode, plansDir } objects.
 * Gracefully returns [] if clients/ does not exist.
 * @param {string} projectRoot
 * @returns {Array<{ clientCode: string, plansDir: string }>}
 */
function discoverClientPlanRoots(projectRoot) {
  const clientsDir = path.join(projectRoot, 'clients');
  if (!fs.existsSync(clientsDir)) return [];

  const entries = fs.readdirSync(clientsDir, { withFileTypes: true });
  const roots = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Skip template directories
    if (entry.name.startsWith('_')) continue;

    const plansDir = path.join(clientsDir, entry.name, 'plans');
    if (fs.existsSync(plansDir) && fs.statSync(plansDir).isDirectory()) {
      roots.push({ clientCode: entry.name, plansDir: plansDir });
    }
  }

  return roots;
}

/**
 * Extract the client code from an absolute path that falls under clients/{CODE}/plans/.
 * @param {string} projectRoot
 * @param {string} absPath
 * @returns {string|null}
 */
function extractClientCode(projectRoot, absPath) {
  const clientsPrefix = path.join(projectRoot, 'clients') + path.sep;
  if (!absPath.startsWith(clientsPrefix)) return null;

  const remainder = absPath.slice(clientsPrefix.length);
  const firstSep = remainder.indexOf(path.sep);
  if (firstSep === -1) return null;

  return remainder.slice(0, firstSep);
}

/**
 * Main resolver. Resolves a task-plan reference (path or task-id) to its
 * canonical file paths and storage metadata.
 *
 * Resolution order:
 * 1. If the reference looks like a path (contains `/`, `.json`, or `.md`),
 *    resolve directly relative to projectRoot (unless already absolute).
 * 2. Otherwise treat as a task-id:
 *    a. Check system root: `_dev/reports/analysis/task-plans/{id}__plan.json`
 *    b. Check ALL client roots: `clients/* /plans/{id}__plan.json`
 *    c. Exactly one match  => return it
 *    d. Multiple matches   => throw (ambiguity blocking)
 *    e. Zero matches       => return null
 *
 * @param {string} projectRoot - Absolute path to the Mythos repo root.
 * @param {string} taskPlanRef - Task-id string or file path.
 * @param {object} [opts={}] - Reserved for future options.
 * @returns {{ jsonPath: string, markdownPath: string, storageRoot: string, resolvedFrom: string, clientCode: string|null } | null}
 * @throws {Error} When the same task-id is found in multiple roots.
 */
/**
 * Attach owned_artifacts_audit and audit_warnings to a resolver result.
 *
 * `owned_artifacts_audit` is `null` when the plan JSON is missing, malformed,
 * or has no scope_identity.owned_artifacts.
 *
 * `audit_warnings` is a (possibly empty) array of structured warnings about
 * the plan's auditability itself — separate from the references the plan
 * declares. Today's warnings:
 *   - `plan-missing-scope-identity-owned-artifacts`: the plan was readable
 *     but declares no `scope_identity.owned_artifacts`, so today's existence
 *     audit cannot run against it. Drift-blind plans are how the
 *     2026-04-29 handshake-formalization concept loss went unnoticed.
 *   - `plan-json-unreadable`: the plan JSON is missing or malformed, so
 *     neither audit nor warnings can run. Surface to /run-plan.
 *
 * Pure helper; never throws.
 *
 * @param {object} result - Resolver result object (must include jsonPath).
 * @param {string} projectRoot - Absolute repo root.
 * @returns {object} The same result with owned_artifacts_audit and audit_warnings attached.
 */
function attachAudit(result, projectRoot) {
  const planJson = readPlanJsonSafe(result.jsonPath);
  const warnings = [];

  if (!planJson) {
    warnings.push({
      code: 'plan-json-unreadable',
      detail: 'Plan JSON is missing or malformed; existence audit cannot run.'
    });
    result.owned_artifacts_audit = null;
    result.audit_warnings = warnings;
    return result;
  }

  const audit = auditOwnedArtifacts(planJson, projectRoot);
  if (audit === null) {
    const hasOwned = !!(planJson.scope_identity &&
      Array.isArray(planJson.scope_identity.owned_artifacts) &&
      planJson.scope_identity.owned_artifacts.length > 0);
    if (!hasOwned) {
      warnings.push({
        code: 'plan-missing-scope-identity-owned-artifacts',
        detail: 'Plan declares no scope_identity.owned_artifacts; the existence audit is drift-blind for this plan. Add owned_artifacts to scope_identity to enable drift detection.'
      });
    }
  }

  result.owned_artifacts_audit = audit;
  result.audit_warnings = warnings;
  return result;
}

function resolveTaskPlanPaths(projectRoot, taskPlanRef, opts) {
  const ref = String(taskPlanRef || '').trim();
  if (!ref) return null;

  const looksLikePath =
    ref.includes('/') ||
    ref.includes(path.sep) ||
    ref.endsWith('.json') ||
    ref.endsWith('.md');

  // ---- Explicit path resolution ----
  if (looksLikePath) {
    const resolved = path.isAbsolute(ref)
      ? ref
      : path.resolve(projectRoot, ref);

    const pair = pairedPaths(resolved);
    const storageRoot = path.dirname(resolved);
    const clientCode = extractClientCode(projectRoot, resolved);
    const isClientPath = clientCode !== null;

    return attachAudit({
      jsonPath: pair.jsonPath,
      markdownPath: pair.markdownPath,
      storageRoot: storageRoot,
      resolvedFrom: 'explicit-path',
      clientCode: isClientPath ? clientCode : null
    }, projectRoot);
  }

  // ---- Task-id lookup across all roots ----
  const candidates = [];

  // (a) System root
  const systemDir = path.join(projectRoot, SYSTEM_PLAN_DIR);
  const systemJson = path.join(systemDir, ref + '__plan.json');
  if (fs.existsSync(systemJson)) {
    candidates.push({
      jsonPath: systemJson,
      markdownPath: path.join(systemDir, ref + '__plan.md'),
      storageRoot: systemDir,
      resolvedFrom: 'system',
      clientCode: null
    });
  }

  // (b) All client roots
  const clientRoots = discoverClientPlanRoots(projectRoot);
  for (const { clientCode, plansDir } of clientRoots) {
    const clientJson = path.join(plansDir, ref + '__plan.json');
    if (fs.existsSync(clientJson)) {
      candidates.push({
        jsonPath: clientJson,
        markdownPath: path.join(plansDir, ref + '__plan.md'),
        storageRoot: plansDir,
        resolvedFrom: 'client',
        clientCode: clientCode
      });
    }
  }

  // (c) Exactly one match
  if (candidates.length === 1) {
    return attachAudit(candidates[0], projectRoot);
  }

  // (d) Multiple matches — ambiguity blocking
  if (candidates.length > 1) {
    const locations = candidates.map(
      (c) => '  - ' + c.jsonPath + ' (' + c.resolvedFrom + (c.clientCode ? ':' + c.clientCode : '') + ')'
    );
    throw new Error(
      'Ambiguous task-plan reference "' + ref + '". Found in ' +
      candidates.length + ' locations:\n' + locations.join('\n') +
      '\nProvide an explicit path or scope to disambiguate.'
    );
  }

  // (e) Not found
  return null;
}

/**
 * Determine the write-root directory for new plan artifacts based on scope.
 *
 * @param {string} projectRoot - Absolute path to the Mythos repo root.
 * @param {string} scopeType  - `"system"` or `"client"`.
 * @param {string} [clientCode] - Required when scopeType is `"client"`.
 * @returns {string} Absolute path to the target plan directory.
 * @throws {Error} On missing/invalid scopeType or missing clientCode for client scope.
 */
function resolveWriteRoot(projectRoot, scopeType, clientCode) {
  if (!scopeType || (scopeType !== 'system' && scopeType !== 'client')) {
    throw new Error('scope_type is required (system or client)');
  }

  if (scopeType === 'system') {
    return path.join(projectRoot, SYSTEM_PLAN_DIR);
  }

  // scopeType === 'client'
  if (!clientCode) {
    throw new Error('client scope requires client_code');
  }

  return clientPlanDir(projectRoot, clientCode);
}

/**
 * Scan both system and all client plan roots. Returns an array of every
 * discovered task-plan with metadata.
 *
 * @param {string} projectRoot - Absolute path to the Mythos repo root.
 * @returns {Array<{ taskId: string, jsonPath: string, markdownPath: string, storageRoot: string, scopeType: string, clientCode: string|null }>}
 */
function listAllTaskPlans(projectRoot) {
  const results = [];

  // System plans
  const systemDir = path.join(projectRoot, SYSTEM_PLAN_DIR);
  if (fs.existsSync(systemDir) && fs.statSync(systemDir).isDirectory()) {
    const files = fs.readdirSync(systemDir);
    for (const file of files) {
      if (!file.endsWith('__plan.json')) continue;
      const taskId = file.slice(0, -('__plan.json'.length));
      results.push({
        taskId: taskId,
        jsonPath: path.join(systemDir, file),
        markdownPath: path.join(systemDir, taskId + '__plan.md'),
        storageRoot: systemDir,
        scopeType: 'system',
        clientCode: null
      });
    }
  }

  // Client plans
  const clientRoots = discoverClientPlanRoots(projectRoot);
  for (const { clientCode, plansDir } of clientRoots) {
    const files = fs.readdirSync(plansDir);
    for (const file of files) {
      if (!file.endsWith('__plan.json')) continue;
      const taskId = file.slice(0, -('__plan.json'.length));
      results.push({
        taskId: taskId,
        jsonPath: path.join(plansDir, file),
        markdownPath: path.join(plansDir, taskId + '__plan.md'),
        storageRoot: plansDir,
        scopeType: 'client',
        clientCode: clientCode
      });
    }
  }

  return results;
}

/**
 * List amendment artifacts for a given task plan.
 * Globs for `<storageRoot>/<taskId>__amendment__*.json` and returns
 * them sorted newest-first by filename (which embeds the date).
 *
 * @param {string} storageRoot - Absolute path to the plan's storage directory.
 * @param {string} taskId - The task-plan id.
 * @returns {Array<{ jsonPath: string, markdownPath: string, timestamp: string }>}
 */
/**
 * Pure annotation/glob/NEW-marker classifier for a plan's owned_artifacts.
 * No filesystem I/O. Pair with auditOwnedArtifacts() for existence checking.
 *
 * @param {object} planJson - Parsed task-plan JSON.
 * @returns {{ existing_required: string[], planned_new: string[], glob_patterns_not_validated: string[] } | null}
 *   Returns null when the plan has no scope_identity.owned_artifacts.
 */
function classifyOwnedArtifacts(planJson) {
  if (!planJson || typeof planJson !== 'object') return null;
  const owned = planJson.scope_identity && planJson.scope_identity.owned_artifacts;
  if (!Array.isArray(owned) || owned.length === 0) return null;

  // Build the set of paths declared as NEW by any step's files_touched entry.
  const newPaths = new Set();
  const steps = planJson.bounded_plan && planJson.bounded_plan.steps;
  if (Array.isArray(steps)) {
    for (const step of steps) {
      const touched = step && step.files_touched;
      if (!Array.isArray(touched)) continue;
      for (const raw of touched) {
        if (typeof raw !== 'string') continue;
        const m = /^(.+?)\s*\((.+)\)\s*$/.exec(raw);
        if (m && /\bNEW\b/i.test(m[2])) {
          newPaths.add(m[1].trim());
        }
      }
    }
  }

  const existing_required = [];
  const planned_new = [];
  const glob_patterns_not_validated = [];

  // Detect glob patterns (POSIX glob + extglob negation).
  // Note: '!' as a leading char is also a YAML/extglob marker; check '!('.
  function isGlob(p) {
    return /[*?\[\]]/.test(p) || /!\(/.test(p) || p.includes(':');
  }

  for (const raw of owned) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // Detect glob FIRST — extglob negation '!(...)' would otherwise be
    // misparsed as a trailing parenthetical annotation by the strip step.
    if (isGlob(trimmed)) {
      glob_patterns_not_validated.push(trimmed);
      continue;
    }

    // Strip trailing parenthetical annotations: "tools/foo.js (NEW)" → "tools/foo.js"
    const stripped = trimmed.replace(/\s*\([^()]*\)\s*$/, '').trim();
    if (!stripped) continue;

    if (newPaths.has(stripped)) {
      planned_new.push(stripped);
    } else {
      existing_required.push(stripped);
    }
  }

  return { existing_required, planned_new, glob_patterns_not_validated };
}

/**
 * Audit owned_artifacts: classify, then existsSync each existing_required path.
 * Side-effect-free except read-only fs.existsSync calls.
 *
 * @param {object} planJson - Parsed task-plan JSON.
 * @param {string} projectRoot - Absolute repo root.
 * @returns {{ existing: string[], missing: string[], planned_new: string[], glob_patterns_not_validated: string[] } | null}
 *   Returns null when classifyOwnedArtifacts returns null.
 */
function auditOwnedArtifacts(planJson, projectRoot) {
  const classified = classifyOwnedArtifacts(planJson);
  if (!classified) return null;

  const existing = [];
  const missing = [];

  for (const p of classified.existing_required) {
    const abs = path.isAbsolute(p) ? p : path.join(projectRoot, p);
    if (fs.existsSync(abs)) {
      existing.push(p);
    } else {
      missing.push(p);
    }
  }

  return {
    existing,
    missing,
    planned_new: classified.planned_new.slice(),
    glob_patterns_not_validated: classified.glob_patterns_not_validated.slice()
  };
}

/**
 * Read a plan JSON file safely. Returns null on missing or malformed JSON;
 * never throws.
 */
function readPlanJsonSafe(jsonPath) {
  try {
    if (!jsonPath || !fs.existsSync(jsonPath)) return null;
    const raw = fs.readFileSync(jsonPath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

const RESOLVED_AMENDMENT_STATES = new Set([
  'superseded_by_baseline_reconciliation',
  'applied',
  'superseded'
]);

function isAmendmentActive(jsonPath) {
  try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return true;
    const lifecycleState = parsed.lifecycle_state;
    const executionStatus = parsed.execution_status;
    if (typeof lifecycleState === 'string' && RESOLVED_AMENDMENT_STATES.has(lifecycleState)) {
      return false;
    }
    if (typeof executionStatus === 'string' && RESOLVED_AMENDMENT_STATES.has(executionStatus)) {
      return false;
    }
    return true;
  } catch (_) {
    return true;
  }
}

function listAmendments(storageRoot, taskId, opts) {
  if (!fs.existsSync(storageRoot) || !fs.statSync(storageRoot).isDirectory()) {
    return [];
  }

  const includeSuperseded = !!(opts && opts.includeSuperseded);
  const prefix = taskId + '__amendment__';
  const files = fs.readdirSync(storageRoot);
  const amendments = [];

  for (const file of files) {
    if (!file.startsWith(prefix) || !file.endsWith('.json')) continue;
    if (file.endsWith('.advisory.json')) continue;
    const timestamp = file.slice(prefix.length, -('.json'.length));
    const jsonPath = path.join(storageRoot, file);
    const active = isAmendmentActive(jsonPath);
    if (!includeSuperseded && !active) continue;
    amendments.push({
      jsonPath: jsonPath,
      markdownPath: path.join(storageRoot, prefix + timestamp + '.md'),
      timestamp: timestamp,
      active: active
    });
  }

  // Newest first
  amendments.sort(function (a, b) {
    return b.timestamp.localeCompare(a.timestamp);
  });

  return amendments;
}

const OPERATOR_GATE_STATUSES = new Set([
  'open',
  'resolved',
  'deferred',
  'waived',
  'superseded'
]);

function extractOperatorGates(amendment) {
  if (!amendment || typeof amendment !== 'object') return [];
  const gates = amendment.operator_gates;
  if (!Array.isArray(gates)) return [];
  return gates;
}

function resolveOperatorGates(amendmentsOldestFirst) {
  const byId = new Map();
  const supersededIds = new Set();
  const list = Array.isArray(amendmentsOldestFirst) ? amendmentsOldestFirst : [];

  for (const amendment of list) {
    const gates = extractOperatorGates(amendment);
    for (const gate of gates) {
      if (!gate || typeof gate !== 'object') continue;
      const id = typeof gate.id === 'string' ? gate.id : null;
      if (!id) continue;
      const supersedesId = typeof gate.supersedes_gate_id === 'string' && gate.supersedes_gate_id
        ? gate.supersedes_gate_id
        : null;
      if (supersedesId) {
        supersededIds.add(supersedesId);
        byId.delete(supersedesId);
      }
      byId.set(id, gate);
    }
  }

  const gates = [];
  const by_id = {};
  for (const [id, gate] of byId.entries()) {
    if (supersededIds.has(id)) continue;
    gates.push(gate);
    by_id[id] = gate;
  }

  return {
    gates: gates,
    blocking_gates: gates.filter((gate) => gate && gate.status === 'open'),
    by_id: by_id
  };
}

function validateOperatorGates(amendment) {
  const errors = [];
  if (!amendment || typeof amendment !== 'object') return { errors };
  if (amendment.operator_gates === undefined || amendment.operator_gates === null) {
    return { errors };
  }
  if (!Array.isArray(amendment.operator_gates)) {
    errors.push({ path: '/operator_gates', message: 'operator_gates must be an array when present' });
    return { errors };
  }

  const isoLike = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  for (let index = 0; index < amendment.operator_gates.length; index += 1) {
    const gate = amendment.operator_gates[index];
    const base = `/operator_gates/${index}`;
    if (!gate || typeof gate !== 'object') {
      errors.push({ path: base, message: 'gate entry must be an object' });
      continue;
    }
    if (typeof gate.id !== 'string' || gate.id.length === 0) {
      errors.push({ path: `${base}/id`, message: 'gate.id must be a non-empty string' });
    }
    if (typeof gate.status !== 'string' || !OPERATOR_GATE_STATUSES.has(gate.status)) {
      errors.push({
        path: `${base}/status`,
        message: `gate.status must be one of: ${Array.from(OPERATOR_GATE_STATUSES).join(', ')}`
      });
    }
    if (gate.decided_at !== undefined && gate.decided_at !== null) {
      if (typeof gate.decided_at !== 'string' || !isoLike.test(gate.decided_at)) {
        errors.push({ path: `${base}/decided_at`, message: 'gate.decided_at must be ISO-8601 (YYYY-MM-DDTHH:MM:SS...) when not null' });
      }
    }
    if (gate.supersedes_gate_id !== undefined && gate.supersedes_gate_id !== null) {
      if (typeof gate.supersedes_gate_id !== 'string') {
        errors.push({ path: `${base}/supersedes_gate_id`, message: 'gate.supersedes_gate_id must be a string when not null' });
      }
    }
  }
  return { errors };
}

/**
 * Assess whether a LIVE repair-plan pairing warning sidecar exists for a plan.
 *
 * The advisory hook tools/planning/hooks/post-write-repair-plan-pairing.cjs
 * writes a `<plan>.json.warning` (or `.md.warning`) sidecar when it detects a
 * single-sided task-plan write. SH1 converts that advice into a run-time
 * invariant: /run-plan must refuse while the warning is LIVE.
 *
 * Liveness is deterministic and self-clearing on the exact named remedies:
 *   - a sidecar is LIVE while its warned surface's PAIRED counterpart is
 *     missing, OR older than the sidecar's triggered_at (still desynced);
 *   - it clears once the sister file is (re)written after the warning
 *     (sister-file sync) or /repair-plan does an atomic paired write.
 * A malformed/unreadable sidecar fails CLOSED (treated as live).
 *
 * @param {string} projectRoot - Absolute repo root.
 * @param {string} taskPlanRef - Task-id string or file path.
 * @returns {{ live: boolean, sidecarPath?: string, warnedFile?: string, sister?: string, reason?: string, sidecar?: object }}
 */
function assessRepairPlanPairingWarning(projectRoot, taskPlanRef) {
  let resolved;
  try {
    resolved = resolveTaskPlanPaths(projectRoot, taskPlanRef);
  } catch {
    resolved = null;
  }
  if (!resolved) return { live: false };

  const candidates = [resolved.jsonPath, resolved.markdownPath].filter(Boolean);
  for (const warnedFile of candidates) {
    const sidecarPath = warnedFile + '.warning';
    if (!fs.existsSync(sidecarPath)) continue;

    let sidecar = null;
    try {
      sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    } catch {
      // Unreadable sidecar -> fail closed.
      return { live: true, sidecarPath, warnedFile, reason: 'pairing warning sidecar is unreadable (fail-closed)' };
    }

    const sister = (sidecar && sidecar.paired_path)
      ? sidecar.paired_path
      : (warnedFile.endsWith('.json') ? warnedFile.slice(0, -5) + '.md' : warnedFile.slice(0, -3) + '.json');
    const trigger = sidecar && sidecar.triggered_at ? Date.parse(sidecar.triggered_at) : NaN;

    let live;
    let reason;
    try {
      const st = fs.statSync(sister);
      if (!Number.isFinite(trigger)) {
        live = true;
        reason = 'pairing warning has no valid triggered_at; cannot prove sister is in sync (fail-closed)';
      } else if (st.mtimeMs >= trigger) {
        live = false; // sister (re)written at/after the warning -> resolved
      } else {
        live = true;
        reason = 'paired surface is older than the pairing warning (still desynced)';
      }
    } catch {
      live = true;
      reason = 'paired surface is missing (single-sided write)';
    }

    if (live) return { live: true, sidecarPath, warnedFile, sister, reason, sidecar };
  }
  return { live: false };
}

module.exports = {
  SYSTEM_PLAN_DIR,
  RESOLVED_AMENDMENT_STATES,
  OPERATOR_GATE_STATUSES,
  clientPlanDir,
  resolveTaskPlanPaths,
  assessRepairPlanPairingWarning,
  resolveWriteRoot,
  listAllTaskPlans,
  listAmendments,
  isAmendmentActive,
  extractOperatorGates,
  resolveOperatorGates,
  validateOperatorGates,
  classifyOwnedArtifacts,
  auditOwnedArtifacts
};
