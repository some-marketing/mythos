'use strict';

const path = require('path');

const DEFAULT_SYSTEM_ID = 'Mythos';

function normalizeRepoPath(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/\\/g, '/');
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    if (value === null || value === undefined) continue;
    const normalized = normalizeRepoPath(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function defaultParentScope({ scopeType, clientCode, projectId, systemId }) {
  const resolvedSystemId = systemId || DEFAULT_SYSTEM_ID;
  if (clientCode && projectId) return `client:${clientCode}/project:${projectId}`;
  if (clientCode) return `client:${clientCode}`;
  if (scopeType === 'system') return `system:${resolvedSystemId}`;
  return null;
}

function defaultWorkingSurface({ scopeType, clientCode, projectId, storageRoot, systemId }) {
  const resolvedSystemId = systemId || DEFAULT_SYSTEM_ID;
  if (clientCode && projectId) return `${resolvedSystemId}/clients/${clientCode}/projects/${projectId}`;
  if (clientCode) return `${resolvedSystemId}/clients/${clientCode}`;
  if (storageRoot) return `${resolvedSystemId}/${normalizeRepoPath(storageRoot)}`;
  return `${resolvedSystemId}/${scopeType || 'unknown'}`;
}

/**
 * Build the TaskCustody/1.0 scope identity object for a task plan or one of
 * its companion artifacts. The helper is intentionally deterministic so
 * custody metadata is generated rather than freehand-authored.
 *
 * @param {object} input
 * @param {string} input.taskId
 * @param {string} [input.scopeType]
 * @param {string|null} [input.clientCode]
 * @param {string|null} [input.projectId]
 * @param {string} [input.storageRoot]
 * @param {string} [input.planJsonPath]
 * @param {string} [input.planMdPath]
 * @param {string} [input.sessionOrRunId]
 * @param {string} [input.workstreamScope]
 * @param {string|null} [input.parentScope]
 * @param {string[]} [input.childScopes]
 * @param {string[]} [input.ownedArtifacts]
 * @param {string[]} [input.forbiddenArtifacts]
 * @param {string} [input.systemId]
 * @returns {object}
 */
function buildScopeIdentity(input) {
  const taskId = String((input && input.taskId) || '').trim();
  if (!taskId) throw new Error('buildScopeIdentity requires taskId');

  const scopeType = String((input && input.scopeType) || 'system').trim() || 'system';
  const systemId = String((input && input.systemId) || DEFAULT_SYSTEM_ID).trim() || DEFAULT_SYSTEM_ID;
  const clientCode = input && input.clientCode ? String(input.clientCode) : null;
  const projectId = input && input.projectId ? String(input.projectId) : null;
  const storageRoot = input && input.storageRoot ? normalizeRepoPath(input.storageRoot) : null;
  const sessionOrRunId = input && input.sessionOrRunId
    ? String(input.sessionOrRunId)
    : 'unknown:session-or-run-id-not-provided';

  const ownedArtifacts = uniqueStrings([
    input && input.planJsonPath,
    input && input.planMdPath,
    ...((input && input.ownedArtifacts) || [])
  ]);

  return {
    workstream_scope: String((input && input.workstreamScope) || taskId),
    session_or_run_id: sessionOrRunId,
    working_surface: defaultWorkingSurface({ scopeType, clientCode, projectId, storageRoot, systemId }),
    custody_hierarchy: {
      system_id: systemId,
      client_code: clientCode,
      project_id: projectId,
      task_id: taskId,
      parent_scope: input && Object.prototype.hasOwnProperty.call(input, 'parentScope')
        ? input.parentScope
        : defaultParentScope({ scopeType, clientCode, projectId, systemId }),
      child_scopes: uniqueStrings((input && input.childScopes) || [])
    },
    owned_artifacts: ownedArtifacts,
    forbidden_artifacts: uniqueStrings((input && input.forbiddenArtifacts) || [])
  };
}

function buildScopeIdentityForPlan(plan, options = {}) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('buildScopeIdentityForPlan requires a plan object');
  }

  const taskId = String(plan.task_id || '').trim();
  if (!taskId) throw new Error('buildScopeIdentityForPlan requires plan.task_id');

  const storageRoot = plan.storage_root || options.storageRoot || null;
  const planJsonPath = options.planJsonPath || (
    storageRoot ? path.join(storageRoot, `${taskId}__plan.json`) : null
  );
  const planMdPath = options.planMdPath || (
    storageRoot ? path.join(storageRoot, `${taskId}__plan.md`) : null
  );

  return buildScopeIdentity({
    taskId,
    scopeType: plan.scope_type || options.scopeType,
    clientCode: plan.client_code || options.clientCode || null,
    projectId: plan.project_id || options.projectId || null,
    storageRoot,
    planJsonPath,
    planMdPath,
    sessionOrRunId: options.sessionOrRunId,
    workstreamScope: options.workstreamScope,
    parentScope: options.parentScope,
    childScopes: options.childScopes,
    ownedArtifacts: options.ownedArtifacts,
    forbiddenArtifacts: options.forbiddenArtifacts,
    systemId: options.systemId
  });
}

module.exports = {
  DEFAULT_SYSTEM_ID,
  buildScopeIdentity,
  buildScopeIdentityForPlan
};
