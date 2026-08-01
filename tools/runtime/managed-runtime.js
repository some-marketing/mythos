'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { runCodexHook, isGitCommitCommand, emit: emitCoordinationHook } = require('./hook-emulation');
const { resolveAuthority, formatDecision } = require('../signals/lib/follow-signal');

const RUNTIME_AUTHORITY_ID = 'mythos-managed-runtime';
const RUNTIME_AUTHORITY_ALIASES = Object.freeze(['smos-managed-runtime']);
const SESSION_SCHEMA = 'CodexManagedSession/1.0';
const GROUNDED_TARGET_TTL_MS = 24 * 60 * 60 * 1000;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function createSessionId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `codex-managed-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function statePathFor(projectRoot) {
  return path.join(projectRoot, '_dev', 'state', 'codex-runtime', 'session.json');
}

function runtimeLogPathFor(projectRoot) {
  return path.join(projectRoot, '_dev', 'logs', 'codex-managed-runtime.jsonl');
}

function createEmptyState() {
  return {
    schema: SESSION_SCHEMA,
    session_id: createSessionId(),
    created_at: nowIso(),
    updated_at: nowIso(),
    boot: {
      status: 'not-run',
      last_run_at: '',
      exit_code: null
    },
    plan_mode: {
      entered_at: ''
    },
    grounding: {
      target: '',
      relative_target: '',
      acknowledged_at: ''
    },
    authority: {
      status: '',
      exact_command: '',
      source: '',
      signal_file: '',
      checked_at: ''
    },
    last_command: {
      command: '',
      cwd: '',
      exit_code: null,
      ran_at: ''
    },
    debrief: {
      pending: false,
      reason: '',
      set_at: ''
    }
  };
}

function loadState(projectRoot) {
  const statePath = statePathFor(projectRoot);
  if (!fs.existsSync(statePath)) return createEmptyState();
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return { ...createEmptyState(), ...parsed };
  } catch {
    return createEmptyState();
  }
}

function writeState(projectRoot, state) {
  const statePath = statePathFor(projectRoot);
  ensureDir(path.dirname(statePath));
  state.updated_at = nowIso();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return statePath;
}

function appendRuntimeLog(projectRoot, event, detail = {}) {
  const logPath = runtimeLogPathFor(projectRoot);
  ensureDir(path.dirname(logPath));
  fs.appendFileSync(logPath, JSON.stringify({
    ts: nowIso(),
    event,
    detail
  }) + '\n', 'utf8');
  return logPath;
}

function relativizeTarget(projectRoot, targetPath) {
  const info = targetInfo(projectRoot, targetPath);
  if (!info.insideProjectRoot) return '';
  return info.relativeTarget;
}

function targetInfo(projectRoot, targetPath) {
  const absoluteTarget = path.resolve(projectRoot, targetPath);
  const relativeTarget = path.relative(projectRoot, absoluteTarget).replace(/\\/g, '/');
  return {
    absoluteTarget,
    insideProjectRoot: !relativeTarget.startsWith('..'),
    relativeTarget
  };
}

function systemSurfaceInfo(projectRoot, targetPath) {
  const relative = relativizeTarget(projectRoot, targetPath);
  if (!relative) {
    return { systemLevel: false, relativeTarget: '', reason: '' };
  }

  const exactMatches = new Set([
    'AGENTS.md',
    'CLAUDE.md',
    'INSTRUCTIONS.md',
    'OPENCODE.md',
    '.cursorrules',
    'instructions',
    '.claude',
    'tools/codex',
    '.claude/settings.json',
    '.claude/guardrails.md',
    '.claude/CLAUDE.md'
  ]);

  if (exactMatches.has(relative)) {
    return { systemLevel: true, relativeTarget: relative, reason: 'managed harness instruction surface' };
  }

  if (relative.startsWith('instructions/')) {
    return { systemLevel: true, relativeTarget: relative, reason: 'canonical or adapter instruction surface' };
  }
  if (relative.startsWith('_dev/reports/')) {
    return { systemLevel: true, relativeTarget: relative, reason: 'governance/orchestration report surface' };
  }
  if (relative.startsWith('tools/planning/')) {
    return { systemLevel: true, relativeTarget: relative, reason: 'planning tool surface' };
  }
  if (relative.startsWith('tools/codex/') || relative.startsWith('tools/claude/') || relative.startsWith('tools/instructions/')) {
    return { systemLevel: true, relativeTarget: relative, reason: 'harness behavior surface' };
  }
  if (/^frameworks\/[^/]+\/[^/]+\/manifest\.json$/.test(relative)) {
    return { systemLevel: true, relativeTarget: relative, reason: 'framework manifest surface' };
  }
  if (/^frameworks\/[^/]+\/[^/]+\/guardrails\.md$/.test(relative)) {
    return { systemLevel: true, relativeTarget: relative, reason: 'framework guardrail surface' };
  }

  return { systemLevel: false, relativeTarget: relative, reason: '' };
}

function groundingIsFresh(state, relativeTarget) {
  if (!state || !state.grounding) return false;
  if (!relativeTarget || state.grounding.relative_target !== relativeTarget) return false;
  const ts = Date.parse(state.grounding.acknowledged_at || '');
  return Number.isFinite(ts) && (Date.now() - ts) <= GROUNDED_TARGET_TTL_MS;
}

function normalizeShellCommand(command) {
  return String(command || '').trim().replace(/\s+/g, ' ');
}

function isClearlyReadOnlyShellCommand(command) {
  const normalized = normalizeShellCommand(command);
  if (!normalized) return false;

  if (/[<>]|&&|\|\||;|\$\(|`/.test(normalized)) return false;
  if (/\b(?:rm|mv|cp|touch|mkdir|rmdir|chmod|chown|truncate|tee|sed\s+-i|perl\s+-pi|git\s+(?:add|commit|push|reset|rebase|merge|checkout|switch|branch\s+-d|branch\s+-D|tag|clean)|npm\s+install|npm\s+ci|yarn\s+add|pnpm\s+add|pip\s+install|make\s+install|curl\s+.*\|\s*(?:sh|bash))\b/i.test(normalized)) {
    return false;
  }

  const readOnlyPatterns = [
    /^pwd(?:\s|$)/i,
    /^ls(?:\s|$)/i,
    /^dir(?:\s|$)/i,
    /^printf(?:\s|$)/i,
    /^echo(?:\s|$)/i,
    /^cat(?:\s|$)/i,
    /^head(?:\s|$)/i,
    /^tail(?:\s|$)/i,
    /^wc(?:\s|$)/i,
    /^stat(?:\s|$)/i,
    /^find(?:\s|$)/i,
    /^rg(?:\s|$)/i,
    /^grep(?:\s|$)/i,
    /^git\s+(?:status|diff|log|show|rev-parse|ls-files|branch(?:\s+--show-current)?)\b/i,
    /^node\s+--test(?:\s|$)/i,
    /^npm\s+test(?:\s|$)/i
  ];

  return readOnlyPatterns.some((pattern) => pattern.test(normalized));
}

function shellCommandHasUnsupportedSyntax(command) {
  return /[<>]|&&|\|\||;|\$\(|`|\|/.test(normalizeShellCommand(command));
}

function tokenizeShellCommand(command) {
  return String(command || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
}

function unquoteShellToken(token) {
  const text = String(token || '');
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function extractScopedMutationOperands(command) {
  const tokens = tokenizeShellCommand(command).map(unquoteShellToken);
  const head = String(tokens[0] || '').toLowerCase();

  if (!head) return null;

  const nonFlagOperands = tokens.slice(1).filter((token) => token && !token.startsWith('-'));

  switch (head) {
    case 'touch':
    case 'mkdir':
    case 'rmdir':
    case 'rm':
      return nonFlagOperands;

    case 'cp':
    case 'mv':
    case 'ln':
      return nonFlagOperands;

    case 'git': {
      const subcommand = String(tokens[1] || '').toLowerCase();
      if (['add', 'rm', 'mv', 'restore'].includes(subcommand)) {
        return tokens.slice(2).filter((token) => token && !token.startsWith('-'));
      }
      return null;
    }

    default:
      return null;
  }
}

function isPathWithinScope(candidatePath, scopeRoot) {
  const relative = path.relative(scopeRoot, candidatePath).replace(/\\/g, '/');
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function buildShellScopeRequiredMessage(command) {
  return [
    'POTENTIALLY MUTATING SHELL COMMAND BLOCKED',
    `Command: ${normalizeShellCommand(command)}`,
    'Provide `--target <repo-relative path>` that contains every file operand, or use a read-only shell command.'
  ].join('\n');
}

function buildShellScopeEscapeMessage(command, targetRelative, offendingOperand) {
  return [
    'POTENTIALLY MUTATING SHELL COMMAND BLOCKED',
    `Command: ${normalizeShellCommand(command)}`,
    `Target scope: ${targetRelative}`,
    `Offending operand: ${offendingOperand}`,
    'The file operand resolves outside the supplied target scope.'
  ].join('\n');
}

function buildShellUnsupportedMutationMessage(command, targetRelative) {
  return [
    'POTENTIALLY MUTATING SHELL COMMAND BLOCKED',
    `Command: ${normalizeShellCommand(command)}`,
    targetRelative ? `Target scope: ${targetRelative}` : 'Target scope: missing',
    'This shell form is too complex to prove safe. Use a simpler command with explicit file operands inside the target scope.'
  ].join('\n');
}

function validateShellMutationScope(projectRoot, opts = {}) {
  const command = normalizeShellCommand(opts.command || '');
  if (!command) {
    return { allowed: false, message: 'Missing --command for shell action.' };
  }

  if (isClearlyReadOnlyShellCommand(command)) {
    return { allowed: true, readOnly: true };
  }

  const target = String(opts.target || '').trim();
  if (!target) {
    return {
      allowed: false,
      message: buildShellScopeRequiredMessage(command)
    };
  }

  const targetDetails = targetInfo(projectRoot, target);
  if (!targetDetails.insideProjectRoot) {
    return {
      allowed: false,
      message: buildShellOutsideProjectRootMessage(target)
    };
  }

  if (shellCommandHasUnsupportedSyntax(command)) {
    return {
      allowed: false,
      message: buildShellUnsupportedMutationMessage(command, targetDetails.relativeTarget)
    };
  }

  const operands = extractScopedMutationOperands(command);
  if (!operands || operands.length === 0) {
    return {
      allowed: false,
      message: buildShellUnsupportedMutationMessage(command, targetDetails.relativeTarget)
    };
  }

  const cwd = opts.cwd ? path.resolve(projectRoot, opts.cwd) : projectRoot;
  const targetRoot = targetDetails.absoluteTarget;

  for (const operand of operands) {
    const resolvedOperand = path.resolve(cwd, operand);
    if (!isPathWithinScope(resolvedOperand, targetRoot)) {
      return {
        allowed: false,
        message: buildShellScopeEscapeMessage(command, targetDetails.relativeTarget, operand)
      };
    }
  }

  return {
    allowed: true,
    readOnly: false,
    targetRoot,
    targetRelative: targetDetails.relativeTarget,
    operands
  };
}

function recordGrounding(state, target, relativeTarget) {
  state.grounding = {
    target: String(target || ''),
    relative_target: String(relativeTarget || ''),
    acknowledged_at: nowIso()
  };
  return state;
}

// Layer 3 wiring — derive a compound actor_id (`codex-managed[:<role>]`)
// from the managed session id and any optional role/worker name on the state.
function managedActorId(state, opts = {}) {
  const role = (opts && opts.role) || (state && state.actor_role) || '';
  return role ? `codex-managed:${role}` : 'codex-managed';
}

function ensureBoot(projectRoot, state, opts = {}) {
  if (state.boot.status === 'ok') {
    return {
      state,
      ran: false,
      result: { stdout: '', exitCode: 0 }
    };
  }

  const result = runCodexHook({
    event: 'session-start',
    cwd: opts.cwd || projectRoot,
    projectRoot
  });

  state.boot = {
    status: result.exitCode === 0 ? 'ok' : 'failed',
    last_run_at: nowIso(),
    exit_code: result.exitCode
  };

  appendRuntimeLog(projectRoot, 'boot', {
    exit_code: result.exitCode,
    cwd: opts.cwd || projectRoot
  });

  // Layer 3 wiring — propagate SessionStart to the coordination-dispatcher.
  // Failure isolated inside emit(); we don't read the result for control flow.
  try {
    emitCoordinationHook('SessionStart', {
      sessionId: state.session_id,
      actorId: managedActorId(state, opts),
      cwd: opts.cwd || projectRoot
    }, { projectRoot });
  } catch {
    // Belt-and-suspenders: emit() already isolates errors; this is just-in-case.
  }

  return { state, ran: true, result };
}

// Layer 3 wiring — explicit close hook callable from launcher / managed exit.
function closeManagedSession(projectRoot, state, opts = {}) {
  try {
    emitCoordinationHook('SessionEnd', {
      sessionId: state && state.session_id,
      actorId: managedActorId(state, opts),
      cwd: opts.cwd || projectRoot
    }, { projectRoot });
  } catch {
    // Never throw out of session close.
  }
  appendRuntimeLog(projectRoot, 'session-end', {
    session_id: state && state.session_id,
    actor_id: managedActorId(state, opts)
  });
  return { state };
}

function enterPlanMode(projectRoot, state) {
  const result = runCodexHook({ event: 'enter-plan-mode', cwd: projectRoot, projectRoot });
  state.plan_mode.entered_at = nowIso();
  appendRuntimeLog(projectRoot, 'plan-mode', {});
  return { state, result };
}

function buildGroundingMessage(relativeTarget, reason) {
  return [
    `SYSTEM-LEVEL TARGET DETECTED: ${relativeTarget}`,
    `Reason: ${reason}`,
    'Load the same grounding route Claude uses before mutating this surface:',
    '- .claude/commands/ground-in-philosophy.md',
    '- .claude/agents/philosophy-grounding.md'
  ].join('\n');
}

function acknowledgeGrounding(projectRoot, state, targetPath) {
  const surface = systemSurfaceInfo(projectRoot, targetPath);
  const relativeTarget = surface.relativeTarget || String(targetPath || '');
  recordGrounding(state, targetPath, relativeTarget);
  appendRuntimeLog(projectRoot, 'grounding-acknowledged', {
    target: targetPath,
    relative_target: relativeTarget,
    system_level: surface.systemLevel
  });
  return {
    state,
    surface,
    message: surface.systemLevel
      ? buildGroundingMessage(relativeTarget, surface.reason)
      : `Grounding note recorded for non-system target: ${relativeTarget}`
  };
}

function spawnNodeScript(projectRoot, scriptRelativePath, args = [], opts = {}) {
  return spawnSync(process.execPath, [path.join(projectRoot, scriptRelativePath), ...args], {
    cwd: opts.cwd || projectRoot,
    encoding: 'utf8'
  });
}

function runManagedShell(projectRoot, state, opts = {}) {
  const command = String(opts.command || '').trim();
  if (!command) {
    return {
      state,
      exitCode: 1,
      stdout: '',
      stderr: 'Missing --command for shell action.'
    };
  }

  // S4 ENFORCEMENT: Block managed commands from generic shell degradation
  const { isManaged } = require('../codex/lib/managed-command-registry');
  if (command.startsWith('/') && isManaged(command)) {
    return {
      state,
      exitCode: 2,
      stdout: [
        'MANAGED COMMAND DEGRADATION BLOCKED',
        `Command: ${command}`,
        'This is a canonically managed Mythos command. It must be executed through the managed runtime surface:',
        `  npm run codex:smos -- command "${command}"`
      ].join('\n'),
      stderr: '',
      blocked: true
    };
  }

  const cwd = opts.cwd ? path.resolve(projectRoot, opts.cwd) : projectRoot;
  const target = String(opts.target || '').trim();
  const scope = validateShellMutationScope(projectRoot, { command, cwd, target });

  if (!scope.allowed) {
    return {
      state,
      exitCode: 2,
      stdout: scope.message,
      stderr: '',
      blocked: true
    };
  }

  if (!scope.readOnly) {
    const surface = systemSurfaceInfo(projectRoot, scope.targetRelative);
    if (surface.systemLevel && !groundingIsFresh(state, surface.relativeTarget)) {
      return {
        state,
        exitCode: 2,
        stdout: [
          `SYSTEM-LEVEL TARGET DETECTED: ${surface.relativeTarget}`,
          'Ground this target first:',
          `  npm run codex:smos -- ground --target ${surface.relativeTarget}`
        ].join('\n'),
        stderr: '',
        blocked: true
      };
    }
  }

  const boot = ensureBoot(projectRoot, state, { cwd });
  state = boot.state;

  const pre = runCodexHook({
    event: 'pre-bash',
    command,
    cwd,
    projectRoot
  });

  // Layer 3 wiring — propagate PreToolUse:Bash to coordination-dispatcher.
  try {
    emitCoordinationHook('PreToolUse', {
      sessionId: state.session_id,
      actorId: managedActorId(state, opts),
      toolName: 'Bash',
      command,
      cwd
    }, { projectRoot });
  } catch { /* isolated */ }

  const result = spawnSync('/bin/bash', ['-lc', command], {
    cwd,
    encoding: 'utf8'
  });

  // Layer 3 wiring — propagate PostToolUse:Bash after command completes.
  try {
    emitCoordinationHook('PostToolUse', {
      sessionId: state.session_id,
      actorId: managedActorId(state, opts),
      toolName: 'Bash',
      command,
      cwd
    }, { projectRoot });
  } catch { /* isolated */ }

  const bootStdout = boot.ran && boot.result.stdout ? `${boot.result.stdout}\n` : '';

  state.last_command = {
    command,
    cwd,
    exit_code: typeof result.status === 'number' ? result.status : 1,
    ran_at: nowIso()
  };

  if (isGitCommitCommand(command)) {
    state.debrief = {
      pending: true,
      reason: 'git-commit',
      set_at: nowIso()
    };
  }

  appendRuntimeLog(projectRoot, 'shell', {
    command,
    cwd,
    exit_code: state.last_command.exit_code
  });

  return {
    state,
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: [bootStdout, pre.stdout, result.stdout || ''].filter(Boolean).join('\n'),
    stderr: result.stderr || '',
    blocked: false
  };
}

function resolveManagedAuthority(projectRoot, opts = {}) {
  return resolveAuthority(projectRoot, {
    file: opts.file || '',
    taskPlan: opts.taskPlan || '',
    actor: opts.actor || '',
    scope: opts.scope || '',
    execute: Boolean(opts.execute)
  });
}

function runManagedSignal(projectRoot, state, opts = {}) {
  const pre = runCodexHook({ event: 'pre-agent', cwd: projectRoot, projectRoot });
  const decision = resolveManagedAuthority(projectRoot, opts);

  state.authority = {
    status: decision.status,
    exact_command: decision.exact_command || '',
    source: decision.authority ? decision.authority.source || '' : '',
    signal_file: decision.authority ? decision.authority.signal_file || '' : '',
    checked_at: nowIso()
  };

  if (!['allowed', 'executed', 'override-allowed', 'override-executed'].includes(decision.status)) {
    appendRuntimeLog(projectRoot, 'signal-blocked', {
      status: decision.status,
      reason: decision.reason
    });
    return {
      state,
      exitCode: 2,
      stdout: [pre.stdout, formatDecision(decision)].filter(Boolean).join('\n'),
      stderr: ''
    };
  }

  if (decision.authority.type !== 'coordination-signal' || !decision.authority.signal_file) {
    appendRuntimeLog(projectRoot, 'signal-noncoordination-authority', {
      status: decision.status,
      exact_command: decision.exact_command
    });
    return {
      state,
      exitCode: 2,
      stdout: [pre.stdout, formatDecision(decision), 'Managed Codex signal execution requires a coordination signal authority.'].filter(Boolean).join('\n'),
      stderr: ''
    };
  }

  const bridgeArgs = ['--file', path.basename(decision.authority.signal_file)];
  if (opts.model) bridgeArgs.push('--model', String(opts.model));
  if (opts.dryRun) bridgeArgs.push('--dry-run');
  if (opts.json) bridgeArgs.push('--json');

  const result = spawnNodeScript(projectRoot, path.join('tools', 'signals', 'run-codex-bridge.js'), bridgeArgs, {
    cwd: projectRoot
  });

  appendRuntimeLog(projectRoot, 'signal', {
    signal_file: decision.authority.signal_file,
    exit_code: typeof result.status === 'number' ? result.status : 1,
    dry_run: Boolean(opts.dryRun)
  });

  return {
    state,
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: [pre.stdout, result.stdout || ''].filter(Boolean).join('\n'),
    stderr: result.stderr || ''
  };
}

module.exports = {
  GROUNDED_TARGET_TTL_MS,
  RUNTIME_AUTHORITY_ID,
  RUNTIME_AUTHORITY_ALIASES,
  SESSION_SCHEMA,
  acknowledgeGrounding,
  closeManagedSession,
  createEmptyState,
  createSessionId,
  ensureBoot,
  enterPlanMode,
  groundingIsFresh,
  loadState,
  managedActorId,
  recordGrounding,
  resolveManagedAuthority,
  runManagedShell,
  runManagedSignal,
  runtimeLogPathFor,
  statePathFor,
  validateShellMutationScope,
  targetInfo,
  isClearlyReadOnlyShellCommand,
  systemSurfaceInfo,
  writeState
};
