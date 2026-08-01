#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const registry = require('../lib/active-session-registry');

const PROJECT_ROOT = registry.PROJECT_ROOT;
const DEFAULT_LOG_PATH = path.join(
  PROJECT_ROOT,
  '_dev',
  'reports',
  'lifecycle',
  'coordination-dispatcher.jsonl'
);

const TTL_POLICY_CACHE_MS = 60 * 1000;
const DEFAULT_RECOMMENDED_HEARTBEAT_MS = 180 * 1000;
const WRITE_TOOL_NAMES = new Set(['Write', 'Edit', 'MultiEdit']);

let ttlPolicyCache = {
  loadedAtMs: 0,
  activeDir: null,
  policy: null
};

let lastHeartbeatAtMs = 0;

function nowIso(context = {}) {
  if (context.now instanceof Date) {
    return context.now.toISOString();
  }
  if (typeof context.now === 'string') {
    return context.now;
  }
  return new Date().toISOString();
}

function nowMs(context = {}) {
  if (context.now instanceof Date) {
    return context.now.getTime();
  }
  if (typeof context.now === 'string') {
    const parsed = Date.parse(context.now);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonl(filePath, entry) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
}

function logError(event, error, partialState = {}, context = {}) {
  const logPath = path.resolve(
    (context.env && context.env.MYTHOS_COORDINATION_DISPATCHER_LOG) ||
      process.env.MYTHOS_COORDINATION_DISPATCHER_LOG ||
      DEFAULT_LOG_PATH
  );

  try {
    writeJsonl(logPath, {
      ts: nowIso(context),
      event,
      error: {
        message: error && error.message ? error.message : String(error),
        stack: error && error.stack ? error.stack : null
      },
      partial_state: partialState || {}
    });
  } catch (logErrorValue) {
    // Hook must never fail the harness. If logging fails, stay silent.
  }
}

function safeReadStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (error) {
    return '';
  }
}

function tryParseJson(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function parseHookInput(context = {}) {
  if (context.input && typeof context.input === 'object') {
    return context.input;
  }

  const stdinParsed = tryParseJson(context.stdin === undefined ? safeReadStdin() : context.stdin);
  if (stdinParsed) {
    return stdinParsed;
  }

  const env = context.env || process.env;
  return tryParseJson(env.CLAUDE_TOOL_INPUT || env.MYTHOS_HOOK_INPUT || '') || {};
}

function getToolName(context = {}) {
  const env = context.env || process.env;
  const input = parseHookInput(context);
  return String(
    context.toolName ||
      env.CLAUDE_TOOL_NAME ||
      env.MYTHOS_TOOL_NAME ||
      input.tool_name ||
      input.toolName ||
      input.name ||
      input.tool ||
      ''
  ).trim();
}

function getActiveDir(registryModule = registry) {
  return registryModule.getActiveSessionDir();
}

function currentIdPath(registryModule = registry) {
  return path.join(getActiveDir(registryModule), '_current-id');
}

function readCurrentId(registryModule = registry) {
  const filePath = currentIdPath(registryModule);
  try {
    const value = fs.readFileSync(filePath, 'utf8').trim();
    return value || null;
  } catch (error) {
    return null;
  }
}

function writeCurrentId(sessionId, registryModule = registry) {
  const filePath = currentIdPath(registryModule);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${sessionId}\n`);
}

function resolveSessionId(context = {}) {
  const env = context.env || process.env;
  const registryModule = context.registry || registry;
  return (
    context.sessionId ||
    env.CLAUDE_SESSION_ID ||
    env.MYTHOS_SESSION_ID ||
    readCurrentId(registryModule) ||
    null
  );
}

function resolveOrMintSessionId(context = {}) {
  const env = context.env || process.env;
  return context.sessionId || env.CLAUDE_SESSION_ID || env.MYTHOS_SESSION_ID || crypto.randomUUID();
}

function gitCurrentBranch() {
  try {
    return cp.execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      timeout: 50,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (error) {
    return null;
  }
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return String(value);
}

function splitWorkingSurface(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function actorTypeFromActorId(actorId) {
  if (!actorId) {
    return null;
  }
  return String(actorId).split(':')[0] || null;
}

function resolveRegistrationMetadata(context = {}) {
  const env = context.env || process.env;
  const actorId = normalizeOptionalString(
    context.actorId ||
      env.MYTHOS_ACTOR_ID ||
      env.CLAUDE_ACTOR_ID ||
      env.CLAUDE_MODEL_ID ||
      'claude-opus-4-7'
  );

  const actorType = normalizeOptionalString(
    context.actorType ||
      env.MYTHOS_ACTOR_TYPE ||
      env.CLAUDE_ACTOR_TYPE ||
      actorTypeFromActorId(actorId) ||
      'claude-opus-4-7'
  );

  const currentBranch = normalizeOptionalString(
    context.currentBranch ||
      env.MYTHOS_CURRENT_BRANCH ||
      env.CLAUDE_CURRENT_BRANCH ||
      gitCurrentBranch()
  );

  return {
    actorId,
    actorType,
    currentBranch,
    workingSurface: splitWorkingSurface(context.workingSurface || env.MYTHOS_WORKING_SURFACE)
  };
}

function loadDispatcherTtlPolicy(context = {}) {
  const registryModule = context.registry || registry;
  const activeDir = getActiveDir(registryModule);
  const loadedAtMs = nowMs(context);

  if (
    ttlPolicyCache.policy &&
    ttlPolicyCache.activeDir === activeDir &&
    loadedAtMs - ttlPolicyCache.loadedAtMs < TTL_POLICY_CACHE_MS
  ) {
    return ttlPolicyCache.policy;
  }

  let policy = null;
  try {
    policy = readJson(path.join(activeDir, '_ttl-policy.json'));
  } catch (error) {
    policy = {
      default_ttl_ms: 30 * 60 * 1000,
      policies: {}
    };
  }

  ttlPolicyCache = {
    loadedAtMs,
    activeDir,
    policy
  };
  return policy;
}

function recommendedHeartbeatMsForSession(session, context = {}) {
  const policy = loadDispatcherTtlPolicy(context);
  const actorType = session && session.actor_type;
  const actorPolicy = actorType && policy.policies ? policy.policies[actorType] : null;
  const value = actorPolicy ? Number(actorPolicy.recommended_heartbeat_ms) : NaN;
  return Number.isFinite(value) ? value : DEFAULT_RECOMMENDED_HEARTBEAT_MS;
}

function heartbeatCurrentSession(context = {}) {
  const registryModule = context.registry || registry;
  const sessionId = resolveSessionId({ ...context, registry: registryModule });
  if (!sessionId) {
    return null;
  }

  // Self-heal: if _current-id points at a session whose registry file was
  // cleaned up (test teardown races, manual rmdir, etc.), don't throw —
  // skip the heartbeat. SessionStart on next session-cycle will overwrite
  // _current-id and a fresh registration will land. Avoids the noisy
  // "active session not found" error stream observed in dry-run.
  const session = registryModule.getSession(sessionId);
  if (!session) {
    return null;
  }

  const result = registryModule.heartbeat(sessionId, { now: nowIso(context) });
  lastHeartbeatAtMs = nowMs(context);
  return result;
}

function maybeHeartbeatCurrentSession(context = {}) {
  const registryModule = context.registry || registry;
  const sessionId = resolveSessionId({ ...context, registry: registryModule });
  if (!sessionId) {
    return null;
  }

  const session = registryModule.getSession(sessionId);
  if (!session) {
    return null;
  }

  const elapsedMs = nowMs(context) - lastHeartbeatAtMs;
  if (lastHeartbeatAtMs === 0 || elapsedMs >= recommendedHeartbeatMsForSession(session, context)) {
    return heartbeatCurrentSession(context);
  }

  return {
    skipped: true,
    reason: 'debounced',
    session_id: sessionId
  };
}

function scanLiveSignals(context = {}) {
  return { matched: [] };
}

function completeAllSatisfied(context = {}) {
  return { completed: [] };
}

function handleSessionStart(context = {}) {
  const registryModule = context.registry || registry;
  const sessionId = resolveOrMintSessionId({ ...context, registry: registryModule });
  const metadata = resolveRegistrationMetadata(context);

  writeCurrentId(sessionId, registryModule);

  let sweep = null;
  if (typeof registryModule.sweepExpired === 'function') {
    try {
      sweep = registryModule.sweepExpired({ now: nowIso(context) });
    } catch (error) {
      sweep = { skipped: true, reason: 'sweep-failed', error: error.message };
    }
  }

  const registered = registryModule.registerSession({
    sessionId,
    actorId: metadata.actorId,
    actorType: metadata.actorType,
    currentBranch: metadata.currentBranch,
    workingSurface: metadata.workingSurface,
    expectedIntervalMs: context.expectedIntervalMs,
    now: nowIso(context)
  });

  if (sweep) {
    registered.sweep_summary = {
      swept: Array.isArray(sweep.swept) ? sweep.swept.length : 0,
      errors: Array.isArray(sweep.errors) ? sweep.errors.length : 0
    };
  }

  return registered;
}

function extractSlashCommand(promptText) {
  if (!promptText || typeof promptText !== 'string') {
    return null;
  }
  const trimmed = promptText.trim();
  const match = trimmed.match(/^\/([a-zA-Z][a-zA-Z0-9:_-]*)(?:\s+([\s\S]*))?$/);
  if (!match) {
    return null;
  }
  const command = `/${match[1]}`;
  const scope = (match[2] || '').trim();
  return { command, scope, raw: trimmed };
}

function updateCurrentTaskFromPrompt(context = {}) {
  const registryModule = context.registry || registry;
  const sessionId = resolveSessionId({ ...context, registry: registryModule });
  if (!sessionId || typeof registryModule.setCurrentTask !== 'function') {
    return null;
  }

  const session = registryModule.getSession(sessionId);
  if (!session) {
    return null;
  }

  const input = parseHookInput(context);
  const promptText = (input && (input.prompt || input.user_prompt || input.message || input.text)) || '';
  const parsed = extractSlashCommand(promptText);
  if (!parsed) {
    return { skipped: true, reason: 'non-slash-prompt' };
  }

  const taskText = parsed.scope ? `${parsed.command} ${parsed.scope}` : parsed.command;
  try {
    return registryModule.setCurrentTask(sessionId, taskText.slice(0, 200), {
      command: parsed.command,
      scope: parsed.scope || undefined,
      now: nowIso(context)
    });
  } catch (error) {
    return { skipped: true, reason: 'set-task-failed', error: error.message };
  }
}

function handleUserPromptSubmit(context = {}) {
  const heartbeatResult = heartbeatCurrentSession(context);
  const taskResult = updateCurrentTaskFromPrompt(context);
  const scanResult = scanLiveSignals(context);
  return {
    heartbeat: heartbeatResult,
    task: taskResult,
    scan: scanResult
  };
}

function handlePreToolUse(context = {}) {
  const toolName = getToolName(context);
  if (toolName !== 'Bash') {
    return { skipped: true, reason: 'non-bash-tool', tool_name: toolName };
  }

  return {
    heartbeat: heartbeatCurrentSession(context)
  };
}

function handlePostToolUse(context = {}) {
  const toolName = getToolName(context);
  const heartbeatResult = WRITE_TOOL_NAMES.has(toolName)
    ? heartbeatCurrentSession(context)
    : maybeHeartbeatCurrentSession(context);

  return {
    heartbeat: heartbeatResult,
    scan: scanLiveSignals(context),
    complete: completeAllSatisfied(context)
  };
}

function handleSessionEnd(context = {}) {
  const registryModule = context.registry || registry;
  const sessionId = resolveSessionId({ ...context, registry: registryModule });
  if (!sessionId) {
    return null;
  }

  return registryModule.closeSession(sessionId, {
    now: nowIso(context),
    reason: 'clean-shutdown'
  });
}

function dispatchEvent(eventName, context = {}) {
  const event = eventName || (context.env || process.env).MYTHOS_HOOK_EVENT;
  try {
    if (event === 'SessionStart') {
      return handleSessionStart(context);
    }
    if (event === 'UserPromptSubmit') {
      return handleUserPromptSubmit(context);
    }
    if (event === 'PreToolUse') {
      return handlePreToolUse(context);
    }
    if (event === 'PostToolUse') {
      return handlePostToolUse(context);
    }
    if (event === 'SubagentStop') {
      return handlePostToolUse(context); // Alias for now as it shares logic
    }
    if (event === 'SessionEnd') {
      return handleSessionEnd(context);
    }
    return {
      skipped: true,
      reason: 'unknown-event',
      event
    };
  } catch (error) {
    logError(event, error, {
      session_id: resolveSessionId(context),
      tool_name: getToolName(context)
    }, context);
    return {
      status: 'error',
      event,
      message: error.message
    };
  }
}

function main() {
  dispatchEvent(process.env.MYTHOS_HOOK_EVENT, {
    env: process.env
  });
}

function _resetForTests() {
  ttlPolicyCache = {
    loadedAtMs: 0,
    activeDir: null,
    policy: null
  };
  lastHeartbeatAtMs = 0;
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_LOG_PATH,
  dispatchEvent,
  handleSessionStart,
  handleUserPromptSubmit,
  handlePreToolUse,
  handlePostToolUse,
  handleSessionEnd,
  scanLiveSignals,
  completeAllSatisfied,
  extractSlashCommand,
  updateCurrentTaskFromPrompt,
  _resetForTests
};
