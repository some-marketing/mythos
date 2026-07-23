'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { projectTargetCapabilities } = require('./target-command-policy.cjs');
const {
  buildCapabilityReceipt,
  classifyFailure,
  enforcementMode,
  loadFailureDecision,
  persistFailureDecisionAtomic,
  scrubSensitive,
  validateActorWorkOrder
} = require('./actor-work-order');

const { scanLiveHandoffSignals } = require('./pipeline-loop');
const {
  sanitizeScope,
  validateSignalForDispatch,
  writeBridgePrompt
} = require('./codex-bridge');
const {
  chooseActorModel,
  chooseClaudeBudgetUsd,
  detectActorRuntime,
  detectInstalledActors,
  getActor,
  inferWorkload,
  normalizeWorkload
} = require('./actor-registry');
const {
  acquireLock,
  appendLessonsNote,
  buildFollowUpStepDetail,
  buildLessonsReconciliationStepDetail,
  classifyOutcome,
  deriveFollowUpActor,
  deriveFollowUpCommand,
  emitLessonsReconciliationSignal,
  ensureLessonsDocument,
  extractLastMeaningfulMessage,
  getLessonsReconciliationStatus,
  outcomeToExitStatus,
  pickLessonsPath,
  releaseLock,
  LESSONS_RECONCILIATION_SCOPE,
  runCodexForSignal
} = require('./codex-auto');
const {
  closeSignal,
  createHandoffSignal,
  findLiveSignalsBySignalScope,
  validateActorRunFeedbackSignal,
  validateHandoffSignal
} = require('../../verify/lib/signal.cjs');
const { checkCostGate } = require('../../provider-cost/cost-gate');

/**
 * ensureSignalRootTrace — fail-open boundary auto-seed for a signal-driven
 * dispatch. Seeds a root span (if the env is not already rooted) from the parent
 * signal's lineage_root_session_id, honoring the physical-equivalence contract,
 * so the derived child env carries a real parent edge and the trace_id joins
 * back to the signal. Telemetry is lazy-loaded so a telemetry load failure can
 * never block actor dispatch (codex review).
 */
function ensureSignalRootTrace(projectRoot, signalInfo) {
  try {
    const signal = (signalInfo && signalInfo.signal) || {};
    const { ensureRootTraceEnv } = require('../../telemetry/dispatches/lib/emit-span.cjs');
    ensureRootTraceEnv(projectRoot, {
      lineageRootSessionId: signal.lineage_root_session_id || signal.produced_by_session_id || null,
      scope: signal.scope || signal.signal_scope || null,
      emitSource: 'actor-auto:root'
    });
  } catch (err) {
    process.stderr.write(`[actor-auto] root-seed fail-open: ${err.message}\n`);
  }
}

/**
 * emitDispatchSpan — write the CHILD span for an actor dispatch at the shared
 * shell boundary (correlation-ID keystone, P1). Agent-agnostic: the same call
 * covers claude/gemini/opencode/opencode-local because it reads the child trace
 * env (execOpts.spawnEnv) the boundary already built, not any harness hook.
 *
 * Telemetry is lazy-loaded under try/catch so neither a module load failure nor
 * an emit failure can ever block a dispatch (codex review; fail-open invariant).
 */
function emitDispatchSpan(projectRoot, actorId, execOpts, signalInfo) {
  try {
    const { emitChildSpan } = require('../../telemetry/dispatches/lib/emit-span.cjs');
    const signal = (signalInfo && signalInfo.signal) || {};
    const scope = signal.scope || signal.signal_scope || 'general';
    return emitChildSpan(projectRoot, execOpts.spawnEnv || {}, {
      model: execOpts.model || null,
      actor_role: 'worker',
      subagent_type: actorId,
      actor_reason: signal.signal_type
        ? `${actorId} bridge dispatch (${signal.signal_type})`
        : `${actorId} bridge dispatch`,
      routing_decision: 'delegate-down',
      scope_identity: scope,
      status: 'ok',
      emit_source: `actor-auto:${actorId}`
    });
  } catch (err) {
    process.stderr.write(`[actor-auto] emit-span fail-open: ${err.message}\n`);
    return null;
  }
}

const CLAUDE_PERMISSION_MODE_MAP = Object.freeze({
  'read-only': 'default',
  'patch-allowed': 'acceptEdits',
  'full-auto': 'auto'
});

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function appendArchiveLog(projectRoot, entry) {
  const logDir = path.join(projectRoot, '_dev', 'logs');
  const logPath = path.join(logDir, 'archive.jsonl');
  ensureDir(logDir);
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
}

function shellQuote(value) {
  const text = String(value == null ? '' : value);
  if (/^[a-zA-Z0-9._/@:=+-]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function actorLabel(actorId) {
  const actor = getActor(actorId);
  return actor ? actor.label : String(actorId || 'Actor');
}

function actorPrefix(actorId) {
  return String(actorId || 'actor').trim().toLowerCase();
}

function actorLogPath(projectRoot, actorId) {
  return path.join(projectRoot, '_dev', 'logs', `${actorPrefix(actorId)}-exec-live.log`);
}

function writeActorRunActiveStatus(projectRoot, actorId, scope, pid, commandLine) {
  const statusPath = path.join(
    projectRoot,
    '_dev',
    'reports',
    'analysis',
    `${actorPrefix(actorId)}-run-active.json`
  );
  ensureDir(path.dirname(statusPath));
  fs.writeFileSync(statusPath, JSON.stringify({
    schema: 'ActorRunActive/1.0',
    actor: actorPrefix(actorId),
    active: true,
    scope,
    pid,
    started_at: new Date().toISOString(),
    command: commandLine,
    live_log: path.relative(projectRoot, actorLogPath(projectRoot, actorId))
  }, null, 2));
  return statusPath;
}

function clearActorRunActiveStatus(projectRoot, actorId) {
  const statusPath = path.join(
    projectRoot,
    '_dev',
    'reports',
    'analysis',
    `${actorPrefix(actorId)}-run-active.json`
  );
  if (!fs.existsSync(statusPath)) return;
  const data = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  data.active = false;
  data.finished_at = new Date().toISOString();
  fs.writeFileSync(statusPath, JSON.stringify(data, null, 2));
}

function buildActorPrompt(actorId, signalInfo) {
  const signal = signalInfo.signal || {};
  const mode = String(signal.execution && signal.execution.mode || '').trim() || '';
  const workload = normalizeWorkload(signal.execution && signal.execution.workload || '')
    || inferWorkload(signal);
  const artifactCount = Array.isArray(signal.artifacts) ? signal.artifacts.length : 0;
  const decisionArtifactCount = Array.isArray(signal.decision_context_artifacts)
    ? signal.decision_context_artifacts.length
    : 0;
  const label = actorLabel(actorId);
  const lines = [];

  lines.push(`Use the latest coordination signal for scope \`${signal.scope || signal.signal_scope || 'general'}\`.`);
  lines.push(`You are running through the ${label} bridge. Treat repo artifacts as the source of truth.`);
  lines.push('');
  lines.push('Read first:');
  if (Array.isArray(signal.artifacts) && signal.artifacts.length > 0) {
    for (const artifact of signal.artifacts) {
      lines.push(`- \`${artifact}\``);
    }
  } else {
    lines.push('- `_dev/reports/signals/`');
  }

  if (Array.isArray(signal.decision_context_artifacts) && signal.decision_context_artifacts.length > 0) {
    lines.push('');
    lines.push('Decision context:');
    for (const artifact of signal.decision_context_artifacts) {
      lines.push(`- \`${artifact}\``);
    }
  }

  lines.push('');
  lines.push('Signal context:');
  lines.push(`- signal_type: \`${signal.signal_type || 'unknown'}\``);
  lines.push(`- source: \`${signal.source || 'unknown'}\``);
  lines.push(`- recommended_next_actor: \`${signal.recommended_next_actor || ''}\``);
  lines.push(`- recommended_next_command: \`${signal.recommended_next_command || ''}\``);
  lines.push(`- execution_mode: \`${mode}\``);
  lines.push(`- execution_workload: \`${workload}\``);
  if (signal.execution && signal.execution.model) {
    lines.push(`- requested_model: \`${signal.execution.model}\``);
  }
  if (signal.execution && signal.execution.cwd) {
    lines.push(`- cwd: \`${signal.execution.cwd}\``);
  }
  if (signal.execution && signal.execution.timeout_ms) {
    lines.push(`- timeout_ms: \`${signal.execution.timeout_ms}\``);
  }

  lines.push('');
  lines.push('Required behavior:');
  lines.push('- read every listed artifact before acting');
  lines.push('- stay inside the listed artifacts and directly paired files unless the evidence proves the scope is stale');
  lines.push('- avoid repo-wide diff or broad archive exploration by default');
  if (artifactCount > 5) {
    lines.push('- when many artifacts are attached, classify them first and read the highest-signal files fully before widening');
  } else if (decisionArtifactCount > 0) {
    lines.push('- use decision-context artifacts to cross-check the attached slice, not to trigger a broad repo review by default');
  }
  lines.push('- findings first');
  lines.push('- preserve exact next-command truth whenever it remains correct');
  if (mode === 'read-only') {
    lines.push('- do not edit files; analyze and recommend only');
  } else {
    lines.push('- keep edits minimal and bounded to the signal scope');
    lines.push('- avoid broad cleanup unrelated to the stated signal scope');
  }
  lines.push('- if the requested action is unsafe or ambiguous, stop at a truthful blocked state');

  if (Array.isArray(signal.next_step_detail) && signal.next_step_detail.length > 0) {
    lines.push('');
    lines.push('Specific instructions from the source signal:');
    for (const step of signal.next_step_detail) {
      lines.push(`- ${step}`);
    }
  }

  lines.push('');
  lines.push('Return:');
  lines.push('1. Findings');
  lines.push('2. Applied changes or recommendations');
  lines.push('3. Exact next command');
  lines.push('4. Operator decisions needed');
  lines.push('5. Evidence used');

  return lines.join('\n');
}

function buildActorRunArtifacts(projectRoot, actorId, signalInfo, timestamp) {
  const safeScope = sanitizeScope(signalInfo.signal.scope || signalInfo.signal.signal_scope || 'general');
  const prefix = actorPrefix(actorId);
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const dispatchId = signalInfo.signal.execution
    && signalInfo.signal.execution.actor_work_order
    && signalInfo.signal.execution.actor_work_order.dispatch_id;
  const resultIdentity = sanitizeScope(dispatchId || timestamp);

  return {
    promptPath: path.join(analysisDir, `${prefix}-bridge-prompt__${safeScope}.md`),
    lastMessagePath: path.join(analysisDir, `${prefix}-last-message__${timestamp}__${safeScope}.md`),
    completionReportPath: path.join(analysisDir, `${prefix}-cli-run__${timestamp}__${safeScope}.md`),
    runResultPath: path.join(analysisDir, `${prefix}-cli-run__${resultIdentity}__${safeScope}.result.json`),
    completionSignalPath: path.join(signalDir, `ready-for-review__${timestamp}__${safeScope}.json`)
  };
}

function writeActorLastMessageArtifact(filePath, payload) {
  payload = scrubSensitive(payload);
  const lines = [
    `# ${actorLabel(payload.actor)} Last Message`,
    '',
    `- Timestamp: ${payload.timestamp}`,
    `- Scope: \`${payload.scope}\``,
    `- Outcome: ${payload.outcome}`,
    `- Source signal: \`${payload.sourceSignal}\``,
    `- Trigger command: \`${payload.triggerCommand}\``,
    '',
    '## Message',
    '',
    payload.message
  ];

  if (payload.stdout) {
    lines.push('', '## Stdout', '', '```text', payload.stdout.trim(), '```');
  }
  if (payload.stderr) {
    lines.push('', '## Stderr', '', '```text', payload.stderr.trim(), '```');
  }

  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function actorOutcomeToSummary(actorId, classified) {
  const label = actorLabel(actorId);
  switch (classified.outcome) {
    case 'success':
      return `${label} CLI run completed successfully.`;
    case 'cli_failure':
      return `${label} CLI run failed with exit code ${classified.exitCode}.`;
    case 'missing_binary':
      return `${label} binary not found.`;
    case 'timeout':
      return `${label} CLI run exceeded the configured timeout and was terminated.`;
    case 'interrupted':
      return `${label} CLI run was interrupted by ${classified.signal || 'unknown signal'}.`;
    default:
      return `${label} CLI run ended with an unknown outcome.`;
  }
}

function writeActorCompletionReport(filePath, report) {
  report = scrubSensitive(report);
  const label = actorLabel(report.actor);
  const lines = [
    `# ${label} CLI Run Report`,
    '',
    `- Timestamp: ${report.timestamp}`,
    `- Scope: \`${report.scope}\``,
    `- Source signal: \`${report.sourceSignal}\``,
    `- Prompt artifact: \`${report.promptArtifact}\``,
    `- Last-message artifact: \`${report.lastMessageArtifact}\``,
    `- Exit code: ${report.exitCode == null ? 'N/A' : report.exitCode}`,
    `- Outcome: ${report.outcome}`,
    `- Success: ${report.success ? 'yes' : 'no'}`,
    '',
    '## Trigger',
    '',
    `- recommended_next_command: \`${report.triggerCommand}\``,
    `- recommended_next_actor: \`${report.triggerActor}\``,
    '',
    '## Command',
    '',
    '```bash',
    report.commandLine,
    '```',
    '',
    '## Summary',
    '',
    report.summary || 'No summary captured.'
  ];

  if (report.stdout) {
    lines.push('', '## Stdout', '', '```text', report.stdout.trim(), '```');
  }
  if (report.stderr) {
    lines.push('', '## Stderr', '', '```text', report.stderr.trim(), '```');
  }

  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function writeRunResult(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(scrubSensitive(data), null, 2));
}

function deriveActorExecutionOptions(actorId, signalInfo, projectRoot, overrides = {}) {
  const actor = getActor(actorId);
  if (!actor) {
    throw new Error(`Unknown actor: ${actorId}`);
  }

  const exec = {
    mode: '',
    model: '',
    cwd: '',
    timeout_ms: 0,
    max_budget_usd: 0,
    workload: '',
    ...(signalInfo.signal.execution || {})
  };

  const workload = normalizeWorkload(overrides.workload || exec.workload || '')
    || inferWorkload(signalInfo.signal);
  const model = chooseActorModel(actorId, workload, overrides.model || exec.model || '');
  const cwd = exec.cwd ? path.resolve(projectRoot, exec.cwd) : projectRoot;
  const timeout_ms = exec.timeout_ms || 0;
  const mode = String(exec.mode || 'read-only').trim().toLowerCase() || 'read-only';
  const budgetUsd = actorId === 'claude'
    ? Number(exec.max_budget_usd || chooseClaudeBudgetUsd(workload))
    : 0;

  // Trace-context construction is FAIL-OPEN (codex review): a telemetry load or
  // build failure must never abort actor dispatch. On failure nextEnv is empty,
  // so the child simply inherits the parent env without trace propagation.
  let nextEnv = {};
  try {
    const { buildNextTraceEnv } = require('../../telemetry/dispatches/lib/trace-context.cjs');
    const { detectExecutionMode } = require('../../telemetry/dispatches/lib/managed-mode-detect.cjs');
    nextEnv = buildNextTraceEnv({
      scope: signalInfo.signal.scope || signalInfo.signal.signal_scope || 'general',
      executionMode: detectExecutionMode(signalInfo.signal.recommended_next_command)
    });
  } catch (telemetryErr) {
    process.stderr.write(`[actor-auto] trace-env fail-open: ${telemetryErr.message}\n`);
  }

  if (actorId === 'claude') {
    const permissionMode = CLAUDE_PERMISSION_MODE_MAP[mode] || 'default';
    const spawnArgs = ['--print', '--output-format', 'text', '--permission-mode', permissionMode];
    if (model) {
      spawnArgs.push('--model', model);
    }
    if (budgetUsd > 0) {
      spawnArgs.push('--max-budget-usd', String(budgetUsd));
    }
    return {
      actorId,
      cwd,
      timeout_ms,
      mode,
      model,
      workload,
      budget_usd: budgetUsd,
      spawnArgs,
      stdinPrompt: overrides.prompt || '',
      spawnEnv: { ...process.env, ...nextEnv },
      commandLine: ['claude', ...spawnArgs, '<stdin-prompt>'].map(shellQuote).join(' ')
    };
  }

  if (actorId === 'opencode') {
    const spawnArgs = ['run', '--format', 'default'];
    if (model) {
      spawnArgs.push('--model', model);
    }
    spawnArgs.push(overrides.prompt || '');
    return {
      actorId,
      cwd,
      timeout_ms,
      mode,
      model,
      workload,
      budget_usd: 0,
      spawnArgs,
      stdinPrompt: '',
      spawnEnv: { ...process.env, ...nextEnv },
      commandLine: ['opencode', ...spawnArgs.slice(0, -1), '<prompt>'].map(shellQuote).join(' ')
    };
  }

  if (actorId === 'gemini') {
    // Gemini CLI: `gemini -p "<prompt>" --yolo` runs non-interactively with
    // auto-approval so Gemini can write, edit, and execute files through the
    // bridge. Without --yolo, non-interactive mode degrades to analysis-only.
    // We only pass --yolo if the execution mode is not read-only.
    const spawnArgs = ['-p', overrides.prompt || ''];
    if (mode !== 'read-only') {
      spawnArgs.push('--yolo');
    }
    if (model) {
      // Gemini supports --model only on some versions; pass through verbatim.
      spawnArgs.unshift('--model', model);
    }
    return {
      actorId,
      cwd,
      timeout_ms,
      mode,
      model,
      workload,
      budget_usd: 0,
      spawnArgs,
      stdinPrompt: '',
      spawnEnv: { ...process.env, ...nextEnv },
      commandLine: ['gemini', ...spawnArgs.slice(0, -1), '<prompt>'].map(shellQuote).join(' ')
    };
  }

  if (actorId === 'opencode-local') {
    // Default to the medium Ollama model when no explicit model is requested.
    const localModel = model || 'ollama/qwen2.5-coder:14b';
    const spawnArgs = ['run', '--format', 'default'];
    spawnArgs.push('--model', localModel);
    spawnArgs.push(overrides.prompt || '');
    // spawnEnv strips frontier API keys so no credential bytes transit Anthropic/OpenAI APIs.
    // Downstream callers (spawnCliAsync etc.) must be updated by the integrator pass to read
    // spawnEnv and pass it as the `env` option to child_process.spawn.
    const spawnEnv = {
      ...process.env,
      ...nextEnv,
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      OPENROUTER_API_KEY: ''
    };
    return {
      actorId,
      cwd,
      timeout_ms,
      mode,
      model: localModel,
      workload,
      budget_usd: 0,
      spawnArgs,
      stdinPrompt: '',
      spawnEnv,
      commandLine: ['opencode', ...spawnArgs.slice(0, -1), '<prompt>'].map(shellQuote).join(' ')
    };
  }

  throw new Error(`Actor execution options are not supported for ${actorId}`);
}

function spawnCliAsync(binary, args, prompt, opts, onSpawn) {
  return new Promise((resolve) => {
    const logPath = actorLogPath(opts.projectRoot, opts.actorId);
    ensureDir(path.dirname(logPath));
    fs.writeFileSync(logPath, `--- ${binary} exec started: ${new Date().toISOString()} ---\n`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    const spawnOptions = {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    };
    // Honor opt-in environment scrubbing (e.g. opencode-local strips frontier
    // API keys so credential bytes don't transit to Anthropic/OpenAI). When
    // spawnEnv is omitted, fall through to the default child-inherited env.
    if (opts.spawnEnv && typeof opts.spawnEnv === 'object') {
      spawnOptions.env = opts.spawnEnv;
    }

    const child = spawn(binary, args, spawnOptions);

    if (typeof onSpawn === 'function') {
      onSpawn(child.pid);
    }

    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(chunk);
      logStream.write(`[stdout] ${chunk}`);
    });

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk);
      logStream.write(`[stderr] ${chunk}`);
    });

    if (String(prompt || '').length > 0) {
      child.stdin.write(prompt);
    }
    child.stdin.end();

    let timedOut = false;
    let timer = null;
    if (opts.timeout_ms > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        logStream.write(`\n--- TIMEOUT after ${opts.timeout_ms}ms ---\n`);
      }, opts.timeout_ms);
    }

    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      logStream.write(`\n--- ERROR: ${error.message} ---\n`);
      logStream.end();
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: null,
        signal: null,
        error,
        timedOut: false
      });
    });

    child.on('close', (code, sig) => {
      if (timer) clearTimeout(timer);
      logStream.write(`\n--- ${binary} exec finished: exit=${code} signal=${sig} ---\n`);
      logStream.end();
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code,
        signal: sig,
        error: null,
        timedOut
      });
    });
  });
}

function closeSignalInfo(projectRoot, signalInfo, operatorName, reason, opts = {}) {
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const closedDir = path.join(signalDir, 'closed');
  const closedPath = path.join(closedDir, signalInfo.name);

  ensureDir(closedDir);
  if (fs.existsSync(closedPath)) {
    throw new Error(`Closed signal destination already exists: ${path.relative(projectRoot, closedPath)}`);
  }

  const closedSignal = closeSignal({ ...signalInfo.signal });
  // L8: structured obligation metadata survives on the closed signal itself,
  // not only inside free-text reason strings (Codex re-review 2026-06-10).
  if (opts.obligationSuccessor) closedSignal.obligation_successor = opts.obligationSuccessor;
  if (opts.deferralRecord) closedSignal.closed_deferral_record = opts.deferralRecord;
  fs.writeFileSync(closedPath, JSON.stringify(closedSignal, null, 2));
  fs.unlinkSync(signalInfo.filePath);

  appendArchiveLog(projectRoot, {
    ts: new Date().toISOString(),
    event: 'signal.close',
    source: path.relative(projectRoot, signalInfo.filePath),
    destination: path.relative(projectRoot, closedPath),
    surface: '_dev/reports/signals',
    reason,
    ...(opts.obligationSuccessor ? { obligation_successor: opts.obligationSuccessor } : {}),
    ...(opts.deferralRecord ? { deferral_record: opts.deferralRecord } : {}),
    operator: operatorName,
    dry_run: false
  });

  return closedPath;
}

function closeLiveSignalsForScope(projectRoot, signalScope, operatorName, reasonPrefix = 'superseded_signal_scope') {
  const liveSignals = findLiveSignalsBySignalScope(
    path.join(projectRoot, '_dev', 'reports', 'signals'),
    signalScope
  );
  const closedPaths = [];
  for (const info of liveSignals) {
    const closedPath = closeSignalInfo(
      projectRoot,
      info,
      operatorName,
      `${reasonPrefix}:${signalScope}`
    );
    closedPaths.push(closedPath);
  }
  return closedPaths;
}

function validateActorCloseoutCoherence(projectRoot, actorId, opts) {
  const warnings = [];

  if (!fs.existsSync(opts.closedSourcePath)) {
    warnings.push(`Source signal not found in closed/ directory: ${path.relative(projectRoot, opts.closedSourcePath)}`);
  }
  if (!fs.existsSync(opts.completionReportPath)) {
    warnings.push(`Completion report missing: ${path.relative(projectRoot, opts.completionReportPath)}`);
  }
  if (!fs.existsSync(opts.completionSignalPath)) {
    warnings.push(`Follow-up signal missing: ${path.relative(projectRoot, opts.completionSignalPath)}`);
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(opts.completionSignalPath, 'utf8'));
      const validation = validateActorRunFeedbackSignal(parsed, {
        projectRoot,
        expectedActor: actorId
      });
      if (!validation.valid) {
        warnings.push(`Follow-up signal is not actionable: ${validation.errors.join('; ')}`);
      }
    } catch (error) {
      warnings.push(`Follow-up signal could not be parsed: ${error.message}`);
    }
  }
  if (!fs.existsSync(opts.lessonsPath)) {
    warnings.push(`Lessons file missing: ${path.relative(projectRoot, opts.lessonsPath)}`);
  }
  if (opts.lessonsReconciliationDue
      && (!opts.lessonsReconciliationSignalPath || !fs.existsSync(opts.lessonsReconciliationSignalPath))) {
    warnings.push('Lessons reconciliation signal missing.');
  }

  return {
    coherent: warnings.length === 0,
    warnings
  };
}

function listActorTargetSignals(projectRoot, actorId = '') {
  const normalizedActor = String(actorId || '').trim().toLowerCase();
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  return scanLiveHandoffSignals(signalDir).filter((info) => {
    const target = String(info.signal.recommended_next_actor || '').trim().toLowerCase();
    if (!target) return false;
    if (normalizedActor) return target === normalizedActor;
    return ['codex', 'claude', 'opencode', 'opencode-local', 'gemini', 'remote-ssh'].includes(target);
  });
}

function listRunnableActorSignals(projectRoot, opts = {}) {
  const runtimes = opts.runtimes || detectInstalledActors();
  return listActorTargetSignals(projectRoot).filter((info) => {
    const actorId = String(info.signal.recommended_next_actor || '').trim().toLowerCase();
    const actor = runtimes[actorId];
    return Boolean(actor && actor.available);
  });
}

function selectActorTargetSignal(projectRoot, actorId = '', fileName = '') {
  const signals = actorId
    ? listActorTargetSignals(projectRoot, actorId)
    : listRunnableActorSignals(projectRoot);
  if (fileName) {
    return signals.find((info) => info.name === fileName) || null;
  }
  return signals[0] || null;
}

async function runNonCodexActorForSignal(projectRoot, actorId, signalInfo, opts = {}) {
  const actor = detectActorRuntime(actorId);
  if (!actor || !actor.available) {
    return {
      mode: 'skipped',
      reason: 'missing_binary',
      actor: actorId,
      signalName: signalInfo.name
    };
  }

  const dispatchCheck = validateSignalForDispatch(signalInfo, projectRoot);
  if (!dispatchCheck.valid) {
    return {
      mode: 'skipped',
      reason: 'invalid_signal',
      actor: actorId,
      errors: dispatchCheck.errors,
      signalName: signalInfo.name,
      signalPath: signalInfo.filePath
    };
  }

  // Cost-gate check: warn if 24h spend exceeds threshold, never block dispatch
  try {
    const costGate = checkCostGate(projectRoot);
    if (costGate.enforced && costGate.exceeded) {
      const costMsg = `[cost-gate] ${costGate.message} — actor: ${actorId}, signal: ${signalInfo.name}`;
      console.log(`  WARNING: ${costMsg}`);
      const logPath = actorLogPath(projectRoot, actorId);
      ensureDir(path.dirname(logPath));
      fs.appendFileSync(logPath, `${new Date().toISOString()} WARN ${costMsg}\n`);
    } else if (costGate.error) {
      const errMsg = `[COST-GATE] Cost check error (continuing dispatch): ${costGate.error}`;
      console.log(`  WARNING: ${errMsg}`);
      const logPath = actorLogPath(projectRoot, actorId);
      ensureDir(path.dirname(logPath));
      fs.appendFileSync(logPath, `${new Date().toISOString()} WARN ${errMsg}\n`);
    }
  } catch (_costErr) {
    // Cost gate is advisory only — never fail dispatch
  }

  const timestamp = opts.timestamp || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const prompt = buildActorPrompt(actorId, signalInfo);
  const artifacts = buildActorRunArtifacts(projectRoot, actorId, signalInfo, timestamp);
  const promptPath = writeBridgePrompt(artifacts.promptPath, prompt);
  // Boundary auto-seed BEFORE deriving the child env, so the child's parent edge
  // and trace_id (== signal lineage) are real, not orphaned. Skip on dry-run —
  // a preview must not write a root span. Fail-open.
  if (!opts.dryRun) {
    ensureSignalRootTrace(projectRoot, signalInfo);
  }
  const execOpts = deriveActorExecutionOptions(actorId, signalInfo, projectRoot, {
    model: opts.model || '',
    workload: opts.workload || '',
    prompt
  });
  const workOrder = signalInfo.signal.execution && signalInfo.signal.execution.actor_work_order || null;
  const contractMode = enforcementMode(opts.env || process.env);
  const durableFailureDecision = loadFailureDecision(artifacts.runResultPath);
  let capabilityReceipt = null;
  if (workOrder) {
    const contract = validateActorWorkOrder(workOrder);
    const expectedCommand = String(signalInfo.signal.recommended_next_command || '');
    const tupleErrors = [];
    if (workOrder.actor && workOrder.actor.target !== actorId) tupleErrors.push('work-order target does not match selected actor');
    if (workOrder.actor && workOrder.actor.command !== expectedCommand) tupleErrors.push('work-order command does not match signal command');
    if (workOrder.actor && workOrder.actor.model !== execOpts.model) tupleErrors.push('resolved model does not match work-order model');
    const facts = projectTargetCapabilities({
      target: actorId,
      command: expectedCommand,
      projectRoot,
      requiredMcp: workOrder.execution && workOrder.execution.required_mcp,
      availableMcp: signalInfo.signal.execution.available_mcp || [],
      privacyCompatible: workOrder.privacy && workOrder.privacy.access !== 'private-bounded'
        || signalInfo.signal.execution.private_surface_allowed === true
    });
    capabilityReceipt = buildCapabilityReceipt(workOrder, { ...facts, errors: [...facts.errors, ...tupleErrors] });
    if ((!contract.valid || !capabilityReceipt.ready) && contractMode === 'observe') {
      process.stderr.write(`[actor-auto] actor work-order observation: ${capabilityReceipt.errors.join('; ')}\n`);
    }
  }

  const preflightBlocked = contractMode === 'enforce' && (!workOrder || !capabilityReceipt || !capabilityReceipt.ready);
  if (preflightBlocked) {
    const blockedData = {
      actor: actorId,
      signal_id: signalInfo.name,
      outcome: 'preflight_blocked',
      actor_work_order_mode: contractMode,
      actor_capability_receipt: capabilityReceipt,
      actor_failure_decision: durableFailureDecision,
      errors: capabilityReceipt ? capabilityReceipt.errors : ['HandoffSignal.execution.actor_work_order is required'],
      timestamp
    };
    writeRunResult(artifacts.runResultPath, blockedData);
    return { mode: 'skipped', reason: 'actor_work_order_preflight_blocked', actor: actorId, artifacts, ...blockedData };
  }

  if (opts.dryRun) {
    return {
      mode: 'dry-run',
      actor: actorId,
      promptPath,
      commandLine: execOpts.commandLine,
      artifacts,
      executionOptions: execOpts
    };
  }

  if (contractMode === 'enforce' && durableFailureDecision
      && durableFailureDecision.disposition !== 'retry_same_target') {
    return {
      mode: 'skipped',
      reason: 'durable_retry_budget_exhausted',
      actor: actorId,
      actor_failure_decision: durableFailureDecision,
      runResultPath: artifacts.runResultPath
    };
  }

  if (!acquireLock(signalInfo.filePath)) {
    return {
      mode: 'skipped',
      reason: 'already_claimed',
      actor: actorId,
      signalName: signalInfo.name
    };
  }

  let runResult = null;
  const operatorName = `signals:run:actor:${actorId}`;
  const scope = signalInfo.signal.scope || signalInfo.signal.signal_scope || 'general';

  try {
    writeActorRunActiveStatus(projectRoot, actorId, scope, 0, execOpts.commandLine);

    // Keystone emission (P1): write the child span at the shell boundary before
    // spawning, since the external actor cannot emit its own span. Fail-open.
    emitDispatchSpan(projectRoot, actorId, execOpts, signalInfo);

    const priorDecision = durableFailureDecision;
    let attemptCount = priorDecision ? priorDecision.attempt_count : 0;
    let result;
    let failureDecision = priorDecision;
    do {
      attemptCount += 1;
      result = await spawnCliAsync(
        actor.binary,
        execOpts.spawnArgs,
        execOpts.stdinPrompt,
        {
          actorId,
          cwd: execOpts.cwd,
          timeout_ms: execOpts.timeout_ms || 0,
          projectRoot,
          spawnEnv: execOpts.spawnEnv
        },
        (pid) => {
          writeActorRunActiveStatus(projectRoot, actorId, scope, pid, execOpts.commandLine);
        }
      );
      if (!workOrder || (result.exitCode === 0 && !result.error && !result.timedOut)) break;
      const decision = classifyFailure({
        message: result.error && result.error.message,
        stderr: result.stderr,
        timedOut: result.timedOut
      }, workOrder, attemptCount);
      failureDecision = decision;
      persistFailureDecisionAtomic(artifacts.runResultPath, {
        actor: actorId,
        signal_id: signalInfo.name,
        actor_capability_receipt: capabilityReceipt,
        timestamp
      }, decision);
      if (decision.disposition !== 'retry_same_target' || contractMode !== 'enforce') break;
    } while (true);

    clearActorRunActiveStatus(projectRoot, actorId);

    const classified = classifyOutcome({
      status: result.exitCode,
      signal: result.signal,
      error: result.error
    }, { timedOut: result.timedOut });

    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const exitCode = classified.exitCode;
    const success = classified.success;
    const outcome = classified.outcome;
    const sourceRelPath = path.relative(projectRoot, signalInfo.filePath);
    const reportRelPath = path.relative(projectRoot, artifacts.completionReportPath);
    const lastMessageRelPath = path.relative(projectRoot, artifacts.lastMessagePath);
    const promptRelPath = path.relative(projectRoot, promptPath);
    const lessonsPath = pickLessonsPath(projectRoot, timestamp);
    const lessonsRelPath = path.relative(projectRoot, lessonsPath);
    const lastMessage = extractLastMeaningfulMessage(stdout, stderr);

    writeActorLastMessageArtifact(artifacts.lastMessagePath, {
      actor: actorId,
      timestamp,
      scope,
      outcome,
      sourceSignal: sourceRelPath,
      triggerCommand: signalInfo.signal.recommended_next_command || '',
      message: lastMessage,
      stdout,
      stderr
    });

    writeActorCompletionReport(artifacts.completionReportPath, {
      actor: actorId,
      timestamp,
      scope,
      sourceSignal: sourceRelPath,
      promptArtifact: promptRelPath,
      lastMessageArtifact: lastMessageRelPath,
      exitCode,
      outcome,
      success,
      triggerCommand: signalInfo.signal.recommended_next_command || '',
      triggerActor: signalInfo.signal.recommended_next_actor || '',
      commandLine: execOpts.commandLine,
      summary: actorOutcomeToSummary(actorId, classified),
      stdout,
      stderr
    });

    ensureLessonsDocument(lessonsPath, timestamp);

    const followUpActor = deriveFollowUpActor(signalInfo);
    const followUpCommand = deriveFollowUpCommand(signalInfo, reportRelPath, success);
    const blockedBy = success ? [] : [actorOutcomeToSummary(actorId, classified)];

    const completionSignal = createHandoffSignal(
      actorId,
      signalInfo.signal.scope || `${actorId}-auto-run`,
      success ? 'ready-for-review' : 'blocked',
      {
        artifacts: [
          reportRelPath,
          lastMessageRelPath,
          lessonsRelPath,
          promptRelPath
        ],
        validation: {
          ran: true,
          // Concrete command/result evidence (emission gate 1a): the exact
          // command line that ran plus its classified outcome.
          summary: `\`${execOpts.commandLine}\` outcome: ${outcome}` + (exitCode != null ? ` (exit ${exitCode})` : '')
        },
        recommended_next_actor: followUpActor,
        recommended_next_command: followUpCommand,
        next_step_detail: buildFollowUpStepDetail(signalInfo, reportRelPath, success),
        blocked_by: blockedBy,
        ready_for_clear: false,
        signal_scope: signalInfo.signal.signal_scope || '',
        supersedes_signal: sourceRelPath,
        superseded_at: signalInfo.signal.timestamp || ''
      }
    );
    completionSignal.run_outcome = {
      outcome,
      exitCode,
      signal: classified.signal,
      success
    };

    const completionValidation = validateActorRunFeedbackSignal(completionSignal, {
      projectRoot,
      expectedActor: actorId
    });
    if (!completionValidation.valid) {
      throw new Error(`Completion signal validation failed: ${completionValidation.errors.join('; ')}`);
    }

    const closedSourcePath = closeSignalInfo(
      projectRoot,
      signalInfo,
      operatorName,
      `${actorId}_auto_run_consumed_signal`
    );
    ensureDir(path.dirname(artifacts.completionSignalPath));
    fs.writeFileSync(artifacts.completionSignalPath, JSON.stringify(completionSignal, null, 2));

    appendLessonsNote(lessonsPath, {
      timestamp,
      scope,
      sourceSignal: sourceRelPath,
      // Stable lineage: survives the live→closed move of the source signal.
      signalId: signalInfo.signal.signal_id || signalInfo.name,
      triggerCommand: signalInfo.signal.recommended_next_command || '',
      exitStatus: outcomeToExitStatus(classified),
      outcome,
      completionArtifact: reportRelPath,
      followUpSignal: path.relative(projectRoot, artifacts.completionSignalPath),
      summary: success
        ? `Automated ${actorLabel(actorId)} bridge run completed and published a ready-for-review signal.`
        : `Automated ${actorLabel(actorId)} bridge run ended with outcome: ${outcome}. Published a blocked signal.`
    });

    const runResultData = {
      actor: actorId,
      signal_id: signalInfo.name,
      outcome,
      exit_code: exitCode,
      execution_options: {
        mode: execOpts.mode,
        model: execOpts.model,
        cwd: execOpts.cwd,
        timeout_ms: execOpts.timeout_ms,
        budget_usd: execOpts.budget_usd
      },
      artifacts_produced: [
        reportRelPath,
        lastMessageRelPath,
        path.relative(projectRoot, artifacts.runResultPath),
        lessonsRelPath,
        promptRelPath
      ],
      timestamp,
      actor_work_order_mode: contractMode,
      actor_capability_receipt: capabilityReceipt,
      actor_failure_decision: failureDecision
    };
    writeRunResult(artifacts.runResultPath, runResultData);

    const lessonsStatus = getLessonsReconciliationStatus(projectRoot, timestamp, {
      lessonsPath,
      sourceSignalType: signalInfo.signal.signal_type || '',
      success
    });
    let lessonsReconciliationSignalPath = '';

    if (lessonsStatus.due) {
      // No actor override: the emitter defaults to codex with an execution
      // contract per the L5 retarget (canonical bridge_signal block,
      // convene 20260610T175230Z, operator-minted receipt 2026-06-10).
      const emitted = emitLessonsReconciliationSignal(projectRoot, lessonsStatus, {
        source: actorId,
        timestamp,
        supersede: true,
        closedBy: operatorName,
        extraArtifacts: [lessonsRelPath, reportRelPath, path.relative(projectRoot, artifacts.runResultPath)]
      });
      lessonsReconciliationSignalPath = emitted.signalPath;
    }

    const coherence = validateActorCloseoutCoherence(projectRoot, actorId, {
      closedSourcePath,
      completionReportPath: artifacts.completionReportPath,
      completionSignalPath: artifacts.completionSignalPath,
      lessonsPath,
      lessonsReconciliationDue: lessonsStatus.due,
      lessonsReconciliationSignalPath
    });

    const finalRunResultData = {
      ...runResultData,
      follow_up_signal_path: path.relative(projectRoot, artifacts.completionSignalPath),
      lessons_reconciliation_due: lessonsStatus.due,
      lessons_reconciliation_reasons: lessonsStatus.reasons,
      lessons_reconciliation_signal_path: lessonsReconciliationSignalPath
        ? path.relative(projectRoot, lessonsReconciliationSignalPath)
        : '',
      source_signal_closed: fs.existsSync(closedSourcePath),
      closeout_coherent: coherence.coherent,
      closeout_warnings: coherence.warnings
    };
    writeRunResult(artifacts.runResultPath, finalRunResultData);

    runResult = {
      mode: 'executed',
      actor: actorId,
      outcome,
      success,
      exitCode,
      promptPath,
      completionReportPath: artifacts.completionReportPath,
      completionSignalPath: artifacts.completionSignalPath,
      runResultPath: artifacts.runResultPath,
      lessonsPath,
      lessonsReconciliationSignalPath,
      closedSourcePath,
      stdout,
      stderr,
      executionOptions: execOpts,
      closeoutCoherence: coherence
    };
  } finally {
    clearActorRunActiveStatus(projectRoot, actorId);
    releaseLock(signalInfo.filePath);
  }

  return runResult;
}

async function runActorForSignal(projectRoot, signalInfo, opts = {}) {
  const actorId = String(opts.actor || signalInfo.signal.recommended_next_actor || '').trim().toLowerCase();
  if (!actorId) {
    return {
      mode: 'skipped',
      reason: 'missing_actor',
      signalName: signalInfo.name
    };
  }

  if (actorId === 'codex') {
    return runCodexForSignal(projectRoot, signalInfo, opts);
  }

  return runNonCodexActorForSignal(projectRoot, actorId, signalInfo, opts);
}

module.exports = {
  CLAUDE_PERMISSION_MODE_MAP,
  actorLogPath,
  actorOutcomeToSummary,
  buildActorPrompt,
  buildActorRunArtifacts,
  clearActorRunActiveStatus,
  closeLiveSignalsForScope,
  closeSignalInfo,
  deriveActorExecutionOptions,
  emitDispatchSpan,
  listActorTargetSignals,
  listRunnableActorSignals,
  runActorForSignal,
  selectActorTargetSignal,
  spawnCliAsync,
  validateActorCloseoutCoherence,
  writeActorCompletionReport,
  writeActorLastMessageArtifact,
  writeActorRunActiveStatus,
  writeRunResult
};
