'use strict';

// Shared session-id resolver. Process-scoped environment values are
// authoritative; sidecar and registry values are best-effort display data.

const fs = require('fs');
const path = require('path');

const ENV_PRIORITY = Object.freeze([
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_SESSION_ID',
  'MYTHOS_SESSION_ID',
  'CODEX_SESSION_ID',
  'SM_OS_SESSION_ID'
]);

function loadRegistry() {
  try {
    return require('./active-session-registry.js');
  } catch (_) {
    return null;
  }
}

function isRegistryLive(registry, sessionId) {
  try {
    return registry.listActive({}).some((s) => String(s.session_id) === String(sessionId));
  } catch (_) {
    return false;
  }
}

function resolveSessionId(projectRoot) {
  for (const name of ENV_PRIORITY) {
    const value = process.env[name];
    if (value && String(value).trim()) {
      return { session_id: String(value).trim(), session_id_source: 'env', custody_grade: 'authoritative' };
    }
  }

  const registry = loadRegistry();
  if (registry) {
    try {
      const sidecarPath = path.join(projectRoot, '_dev', 'state', 'active-sessions', '_current-id');
      const sidecarId = fs.existsSync(sidecarPath) ? fs.readFileSync(sidecarPath, 'utf8').trim() : '';
      if (sidecarId && isRegistryLive(registry, sidecarId)) {
        return { session_id: sidecarId, session_id_source: 'active-session-sidecar', custody_grade: 'best_effort' };
      }
    } catch (_) { /* fall through to registry */ }

    try {
      const active = registry.listActive({});
      if (active.length === 1 && active[0].session_id) {
        return { session_id: active[0].session_id, session_id_source: 'sole-active-session', custody_grade: 'best_effort' };
      }
      if (active.length > 1) {
        const newest = active.slice().sort((a, b) => String(b.last_heartbeat || '').localeCompare(String(a.last_heartbeat || '')))[0];
        if (newest && newest.session_id) {
          return { session_id: newest.session_id, session_id_source: 'newest-active-session', custody_grade: 'best_effort' };
        }
      }
    } catch (_) { /* registry unreadable — return unavailable */ }
  }

  return { session_id: null, session_id_source: 'unavailable', custody_grade: 'none' };
}

function assertAuthoritativeSessionIdentity(projectRoot, operation = 'operation') {
  const identity = resolveSessionId(projectRoot);
  if (identity.custody_grade === 'authoritative' && identity.session_id) return identity;

  const reason = identity.custody_grade === 'best_effort'
    ? 'best-effort session identity cannot authorize this operation'
    : 'authoritative session identity is unavailable';
  const error = new Error(`SESSION_IDENTITY_BLOCKED: ${operation} requires an authoritative session identity; ${reason}`);
  error.code = 'SESSION_IDENTITY_BLOCKED';
  error.identity = identity;
  error.operation = operation;
  throw error;
}

module.exports = { resolveSessionId, assertAuthoritativeSessionIdentity, ENV_PRIORITY };
