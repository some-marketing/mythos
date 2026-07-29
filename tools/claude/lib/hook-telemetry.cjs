'use strict';

const fs = require('fs');
const path = require('path');

// env-path-hardening s2: __dirname resolution was already correct, but this
// writer mkdir-p's its lifecycle log dir before any validity check. Route
// through the ONE canonical source so an anomalous resolved root is caught
// (anchor-validated) rather than silently mkdir-recreated. circuit-breaker
// during staged rollout; promoted to 'hard' after s5 clean-pass.
const { resolveCanonicalRoot } = require('../../lib/canonical-root.cjs');
const PROJECT_ROOT = resolveCanonicalRoot({ mode: 'hard' });
const DEFAULT_LOG_PATH = path.join(PROJECT_ROOT, '_dev', 'reports', 'lifecycle', 'claude-hook-events.jsonl');

function appendHookEvent(entry) {
  const payload = {
    timestamp: new Date().toISOString(),
    source: String(entry.source || 'claude-settings-hook'),
    matcher: String(entry.matcher || ''),
    event: String(entry.event || ''),
    detail: entry.detail && typeof entry.detail === 'object' ? entry.detail : {}
  };

  // env-override containment (env-path-hardening codex-bridge review 20260520T164108Z):
  // MYTHOS_HOOK_EVENT_LOG previously bypassed the PROJECT_ROOT canonical-root check —
  // a wrong-rooted override could mkdir under the abandoned path even with PROJECT_ROOT
  // in hard mode. Constrain the override to the validated canonical root; fall back
  // to DEFAULT_LOG_PATH with a loud marker if it escapes.
  let logPath = DEFAULT_LOG_PATH;
  const override = process.env.MYTHOS_HOOK_EVENT_LOG;
  if (override) {
    const resolved = path.resolve(override);
    const projectRootWithSep = PROJECT_ROOT.endsWith(path.sep) ? PROJECT_ROOT : PROJECT_ROOT + path.sep;
    if (resolved === PROJECT_ROOT || resolved.startsWith(projectRootWithSep)) {
      logPath = resolved;
    } else {
      process.stderr.write(`[canonical-root] hook-telemetry: MYTHOS_HOOK_EVENT_LOG=${override} escapes PROJECT_ROOT=${PROJECT_ROOT}; falling back to DEFAULT_LOG_PATH\n`);
    }
  }
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(payload) + '\n');
  return logPath;
}

module.exports = {
  DEFAULT_LOG_PATH,
  appendHookEvent
};
