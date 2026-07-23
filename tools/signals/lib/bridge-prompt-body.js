'use strict';

const fs = require('fs');
const path = require('path');

const { inferWorkload, normalizeWorkload, getActor } = require('./actor-registry');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FULL_READ_ARTIFACTS = 5;

// REVIEW_ONLY wording (lessons synthesis 2026-06-03→10 root 4, 2026-06-04 /
// 2026-06-08 P5): bare "do not implement" is ambiguous when the dispatched
// command's contract REQUIRES writing analysis artifacts. This phrasing was
// proven in the 2026-06-10 drain prompts.
const REVIEW_ONLY_ARTIFACT_CLAUSE = 'the dispatched command is REVIEW_ONLY: it writes analysis artifacts only; do not implement product/system fixes';

const DEPTH_PROFILES = Object.freeze({
  light: { sections: 5, hasReviewSteps: false, hasLessons: false, hasPromptStub: false, hasSchemaCheck: false },
  review: { sections: 8, hasReviewSteps: true, hasLessons: false, hasPromptStub: false, hasSchemaCheck: false },
  full: { sections: 8, hasReviewSteps: true, hasLessons: true, hasPromptStub: true, hasSchemaCheck: true }
});

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

function actorLabel(actorId) {
  const actor = getActor(actorId);
  return actor ? actor.label : String(actorId || 'Actor');
}

/**
 * resolveCommandSpecMode — Read the execution mode declared by the canonical
 * command spec for a dispatched slash command (e.g. '/reconcile-lessons
 * 2026-06-08' → instructions/canonical/commands/reconcile-lessons.yaml →
 * 'REVIEW_ONLY'). READ-ONLY consumer of canonical specs.
 *
 * Returns '' when the command is not a slash command, the spec is missing,
 * or no top-level mode can be determined — callers treat '' as "unknown"
 * and add no mode-specific wording.
 *
 * @param {string} command - the dispatched command (with arguments)
 * @param {string} [projectRoot] - defaults to the repo root
 * @returns {string} the spec's top-level mode, or ''
 */
function resolveCommandSpecMode(command, projectRoot) {
  const head = String(command || '').trim().match(/^\/([A-Za-z0-9_-]+)/);
  if (!head) return '';
  const root = projectRoot || path.resolve(__dirname, '..', '..', '..');
  const specPath = path.join(root, 'instructions', 'canonical', 'commands', `${head[1]}.yaml`);
  let raw;
  try {
    raw = fs.readFileSync(specPath, 'utf8');
  } catch {
    return '';
  }
  // Command specs are JSON bodies in .yaml files; parse for the top-level
  // mode first so nested execution.mode blocks are never mistaken for it.
  try {
    const spec = JSON.parse(raw);
    if (spec && typeof spec.mode === 'string') return spec.mode.trim();
  } catch {
    // Fall through to a conservative first-mode-line scan.
  }
  const m = raw.match(/^\s*"?mode"?\s*:\s*"?([A-Z_]+)"?/m);
  return m ? m[1] : '';
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

function listSignalArtifacts(signal) {
  const primary = Array.isArray(signal.artifacts)
    ? signal.artifacts.filter(Boolean)
    : [];
  const decision = Array.isArray(signal.decision_context_artifacts)
    ? signal.decision_context_artifacts.filter(Boolean)
    : [];

  return {
    primary,
    decision,
    combined: Array.from(new Set([...primary, ...decision]))
  };
}

function shouldCrossCheckWiderSurfaces(signal) {
  const nextCommand = String(signal.recommended_next_command || '').trim();
  return signal.signal_type === 'blocked'
    || nextCommand === '/plan-pipeline'
    || nextCommand === '/plan-active-workstreams'
    || nextCommand === '/review-progress advance-pipeline';
}

function resolveDepth(actorId, workload) {
  const id = String(actorId || '').toLowerCase();
  const wl = String(workload || '').toLowerCase();
  if (id === 'codex') return 'full';
  if (id === 'opencode') return 'review';
  if (id === 'claude') {
    if (wl === 'low') return 'light';
    return 'review'; // medium, high, or unspecified
  }
  // local models, unknown actors
  return 'light';
}

// ---------------------------------------------------------------------------
// composePromptBody — main function
// ---------------------------------------------------------------------------

function composePromptBody(signalInfo, options) {
  const depth = options && options.depth;
  if (!depth || !DEPTH_PROFILES[depth]) {
    throw new Error(`composePromptBody: depth must be one of light, review, full (got ${JSON.stringify(depth)})`);
  }
  const actorId = options.actorId;

  // -----------------------------------------------------------------------
  // depth === 'light'
  // -----------------------------------------------------------------------
  if (depth === 'light') {
    const signal = signalInfo.signal || {};
    const mode = String(signal.execution && signal.execution.mode || 'read-only').trim() || 'read-only';
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
    lines.push('- verify recommended_next_command is executable by the nominated actor before publishing ready-for-review');
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
    if (resolveCommandSpecMode(signal.recommended_next_command, options.projectRoot) === 'REVIEW_ONLY') {
      lines.push(`- ${REVIEW_ONLY_ARTIFACT_CLAUSE}`);
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

  // -----------------------------------------------------------------------
  // depth === 'full' or depth === 'review'
  // -----------------------------------------------------------------------
  const profile = DEPTH_PROFILES[depth];
  const signal = signalInfo.signal;
  const listedArtifacts = listSignalArtifacts(signal);
  const requestedWorkload = normalizeWorkload(signal.execution && signal.execution.workload || '');
  const workload = requestedWorkload || inferWorkload(signal);
  const lines = [];

  lines.push(`Use the latest coordination signal for scope \`${signal.scope}\`.`);
  lines.push('');
  lines.push('Read first:');
  for (const artifact of signal.artifacts || []) {
    lines.push(`- \`${artifact}\``);
  }
  if (!signal.artifacts || signal.artifacts.length === 0) {
    lines.push('- `_dev/reports/signals/` (no artifact paths were attached to the signal)');
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
  lines.push(`- signal_type: \`${signal.signal_type}\``);
  lines.push(`- source: \`${signal.source || 'unknown'}\``);
  lines.push(`- scope: \`${signal.scope || 'unknown'}\``);
  lines.push(`- recommended_next_actor: \`${signal.recommended_next_actor || ''}\``);
  lines.push(`- recommended_next_command: \`${signal.recommended_next_command || ''}\``);
  if (signal.next_prompt_stub) {
    lines.push('- next_prompt_stub: present on source signal');
  }
  lines.push(`- validation_summary: ${signal.validation?.summary || 'none provided'}`);
  if (Array.isArray(signal.blocked_by) && signal.blocked_by.length > 0) {
    lines.push('- blockers:');
    for (const blocker of signal.blocked_by) {
      lines.push(`  - ${blocker}`);
    }
  }
  if (signal.execution && typeof signal.execution === 'object') {
    lines.push('');
    lines.push('Execution context:');
    lines.push(`- mode: \`${signal.execution.mode || 'patch-allowed'}\``);
    lines.push(`- cwd: \`${signal.execution.cwd || '.'}\``);
    lines.push(`- workload: \`${workload}\``);
    if (signal.execution.model) {
      lines.push(`- requested_model: \`${signal.execution.model}\``);
    }
    if (signal.execution.timeout_ms) {
      lines.push(`- timeout_ms: \`${signal.execution.timeout_ms}\``);
    }
  } else {
    lines.push('');
    lines.push('Execution context:');
    lines.push(`- workload: \`${workload}\``);
  }
  lines.push('');
  lines.push('Task:');
  lines.push('- treat the repo artifacts as source of truth');
  lines.push('');
  lines.push('## Step 1: Review the scoped slice');
  if (listedArtifacts.primary.length > 0) {
    lines.push('- start with the attached artifacts and finish those before widening scope');
  } else {
    lines.push('- start with the live signal context and only add directly related artifacts if they are required');
  }
  if (listedArtifacts.decision.length > 0) {
    lines.push('- use decision-context artifacts only to cross-check the attached slice and the truthful next command');
  }
  if (listedArtifacts.combined.length > MAX_FULL_READ_ARTIFACTS) {
    lines.push(`- there are ${listedArtifacts.combined.length} attached/context artifacts; first classify them by role and read the highest-signal files fully before widening`);
  } else if (listedArtifacts.combined.length > 0) {
    lines.push('- read the attached artifacts in full before inspecting anything else');
  }
  lines.push('- inspect only directly related changed files; do not treat the whole worktree as the review target');
  lines.push('- if diff context is needed, prefer `git diff -- <paths...>` scoped to the attached or directly related files');
  lines.push('- do not run repo-wide `git diff --stat` or `git diff` by default');
  if (shouldCrossCheckWiderSurfaces(signal)) {
    lines.push('- widen only to closely related planning, signal, or workflow surfaces needed to verify the blocker or the truthful next command');
  }
  lines.push('- do not inspect `_dev/reports/analysis/session-bundles` or archive surfaces unless they are explicitly attached or clearly required by the signal');
  lines.push('- check for paired artifacts that should have been updated together inside this slice (e.g., .md + .expectation-failures.json, signal + planning surface)');
  lines.push('');
  lines.push('## Step 2: Produce scoped findings');
  if (signal.signal_type === 'blocked') {
    lines.push('- assess the blocker, identify the exact operator decision or repo fix needed');
  } else if (signal.recommended_next_command === '/review-progress advance-pipeline') {
    lines.push('- run a findings-first review mindset against the indicated pipeline output and supporting artifacts');
    lines.push('- state whether planning refresh is needed before more execution');
  } else if (signal.recommended_next_command === '/plan-pipeline') {
    lines.push('- verify whether the planning surfaces are stale and what the truthful next command should be');
  } else {
    lines.push('- inspect whether the recommended next command is still the truthful next move');
    lines.push('- if it is not, explain what changed and what should happen instead');
  }
  lines.push('- flag any gaps, stale references, missing updates, or inconsistencies inside the reviewed slice');
  lines.push('- flag any quality issues: vague content, overclaiming, missing evidence, structural problems');
  lines.push('');
  lines.push('## Step 3: Make concrete suggestions');
  lines.push('- for each finding, provide a specific actionable recommendation with exact file paths and what should change');
  lines.push('- if the execution mode is `patch-allowed` or `full-auto`, make the changes directly instead of just recommending them');
  lines.push('- keep any edits minimal and bounded to the reviewed slice');
  lines.push('- if the execution mode is `read-only`, write detailed suggestions that Claude can apply in the next pass');
  if (resolveCommandSpecMode(signal.recommended_next_command, options.projectRoot) === 'REVIEW_ONLY') {
    lines.push(`- ${REVIEW_ONLY_ARTIFACT_CLAUSE}`);
  }

  // Step numbering: full uses Steps 1-5 (with Step 4 = Lessons).
  // review skips lessons, so Step 4 in review = "Verify next command".
  const verifyStepNum = profile.hasLessons ? 5 : 4;

  if (profile.hasLessons) {
    lines.push('');
    lines.push('## Step 4: Lessons learned');
    lines.push('- reflect on what you observed in this review pass');
    lines.push('- identify any patterns, recurring issues, process gaps, or non-obvious insights worth preserving');
    lines.push('- write a "Lessons from this review" section with concrete, actionable takeaways — not generic advice');
    lines.push('- flag anything that should change in the bridge prompt itself, the signal contract, or the review process');
    lines.push('- these lessons will be consumed by the lessons reconciliation loop to improve future work');
  }

  lines.push('');
  lines.push(`## Step ${verifyStepNum}: Verify next command`);
  lines.push('- verify recommended_next_command is executable by the nominated actor before publishing ready-for-review (check the actor/command pair against tools/signals/lib/target-command-policy.cjs and the canonical command registry)');
  lines.push('- inspect whether the recommended next command is still the truthful next move given your review findings');
  lines.push('- if it is not, explain what changed and what should happen instead');
  lines.push('- if the truthful path requires analysis first, perform the analysis and then continue through planning or workflow-update steps until the next move is actionable');
  lines.push('- if planning or workflow surfaces are stale, update or recommend the exact planning/workflow command instead of stopping at generic review notes');
  lines.push('- continue reasoning until you can name one exact next command or conclude that Claude must leave an operator action item');
  lines.push('- do not stop at vague advice like "needs more investigation" without a concrete next action owner');
  if (profile.hasPromptStub) {
    lines.push('- when one bounded follow-on slice is clearly supported, include an optional next-prompt stub the next actor can use directly');
    lines.push('- keep any prompt stub short, exact, and scoped to one follow-on slice');
  }
  if (Array.isArray(signal.next_step_detail) && signal.next_step_detail.length > 0) {
    lines.push('');
    lines.push('Specific instructions from the source signal:');
    for (const step of signal.next_step_detail) {
      lines.push(`- ${step}`);
    }
  }
  lines.push('');
  lines.push('Return:');
  lines.push('- findings first');
  lines.push('- exact next command');
  if (profile.hasPromptStub) {
    lines.push('- optional next prompt stub (only when one bounded follow-on slice is clearly supportable)');
  }
  lines.push('- any operator decisions needed');
  lines.push('- if no exact repo command is supportable, tell Claude to leave an operator action item with recommended options and evidence');
  lines.push('- any Dart-task update recommendation if the workstream is blocked or ready for review');
  lines.push('');
  lines.push('Use this response shape:');
  lines.push('1. Scoped review (attached artifacts and directly related files, with specific line references where useful)');
  lines.push('2. Findings (gaps, inconsistencies, quality issues, missed paired artifacts)');
  lines.push('3. Suggestions (concrete, actionable — exact file paths and content changes, or applied directly if execution mode allows)');
  if (profile.hasLessons) {
    lines.push('4. Lessons from this review (patterns, process gaps, non-obvious insights, improvements to the review process itself)');
    lines.push('5. Exact next command');
    if (profile.hasPromptStub) {
      lines.push('6. Optional next prompt stub');
    }
    // For full: sections after prompt stub
    const decisionsNum = profile.hasPromptStub ? 7 : 6;
    lines.push(`${decisionsNum}. Operator decisions needed`);
    lines.push(`${decisionsNum + 1}. Evidence used`);
  } else {
    // review: no lessons, no prompt stub
    lines.push('4. Exact next command');
    lines.push('5. Operator decisions needed');
    lines.push('6. Evidence used');
  }

  if (profile.hasSchemaCheck) {
    lines.push('');
    lines.push('## Pre-signal schema check');
    lines.push('Before publishing a ready-for-review signal for this slice:');
    lines.push('- Compare the field names in any JSON artifacts produced by this slice against the plan-declared `expected_outcomes` and `required_gates` (if available from the signal context or referenced planning surfaces)');
    lines.push('- Flag any field name mismatches between produced artifacts and plan-declared contracts (e.g. `bridge_state_artifacts` vs `bridge_state_key`, or any renamed/missing/extra fields)');
    lines.push('- If plan-declared output contracts are not available, note that and skip this check');
    lines.push('- Any mismatches must be resolved before the signal is published');
    lines.push('');
    lines.push('Signal-emission evidence contract:');
    lines.push('- when the follow-up signal claims `validation.ran=true`, its `validation.summary` must carry the exact command(s) run and their results — never bare boilerplate');
    lines.push('- when validation did not run, set `validation.ran=false` with an explicit reason stating why it did not run');
    lines.push('- the completion signal\'s `recommended_next_command` must match your "Exact next command" section verbatim when one is declared');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  composePromptBody,
  resolveDepth,
  resolveCommandSpecMode,
  listSignalArtifacts,
  shouldCrossCheckWiderSurfaces,
  DEPTH_PROFILES,
  MAX_FULL_READ_ARTIFACTS,
  REVIEW_ONLY_ARTIFACT_CLAUSE
};
