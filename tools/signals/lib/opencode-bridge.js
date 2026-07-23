'use strict';

/**
 * OpenCode Bridge — harness-specific wrapper for Mythos bridge review.
 *
 * This module produces review prompts targeted at OpenCode's execution
 * model. The body of the prompt (5-step review + 8-section response
 * shape) is shared with codex-bridge.js via composePromptBody — this
 * guarantees contract fidelity by construction. Only the transport
 * metadata (output path, scope label, execution model defaults) differs.
 *
 * OpenCode capability surface (from actor registry):
 *   - read_only: true
 *   - patch_allowed: true
 *   - full_auto: false   <-- NOT supported
 *
 * If a signal requests execution.mode === 'full-auto', the OpenCode bridge
 * downgrades to 'patch-allowed' and records the downgrade in the output
 * metadata.
 */

const fs = require('fs');
const path = require('path');

const {
  sanitizeScope,
  selectLatestActionableSignal,
  validateSignalForDispatch,
  buildPromptFromPlan,
  writeBridgePrompt,
  loadGroundingBundle,
  normalizeGroundingMode,
  buildGroundingDescriptor,
  renderGroundingDescriptor
} = require('./codex-bridge');
const { composePromptBody } = require('./bridge-prompt-body');

const { buildLoopState } = require('./pipeline-loop');

// ─── OpenCode execution mode handling ───────────────────────────────────────

const OPENCODE_SUPPORTED_MODES = Object.freeze(['read-only', 'patch-allowed']);

/**
 * Downgrade execution mode to what OpenCode supports.
 * Returns { mode, downgraded, original }.
 */
function normalizeOpenCodeExecutionMode(requestedMode) {
  const mode = String(requestedMode || 'read-only').toLowerCase();
  if (OPENCODE_SUPPORTED_MODES.includes(mode)) {
    return { mode, downgraded: false, original: mode };
  }
  if (mode === 'full-auto') {
    return { mode: 'patch-allowed', downgraded: true, original: 'full-auto' };
  }
  return { mode: 'read-only', downgraded: true, original: mode };
}

// ─── Prompt builders ────────────────────────────────────────────────────────

/**
 * buildPromptFromSignal — Execution form for OpenCode.
 * Reuses composePromptBody from codex-bridge for contract fidelity.
 * Prepends OpenCode-specific header noting capability constraints.
 *
 * @param {object} signalInfo
 * @param {object} [opts]
 * @returns {string}
 */
function buildPromptFromSignal(signalInfo, opts) {
  const signal = signalInfo.signal;
  const execMode = normalizeOpenCodeExecutionMode(signal.execution && signal.execution.mode);

  const groundingOpts = (opts && typeof opts === 'object') ? opts : {};
  const groundingMode = normalizeGroundingMode(signal && signal.grounding_mode);
  const grounding = loadGroundingBundle(groundingMode, { projectRoot: groundingOpts.projectRoot || '' });

  const header = [];
  header.push('# OpenCode Bridge Review');
  header.push('');
  header.push('This review is dispatched via the OpenCode CLI harness.');
  header.push('');
  header.push(`Capability surface: ${OPENCODE_SUPPORTED_MODES.join(', ')} (no full-auto).`);
  if (execMode.downgraded) {
    header.push(`Execution mode: \`${execMode.mode}\` (downgraded from requested \`${execMode.original}\` — OpenCode does not support that mode).`);
  } else {
    header.push(`Execution mode: \`${execMode.mode}\`.`);
  }
  header.push('');
  header.push('The review contract below is shared with the Codex bridge — same 5-step review, same 8-section response shape. Only the execution transport differs.');
  header.push('');
  header.push('---');
  header.push('');

  const body = composePromptBody(signalInfo, { depth: 'review' });
  const prompt = grounding.text
    ? `${grounding.text}\n${header.join('\n')}${body}`
    : `${header.join('\n')}${body}`;
  return prompt;
}

/**
 * buildPromptForArtifact — Disk-safe form for OpenCode.
 * Uses grounding descriptor (no substrate content) instead of full text.
 */
function buildPromptForArtifact(signalInfo, opts) {
  const signal = signalInfo && signalInfo.signal;
  const execMode = normalizeOpenCodeExecutionMode(signal && signal.execution && signal.execution.mode);
  const groundingOpts = (opts && typeof opts === 'object') ? opts : {};
  const groundingMode = normalizeGroundingMode(signal && signal.grounding_mode);
  const grounding = loadGroundingBundle(groundingMode, { projectRoot: groundingOpts.projectRoot || '' });
  const descriptor = buildGroundingDescriptor(grounding, { projectRoot: groundingOpts.projectRoot || '' });
  const descriptorBlock = renderGroundingDescriptor(descriptor);

  const header = [];
  header.push('# OpenCode Bridge Review');
  header.push('');
  header.push('This review is dispatched via the OpenCode CLI harness.');
  header.push('');
  header.push(`Capability surface: ${OPENCODE_SUPPORTED_MODES.join(', ')} (no full-auto).`);
  if (execMode.downgraded) {
    header.push(`Execution mode: \`${execMode.mode}\` (downgraded from requested \`${execMode.original}\`).`);
  } else {
    header.push(`Execution mode: \`${execMode.mode}\`.`);
  }
  header.push('');
  header.push('The review contract below is shared with the Codex bridge — same 5-step review, same 8-section response shape. Only the execution transport differs.');
  header.push('');
  header.push('---');
  header.push('');

  const body = composePromptBody(signalInfo, { depth: 'review' });
  return descriptorBlock
    ? `${descriptorBlock}${header.join('\n')}${body}`
    : `${header.join('\n')}${body}`;
}

// ─── buildOpenCodeBridge — parallel to buildCodexBridge ──────────────────────

function buildOpenCodeBridge(projectRoot) {
  const state = buildLoopState(projectRoot);
  const latestSignal = selectLatestActionableSignal(state);

  if (latestSignal) {
    const safeScope = sanitizeScope(latestSignal.signal.scope);
    const dispatchValidation = validateSignalForDispatch(latestSignal, projectRoot);
    const execMode = normalizeOpenCodeExecutionMode(
      latestSignal.signal.execution && latestSignal.signal.execution.mode
    );
    return {
      mode: 'live-signal',
      actor: 'opencode',
      previewOnly: false,
      validated: dispatchValidation.valid,
      validationErrors: dispatchValidation.errors,
      scope: latestSignal.signal.scope || 'general',
      sourceSignalPath: latestSignal.filePath,
      outputPath: path.join(projectRoot, '_dev', 'reports', 'analysis', `opencode-bridge-prompt__${safeScope}.md`),
      content: buildPromptForArtifact(latestSignal, { projectRoot }),
      executionMode: execMode.mode,
      modeDowngraded: execMode.downgraded,
      originalMode: execMode.original
    };
  }

  return {
    mode: 'plan-fallback',
    actor: 'opencode',
    previewOnly: true,
    validated: false,
    scope: 'plan-pipeline',
    sourceSignalPath: '',
    outputPath: path.join(projectRoot, '_dev', 'reports', 'analysis', 'opencode-bridge-prompt__plan-pipeline.md'),
    content: buildPromptFromPlan(state.planArtifactPath, state.activeWorkstreamsArtifactPath)
  };
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  buildOpenCodeBridge,
  buildPromptFromSignal,
  buildPromptForArtifact,
  normalizeOpenCodeExecutionMode,
  OPENCODE_SUPPORTED_MODES
};
