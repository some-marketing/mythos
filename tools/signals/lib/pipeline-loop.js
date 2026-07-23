'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { COORDINATION_SCHEMA_VERSION } = require('../../verify/lib/signal.cjs');
const { resolveTypedInvocation } = require('./target-command-policy.cjs');

const CAPABILITY_REGISTRY_ROOT = path.resolve(__dirname, '..', '..', '..');

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getFileMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function normalizeJson(value) {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = normalizeJson(value[key]);
    return out;
  }, {});
}

function fingerprintJson(value) {
  if (!value || typeof value !== 'object') return null;
  const normalized = JSON.stringify(normalizeJson(value));
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function buildTransitionEvidence(artifact, artifactPath, mtimeMs) {
  if (!artifact || typeof artifact !== 'object') return null;
  const explicit = artifact.transition_evidence && typeof artifact.transition_evidence === 'object'
    ? artifact.transition_evidence
    : {};
  return {
    fingerprint: fingerprintJson(artifact),
    predecessor_fingerprint: explicit.predecessor_fingerprint || artifact.predecessor_fingerprint || null,
    input_fingerprint: explicit.input_fingerprint || artifact.input_fingerprint || null,
    review_of_fingerprint: explicit.review_of_fingerprint || artifact.review_of_fingerprint || null,
    supersedes_fingerprint: explicit.supersedes_fingerprint || artifact.supersedes_fingerprint || null,
    producer: explicit.producer || artifact.produced_by_actor_id || artifact.producer || artifact.source || 'unknown',
    produced_at: explicit.produced_at || artifact.produced_at || artifact.timestamp || artifact.generated_at || null,
    relationship: explicit.relationship || artifact.relationship || null,
    artifact_path: artifactPath || null,
    discovery_mtime_ms: mtimeMs || 0
  };
}

function evidenceReviews(successorEvidence, predecessorEvidence, relationship = 'any') {
  if (!successorEvidence || !predecessorEvidence || !predecessorEvidence.fingerprint) return false;
  const fields = relationship === 'review_of'
    ? [successorEvidence.review_of_fingerprint]
    : [
        successorEvidence.review_of_fingerprint,
        successorEvidence.input_fingerprint,
        successorEvidence.predecessor_fingerprint,
        successorEvidence.supersedes_fingerprint
      ];
  return fields.includes(predecessorEvidence.fingerprint);
}

function scanLiveHandoffSignals(signalDir) {
  if (!fs.existsSync(signalDir)) return [];

  const entries = fs.readdirSync(signalDir, { withFileTypes: true });
  const liveSignals = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.json')) continue;

    const filePath = path.join(signalDir, entry.name);
    const signal = safeReadJson(filePath);
    if (!signal) continue;
    if (signal.schema !== COORDINATION_SCHEMA_VERSION) continue;
    if (signal.lifecycle_state !== 'live') continue;

    liveSignals.push({
      name: entry.name,
      filePath,
      signal,
      mtimeMs: getFileMtimeMs(filePath),
      transitionEvidence: buildTransitionEvidence(signal, filePath, getFileMtimeMs(filePath))
    });
  }

  liveSignals.sort((a, b) => {
    const aTs = Date.parse(a.signal.timestamp || '') || a.mtimeMs || 0;
    const bTs = Date.parse(b.signal.timestamp || '') || b.mtimeMs || 0;
    return bTs - aTs;
  });

  return liveSignals;
}

function normalizeRecommendationCommand(command) {
  return typeof command === 'string' ? command.trim() : '';
}

function reviewRequestsPlan(reviewArtifact) {
  if (!reviewArtifact || !Array.isArray(reviewArtifact.failures)) return false;
  return reviewArtifact.failures.some((failure) => {
    const action = String(failure.recommended_next_action || '');
    return action.includes('/plan-pipeline');
  });
}

function signalNeedsIndependentReview(liveSignal) {
  if (!liveSignal) return false;
  const source = String(liveSignal.signal.source || '').toLowerCase();
  return source.includes('claude');
}

function isMainPipelineSignal(liveSignal) {
  if (!liveSignal || !liveSignal.signal) return false;
  return !String(liveSignal.signal.signal_scope || '').trim();
}

function masterPipelineIsComplete(planArtifact) {
  if (!planArtifact || typeof planArtifact !== 'object') return false;

  const remaining = Array.isArray(planArtifact.remaining_track_sequence)
    ? planArtifact.remaining_track_sequence
    : null;
  if (remaining && remaining.length > 0) return false;

  const summary = String(planArtifact.current_state_summary || '').toLowerCase();
  const nextCommand = normalizeRecommendationCommand(planArtifact.next_recommended_command);

  return summary.includes('all 15 main stages are complete')
    || summary.includes('no remaining incomplete track')
    || (!nextCommand.startsWith('/advance-pipeline') && Array.isArray(remaining) && remaining.length === 0);
}

function deriveRawLoopRecommendation(state) {
  const latestSignal = state.liveSignals.find(isMainPipelineSignal) || null;
  const reviewArtifact = state.reviewArtifact;
  const planArtifact = state.planArtifact;
  const activeWorkstreamsArtifact = state.activeWorkstreamsArtifact;

  if (latestSignal && latestSignal.signal.signal_type === 'blocked') {
    const recommendedCommand = normalizeRecommendationCommand(latestSignal.signal.recommended_next_command);
    return {
      source: 'live-signal',
      command: recommendedCommand || '',
      reason: `Live blocked signal from ${latestSignal.signal.source || 'unknown'} on ${latestSignal.signal.scope || 'unknown scope'}.`,
      blocked_by: Array.isArray(latestSignal.signal.blocked_by) ? latestSignal.signal.blocked_by : [],
      latest_signal: latestSignal
    };
  }

  if (latestSignal && signalNeedsIndependentReview(latestSignal) && !evidenceReviews(state.reviewEvidence, latestSignal.transitionEvidence, 'review_of')) {
    return {
      source: 'live-signal',
      command: '/review-progress advance-pipeline',
      reason: `New live signal from ${latestSignal.signal.source || 'unknown'} is waiting for an independent progress review.`,
      blocked_by: [],
      latest_signal: latestSignal
    };
  }

  if (reviewRequestsPlan(reviewArtifact) && !evidenceReviews(state.planEvidence, state.reviewEvidence)) {
    return {
      source: 'review-artifact',
      command: '/plan-pipeline',
      reason: 'The latest review artifact still recommends refreshing planning before the next execution pass.',
      blocked_by: [],
      latest_signal: latestSignal
    };
  }

  if (latestSignal) {
    const recommendedCommand = normalizeRecommendationCommand(latestSignal.signal.recommended_next_command);
    if (recommendedCommand) {
      return {
        source: 'live-signal',
        command: recommendedCommand,
        reason: `Latest live signal from ${latestSignal.signal.source || 'unknown'} already carries a next-command recommendation.`,
        blocked_by: [],
        latest_signal: latestSignal
      };
    }
  }

  if (planArtifact && normalizeRecommendationCommand(planArtifact.next_recommended_command)) {
    if (masterPipelineIsComplete(planArtifact) && activeWorkstreamsArtifact) {
      const activeCommand = normalizeRecommendationCommand(activeWorkstreamsArtifact.next_recommended_command);
      if (activeCommand) {
        return {
          source: 'active-workstreams-artifact',
          command: activeCommand,
          reason: 'The master pipeline is complete, so the active-workstreams queue is now the truthful next-step surface.',
          blocked_by: [],
          latest_signal: latestSignal
        };
      }
    }

    return {
      source: 'plan-artifact',
      command: normalizeRecommendationCommand(planArtifact.next_recommended_command),
      reason: 'No higher-priority live signal is pending, so the current planning artifact is the best next-step source.',
      blocked_by: [],
      latest_signal: latestSignal
    };
  }

  return {
    source: 'fallback',
    command: '',
    reason: 'No live signal or planning artifact currently recommends a next command.',
    blocked_by: [],
    latest_signal: latestSignal
  };
}

function deriveLoopRecommendation(state) {
  const recommendation = deriveRawLoopRecommendation(state);
  const command = normalizeRecommendationCommand(recommendation.command);
  if (!command) return recommendation;

  const resolved = resolveTypedInvocation({
    projectRoot: state.projectRoot,
    registryRoot: state.registryRoot || CAPABILITY_REGISTRY_ROOT,
    input: command,
    executionMode: 'COORDINATOR',
    harnessCapabilityState: 'advertised'
  });
  let requiredTransitionEvidence = null;
  if (resolved.command_id === '/review-progress' && recommendation.latest_signal?.transitionEvidence?.fingerprint) {
    requiredTransitionEvidence = {
      relationship: 'review_of',
      review_of_fingerprint: recommendation.latest_signal.transitionEvidence.fingerprint,
      predecessor_producer: recommendation.latest_signal.transitionEvidence.producer
    };
  } else if (resolved.command_id === '/plan-pipeline' && state.reviewEvidence?.fingerprint) {
    requiredTransitionEvidence = {
      relationship: 'derived_from_review',
      input_fingerprint: state.reviewEvidence.fingerprint,
      predecessor_producer: state.reviewEvidence.producer
    };
  }
  return {
    ...recommendation,
    command: resolved.resolved_command,
    invocation: resolved,
    required_transition_evidence: requiredTransitionEvidence,
    reason: resolved.resolution_state === 'resolved'
      ? recommendation.reason
      : `${recommendation.reason} Command resolution: ${resolved.fallback_reason}.`
  };
}

function buildLoopState(projectRoot, opts = {}) {
  const signalDir = opts.signalDir || path.join(projectRoot, '_dev', 'reports', 'signals');
  const reviewArtifactPath = opts.reviewArtifactPath || path.join(projectRoot, '_dev', 'reports', 'analysis', 'review-progress__advance-pipeline.expectation-failures.json');
  const planArtifactPath = opts.planArtifactPath || path.join(projectRoot, '_dev', 'reports', 'analysis', 'plan-pipeline.next-step.json');
  const activeWorkstreamsArtifactPath = opts.activeWorkstreamsArtifactPath || path.join(projectRoot, '_dev', 'reports', 'analysis', 'plan-active-workstreams.next-step.json');

  const reviewArtifact = safeReadJson(reviewArtifactPath);
  const reviewMtimeMs = getFileMtimeMs(reviewArtifactPath);
  const planArtifact = safeReadJson(planArtifactPath);
  const planMtimeMs = getFileMtimeMs(planArtifactPath);
  const activeWorkstreamsArtifact = safeReadJson(activeWorkstreamsArtifactPath);
  const activeWorkstreamsMtimeMs = getFileMtimeMs(activeWorkstreamsArtifactPath);

  return {
    projectRoot,
    signalDir,
    reviewArtifactPath,
    planArtifactPath,
    activeWorkstreamsArtifactPath,
    liveSignals: scanLiveHandoffSignals(signalDir),
    reviewArtifact,
    reviewMtimeMs,
    reviewEvidence: buildTransitionEvidence(reviewArtifact, reviewArtifactPath, reviewMtimeMs),
    planArtifact,
    planMtimeMs,
    planEvidence: buildTransitionEvidence(planArtifact, planArtifactPath, planMtimeMs),
    activeWorkstreamsArtifact,
    activeWorkstreamsMtimeMs,
    activeWorkstreamsEvidence: buildTransitionEvidence(activeWorkstreamsArtifact, activeWorkstreamsArtifactPath, activeWorkstreamsMtimeMs)
  };
}

function describeSignal(liveSignal) {
  if (!liveSignal) return 'none';
  const signal = liveSignal.signal;
  return `${signal.signal_type} from ${signal.source || 'unknown'} (${signal.scope || 'no scope'})`;
}

function buildFollowOnFlow(recommendation) {
  const command = recommendation.command;
  if (command === '/review-progress advance-pipeline') {
    return [
      '/review-progress advance-pipeline',
      'If the review says planning is stale, run /plan-pipeline',
      'Then continue with /advance-pipeline'
    ];
  }

  if (command === '/plan-pipeline') {
    return [
      '/plan-pipeline',
      'Check that plan-pipeline.next-step.json now matches the master run order',
      'Then continue with /advance-pipeline'
    ];
  }

  if (command === '/advance-pipeline') {
    return [
      '/advance-pipeline',
      'When Claude emits a new live completion signal, run /review-progress advance-pipeline',
      'Refresh planning only if the review says the planning surfaces are stale'
    ];
  }

  if (command === '/review-active-workstreams') {
    return [
      '/review-active-workstreams',
      'If queue assignments or signal truth are stale, run /plan-active-workstreams',
      'Then continue the highest-priority bounded workstream'
    ];
  }

  if (command === '/plan-active-workstreams') {
    return [
      '/plan-active-workstreams',
      'Check that plan-active-workstreams.next-step.json matches the live queue assignments and signals',
      'Then continue with /review-active-workstreams'
    ];
  }

  if (!command) {
    return [
      'Inspect the latest live signal or planning artifacts',
      'If operator input is needed, publish a blocked coordination signal',
      'Resume the normal review -> plan -> advance loop once a next command is clear'
    ];
  }

  return [
    command,
    'Follow the command output truthfully',
    'Return to the normal review -> plan -> advance loop after the next bounded step'
  ];
}

function buildClaudeDirective(recommendation) {
  const lines = [];
  lines.push('Claude loop contract:');
  lines.push('- Poll `_dev/reports/signals/` every 2 minutes for live `HandoffSignal/1.0` files.');

  if (recommendation.command) {
    lines.push(`- If you are the next actor, execute \`${recommendation.command}\`.`);
  } else {
    lines.push('- If no command is listed yet, inspect the latest live signal and current planning artifacts before acting.');
  }

  lines.push('- After your pass, publish a new live coordination signal with the artifact paths, validation summary, and the exact next recommended command/actor.');
  if (recommendation.required_transition_evidence) {
    lines.push(`- Record this exact transition evidence in the produced review or planning artifact: \`${JSON.stringify(recommendation.required_transition_evidence)}\`; add the producing actor and produced-at timestamp.`);
  }
  lines.push('- Include enough handoff detail for Codex/operator review: changed files, validations run, blockers or gates, and the exact next step.');
  lines.push('- If operator input is needed, update the linked Dart task, assign it to {OPERATOR_NAME}, and include the exact decision questions in the task comment or description.');

  return lines;
}

function formatLoopStatus(state, recommendation) {
  const lines = [];
  lines.push(`[${new Date().toISOString()}] Pipeline Loop Watch`);
  lines.push(`Live coordination signals: ${state.liveSignals.length}`);
  lines.push(`Latest live signal: ${describeSignal(recommendation.latest_signal)}`);
  lines.push(`Recommended next command: ${recommendation.command || '(none)'}`);
  lines.push(`Why: ${recommendation.reason}`);

  if (recommendation.blocked_by && recommendation.blocked_by.length > 0) {
    lines.push('Blocked by:');
    for (const item of recommendation.blocked_by) {
      lines.push(`- ${item}`);
    }
  }

  lines.push('Suggested loop:');
  for (const step of buildFollowOnFlow(recommendation)) {
    lines.push(`- ${step}`);
  }

  for (const step of buildClaudeDirective(recommendation)) {
    lines.push(step);
  }

  return lines.join('\n');
}

module.exports = {
  buildClaudeDirective,
  buildFollowOnFlow,
  buildLoopState,
  buildTransitionEvidence,
  deriveLoopRecommendation,
  deriveRawLoopRecommendation,
  evidenceReviews,
  fingerprintJson,
  formatLoopStatus,
  isMainPipelineSignal,
  masterPipelineIsComplete,
  normalizeJson,
  reviewRequestsPlan,
  safeReadJson,
  scanLiveHandoffSignals,
  signalNeedsIndependentReview
};
