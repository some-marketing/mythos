'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  createHandoffSignal,
  validateHandoffSignal,
  isExactSlashCommand,
  isRecursiveFollowSignalCommand,
  isResolverCommand
} = require('../../verify/lib/signal.cjs');
const { closeLiveSignalsForScope } = require('./actor-auto');
const { isPromptTargetPath, validatePasteTargetPrompt } = require('../../verify/lib/paste-target-prompt.cjs');
const { getSignalIdentity } = require('./signal-identity');
const { parseRemoteTarget } = require('./bridge-target-policy');
const { projectTargetCapabilities } = require('./target-command-policy.cjs');
const { parseReviewTaskPlanTarget, safeTaskId } = require('./review-task-plan-narrative');
const { resolveTaskPlanPaths } = require('../../planning/lib/resolve-task-plan');
const {
  buildCapabilityReceipt,
  classifyFailure,
  enforcementMode,
  loadFailureDecision,
  persistFailureDecisionAtomic,
  scrubSensitive,
  validateActorWorkOrder
} = require('./actor-work-order');

const SUPPORTED_TARGETS = Object.freeze([
  'codex',
  'claude',
  'gemini',
  'opencode',
  'opencode-local',
  'openrouter',
  'remote-ssh'
]);

// Freeform-prompt-targets accept '' or 'freeform' as command per
// tools/signals/lib/target-command-policy.cjs (FREEFORM_PROMPT_TARGETS).
// Managed-command actors must receive an exact slash command.
// remote-ssh is treated as freeform in Phase 1 (remote managed-command
// validation is Phase 2).
const FREEFORM_TARGETS = Object.freeze(['gemini', 'openrouter', 'remote-ssh']);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeScope(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function formatStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function rel(projectRoot, absPath) {
  return path.relative(projectRoot, absPath).replace(/\\/g, '/');
}

function resolveProjectPath(projectRoot, inputPath) {
  const absolute = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(projectRoot, inputPath);
  const relative = path.relative(projectRoot, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Context path is outside the project root: ${inputPath}`);
  }
  if (!fs.existsSync(absolute)) {
    throw new Error(`Context path does not exist: ${inputPath}`);
  }
  return rel(projectRoot, absolute);
}

function readReferencedArtifactChronology(projectRoot, artifacts, signalTimestamp) {
  const signalMs = Date.parse(signalTimestamp);
  const precisionAllowanceMs = 1;
  if (!Number.isFinite(signalMs)) {
    throw new Error(`Invalid signal timestamp for artifact chronology check: ${signalTimestamp}`);
  }

  const rows = [];
  const offenders = [];

  for (const artifact of artifacts) {
    const relPath = String(artifact || '').trim();
    if (!relPath) continue;
    const absPath = path.resolve(projectRoot, relPath);
    const relative = path.relative(projectRoot, absPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Referenced artifact is outside the project root: ${artifact}`);
    }
    if (!fs.existsSync(absPath)) {
      throw new Error(`Referenced artifact does not exist at signal-write time: ${relPath}`);
    }

    const stat = fs.statSync(absPath);
    const mtimeMs = stat.mtimeMs;
    const row = {
      path: relPath,
      exists_at_signal_write: true,
      observed_mtime: stat.mtime.toISOString(),
      observed_mtime_ms: mtimeMs,
      signal_timestamp: signalTimestamp,
      signal_timestamp_ms: signalMs,
      pre_existed_signal: mtimeMs <= signalMs + precisionAllowanceMs
    };
    rows.push(row);
    if (mtimeMs > signalMs + precisionAllowanceMs) {
      offenders.push(row);
    }
  }

  if (offenders.length > 0) {
    const paths = offenders.map((entry) => `${entry.path} mtime=${entry.observed_mtime}`).join(', ');
    throw new Error(`Referenced artifact chronology violation: signal timestamp ${signalTimestamp} predates artifact mtime(s): ${paths}`);
  }

  return rows;
}

function normalizeTarget(value) {
  return String(value || '').trim().toLowerCase();
}

function deriveScope(target, task, explicitScope = '', hostAlias = '') {
  const explicit = sanitizeScope(explicitScope);
  if (explicit) return explicit;

  const parts = [target];
  if (hostAlias) parts.push(hostAlias);
  parts.push(sanitizeScope(task).slice(0, 72));
  return parts.filter(Boolean).join('-').slice(0, 96);
}

function runnerForTarget(target, hostAlias = '') {
  if (target === 'codex') {
    return {
      id: 'signals:codex-run',
      script: path.join('tools', 'signals', 'run-codex-bridge.js'),
      args: []
    };
  }
  if (target === 'claude' || target === 'opencode' || target === 'opencode-local') {
    return {
      id: 'signals:run:actor',
      script: path.join('tools', 'signals', 'run-actor-bridge.js'),
      args: ['--actor', target]
    };
  }
  if (target === 'gemini') {
    return {
      id: 'signals:run:gemini',
      script: path.join('tools', 'signals', 'run-gemini-bridge.js'),
      args: []
    };
  }
  if (target === 'openrouter') {
    return {
      id: 'signals:run:openrouter',
      script: path.join('tools', 'signals', 'run-openrouter-bridge.js'),
      args: []
    };
  }
  if (target === 'remote-ssh') {
    return {
      id: 'signals:run:remote-ssh',
      script: path.join('tools', 'signals', 'run-remote-ssh-bridge.js'),
      args: hostAlias ? ['--host', hostAlias] : [],
      host_alias: hostAlias || ''
    };
  }
  return null;
}

function deriveReviewOutputOverride(projectRoot, command, stamp) {
  const target = parseReviewTaskPlanTarget(command);
  if (!target) return null;
  const resolved = resolveTaskPlanPaths(projectRoot, target);
  if (!resolved) return null;
  const plan = JSON.parse(fs.readFileSync(resolved.jsonPath, 'utf8'));
  const taskId = safeTaskId(plan.task_id || path.basename(resolved.jsonPath).replace(/__plan\.json$/, ''));
  const statePath = path.join(projectRoot, '_dev', 'state', 'plan-task-review-state', `${taskId}.json`);
  if (!fs.existsSync(statePath)) return null;
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.last_event !== 'post_repair') return null;
  const outputDir = path.join('_dev', 'reports', 'analysis', 'task-plan-reviews');
  const base = `${taskId}__review__${stamp}`;
  return {
    schema: 'TaskPlanReviewOutput/1.0',
    reason: 'post_repair_rereview_requires_distinct_approval_artifact',
    json: path.join(outputDir, `${base}.json`).replace(/\\/g, '/'),
    markdown: path.join(outputDir, `${base}.md`).replace(/\\/g, '/'),
    preserves_review_reference: state.post_repair && state.post_repair.review_reference
      ? String(state.post_repair.review_reference)
      : ''
  };
}

// Target -> harness/mind provenance for the PRE-EXECUTION dispatch-boundary span
// (c6-mind-coverage-repair). Pure + exported so the derivation is unit-testable.
// Harness covers every SUPPORTED_TARGET (incl. openrouter). mind_class is set only
// where the target IS itself a distinct mind (codex/claude/gemini); harness-only
// targets (opencode, openrouter, remote-ssh) run a configurable mind unknown at
// this boundary, so mind_class stays null (never fabricated). All values are
// INFERRED here, never witnessed — the runner stamps the witnessed model later.
const HARNESS_BY_TARGET = Object.freeze({
  codex: 'codex-cli', claude: 'claude-code-cli', gemini: 'gemini-cli',
  opencode: 'opencode', 'opencode-local': 'opencode-local',
  openrouter: 'openrouter', 'remote-ssh': 'remote-ssh'
});
const MIND_CLASS_BY_TARGET = Object.freeze({ codex: 'codex', claude: 'claude', gemini: 'gemini' });

function deriveTargetProvenance(target) {
  const baseTarget = String(target || '').split(':')[0]; // remote-ssh:host -> remote-ssh
  const harness = HARNESS_BY_TARGET[baseTarget] || null;
  const mind_class = MIND_CLASS_BY_TARGET[baseTarget] || null;
  const mind_relation = mind_class
    ? (mind_class === 'claude' ? 'parallel-context' : 'external-cli')
    : null;
  return {
    harness,
    harness_witness_state: harness ? 'inferred' : null,
    mind_class,
    mind_relation
  };
}

function buildPromptBody(payload) {
  const commandHead = String(payload.command || '').trim().match(/^(\/[a-z][a-z0-9-]*)(?:\s|$)/i);
  const isConvene = commandHead && commandHead[1].toLowerCase() === '/convene';
  const lines = [
    '# Dispatch Bridge Prompt',
    '',
    `- Source actor: ${payload.source}`,
    `- Target actor: ${payload.target}`,
    `- Signal scope: ${payload.scope}`,
    `- Exact command: ${payload.command}`,
    `- Signal path: ${payload.signalPath}`,
    ''
  ];

  // HARD CONTRACT (control-loop-lobe s06 / Gate 11): every bridge dispatch
  // emits <critical> (top-down intent) and <context> (bottom-up evidence)
  // as NAMED XML-like tagged blocks — not freeform markdown.
  // doctrine-reflex.cjs check #4 parses these blocks deterministically.
  lines.push('<critical>');
  lines.push('Top-down intent (declared by the dispatcher):');
  lines.push('');
  lines.push(`- Exact command: ${payload.command}`);
  lines.push(`- Scope: ${payload.scope}`);
  lines.push(`- Target actor: ${payload.target}`);
  lines.push('');
  lines.push('Task statement:');
  lines.push(payload.task);
  lines.push('</critical>');
  lines.push('');

  lines.push('<context>');
  lines.push('Bottom-up evidence (context artifacts + execution contract):');
  lines.push('');
  if (payload.context.length > 0) {
    lines.push('Context Artifacts:');
    for (const item of payload.context) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }
  lines.push('Execution Contract:');
  lines.push(`1. Read the dispatch task and attached context before acting.`);
  lines.push(`2. Execute the exact command \`${payload.command}\` unless repo truth blocks it.`);
  lines.push('3. If execution is blocked, report the blocker explicitly instead of improvising a different command.');
  if (payload.reviewOutput) {
    lines.push(`4. Write the re-review JSON to \`${payload.reviewOutput.json}\` and Markdown to \`${payload.reviewOutput.markdown}\`; preserve the defect-surfacing review at \`${payload.reviewOutput.preserves_review_reference || '(undeclared)'}\`.`);
  }
  lines.push('</context>');
  lines.push('');

  // Retain the legacy Task / Context Artifacts / Execution Contract
  // markdown sections for backward-compatibility with existing readers.
  lines.push('## Task');
  lines.push('');
  lines.push(payload.task);
  lines.push('');

  if (payload.context.length > 0) {
    lines.push('## Context Artifacts');
    lines.push('');
    for (const item of payload.context) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  lines.push('## Execution Contract');
  lines.push('');
  lines.push(`1. Read the dispatch task and attached context before acting.`);
  lines.push(`2. Execute the exact command \`${payload.command}\` unless repo truth blocks it.`);
  lines.push('3. If execution is blocked, report the blocker explicitly instead of improvising a different command.');
  if (payload.reviewOutput) {
    lines.push(`4. Write the re-review JSON to \`${payload.reviewOutput.json}\` and Markdown to \`${payload.reviewOutput.markdown}\`; preserve the defect-surfacing review at \`${payload.reviewOutput.preserves_review_reference || '(undeclared)'}\`.`);
  }
  if (isConvene) {
    lines.push('');
    lines.push('## Origin-Aware Convene Contract');
    lines.push('');
    lines.push(`This dispatch targets \`${payload.target}\`, so \`${payload.target}\` is the origin lobe for this convene run.`);
    lines.push('Do not dispatch `/convene` again from inside the target actor. Run the origin-aware convene runner directly so the origin lobe is excluded from participant fanout:');
    lines.push('');
    lines.push('```bash');
    lines.push(`node tools/convene/convene.js --origin ${payload.target} --task "<task text above>" --scope "${payload.scope}"`);
    lines.push('```');
    lines.push('');
    lines.push('Include attached context files with repeated `--context <path>` arguments when they are relevant.');
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function buildDispatchMarkdown(result) {
  const lines = [
    '# Dispatch Bridge',
    '',
    `- Timestamp: ${result.timestamp}`,
    `- Source actor: ${result.source}`,
    `- Target actor: ${result.target}`,
    `- Signal scope: ${result.signal_scope}`,
    `- Local task state: ${result.local_task_state}`,
    `- Dispatch runner: ${result.runner.id}`,
    `- Dispatch signal path: ${result.dispatch_signal_path}`,
    `- Prompt path: ${result.prompt_path}`,
    `- Exact command: ${result.recommended_next_command}`,
    `- Run now: ${result.run_now}`,
    `- Dispatch status: ${result.dispatch_status}`,
    ''
  ];

  lines.push('## Task Summary');
  lines.push('');
  lines.push(result.task_summary);
  lines.push('');

  if (result.context_files_referenced.length > 0) {
    lines.push('## Context Files');
    lines.push('');
    for (const item of result.context_files_referenced) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  if (result.dispatch_result) {
    lines.push('## Dispatch Result');
    lines.push('');
    lines.push(`- success: ${result.dispatch_result.success}`);
    lines.push(`- reason: ${result.dispatch_result.reason || '(none)'}`);
    lines.push(`- completion signal path: ${result.dispatch_result.completion_signal_path || '(pending)'}`);
    lines.push('');
  } else {
    lines.push('## Expected Completion');
    lines.push('');
    lines.push(`- Watch signal scope: ${result.signal_scope}`);
    lines.push(`- Completion signal path: ${result.expected_completion_signal_path}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function appendArchiveLog(projectRoot, entry) {
  const logPath = path.join(projectRoot, '_dev', 'logs', 'archive.jsonl');
  ensureDir(path.dirname(logPath));
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function buildDispatchResult(projectRoot, opts = {}) {
  const source = normalizeTarget(opts.source || 'operator');
  const rawTarget = normalizeTarget(opts.target);
  const task = String(opts.task || '').trim();
  const command = String(opts.command || '').trim();

  // Parse remote-ssh:<host> syntax (already normalized by caller, but defensively
  // re-parse here so the library remains usable independently of the CLI wrapper).
  let target, hostAlias, openrouterModel = null;
  try {
    const parsed = parseRemoteTarget(rawTarget);
    target = parsed.target;
    hostAlias = parsed.host_alias || '';
    if (target.startsWith('openrouter-')) {
      openrouterModel = target.slice('openrouter-'.length);
      target = 'openrouter';
    }
  } catch (err) {
    throw new Error(`Invalid target "${rawTarget}": ${err.message}`);
  }

  if (!source) throw new Error('Source actor is required.');
  if (!target) throw new Error('Target actor is required.');
  if (!SUPPORTED_TARGETS.includes(target)) {
    throw new Error(`Unsupported target actor "${target}". Expected one of: ${SUPPORTED_TARGETS.join(', ')}`);
  }
  if (!task) throw new Error('Task summary is required.');

  const isFreeformTarget = FREEFORM_TARGETS.includes(target);
  if (isFreeformTarget) {
    if (command !== '' && command.toLowerCase() !== 'freeform') {
      throw new Error(`target ${target} is a freeform-prompt-target; command must be empty or "freeform", got "${command}".`);
    }
  } else {
    if (!command) throw new Error('Exact command is required.');
    if (!isExactSlashCommand(command)) {
      throw new Error(`Exact command must be a slash command, got "${command}".`);
    }
    if (isRecursiveFollowSignalCommand(command)) {
      throw new Error(`Exact command must be a downstream leaf slash command, not recursive authority command "${command}".`);
    }
    if (isResolverCommand(command)) {
      throw new Error(`Exact command must be a concrete leaf command, not a resolver that delegates to another command: "${command}". Resolver commands (/follow-signal, /run-plan, /execute-plan, /advance-pipeline) cannot be dispatched across actors because the target actor would re-resolve signals or plans the source actor owns.`);
    }
  }
  if (source === target) {
    throw new Error(`Distinct Intelligence Validation failed: source "${source}" matches target "${target}".`);
  }

  // Normalize freeform-target empty command to the explicit 'freeform' sentinel
  // so downstream validation (validateHandoffSignal: recommended_next_command
  // required) sees a non-empty token. Both '' and 'freeform' from the caller
  // converge on the same on-disk shape.
  let normalizedCommand = command;
  if (isFreeformTarget && (command === '' || command.toLowerCase() === 'freeform')) {
    normalizedCommand = 'freeform';
  }

  const workOrder = opts.actor_work_order
    || opts.actorWorkOrder
    || (opts.signal_obj && opts.signal_obj.execution && opts.signal_obj.execution.actor_work_order)
    || null;
  const contractMode = enforcementMode(opts.env || process.env);
  let capabilityReceipt = null;
  if (workOrder) {
    const contract = validateActorWorkOrder(workOrder);
    const tupleErrors = [];
    if (workOrder.actor && workOrder.actor.target !== target) tupleErrors.push('work-order target does not match dispatch target');
    if (workOrder.actor && workOrder.actor.command !== normalizedCommand) tupleErrors.push('work-order command does not match dispatch command');
    const facts = projectTargetCapabilities({
      target,
      command: normalizedCommand,
      projectRoot,
      requiredMcp: workOrder.execution && workOrder.execution.required_mcp,
      availableMcp: opts.available_mcp || opts.availableMcp || [],
      privacyCompatible: workOrder.privacy && workOrder.privacy.access !== 'private-bounded'
        || opts.private_surface_allowed === true
    });
    capabilityReceipt = buildCapabilityReceipt(workOrder, { ...facts, errors: [...facts.errors, ...tupleErrors] });
    if ((!contract.valid || !capabilityReceipt.ready) && contractMode === 'enforce') {
      throw new Error(`Actor work-order preflight blocked dispatch: ${capabilityReceipt.errors.join('; ')}`);
    }
    if (!capabilityReceipt.ready && contractMode === 'observe') {
      process.stderr.write(`[dispatch-bridge] actor work-order observation: ${capabilityReceipt.errors.join('; ')}\n`);
    }
  } else if (contractMode === 'enforce') {
    throw new Error('Actor work-order preflight blocked dispatch: HandoffSignal.execution.actor_work_order is required');
  } else if (contractMode === 'observe') {
    process.stderr.write('[dispatch-bridge] actor work-order observation: embedded work order is absent; legacy dispatch remains enabled\n');
  }

  const scope = deriveScope(target, task, opts.scope || '', hostAlias);
  const stamp = formatStamp();
  const reviewOutput = deriveReviewOutputOverride(projectRoot, normalizedCommand, stamp);
  const runner = runnerForTarget(target, hostAlias);
  if (!runner) {
    throw new Error(`Unable to choose a runner for target "${target}".`);
  }
  if (target === 'openrouter' && openrouterModel) {
    runner.args = ['--model', openrouterModel, ...runner.args];
  }

  // S3 adaptive-mind-router SHADOW MODE (R1): record what the learning
  // router would recommend; the static choice above remains the decision.
  // recordShadowDecision never throws; failures land as loud
  // consultation_failed events (G2).
  try {
    require('./mind-router-shadow.cjs').recordShadowDecision({
      stage: 'dispatch-bridge',
      task,
      target,
      paths: Array.isArray(opts.context) ? opts.context : [],
      static_choice: 'default'
    });
  } catch { /* shadow must never block dispatch */ }

  const contextFiles = Array.isArray(opts.context)
    ? opts.context
    : splitCsv(opts.context || opts.context_files || '');
  const resolvedContext = contextFiles.map((item) => resolveProjectPath(projectRoot, item));

  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
  ensureDir(signalDir);
  ensureDir(analysisDir);

  // Close any prior live signals at this derived scope, not only when --scope
  // was passed explicitly. The prior behavior was: if the caller let the scope
  // be derived from task text, prior live signals with the same derived scope
  // would be left orphaned on the signal surface. That produced the duplicate
  // live signals flagged on 2026-04-14 (122016Z + 122052Z same scope, both
  // live, neither consumed). Scope uniqueness is well-defined regardless of
  // how the scope was produced, so close prior live signals in both cases.
  closeLiveSignalsForScope(projectRoot, scope, 'dispatch-bridge', 'superseded_by_dispatch_bridge');

  const promptPath = path.join(analysisDir, `dispatch-bridge-prompt__${scope}.md`);
  const signalFile = `dispatch-bridge__${stamp}__${scope}.signal.json`;
  const signalPath = path.join(signalDir, signalFile);

  const promptBody = buildPromptBody({
    source,
    target,
    scope,
    task,
    command: normalizedCommand,
    context: resolvedContext,
    signalPath: rel(projectRoot, signalPath),
    reviewOutput
  });
  if (isPromptTargetPath(promptPath)) {
    const validation = validatePasteTargetPrompt(promptPath, { content: promptBody });
    if (!validation.ok) {
      const violationLines = validation.violations
        .map((v) => `  - ${v.rule}${v.line ? ':' + v.line : ''}: ${v.message}`)
        .join('\n');
      process.stderr.write(
        `paste-target-prompt validator: REFUSING TO WRITE ${promptPath}\n${violationLines}\nFix the prompt body and retry.\n`
      );
      process.exit(1);
    }
  }
  fs.writeFileSync(promptPath, promptBody, 'utf8');

  const groundingMode = opts.signal_obj && opts.signal_obj.grounding_mode;
  if (!groundingMode || String(groundingMode).toLowerCase() === 'none') {
    process.stderr.write(
      `[dispatch-bridge] advisory: grounding_mode is ${groundingMode ? `"${groundingMode}"` : 'absent'} for dispatch to ${target} (scope=${scope}). ` +
      'The target will receive no grounding bundle. ' +
      'If this dispatch carries project- or system-tier consequence, pass --grounding-mode or set signal_obj.grounding_mode explicitly. ' +
      'This is an advisory, not a block.\n'
    );
  }

  const signal = createHandoffSignal(source, scope, 'ready-for-review', {
    artifacts: [rel(projectRoot, promptPath), ...resolvedContext],
    decision_context_artifacts: resolvedContext,
    recommended_next_actor: target,
    recommended_next_command: normalizedCommand,
    next_prompt_stub: task,
    next_step_detail: [
      `Read ${rel(projectRoot, promptPath)} before acting.`,
      resolvedContext.length > 0
        ? 'Review each attached context artifact before executing the command.'
        : 'No extra context artifacts were attached to this dispatch.',
      `Execute ${normalizedCommand} or report the concrete blocker.`
    ],
    signal_scope: scope,
    grounding_mode: groundingMode,
    // improve-002: caller may pass a validation block (produced by
    // --validation-command in the CLI). If absent, the dispatch signal
    // carries an EXPLICIT ran=false reason (emission gate 1b, lessons
    // synthesis 2026-06-03→10): a bare { ran:false, summary:'' } default
    // leaves prose free to imply validation that never happened.
    validation: opts.validation && typeof opts.validation === 'object'
      ? { ran: Boolean(opts.validation.ran), summary: String(opts.validation.summary || '') }
      : {
          ran: false,
          summary: 'not run — pre-execution dispatch request; validation is expected from the target actor run before any completion signal.'
        }
  });
  signal.execution = {
    ...((opts.signal_obj && opts.signal_obj.execution) || {}),
    ...(workOrder ? { actor_work_order: workOrder } : {}),
    ...(reviewOutput ? { review_output: reviewOutput } : {})
  };

  // Workflow-identity propagation (Phase 3d archive additive). The HEAD
  // createHandoffSignal() does not yet emit workflow_scope/workflow_kind/
  // session_id/execution_id/signal_id, so assign them to the signal here.
  // getSignalIdentity() reads these for downstream propagation onto the
  // dispatch result.
  signal.signal_id = `coord-${signal.timestamp.replace(/[^0-9]/g, '')}-${Math.random().toString(36).slice(2, 8)}`;
  signal.workflow_scope = scope;
  signal.workflow_kind = 'bridge';
  if (typeof opts.session_id === 'string' && opts.session_id) {
    signal.session_id = opts.session_id;
  }
  if (typeof opts.execution_id === 'string' && opts.execution_id) {
    signal.execution_id = opts.execution_id;
  }

  signal.task_summary = task;
  signal.local_task_state = 'pending_bridge';
  signal.dispatch_runner = runner.id;
  signal.referenced_artifacts_chronology = readReferencedArtifactChronology(
    projectRoot,
    signal.artifacts || [],
    signal.timestamp
  );

  // requireValidationEvidence: emission-side gate — ran=true must carry
  // concrete command/result evidence; ran=false must carry an explicit reason.
  const validation = validateHandoffSignal(signal, { projectRoot, requireValidationEvidence: true });
  if (!validation.valid) {
    throw new Error(`Dispatch signal validation failed: ${validation.errors.join('; ')}`);
  }

  fs.writeFileSync(signalPath, JSON.stringify(signal, null, 2) + '\n', 'utf8');

  // Read identity through the shared helper so dispatch-bridge does not
  // open-code `signal.workflow_scope || signal.signal_scope` fallbacks.
  // The helper dual-reads new identity fields and legacy signal_scope/run_id,
  // keeping this writer compatible with both old and new signal shapes.
  const signalIdentity = getSignalIdentity(signal);
  const result = {
    timestamp: signal.timestamp,
    source,
    target,
    target_actor_id: target,
    signal_id: signalIdentity.signalId,
    workflow_scope: signalIdentity.workflowScope,
    workflow_kind: signalIdentity.workflowKind,
    session_id: signalIdentity.sessionId,
    execution_id: signalIdentity.executionId,
    signal_scope: scope,
    task_summary: task,
    local_task_state: 'pending_bridge',
    dispatch_status: runner.unsupported ? 'pending_manual_runner' : 'pending_bridge',
    dispatch_signal_path: rel(projectRoot, signalPath),
    prompt_path: rel(projectRoot, promptPath),
    recommended_next_command: normalizedCommand,
    review_output_override: reviewOutput,
    context_files_referenced: resolvedContext,
    expected_completion_signal_path: `_dev/reports/signals/(pending completion for signal_scope ${scope})`,
    run_now: Boolean(opts.runNow || opts.run_now),
    runner: {
      id: runner.id,
      unsupported: Boolean(runner.unsupported)
    },
    validation: signal.validation
      ? { ran: Boolean(signal.validation.ran), summary: String(signal.validation.summary || '') }
      : { ran: false, summary: '' },
    actor_capability_receipt: capabilityReceipt,
    actor_work_order_mode: contractMode,
    dispatch_result: null
  };

  const resultIdentity = workOrder ? sanitizeScope(workOrder.dispatch_id) : stamp;
  const baseName = `dispatch-bridge__${resultIdentity}__${scope}`;
  const jsonPath = path.join(analysisDir, `${baseName}.json`);
  const markdownPath = path.join(analysisDir, `${baseName}.md`);
  const durableBridgeDecision = loadFailureDecision(jsonPath);
  if (durableBridgeDecision) result.actor_failure_decision = durableBridgeDecision;

  if (result.run_now) {
    if (runner.unsupported) {
      throw new Error(`run-now is not supported for target "${target}" because no signal-aware runner is implemented yet.`);
    }

    // Keystone emission (P1): this is a real shell boundary — the bridge runner
    // hop. Auto-seed the root from the signal's lineage, write the child span,
    // then propagate. FULLY FAIL-OPEN: a telemetry failure falls back to the
    // inherited env and never blocks the runner (codex review).
    let bridgeEnv = process.env;
    try {
      const { buildNextTraceEnv } = require('../../telemetry/dispatches/lib/trace-context.cjs');
      const { detectExecutionMode } = require('../../telemetry/dispatches/lib/managed-mode-detect.cjs');
      const { emitChildSpan, ensureRootTraceEnv } = require('../../telemetry/dispatches/lib/emit-span.cjs');
      ensureRootTraceEnv(projectRoot, {
        lineageRootSessionId: (signal && (signal.lineage_root_session_id || signal.produced_by_session_id)) || null,
        scope,
        emitSource: 'dispatch-bridge:root'
      });
      const nextEnv = buildNextTraceEnv({
        scope,
        executionMode: detectExecutionMode(normalizedCommand)
      });
      // ANTI-FABRICATION (S1 / codex review condition A1, binding): this is a
      // PRE-EXECUTION dispatch-boundary span. The model is resolved downstream by
      // the runner (run-codex-bridge -> codex-auto / run-actor-bridge -> actor-auto),
      // which emits the model-bearing child span post-resolution. The boundary span
      // may therefore record `model` ONLY from the explicit schema field
      // signal.execution.model; if that field is absent we leave model null (it is
      // captured downstream). NEVER derive/infer the model from target,
      // recommended_next_actor, runner id, adapter, workload, or any default policy.
      const signalModel =
        signal && signal.execution && typeof signal.execution.model === 'string' && signal.execution.model.trim()
          ? signal.execution.model.trim()
          : null;
      // Pre-execution mind/harness provenance (c6-mind-coverage-repair). This is
      // the dispatch-BOUNDARY span: the model is resolved downstream, so it is
      // never witnessed here. deriveTargetProvenance() stamps the HARNESS and
      // (where the target is itself a distinct mind) the mind class, all
      // target-DERIVED and INFERRED, with model_verified:false. We NEVER fabricate
      // the model (A1, above) and never claim a witnessed harness at this boundary.
      const prov = deriveTargetProvenance(target);
      emitChildSpan(projectRoot, nextEnv, {
        subagent_type: target,
        actor_role: 'worker',
        // target as the handoff/role label (NOT the model field) so print-cascade
        // shows the handoff target rather than a blank; model stays honest-null
        // unless the signal carried it explicitly.
        model: signalModel,
        mind_class: prov.mind_class,
        mind_relation: prov.mind_relation,
        model_verified: false,
        harness: prov.harness,
        harness_witness_state: prov.harness_witness_state,
        actor_reason: `dispatch-bridge run-now: ${normalizedCommand}`,
        routing_decision: 'delegate-down',
        scope_identity: scope,
        status: 'ok',
        emit_source: 'dispatch-bridge'
      });
      bridgeEnv = { ...process.env, ...nextEnv };
    } catch (telemetryErr) {
      process.stderr.write(`[dispatch-bridge] telemetry fail-open: ${telemetryErr.message}\n`);
    }

    const runnerArgs = [path.join(projectRoot, runner.script), ...runner.args, '--file', signalFile, '--json'];
    if (opts.dryRun || opts.dry_run) {
      runnerArgs.push('--dry-run');
    }
    let spawned;
    const priorDecision = durableBridgeDecision;
    let attemptCount = priorDecision ? priorDecision.attempt_count : 0;
    if (contractMode === 'enforce' && priorDecision
        && priorDecision.disposition !== 'retry_same_target') {
      spawned = { status: null, stdout: '', stderr: 'durable retry budget exhausted', error: null };
      result.actor_failure_decision = priorDecision;
    }
    do {
      if (spawned) break;
      attemptCount += 1;
      spawned = spawnSync(process.execPath, runnerArgs, {
        cwd: projectRoot,
        encoding: 'utf8',
        env: bridgeEnv
      });
      if (!workOrder || (!spawned.error && spawned.status === 0)) break;
      const decision = classifyFailure({
        message: spawned.error && spawned.error.message,
        reason: String(spawned.stderr || ''),
        timedOut: Boolean(spawned.error && spawned.error.code === 'ETIMEDOUT')
      }, workOrder, attemptCount);
      persistFailureDecisionAtomic(jsonPath, result, decision);
      result.actor_failure_decision = decision;
      if (decision.disposition !== 'retry_same_target' || contractMode !== 'enforce') break;
    } while (true);

    if (spawned.error) {
      throw spawned.error;
    }

    let parsed = null;
    const stdout = String(spawned.stdout || '').trim();
    if (stdout) {
      // Strip runner framing lines that the Codex/Claude runner libraries emit
      // to stdout before the JSON payload. Known framing prefixes as of 2026-04-14:
      //   "Live log: ..."       (codex-auto.js:1199)
      //   "Wrote run result: ..." (codex-auto.js completion path)
      //   "=== codex exec ..."  (run-codex-bridge.js header)
      //   "--- claude exec ..." (run-actor-bridge.js header)
      //   "Consumed signal: ..." (run-codex-bridge.js text output)
      //   "Restored session: ..." (codex CLI preamble)
      //   "Saving session..."   (codex CLI postamble)
      //   "...saving history..." (codex CLI postamble)
      //   "...completed."       (codex CLI postamble)
      //   "WARNING [closeout]:" (codex-auto.js:1460)
      //   "  SKIPPED: ..."      (codex-auto.js:1077)
      //   "  Local-first ..."   (codex-auto.js:1113)
      const FRAMING_PREFIX_RE = /^\s*(Live log: |Wrote run result: |=== |--- |Consumed signal: |Restored session: |Saving session|\.\.\.saving |\.\.\.completed|\.\.\.copying |WARNING \[closeout\]:|SKIPPED: |Local-first )/;
      const jsonOnly = stdout
        .split('\n')
        .filter(function (line) { return !FRAMING_PREFIX_RE.test(line); })
        .join('\n')
        .trim();
      if (jsonOnly) {
        try {
          parsed = JSON.parse(jsonOnly);
        } catch (error) {
          throw new Error(`Runner returned non-JSON output after framing strip: ${error.message}`);
        }
      }
    }

    // Hardened spawn-success classification: a runner can exit 0 yet emit
    // parsed.success === false (e.g. blocked / skipped result modes). Treat
    // those as bridge_failed rather than bridge_dispatched.
    const spawnedSuccess = spawned.status === 0
      && !(parsed && parsed.success === false);
    result.dispatch_status = spawnedSuccess ? 'bridge_dispatched' : 'bridge_failed';
    result.dispatch_result = scrubSensitive({
      success: spawnedSuccess,
      exit_code: spawned.status,
      reason: parsed && parsed.reason ? parsed.reason : (spawnedSuccess ? '' : String(spawned.stderr || '').trim()),
      completion_signal_path: parsed && parsed.completion_signal_path ? parsed.completion_signal_path : '',
      closed_source_path: parsed && parsed.closed_source_path ? parsed.closed_source_path : ''
    });
    if (result.dispatch_result.completion_signal_path) {
      result.expected_completion_signal_path = result.dispatch_result.completion_signal_path;
      result.local_task_state = 'bridge_dispatched';
    }
  }

  fs.writeFileSync(jsonPath, JSON.stringify(scrubSensitive(result), null, 2) + '\n', 'utf8');
  fs.writeFileSync(markdownPath, buildDispatchMarkdown(result), 'utf8');

  result.analysis_artifacts = {
    json: rel(projectRoot, jsonPath),
    markdown: rel(projectRoot, markdownPath)
  };

  fs.writeFileSync(jsonPath, JSON.stringify(scrubSensitive(result), null, 2) + '\n', 'utf8');

  appendArchiveLog(projectRoot, {
    ts: result.timestamp,
    event: 'dispatch.bridge',
    source,
    target,
    signal_scope: scope,
    task_summary: task,
    dispatch_signal_path: result.dispatch_signal_path,
    analysis_artifact: result.analysis_artifacts.json,
    operator: 'dispatch-bridge',
    dispatch_status: result.dispatch_status,
    run_now: result.run_now
  });

  return result;
}

module.exports = {
  SUPPORTED_TARGETS,
  FREEFORM_TARGETS,
  buildDispatchResult,
  deriveScope,
  deriveReviewOutputOverride,
  deriveTargetProvenance,
  normalizeTarget,
  runnerForTarget,
  sanitizeScope,
  splitCsv
};
