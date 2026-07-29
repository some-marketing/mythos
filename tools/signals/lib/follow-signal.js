'use strict';

const fs = require('fs');
const path = require('path');

const {
  listLiveHandoffSignals,
  validateHandoffSignal
} = require('../../verify/lib/signal.cjs');
const { validate } = require('../../verify/lib/schema.cjs');
const { planSignalNormalization } = require('./signal-normalization-proposal');
const { assessHandoffAuthority } = require('../../planning/lib/handoff-authority-assessment');
const { resolveStateMarkerPath } = require('../../planning/lib/plan-review-state');

const FOLLOW_SIGNAL_DECISION_SCHEMA = 'FollowSignalDecision/1.0';
const TASK_PLAN_SCHEMA_PATH = path.resolve(__dirname, '../../planning/task-intake.schema.json');

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function appendArchiveLog(projectRoot, entry) {
  const logDir = path.join(projectRoot, '_dev', 'logs');
  ensureDir(logDir);
  fs.appendFileSync(path.join(logDir, 'archive.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
}

function rel(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function formatIsoForFile(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function sanitizeScope(value) {
  const safe = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || 'general';
}

function normalizeActor(actor) {
  return String(actor || '').trim().toLowerCase();
}

function normalizeCommand(command) {
  return typeof command === 'string' ? command.trim() : '';
}

function normalizeScope(scope) {
  return String(scope || '').trim();
}

function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function patternMatchesText(pattern, values) {
  const normalizedPattern = String(pattern || '').trim();
  if (!normalizedPattern) return false;
  const regex = normalizedPattern.includes('*') ? globToRegExp(normalizedPattern) : null;
  const lowerPattern = normalizedPattern.toLowerCase();
  return values.some((value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return false;
    if (regex && regex.test(normalized)) return true;
    return normalized.toLowerCase().includes(lowerPattern);
  });
}

function parseTimestamp(value) {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? ts : 0;
}

function buildCheck(id, ok, detail) {
  return {
    id,
    status: ok ? 'PASS' : 'FAIL',
    detail
  };
}

function createDecision(projectRoot, opts = {}) {
  return {
    schema: FOLLOW_SIGNAL_DECISION_SCHEMA,
    timestamp: new Date().toISOString(),
    phase: 'resolver-verifier',
    status: 'blocked',
    reason: '',
    exact_command: '',
    recovery_command: '',
    requested: {
      signal_scope: normalizeScope(opts.signalScope || opts.scope || ''),
      signal_file: opts.file ? String(opts.file) : '',
      task_plan: opts.taskPlan ? String(opts.taskPlan) : (opts.task_plan ? String(opts.task_plan) : ''),
      actor: normalizeActor(opts.actor || ''),
      execute: Boolean(opts.execute),
      allow_override: opts.allowOverride ? String(opts.allowOverride) : (opts.allow_override ? String(opts.allow_override) : ''),
      allow_ignored: Boolean(opts.allowIgnored || opts.allow_ignored)
    },
    authority: {
      type: '',
      label: '',
      source: '',
      actor: '',
      signal_type: '',
      signal_scope: '',
      scope: '',
      signal_file: '',
      task_id: '',
      task_plan_json: '',
      task_plan_markdown: ''
    },
    validation: {
      checks: [],
      blocked_reasons: []
    },
    artifacts: {
      json: '',
      markdown: ''
    },
    override: {
      active: false,
      reason: '',
      original_status: '',
      original_reason: ''
    },
    ignored_scope: {
      matched: false,
      closed_signal: '',
      closed_at: '',
      closed_scope_match: '',
      allow_ignored: Boolean(opts.allowIgnored || opts.allow_ignored)
    },
    handoff_authority_assessment: null,
    project_root: projectRoot
  };
}

function addCheckResult(decision, id, ok, detail) {
  decision.validation.checks.push(buildCheck(id, ok, detail));
  if (!ok) {
    decision.validation.blocked_reasons.push(detail);
  }
}

function signalAuthorityKey(signal) {
  const scoped = normalizeScope(signal && signal.signal_scope);
  if (scoped) return { kind: 'signal_scope', value: scoped };
  const unscoped = normalizeScope(signal && signal.scope);
  if (unscoped) return { kind: 'scope', value: unscoped };
  return { kind: '', value: '' };
}

function signalMatchText(projectRoot, info) {
  const signal = info.signal || {};
  return [
    info.filePath ? rel(projectRoot, info.filePath) : '',
    info.filePath ? path.basename(info.filePath) : '',
    signal.scope,
    signal.signal_scope,
    signal.source,
    signal.recommended_next_actor,
    signal.recommended_next_command,
    signal.next_prompt_stub,
    Array.isArray(signal.next_step_detail) ? signal.next_step_detail.join(' ') : '',
    Array.isArray(signal.artifacts) ? signal.artifacts.join(' ') : '',
    Array.isArray(signal.decision_context_artifacts) ? signal.decision_context_artifacts.join(' ') : ''
  ].filter((value) => String(value || '').trim()).map((value) => String(value).trim());
}

function listClosedIgnoredSignals(projectRoot) {
  const closedDir = path.join(projectRoot, '_dev', 'reports', 'signals', 'closed');
  if (!fs.existsSync(closedDir)) return [];

  return fs.readdirSync(closedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => {
      const filePath = path.join(closedDir, entry.name);
      return {
        filePath,
        signal: safeReadJson(filePath)
      };
    })
    .filter((info) => info.signal && info.signal.closed_reason === 'ignored');
}

function findIgnoredCloseoutForSignal(projectRoot, signalInfo) {
  const candidateValues = signalMatchText(projectRoot, signalInfo);
  const ignoredSignals = listClosedIgnoredSignals(projectRoot);

  for (const ignored of ignoredSignals) {
    const ignoredValues = signalMatchText(projectRoot, ignored);
    const patterns = [
      ignored.signal.closed_scope_match,
      ignored.signal.signal_scope,
      ignored.signal.scope,
      path.basename(ignored.filePath)
    ].filter((value) => String(value || '').trim());

    const directPatternMatch = patterns.some((pattern) => patternMatchesText(pattern, candidateValues));
    const reversePatternMatch = candidateValues.some((pattern) => patternMatchesText(pattern, ignoredValues));
    if (directPatternMatch || reversePatternMatch) return ignored;
  }

  return null;
}

function resolveSignalFilePath(projectRoot, fileRef) {
  const ref = String(fileRef || '').trim();
  if (!ref) return null;

  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const candidates = [];

  if (path.isAbsolute(ref)) {
    candidates.push(ref);
  } else {
    candidates.push(path.resolve(projectRoot, ref));
    candidates.push(path.join(signalDir, ref));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return path.resolve(projectRoot, ref);
}

function resolveTaskPlanPaths(projectRoot, taskPlanRef) {
  const sharedResolver = require('../../planning/lib/resolve-task-plan');
  try {
    const result = sharedResolver.resolveTaskPlanPaths(projectRoot, taskPlanRef);
    if (!result) return null;
    return {
      jsonPath: result.jsonPath,
      markdownPath: result.markdownPath
    };
  } catch (err) {
    // Ambiguity or other resolver errors — return null so follow-signal
    // blocks on the validation check rather than crashing
    return null;
  }
}

function collectActorSignals(liveSignals, actor) {
  const normalizedActor = normalizeActor(actor);
  if (!normalizedActor) return [];
  return liveSignals.filter((info) => normalizeActor(info.signal.recommended_next_actor) === normalizedActor);
}

function collectScopeSignals(liveSignals, requestedScope) {
  const normalizedScope = normalizeScope(requestedScope);
  if (!normalizedScope) return [];

  const bySignalScope = liveSignals.filter((info) => normalizeScope(info.signal.signal_scope) === normalizedScope);
  if (bySignalScope.length > 0) return bySignalScope;

  return liveSignals.filter((info) => {
    const signalScope = normalizeScope(info.signal.signal_scope);
    return !signalScope && normalizeScope(info.signal.scope) === normalizedScope;
  });
}

function findSupersedingSignals(projectRoot, liveSignals, currentInfo) {
  const currentRel = rel(projectRoot, currentInfo.filePath);
  const currentName = path.basename(currentInfo.filePath);

  return liveSignals.filter((info) => {
    if (info.filePath === currentInfo.filePath) return false;
    const supersedes = String(info.signal.supersedes_signal || '').trim();
    if (!supersedes) return false;
    return supersedes === currentRel || supersedes === currentName || supersedes.endsWith(`/${currentName}`);
  });
}

function findAuthorityConflicts(currentInfo, liveSignals) {
  const key = signalAuthorityKey(currentInfo.signal);
  if (!key.value) return [];

  return liveSignals.filter((info) => {
    if (info.filePath === currentInfo.filePath) return false;
    const otherKey = signalAuthorityKey(info.signal);
    return otherKey.kind === key.kind && otherKey.value === key.value;
  });
}

function validateSignalInfo(projectRoot, decision, signalInfo, liveSignals) {
  const signal = signalInfo.signal;
  const requestedActor = normalizeActor(decision.requested.actor);
  const command = normalizeCommand(signal.recommended_next_command);
  const validation = validateHandoffSignal(signal, { projectRoot });
  const authorityKey = signalAuthorityKey(signal);
  const conflicts = findAuthorityConflicts(signalInfo, liveSignals);
  const supersedingSignals = findSupersedingSignals(projectRoot, liveSignals, signalInfo);

  decision.authority = {
    type: 'coordination-signal',
    label: authorityKey.value || rel(projectRoot, signalInfo.filePath),
    source: String(signal.source || '').trim(),
    actor: normalizeActor(signal.recommended_next_actor),
    signal_type: String(signal.signal_type || '').trim(),
    signal_scope: normalizeScope(signal.signal_scope),
    scope: normalizeScope(signal.scope),
    signal_file: rel(projectRoot, signalInfo.filePath),
    task_id: '',
    task_plan_json: '',
    task_plan_markdown: ''
  };

  addCheckResult(
    decision,
    'signal.schema',
    validation.valid,
    validation.valid ? 'Coordination signal schema and artifact references are valid.' : validation.errors.join(' ')
  );

  const isLive = signal.lifecycle_state === 'live';
  addCheckResult(
    decision,
    'signal.lifecycle_state',
    isLive,
    isLive ? 'Signal is live.' : `Signal lifecycle_state must be live, got "${signal.lifecycle_state || '(empty)'}".`
  );

  const hasTimestamp = parseTimestamp(signal.timestamp) > 0;
  addCheckResult(
    decision,
    'signal.timestamp',
    hasTimestamp,
    hasTimestamp ? 'Signal timestamp is parseable.' : 'Signal timestamp is missing or invalid.'
  );

  const actionableType = signal.signal_type !== 'ready-for-clear';
  addCheckResult(
    decision,
    'signal.actionable_type',
    actionableType,
    actionableType ? `Signal type "${signal.signal_type}" is actionable.` : 'ready-for-clear signals are not actionable authority for /follow-signal.'
  );

  const exactSlashCommand = command.startsWith('/');
  addCheckResult(
    decision,
    'signal.exact_command',
    exactSlashCommand,
    exactSlashCommand ? `Signal carries exact slash command ${command}.` : `recommended_next_command must be an exact slash command, got "${command || '(empty)'}".`
  );

  const actorMatches = !requestedActor || requestedActor === normalizeActor(signal.recommended_next_actor);
  addCheckResult(
    decision,
    'signal.actor_match',
    actorMatches,
    actorMatches
      ? (requestedActor ? `Signal targets requested actor "${requestedActor}".` : 'No actor constraint requested.')
      : `Signal targets "${normalizeActor(signal.recommended_next_actor) || '(empty)'}", not requested actor "${requestedActor}".`
  );

  addCheckResult(
    decision,
    'signal.unique_authority',
    conflicts.length === 0,
    conflicts.length === 0
      ? 'Signal is the only live authority surface for its scope.'
      : `Multiple live signals remain for ${authorityKey.kind} "${authorityKey.value}": ${conflicts.map((info) => path.basename(info.filePath)).join(', ')}.`
  );

  addCheckResult(
    decision,
    'signal.not_superseded',
    supersedingSignals.length === 0,
    supersedingSignals.length === 0
      ? 'Signal is not explicitly superseded by another live signal.'
      : `Signal is superseded by newer live signal(s): ${supersedingSignals.map((info) => path.basename(info.filePath)).join(', ')}.`
  );

  decision.exact_command = command;
  if (signal.signal_type === 'blocked') {
    const blockers = Array.isArray(signal.blocked_by)
      ? signal.blocked_by.filter((item) => String(item || '').trim())
      : [];
    if (blockers.length > 0) {
      for (const blocker of blockers) {
        decision.validation.blocked_reasons.push(`Signal blocker: ${blocker}`);
      }
    }
    decision.status = 'blocked';
    decision.reason = blockers.length > 0
      ? `Live blocked signal prevents execution: ${blockers.join('; ')}`
      : 'Live blocked signal prevents execution.';
    decision.recovery_command = exactSlashCommand ? command : '';
    return decision;
  }

  const hasFailures = decision.validation.checks.some((check) => check.status === 'FAIL');
  if (hasFailures) {
    decision.status = 'blocked';
    decision.reason = 'Signal authority is not valid for autonomous continuation.';
    if (conflicts.length > 0 && authorityKey.value) {
      decision.recovery_command = `/normalize-signals ${authorityKey.value}`;
    } else if (exactSlashCommand) {
      decision.recovery_command = command;
    }
    return decision;
  }

  decision.status = 'allowed';
  decision.reason = `Signal authority validated for ${command}.`;
  return decision;
}

function applyIgnoredCloseoutPolicy(projectRoot, decision, signalInfo, opts = {}) {
  if (!signalInfo || decision.authority.type !== 'coordination-signal') return decision;

  const ignored = findIgnoredCloseoutForSignal(projectRoot, signalInfo);
  if (!ignored) {
    addCheckResult(
      decision,
      'signal.not_previously_ignored',
      true,
      'No ignored closeout matches this signal scope.'
    );
    return decision;
  }

  const closedSignal = rel(projectRoot, ignored.filePath);
  const closedAt = String(ignored.signal.closed_at || '').trim();
  const closedScopeMatch = String(ignored.signal.closed_scope_match || '').trim();

  decision.ignored_scope = {
    matched: true,
    closed_signal: closedSignal,
    closed_at: closedAt,
    closed_scope_match: closedScopeMatch,
    allow_ignored: Boolean(opts.allowIgnored || opts.allow_ignored)
  };

  if (opts.allowIgnored || opts.allow_ignored) {
    addCheckResult(
      decision,
      'signal.previously_ignored_override',
      true,
      `Previously ignored closeout overridden by --allow-ignored: ${closedSignal}.`
    );
    appendArchiveLog(projectRoot, {
      ts: new Date().toISOString(),
      event: 'signal.ignore_override',
      override_reason: 'allow-ignored flag',
      closed_signal: closedSignal,
      closed_at: closedAt,
      closed_scope_match: closedScopeMatch,
      authority_signal: decision.authority.signal_file,
      operator: 'follow-signal'
    });
    return decision;
  }

  const message = `Suppressed because the human operator previously ignored this scope. Closed signal: ${closedSignal}. Closed at: ${closedAt || '(unknown)'}. To override: re-run with --allow-ignored`;
  addCheckResult(decision, 'signal.not_previously_ignored', false, message);
  decision.status = 'blocked';
  decision.reason = message;
  decision.recovery_command = 're-run with --allow-ignored';
  return decision;
}

function applyHandoffAuthorityAssessment(decision, input) {
  if (!input || typeof input !== 'object') return decision;
  const assessment = assessHandoffAuthority(input);
  decision.handoff_authority_assessment = assessment;
  const consistent = assessment.state === 'consistent';
  addCheckResult(
    decision,
    'handoff.authority_consistent',
    consistent,
    consistent
      ? 'Handoff evidence matches current custody and authority observations.'
      : `Handoff authority assessment requires review: ${assessment.state} (${assessment.reason_codes.join(', ')}).`
  );
  if (!consistent && decision.status === 'allowed') {
    decision.status = 'blocked';
    decision.reason = `Handoff authority assessment blocked execution: ${assessment.state}.`;
    decision.recovery_command = assessment.recovery_route || '';
  }
  return decision;
}

function loadTaskPlanSchema() {
  return JSON.parse(fs.readFileSync(TASK_PLAN_SCHEMA_PATH, 'utf8'));
}

function inferTaskPlanApproval(plan, reviewState = null) {
  const approvalStatus = normalizeScope(plan && plan.approval && plan.approval.status).toLowerCase();
  if (approvalStatus === 'approved') {
    return { approved: true, reason: 'approval.status=approved' };
  }

  const reviewDecision = normalizeScope(plan && plan.operator_review && plan.operator_review.decision).toLowerCase();
  if (reviewDecision === 'approved') {
    return { approved: true, reason: 'operator_review.decision=approved' };
  }

  const operatorStampStatus = normalizeScope(
    plan &&
      plan['plan-task-review-state'] &&
      plan['plan-task-review-state'].operator_stamp &&
      plan['plan-task-review-state'].operator_stamp.status
  ).toLowerCase();
  const durableReviewDecision = normalizeScope(
    reviewState && reviewState.post_review && reviewState.post_review.decision
  ).toLowerCase();
  const approvalReference = normalizeScope(
    reviewState && reviewState.post_review && reviewState.post_review.approval_reference
  );
  if (operatorStampStatus === 'approved' && durableReviewDecision === 'approved' && approvalReference) {
    return {
      approved: true,
      reason: `plan-task-review-state.operator_stamp.status=approved + post_review.decision=approved (${approvalReference})`
    };
  }

  return {
    approved: false,
    reason: 'Task-plan approval is not durably modeled in current task-plan artifacts.'
  };
}

function validateTaskPlan(projectRoot, decision, taskPlanRef) {
  const resolved = resolveTaskPlanPaths(projectRoot, taskPlanRef);
  const schema = loadTaskPlanSchema();
  const plan = resolved && fs.existsSync(resolved.jsonPath) ? safeReadJson(resolved.jsonPath) : null;
  const markdownExists = Boolean(resolved && fs.existsSync(resolved.markdownPath));
  const schemaErrors = plan ? validate(plan, schema, { rootSchema: schema, path: '' }) : [{ path: '', message: 'Task plan JSON is missing or unreadable.' }];
  const taskId = normalizeScope(plan && plan.task_id);
  const exactCommand = taskId ? `/run-plan ${taskId}` : '';
  const markerPath = taskId
    ? resolveStateMarkerPath(projectRoot, taskId, { clientCode: (resolved && resolved.clientCode) || undefined })
    : '';
  const reviewState = markerPath ? safeReadJson(markerPath) : null;
  const approval = inferTaskPlanApproval(plan, reviewState);

  decision.authority = {
    type: 'task-plan',
    label: taskId || String(taskPlanRef || '').trim(),
    source: normalizeScope(plan && plan.source),
    actor: '',
    signal_type: '',
    signal_scope: '',
    scope: '',
    signal_file: '',
    task_id: taskId,
    task_plan_json: resolved ? rel(projectRoot, resolved.jsonPath) : '',
    task_plan_markdown: resolved ? rel(projectRoot, resolved.markdownPath) : ''
  };
  decision.exact_command = exactCommand;

  addCheckResult(
    decision,
    'task_plan.json',
    Boolean(plan),
    plan ? 'Task plan JSON exists and is readable.' : `Task plan JSON not found: ${resolved ? rel(projectRoot, resolved.jsonPath) : String(taskPlanRef || '')}`
  );

  addCheckResult(
    decision,
    'task_plan.markdown',
    markdownExists,
    markdownExists ? 'Task plan markdown summary exists.' : `Task plan markdown summary not found: ${resolved ? rel(projectRoot, resolved.markdownPath) : String(taskPlanRef || '')}`
  );

  addCheckResult(
    decision,
    'task_plan.schema',
    schemaErrors.length === 0,
    schemaErrors.length === 0
      ? 'Task plan matches task-intake schema.'
      : schemaErrors.map((error) => `${error.path || '/'} ${error.message}`).join('; ')
  );

  addCheckResult(
    decision,
    'task_plan.run_plan_command',
    Boolean(exactCommand),
    exactCommand ? `Task plan routes through exact command ${exactCommand}.` : 'Task plan is missing task_id, so no exact /run-plan command can be derived.'
  );

  addCheckResult(
    decision,
    'task_plan.approval',
    approval.approved,
    approval.approved
      ? `Task plan approval proven by ${approval.reason}.`
      : `${approval.reason} /follow-signal blocks instead of guessing approval.`
  );

  const hasFailures = decision.validation.checks.some((check) => check.status === 'FAIL');
  if (hasFailures) {
    decision.status = 'blocked';
    decision.reason = approval.approved
      ? 'Task-plan authority is not valid for autonomous continuation.'
      : 'Task plan exists, but approval cannot be proven from repo truth yet.';
    decision.recovery_command = taskId ? `/review-task-plan ${taskId}` : '';
    return decision;
  }

  decision.status = 'allowed';
  decision.reason = `Task-plan authority validated for ${exactCommand}.`;
  return decision;
}

function writeDecisionArtifacts(projectRoot, decision) {
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
  ensureDir(analysisDir);

  const authorityLabel = decision.authority.label
    || decision.requested.signal_scope
    || decision.requested.task_plan
    || decision.requested.signal_file
    || decision.requested.actor
    || 'general';
  const stamp = formatIsoForFile(new Date(decision.timestamp));
  const safeScope = sanitizeScope(authorityLabel);
  const baseName = `follow-signal__${stamp}__${safeScope}`;
  const jsonPath = path.join(analysisDir, `${baseName}.json`);
  const markdownPath = path.join(analysisDir, `${baseName}.md`);

  const markdown = [
    '# Follow-Signal Decision',
    '',
    `- Timestamp: ${decision.timestamp}`,
    `- Status: ${decision.status}`,
    `- Reason: ${decision.reason}`,
    `- Authority type: ${decision.authority.type || 'none'}`,
    `- Authority label: ${decision.authority.label || 'none'}`,
    `- Exact command: ${decision.exact_command || '(none)'}`,
    `- Recovery command: ${decision.recovery_command || '(none)'}`,
    '',
    '## Requested Inputs',
    '',
    `- signal_scope: ${decision.requested.signal_scope || '(none)'}`,
    `- signal_file: ${decision.requested.signal_file || '(none)'}`,
    `- task_plan: ${decision.requested.task_plan || '(none)'}`,
    `- actor: ${decision.requested.actor || '(none)'}`,
    `- execute: ${decision.requested.execute}`,
    `- allow_override: ${decision.requested.allow_override || '(none)'}`,
    `- allow_ignored: ${decision.requested.allow_ignored}`,
    '',
    '## Validation',
    '',
    ...decision.validation.checks.map((check) => `- [${check.status}] ${check.id}: ${check.detail}`)
  ].join('\n');

  fs.writeFileSync(jsonPath, JSON.stringify(decision, null, 2) + '\n', 'utf8');
  fs.writeFileSync(markdownPath, `${markdown}\n`, 'utf8');

  decision.artifacts.json = rel(projectRoot, jsonPath);
  decision.artifacts.markdown = rel(projectRoot, markdownPath);
  fs.writeFileSync(jsonPath, JSON.stringify(decision, null, 2) + '\n', 'utf8');

  return decision;
}

function resolveAuthority(projectRoot, opts = {}) {
  const decision = createDecision(projectRoot, opts);
  const liveSignals = listLiveHandoffSignals(path.join(projectRoot, '_dev', 'reports', 'signals'));
  const signalScope = normalizeScope(opts.signalScope || opts.scope || (opts._ && opts._[0]) || '');
  const taskPlan = opts.taskPlan || opts.task_plan || '';
  const requestedActor = normalizeActor(opts.actor);
  const executeRequested = Boolean(opts.execute);
  const overrideRequested = Boolean(opts.allowOverride || opts.allow_override);
  const allowIgnoredRequested = Boolean(opts.allowIgnored || opts.allow_ignored);
  let resolvedSignalInfo = null;

  if (opts.file) {
    const resolvedFile = resolveSignalFilePath(projectRoot, opts.file);
    const signal = safeReadJson(resolvedFile);

    addCheckResult(
      decision,
      'resolution.signal_file',
      Boolean(signal),
      signal ? `Signal file resolved: ${rel(projectRoot, resolvedFile)}` : `Signal file not found or unreadable: ${String(opts.file)}`
    );

    if (!signal) {
      decision.reason = 'Explicit signal file could not be resolved.';
      return writeDecisionArtifacts(projectRoot, decision);
    }

    const signalInfo = {
      filePath: resolvedFile,
      signal
    };
    resolvedSignalInfo = signalInfo;
    validateSignalInfo(projectRoot, decision, signalInfo, liveSignals);
  } else if (signalScope) {
    const candidates = collectScopeSignals(liveSignals, signalScope);
    addCheckResult(
      decision,
      'resolution.scope_candidates',
      candidates.length === 1,
      candidates.length === 1
        ? `Exactly one live signal matches requested scope "${signalScope}".`
        : candidates.length === 0
          ? `No live signal matches requested scope "${signalScope}".`
          : `Multiple live signals match requested scope "${signalScope}": ${candidates.map((info) => path.basename(info.filePath)).join(', ')}.`
    );

    if (candidates.length === 1) {
      resolvedSignalInfo = candidates[0];
      validateSignalInfo(projectRoot, decision, candidates[0], liveSignals);
    } else {
      decision.reason = candidates.length === 0
        ? `No live signal authority exists for scope "${signalScope}".`
        : `Scope "${signalScope}" is ambiguous across multiple live signals.`;
      if (candidates.length > 1) {
        decision.recovery_command = `/normalize-signals ${signalScope}`;
      }
    }
  } else if (taskPlan) {
    validateTaskPlan(projectRoot, decision, taskPlan);
  } else if (requestedActor) {
    const candidates = collectActorSignals(liveSignals, requestedActor);
    addCheckResult(
      decision,
      'resolution.actor_candidates',
      candidates.length === 1,
      candidates.length === 1
        ? `Exactly one live signal targets actor "${requestedActor}".`
        : candidates.length === 0
          ? `No live signal targets actor "${requestedActor}".`
          : `Multiple live signals target actor "${requestedActor}": ${candidates.map((info) => path.basename(info.filePath)).join(', ')}.`
    );

    if (candidates.length === 1) {
      resolvedSignalInfo = candidates[0];
      validateSignalInfo(projectRoot, decision, candidates[0], liveSignals);
    } else {
      decision.reason = candidates.length === 0
        ? `No live signal authority currently targets actor "${requestedActor}".`
        : `Actor-targeted live authority for "${requestedActor}" is ambiguous.`;
    }
  } else {
    addCheckResult(
      decision,
      'resolution.authority_input',
      false,
      'Provide exactly one authority hint: positional <signal-scope>, --file <signal.json>, --task-plan <task-id|path>, or --actor <name>.'
    );
    decision.reason = 'No authority surface was requested.';
  }

  applyIgnoredCloseoutPolicy(projectRoot, decision, resolvedSignalInfo, {
    allowIgnored: allowIgnoredRequested
  });
  applyHandoffAuthorityAssessment(decision, opts.handoffAuthority || opts.handoff_authority);

  // Phase 2: --allow-override handling
  // Override converts a blocked decision into override-allowed when operator provides a reason
  if (overrideRequested && decision.status === 'blocked') {
    const rawOverride = opts.allowOverride || opts.allow_override || '';
    const overrideReason = (typeof rawOverride === 'string' ? rawOverride : '').trim();
    if (overrideReason) {
      const hasExecutableCommand = decision.exact_command && decision.exact_command.startsWith('/');
      decision.override = {
        active: true,
        reason: overrideReason,
        original_status: 'blocked',
        original_reason: decision.reason
      };
      decision.status = (executeRequested && hasExecutableCommand) ? 'override-executed' : 'override-allowed';
      decision.reason = `Operator override: ${overrideReason}`;
    }
    // --allow-override without a reason stays blocked
  }

  // Phase 2: --execute handling
  // Execute upgrades allowed to executed (signals the Claude agent to run the command)
  if (executeRequested && decision.status === 'allowed') {
    decision.status = 'executed';
    decision.reason = `Execution authorized for ${decision.exact_command}.`;
  }
  // --execute when blocked (without override) stays blocked — no change needed

  if (!decision.reason) {
    decision.reason = decision.status === 'allowed'
      ? 'Authority resolved.'
      : 'Authority could not be resolved safely.';
  }

  return writeDecisionArtifacts(projectRoot, decision);
}

function formatDecision(decision) {
  const lines = [];
  lines.push(`Status:   ${decision.status}`);
  lines.push(`Reason:   ${decision.reason}`);
  lines.push(`Authority:${decision.authority.type ? ` ${decision.authority.type} (${decision.authority.label || 'unnamed'})` : ' none'}`);
  lines.push(`Command:  ${decision.exact_command || '(none)'}`);
  lines.push(`Recovery: ${decision.recovery_command || '(none)'}`);
  lines.push(`Artifacts: ${decision.artifacts.json || '(pending)'}, ${decision.artifacts.markdown || '(pending)'}`);

  if (decision.validation.blocked_reasons.length > 0) {
    lines.push('');
    lines.push('Blocked reasons:');
    for (const reason of decision.validation.blocked_reasons) {
      lines.push(`- ${reason}`);
    }
  }

  if (decision.override && decision.override.active) {
    lines.push('');
    lines.push(`Override:  ${decision.override.reason}`);
    lines.push(`Original:  [${decision.override.original_status}] ${decision.override.original_reason}`);
  }

  return lines.join('\n');
}

module.exports = {
  FOLLOW_SIGNAL_DECISION_SCHEMA,
  collectActorSignals,
  collectScopeSignals,
  findAuthorityConflicts,
  findSupersedingSignals,
  formatDecision,
  resolveAuthority,
  resolveSignalFilePath,
  resolveTaskPlanPaths,
  signalAuthorityKey,
  findIgnoredCloseoutForSignal,
  applyHandoffAuthorityAssessment,
  listClosedIgnoredSignals,
  validateSignalInfo,
  validateTaskPlan,
  inferTaskPlanApproval,
  writeDecisionArtifacts,
  planSignalNormalization
};
