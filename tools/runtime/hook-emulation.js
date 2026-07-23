'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { appendHookEvent } = require('../claude/lib/hook-telemetry.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CLAUDE_SETTINGS_RELATIVE_PATH = path.join('.claude', 'settings.json');
const CREDENTIAL_VERIFY_COMMAND_FRAGMENT = path.join('tools', 'boot', 'verify-credentials.cjs').replace(/\\/g, '/');
const VISUAL_REVIEW_COMMAND_FRAGMENT = path.join('tools', 'verify', 'visual-review-gate.cjs').replace(/\\/g, '/');

const SUBAGENT_REMINDER = 'GUARDRAIL REMINDER: Task-subagent nesting is capped at depth 2. Beyond depth 2, route through either (a) the Ollama local-subagent lane — WEAK distinctness, depth 3 max, non-consequential work only — or (b) /dispatch-bridge to a distinct provider — STRONG distinctness, arbitrary depth OK. Deep same-provider chains are one voice and do not satisfy the Cross-Verification Law. (guardrails.md § Parallel subagent rules, rule 6)';
const PLAN_MODE_REMINDER = 'GUARDRAIL REMINDER: Plan mode artifacts in this project are routing documents. They describe which Mythos scripts to invoke (node tools/planning/assess-similarity.js, node tools/signals/follow-signal.js), not freestanding execution plans. Do not define stages or exit criteria directly — route through the planning tools. (guardrails.md § Planning Policy)';
const DEBRIEF_REMINDER = 'GUARDRAIL REMINDER: Have you debriefed this work? Rule 8 requires a debrief before committing. Write outcome_delta, divergences, and corrections to the plan artifact or to _dev/reports/analysis/ before this commit. (guardrails.md § Non-negotiable Rules, rule 8).';

const DANGEROUS_COMMAND_REGISTRY = [
  { label: 'rm -rf', all: [' rm -rf '] },
  { label: 'git push --force', all: [' git push ', ' --force '] },
  { label: 'git reset --hard', all: [' git reset ', ' --hard '] },
  { label: 'DROP TABLE', all: [' drop table '] },
  { label: 'DELETE FROM', all: [' delete from '] },
  { label: 'chmod 777', all: [' chmod 777 '] },
  { label: 'curl | sh', all: [' curl '], any: [' | sh ', ' | bash '] },
  { label: 'eval', all: [' eval '] },
  { label: '> /dev/sda', all: [' > /dev/sda '] },
  { label: 'mkfs', any: [' mkfs ', ' mkfs.', '/mkfs.'] },
  { label: 'kill -9', all: [' kill -9 '] },
  { label: 'pkill', all: [' pkill '] }
];

function normalizeCommand(command) {
  return ` ${String(command || '')
    .toLowerCase()
    .split('|')
    .map((part) => part.trim())
    .join(' | ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

function detectDangerousCommand(command) {
  const normalized = normalizeCommand(command);
  return DANGEROUS_COMMAND_REGISTRY.find((item) => {
    const allMatch = !item.all || item.all.every((token) => normalized.includes(token.toLowerCase()));
    const anyMatch = !item.any || item.any.some((token) => normalized.includes(token.toLowerCase()));
    return allMatch && anyMatch;
  }) || null;
}

function buildDangerousCommandWarning(label) {
  return `GUARDRAIL: Dangerous command detected — [${label}]. Confirm with the operator before executing. (guardrails.md § Non-negotiable Rules, rule 5).`;
}

function isGitCommitCommand(command) {
  return /^git commit(?:\s|$)/.test(String(command || '').trim());
}

function frameworkRelativePath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  if (normalized.includes('/frameworks/')) return normalized.split('/frameworks/')[1];
  if (normalized.startsWith('frameworks/')) return normalized.slice('frameworks/'.length);
  return null;
}

function buildFrameworkChangeNotice(filePath) {
  const relative = frameworkRelativePath(filePath);
  if (!relative) return null;
  return `NOTICE: Framework file changed (${relative}). Run npm run manifest:sync if prompt chain, guardrails, or manifest changed.`;
}

function appendCodexEvent(matcher, event, detail = {}) {
  appendHookEvent({
    source: 'codex-hook-emulation',
    matcher,
    event,
    detail
  });
}

function resolveProjectRoot(projectRoot) {
  return path.resolve(projectRoot || PROJECT_ROOT);
}

function claudeSettingsPathFor(projectRoot) {
  return path.join(resolveProjectRoot(projectRoot), CLAUDE_SETTINGS_RELATIVE_PATH);
}

function scriptPathFor(projectRoot, ...segments) {
  return path.join(resolveProjectRoot(projectRoot), ...segments);
}

function readClaudeSettings(projectRoot, settingsPath) {
  const resolvedPath = settingsPath
    ? path.resolve(settingsPath)
    : claudeSettingsPathFor(projectRoot);

  if (!fs.existsSync(resolvedPath)) return {};

  try {
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function hookEntriesFor(settings, key) {
  if (!settings || typeof settings !== 'object') return [];
  if (!settings.hooks || typeof settings.hooks !== 'object') return [];
  return Array.isArray(settings.hooks[key]) ? settings.hooks[key] : [];
}

function commandHooksForEntry(entry) {
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.hooks)) return [];
  return entry.hooks.filter((hook) => (
    hook &&
    hook.type === 'command' &&
    typeof hook.command === 'string' &&
    hook.command.trim()
  ));
}

function matcherIncludesTool(matcher, toolName) {
  const normalizedTool = String(toolName || '').trim();
  return String(matcher || '')
    .split('|')
    .map((token) => token.trim())
    .filter(Boolean)
    .some((token) => {
      if (token === '*' || token === '.*') return true;
      if (token === normalizedTool) return true;
      try {
        return new RegExp(`^(?:${token})$`).test(normalizedTool);
      } catch {
        return false;
      }
    });
}

function selectSessionStartHooks(settings) {
  return hookEntriesFor(settings, 'SessionStart').flatMap((entry) => commandHooksForEntry(entry));
}

function selectSessionEndHooks(settings) {
  return hookEntriesFor(settings, 'SessionEnd').flatMap((entry) => commandHooksForEntry(entry));
}

function selectUserPromptSubmitHooks(settings) {
  return hookEntriesFor(settings, 'UserPromptSubmit').flatMap((entry) => commandHooksForEntry(entry));
}

function selectPostToolUseHooks(settings, toolName) {
  return hookEntriesFor(settings, 'PostToolUse')
    .filter((entry) => matcherIncludesTool(entry.matcher, toolName))
    .flatMap((entry) => commandHooksForEntry(entry));
}

function buildClaudeToolInput({ toolName = '', filePath = '' } = {}) {
  return {
    tool_name: String(toolName || ''),
    file_path: String(filePath || ''),
    tool_input: {
      file_path: String(filePath || '')
    }
  };
}

function resolveHookFilePath(filePath, cwd, projectRoot) {
  if (!filePath) return '';
  return path.resolve(cwd || resolveProjectRoot(projectRoot), filePath);
}

function normalizeHookTimeoutMs(timeoutSeconds) {
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) return undefined;
  return timeoutSeconds * 1000;
}

function commandIncludesFragment(command, fragment) {
  return String(command || '').replace(/\\/g, '/').includes(fragment);
}

function hookInvokesVisualReviewGate(hook) {
  return commandIncludesFragment(hook && hook.command, VISUAL_REVIEW_COMMAND_FRAGMENT);
}

function hookInvokesCredentialVerify(hook) {
  return commandIncludesFragment(hook && hook.command, CREDENTIAL_VERIFY_COMMAND_FRAGMENT);
}

function mergeExitCode(currentExitCode, nextExitCode) {
  if (currentExitCode !== 0) return currentExitCode;
  return nextExitCode || 0;
}

// ---------------------------------------------------------------------------
// Genuine session context for emulated lifecycle payloads (tier-s0a).
//
// The SessionStart payload previously shipped as `{}`, so the tier stamp
// (tools/kernel/hooks/session-start-tier-stamp.cjs) could never resolve the
// coordinating model under codex emulation and silently stamped
// tier=scaffold with no provenance (convene 20260611T130035Z, condition 2;
// harness-fanout finding 2026-06-11). These resolvers pull model identity
// and session id from the emulator's actual context: explicit caller
// options first, then the codex runtime environment. A model that cannot
// be genuinely resolved is OMITTED (never fabricated) so the tier stamp
// records tier_provenance=fallback-scaffold instead of a silent default.
// ---------------------------------------------------------------------------

function resolveCodexSessionModel(explicitModel) {
  return String(
    explicitModel ||
    process.env.CODEX_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.MYTHOS_MODEL ||
    ''
  ).trim();
}

function resolveCodexSessionId(explicitSessionId) {
  const fromContext = String(
    explicitSessionId ||
    process.env.MYTHOS_SESSION_ID ||
    process.env.CODEX_SESSION_ID ||
    ''
  ).trim();
  return fromContext || `codex-hook-emulation:${Date.now()}:${process.pid}`;
}

function buildCodexSessionStartPayload({ model, sessionId, processTier } = {}) {
  const payload = {
    session_id: resolveCodexSessionId(sessionId)
  };
  const resolvedModel = resolveCodexSessionModel(model);
  if (resolvedModel) payload.model = resolvedModel;
  const declared = String(processTier || process.env.MYTHOS_PROCESS_TIER || '').trim();
  if (declared) payload.process_tier = declared;
  return payload;
}

function runNodeScript(scriptPath, options = {}) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: options.cwd || resolveProjectRoot(options.projectRoot),
    env: { ...process.env, ...(options.env || {}) },
    input: options.input,
    encoding: 'utf8'
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: typeof result.status === 'number' ? result.status : 1
  };
}

function runCommandHook(hook, options = {}) {
  const timeoutMs = normalizeHookTimeoutMs(hook && hook.timeout);
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const payloadString = JSON.stringify(options.payload || {});
  const stdin = typeof options.stdin === 'string' ? options.stdin : payloadString;
  const result = spawnSync('/bin/bash', ['-lc', hook.command], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectRoot,
      CLAUDE_TOOL_INPUT: payloadString
    },
    input: stdin,
    encoding: 'utf8',
    timeout: timeoutMs
  });

  const stderrParts = [];
  if (result.stderr) stderrParts.push(result.stderr.trimEnd());
  if (result.error && result.error.code === 'ETIMEDOUT') {
    stderrParts.push(`Hook timed out after ${timeoutMs}ms: ${hook.command}`);
  }

  return {
    stdout: result.stdout || '',
    stderr: stderrParts.join('\n'),
    exitCode: typeof result.status === 'number'
      ? result.status
      : (result.error && result.error.code === 'ETIMEDOUT' ? 124 : 1)
  };
}

function runCommandHooks(hooks, options = {}) {
  const output = [];
  let exitCode = 0;

  for (const hook of hooks) {
    const result = runCommandHook(hook, options);
    if (result.stdout) output.push(result.stdout.trimEnd());
    if (result.stderr) output.push(result.stderr.trimEnd());
    exitCode = mergeExitCode(exitCode, result.exitCode);
  }

  return {
    stdout: output.filter(Boolean).join('\n'),
    exitCode
  };
}

function runCodexHook({ event, command = '', filePath = '', cwd, projectRoot: explicitProjectRoot, model, sessionId, processTier } = {}) {
  const projectRoot = resolveProjectRoot(explicitProjectRoot || PROJECT_ROOT);
  const output = [];
  let exitCode = 0;

  switch (event) {
    case 'SessionStart':
    case 'session-start': {
      const settings = readClaudeSettings(projectRoot);
      const sessionHooks = selectSessionStartHooks(settings);

      if (!sessionHooks.some((hook) => hookInvokesCredentialVerify(hook))) {
        appendCodexEvent('SessionStart', 'credential-verification-started');
        const result = runNodeScript(scriptPathFor(projectRoot, 'tools', 'boot', 'verify-credentials.cjs'), {
          cwd: projectRoot,
          projectRoot
        });
        if (result.stdout) output.push(result.stdout.trimEnd());
        if (result.stderr) output.push(result.stderr.trimEnd());
        exitCode = mergeExitCode(exitCode, result.exitCode);
      }

      // tier-s0a: carry genuine model identity + session id so the
      // SessionStart tier stamp resolves a real tier with provenance
      // instead of fallback scaffold from an empty payload.
      const payload = buildCodexSessionStartPayload({ model, sessionId, processTier });
      const settingsResult = runCommandHooks(sessionHooks, {
        projectRoot,
        payload,
        stdin: JSON.stringify(payload)
      });
      if (settingsResult.stdout) output.push(settingsResult.stdout);
      exitCode = mergeExitCode(exitCode, settingsResult.exitCode);
      break;
    }
    case 'userprompt-submit':
    case 'UserPromptSubmit': {
      const settings = readClaudeSettings(projectRoot);
      const userPromptHooks = selectUserPromptSubmitHooks(settings);
      const payload = {
        prompt: String(command || ''),
        session_id: resolveCodexSessionId(sessionId)
      };
      const settingsResult = runCommandHooks(userPromptHooks, {
        projectRoot,
        payload,
        stdin: JSON.stringify(payload)
      });
      if (settingsResult.stdout) output.push(settingsResult.stdout);
      exitCode = mergeExitCode(exitCode, settingsResult.exitCode);
      break;
    }
    case 'SessionEnd':
    case 'session-end': {
      const settings = readClaudeSettings(projectRoot);
      const sessionEndHooks = selectSessionEndHooks(settings);
      const payload = {
        session_id: resolveCodexSessionId(sessionId)
      };
      const settingsResult = runCommandHooks(sessionEndHooks, {
        projectRoot,
        payload,
        stdin: JSON.stringify(payload)
      });
      if (settingsResult.stdout) output.push(settingsResult.stdout);
      exitCode = mergeExitCode(exitCode, settingsResult.exitCode);
      break;
    }
    case 'enter-plan-mode': {
      appendCodexEvent('EnterPlanMode', 'plan-mode-entered', { policy: 'routing-document' });
      output.push(PLAN_MODE_REMINDER);
      break;
    }
    case 'pre-agent': {
      appendCodexEvent('Agent', 'subagent-reminder-emitted');
      output.push(SUBAGENT_REMINDER);
      try {
        const { observeContextBudget, formatContextBudgetSummary } = require('../context/context-budget.cjs');
        const budget = observeContextBudget(projectRoot, {
          role: 'actor',
          source: 'codex-pre-agent',
          proxy: {
            substantialImplementationAndReviewLoop: false
          }
        });
        output.push(formatContextBudgetSummary(budget));
      } catch (err) {
        output.push(`CONTEXT BUDGET: unavailable (${err && err.message ? err.message : String(err)})`);
      }
      try {
        const { createActorAwarenessPacket, formatActorPacketSummary } = require('../context/repo-awareness.cjs');
        const packet = createActorAwarenessPacket(projectRoot, {
          role: 'actor',
          task: command || 'pre-agent dispatch',
          source: 'codex-pre-agent',
          includeBoundaryDetails: false
        });
        output.push(formatActorPacketSummary(packet));
      } catch (err) {
        output.push(`ACTOR AWARENESS: unavailable (${err && err.message ? err.message : String(err)})`);
      }
      break;
    }
    case 'pre-bash': {
      const hit = detectDangerousCommand(command);
      if (hit) {
        appendCodexEvent('Bash', 'dangerous-command-detected', { pattern: hit.label });
        output.push(buildDangerousCommandWarning(hit.label));
      }
      if (isGitCommitCommand(command)) {
        appendCodexEvent('Bash', 'debrief-reminder-emitted', { trigger: 'git-commit' });
        output.push(DEBRIEF_REMINDER);
      }
      break;
    }
    case 'post-write':
    case 'post-edit': {
      const toolName = event === 'post-edit' ? 'Edit' : 'Write';
      const absoluteFilePath = resolveHookFilePath(filePath, cwd, projectRoot);
      const payload = buildClaudeToolInput({ toolName, filePath: absoluteFilePath });
      const settings = readClaudeSettings(projectRoot);
      const postToolHooks = selectPostToolUseHooks(settings, toolName);

      if (postToolHooks.length === 0) {
        const notice = buildFrameworkChangeNotice(absoluteFilePath);
        if (notice) output.push(notice);
      }

      const settingsResult = runCommandHooks(postToolHooks, {
        projectRoot,
        payload,
        stdin: JSON.stringify(payload)
      });
      if (settingsResult.stdout) output.push(settingsResult.stdout);
      exitCode = mergeExitCode(exitCode, settingsResult.exitCode);

      if (toolName === 'Write' && !postToolHooks.some((hook) => hookInvokesVisualReviewGate(hook))) {
        const gateResult = runNodeScript(scriptPathFor(projectRoot, 'tools', 'verify', 'visual-review-gate.cjs'), {
          cwd: projectRoot,
          projectRoot,
          env: {
            CLAUDE_TOOL_INPUT: JSON.stringify(payload)
          }
        });

        if (gateResult.stdout) output.push(gateResult.stdout.trimEnd());
        if (gateResult.stderr) output.push(gateResult.stderr.trimEnd());
        exitCode = mergeExitCode(exitCode, gateResult.exitCode);
      }
      break;
    }
    case 'SubagentStop': {
      const settings = readClaudeSettings(projectRoot);
      const subagentHooks = hookEntriesFor(settings, 'SubagentStop').flatMap((entry) => commandHooksForEntry(entry));
      
      const payload = {
        agent_name: command, // Re-using command arg as agent name
        reason: 'codex-managed-dispatch'
      };

      const settingsResult = runCommandHooks(subagentHooks, {
        projectRoot,
        payload,
        stdin: JSON.stringify(payload)
      });
      if (settingsResult.stdout) output.push(settingsResult.stdout);
      exitCode = mergeExitCode(exitCode, settingsResult.exitCode);
      break;
    }
    default:
      output.push(`Unknown Codex hook event: ${event}`);
      exitCode = 1;
  }

  return {
    stdout: output.filter(Boolean).join('\n'),
    exitCode
  };
}

// =============================================================================
// Layer 3 wiring — coordination-dispatcher emit() bridge
// =============================================================================
// This block routes Codex managed-runtime lifecycle events to the same
// coordination-dispatcher that .claude/settings.local.json hooks invoke.
// Cluster A (codex) is authoring tools/sessions/hooks/coordination-dispatcher.js;
// Cluster C (this file) just calls it. If the path doesn't exist yet, emit()
// degrades to a no-op that still records the attempt to the lifecycle log.
//
// Failure isolated: dispatcher errors NEVER propagate. We log and continue.
// Spec: _dev/reports/analysis/codex-bridge-response__layer-3-wiring-self-driving-protocol.md
// -----------------------------------------------------------------------------

const COORDINATION_DISPATCHER_RELATIVE_PATH = path.join(
  'tools', 'sessions', 'hooks', 'coordination-dispatcher.js'
);
const CODEX_LIFECYCLE_LOG_RELATIVE_PATH = path.join(
  '_dev', 'reports', 'lifecycle', 'codex-hook-emulation.jsonl'
);

const CODEX_LIFECYCLE_EVENTS = Object.freeze([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'SubagentStop',
  'SessionEnd'
]);

function isValidLifecycleEvent(eventName) {
  return CODEX_LIFECYCLE_EVENTS.includes(String(eventName || ''));
}

function coordinationDispatcherPathFor(projectRoot) {
  return path.join(resolveProjectRoot(projectRoot), COORDINATION_DISPATCHER_RELATIVE_PATH);
}

function codexLifecycleLogPathFor(projectRoot) {
  return path.join(resolveProjectRoot(projectRoot), CODEX_LIFECYCLE_LOG_RELATIVE_PATH);
}

function ensureLifecycleLogDir(projectRoot) {
  const logPath = codexLifecycleLogPathFor(projectRoot);
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
  } catch {
    // Directory creation failure must not crash a managed session.
  }
  return logPath;
}

function appendLifecycleLog(projectRoot, entry) {
  const logPath = ensureLifecycleLogDir(projectRoot);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    source: 'codex-hook-emulation.emit',
    ...entry
  }) + '\n';
  try {
    fs.appendFileSync(logPath, line, 'utf8');
  } catch {
    // Log-write failure is itself isolated — never throw out of emit().
  }
  return logPath;
}

/**
 * Emit a coordination-dispatcher hook event from the Codex managed runtime.
 *
 * @param {string} eventName One of SessionStart | UserPromptSubmit | PreToolUse | PostToolUse | SessionEnd
 * @param {object} env       Caller-supplied env vars merged into the dispatcher process env.
 *                           Conventional keys: sessionId, actorId, toolName, filePath, cwd.
 * @param {object} options   { projectRoot, dispatcherPath, runner } — runner & dispatcherPath
 *                           are dependency injection seams for tests.
 * @returns {{ok:boolean, exitCode:number, dispatcherExists:boolean, error:?string}}
 */
function emit(eventName, env = {}, options = {}) {
  const projectRoot = resolveProjectRoot(options.projectRoot || PROJECT_ROOT);
  const dispatcherPath = options.dispatcherPath || coordinationDispatcherPathFor(projectRoot);

  if (!isValidLifecycleEvent(eventName)) {
    appendLifecycleLog(projectRoot, {
      event: eventName,
      ok: false,
      reason: 'invalid-event-name'
    });
    return { ok: false, exitCode: 1, dispatcherExists: false, error: `invalid event ${eventName}` };
  }

  const dispatcherExists = fs.existsSync(dispatcherPath);

  // Build the dispatcher env. Convention: MYTHOS_HOOK_EVENT carries the event name;
  // other contextual fields go through MYTHOS_HOOK_* prefix to avoid clobbering shell.
  const dispatcherEnv = {
    ...process.env,
    MYTHOS_HOOK_EVENT: eventName,
    MYTHOS_HOOK_SOURCE: 'codex-managed-runtime'
  };
  if (env && typeof env === 'object') {
    if (env.sessionId) dispatcherEnv.MYTHOS_HOOK_SESSION_ID = String(env.sessionId);
    if (env.actorId) dispatcherEnv.MYTHOS_HOOK_ACTOR_ID = String(env.actorId);
    if (env.toolName) dispatcherEnv.MYTHOS_HOOK_TOOL_NAME = String(env.toolName);
    if (env.filePath) dispatcherEnv.MYTHOS_HOOK_FILE_PATH = String(env.filePath);
    if (env.cwd) dispatcherEnv.MYTHOS_HOOK_CWD = String(env.cwd);
    if (env.command) dispatcherEnv.MYTHOS_HOOK_COMMAND = String(env.command);
    // Allow arbitrary extra env vars under the MYTHOS_HOOK_ prefix.
    for (const [k, v] of Object.entries(env)) {
      if (k.startsWith('MYTHOS_HOOK_') && v != null) dispatcherEnv[k] = String(v);
    }
  }

  if (!dispatcherExists) {
    appendLifecycleLog(projectRoot, {
      event: eventName,
      ok: false,
      reason: 'dispatcher-not-on-disk',
      dispatcher_path: dispatcherPath,
      session_id: dispatcherEnv.MYTHOS_HOOK_SESSION_ID || '',
      actor_id: dispatcherEnv.MYTHOS_HOOK_ACTOR_ID || ''
    });
    // Cluster A may not have merged yet — that's expected. No-op success-with-warning.
    return { ok: true, exitCode: 0, dispatcherExists: false, error: 'dispatcher-not-on-disk' };
  }

  const runner = typeof options.runner === 'function' ? options.runner : runNodeScript;
  let result;
  try {
    result = runner(dispatcherPath, {
      cwd: env.cwd || projectRoot,
      projectRoot,
      env: dispatcherEnv
    });
  } catch (err) {
    appendLifecycleLog(projectRoot, {
      event: eventName,
      ok: false,
      reason: 'runner-threw',
      error: err && err.message ? err.message : String(err),
      session_id: dispatcherEnv.MYTHOS_HOOK_SESSION_ID || '',
      actor_id: dispatcherEnv.MYTHOS_HOOK_ACTOR_ID || ''
    });
    return { ok: false, exitCode: 1, dispatcherExists: true, error: String(err && err.message || err) };
  }

  const exitCode = typeof result.exitCode === 'number' ? result.exitCode : 1;
  appendLifecycleLog(projectRoot, {
    event: eventName,
    ok: exitCode === 0,
    exit_code: exitCode,
    session_id: dispatcherEnv.MYTHOS_HOOK_SESSION_ID || '',
    actor_id: dispatcherEnv.MYTHOS_HOOK_ACTOR_ID || '',
    tool_name: dispatcherEnv.MYTHOS_HOOK_TOOL_NAME || '',
    stderr_excerpt: result.stderr ? String(result.stderr).slice(0, 500) : ''
  });

  return {
    ok: exitCode === 0,
    exitCode,
    dispatcherExists: true,
    error: exitCode === 0 ? null : (result.stderr || '').slice(0, 500)
  };
}

module.exports = {
  CLAUDE_SETTINGS_RELATIVE_PATH,
  CODEX_LIFECYCLE_EVENTS,
  CODEX_LIFECYCLE_LOG_RELATIVE_PATH,
  COORDINATION_DISPATCHER_RELATIVE_PATH,
  DEBRIEF_REMINDER,
  DANGEROUS_COMMAND_REGISTRY,
  PLAN_MODE_REMINDER,
  PROJECT_ROOT,
  SUBAGENT_REMINDER,
  buildClaudeToolInput,
  buildCodexSessionStartPayload,
  buildDangerousCommandWarning,
  buildFrameworkChangeNotice,
  claudeSettingsPathFor,
  codexLifecycleLogPathFor,
  coordinationDispatcherPathFor,
  detectDangerousCommand,
  emit,
  frameworkRelativePath,
  hookInvokesCredentialVerify,
  hookInvokesVisualReviewGate,
  isGitCommitCommand,
  isValidLifecycleEvent,
  matcherIncludesTool,
  normalizeCommand,
  normalizeHookTimeoutMs,
  readClaudeSettings,
  resolveCodexSessionId,
  resolveCodexSessionModel,
  resolveHookFilePath,
  runCodexHook,
  runCommandHook,
  runCommandHooks,
  selectPostToolUseHooks,
  selectSessionStartHooks
};
