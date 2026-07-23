'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { inferWorkload, normalizeWorkload } = require('./actor-registry');
const { buildLoopState, masterPipelineIsComplete, safeReadJson } = require('./pipeline-loop');
const { validateHandoffSignal } = require('../../verify/lib/signal.cjs');
const { isPromptTargetPath, validatePasteTargetPrompt } = require('../../verify/lib/paste-target-prompt.cjs');
const { isDistinctIntelligence, normalizeProvenance } = require('../../planning/lib/provenance-utils');
const { writeStatusSnapshot } = require('../../status/bridge-status');
const {
  composePromptBody: _composePromptBodyShared
} = require('./bridge-prompt-body');

// ---------------------------------------------------------------------------
// Grounding bundle (opt-in, probationary)
// ---------------------------------------------------------------------------
//
// System-level codex-bridge reviews may optionally include a grounding
// substrate alongside the review prompt. The substrate lives locally at
// _dev/research/{OPERATOR_NAME}-philosophy/ and is gitignored.
//
// Grounding is OPT-IN via the signal field `grounding_mode`:
//   - 'none' (or missing) — no grounding section is prepended; behavior
//     is identical to pre-grounding builds.
//   - 'kernel' — prepend KERNEL.md, LINEAGE.md, grounding-patterns.md.
//   - 'kernel_deep' — kernel bundle plus meetings/{OPERATOR_NAME}-{OPERATOR_NAME}.md and
//     a-conversation-with-claude__continuation.md.
//
// If grounding-bundle files are missing on disk (expected on machines
// where the substrate is not present), loadGroundingBundle returns an
// empty string with a null file list — the prompt is built as if
// grounding_mode were 'none'. This keeps the edit safe for any non-local
// environment.
//
// Grounding should mirror the posture that `plan-task` honors at the
// planning layer: it is interpretive posture, not implementation spec,
// and local acceptance criteria remain primary data.

const GROUNDING_MODES = Object.freeze({
  NONE: 'none',
  KERNEL: 'kernel',
  KERNEL_DEEP: 'kernel_deep'
});

const GROUNDING_ROOT_REL = path.join('_dev', 'research', '{OPERATOR_NAME}-philosophy');

const GROUNDING_BUNDLE_FILES = Object.freeze({
  kernel: Object.freeze([
    'KERNEL.md',
    'LINEAGE.md',
    'grounding-patterns.md'
  ]),
  kernel_deep: Object.freeze([
    'KERNEL.md',
    'LINEAGE.md',
    'grounding-patterns.md',
    path.join('meetings', '{OPERATOR_NAME}-{OPERATOR_NAME}.md'),
    'a-conversation-with-claude__continuation.md'
  ])
});

function resolveGroundingRoot(projectRoot) {
  const root = projectRoot || path.resolve(__dirname, '..', '..', '..');
  return path.join(root, GROUNDING_ROOT_REL);
}

/**
 * normalizeGroundingMode — Coerce any raw mode value into a valid enum.
 * Unknown or falsy values map to 'none'.
 *
 * @param {string} mode
 * @returns {string} one of GROUNDING_MODES values
 */
function normalizeGroundingMode(mode) {
  const value = String(mode || '').trim().toLowerCase();
  if (value === GROUNDING_MODES.KERNEL) return GROUNDING_MODES.KERNEL;
  if (value === GROUNDING_MODES.KERNEL_DEEP) return GROUNDING_MODES.KERNEL_DEEP;
  return GROUNDING_MODES.NONE;
}

/**
 * loadGroundingBundle — Read the grounding-substrate files for the given
 * mode and return a single concatenated "## Grounding Context" section
 * along with the list of files that were actually loaded.
 *
 * For mode 'none' (or any unknown mode) the function returns an empty
 * text block with an empty files array — callers should prepend nothing.
 *
 * If a bundle file is missing on disk, it is silently skipped; callers
 * that care about completeness can inspect the returned files list.
 *
 * @param {string} mode - 'none' | 'kernel' | 'kernel_deep'
 * @param {object} [opts]
 * @param {string} [opts.projectRoot] - Absolute project root; defaults to Mythos repo root
 * @returns {{ mode: string, text: string, files: string[], missing: string[] }}
 */
function loadGroundingBundle(mode, opts) {
  const normalized = normalizeGroundingMode(mode);
  if (normalized === GROUNDING_MODES.NONE) {
    return { mode: GROUNDING_MODES.NONE, text: '', files: [], missing: [] };
  }

  const root = resolveGroundingRoot((opts && opts.projectRoot) || '');
  const bundle = GROUNDING_BUNDLE_FILES[normalized] || [];
  const loaded = [];
  const missing = [];
  const sections = [];

  for (const rel of bundle) {
    const absPath = path.join(root, rel);
    let content = '';
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch (_err) {
      missing.push(rel);
      continue;
    }
    loaded.push(rel);
    sections.push(`### ${rel}\n\n${content.trim()}`);
  }

  if (loaded.length === 0) {
    // Substrate not present on this machine; treat as none so the review
    // prompt is unchanged from the pre-grounding behavior.
    return { mode: normalized, text: '', files: [], missing };
  }

  const header = [
    '## Grounding Context',
    '',
    'The following files are the grounding substrate for this Mythos project. They are interpretive posture, not implementation spec. Use them to understand intent, epistemic posture, and non-negotiables for system-level work. Local artifacts and acceptance criteria attached to this review remain primary data. If the grounding and the local contract appear to conflict, call that out explicitly rather than silently resolving in either direction. This treatment is consistent with how `plan-task` uses grounding at the planning layer.',
    '',
    'If deeper context beyond what is supplied here would resolve a specific concern, ask the operator — `meetings/` and the conversation continuation file are available on request but are not loaded by default.',
    '',
    '---',
    ''
  ].join('\n');

  const body = sections.join('\n\n---\n\n');
  const text = `${header}${body}\n\n---\n`;
  return { mode: normalized, text, files: loaded, missing };
}

/**
 * buildGroundingDescriptor — Convert a loaded grounding bundle (from
 * loadGroundingBundle) into a containment-safe descriptor that can be
 * written to disk. The descriptor records which substrate files were
 * supplied to Codex and the sha256 + byte size of each, but never the
 * file content itself — the substrate stays local-only.
 *
 * @param {{ mode: string, files: string[], missing: string[], text: string }} grounding
 * @param {object} [opts]
 * @param {string} [opts.projectRoot] - Absolute project root for resolving file paths
 * @returns {{ grounding_mode: string, files: Array<{ path: string, size: number, sha256: string }>, loaded_count: number, missing: string[] }}
 */
function buildGroundingDescriptor(grounding, opts) {
  const groundingOpts = (opts && typeof opts === 'object') ? opts : {};
  const mode = (grounding && grounding.mode) ? grounding.mode : GROUNDING_MODES.NONE;
  const missing = (grounding && Array.isArray(grounding.missing)) ? grounding.missing.slice() : [];

  if (!grounding || mode === GROUNDING_MODES.NONE || !Array.isArray(grounding.files) || grounding.files.length === 0) {
    return {
      grounding_mode: mode,
      files: [],
      loaded_count: 0,
      missing
    };
  }

  const root = resolveGroundingRoot(groundingOpts.projectRoot || '');
  const files = [];
  for (const rel of grounding.files) {
    const absPath = path.join(root, rel);
    let content = '';
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch (_err) {
      // File disappeared between load and descriptor; record as missing.
      if (!missing.includes(rel)) missing.push(rel);
      continue;
    }
    const size = Buffer.byteLength(content, 'utf8');
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    files.push({ path: rel, size, sha256 });
  }

  return {
    grounding_mode: mode,
    files,
    loaded_count: files.length,
    missing
  };
}

/**
 * renderGroundingDescriptor — Render the descriptor as a compact markdown
 * block suitable for prepending to an artifact-form prompt. Substrate
 * content is NEVER included — only the file list, hashes, and sizes.
 *
 * Returns an empty string when grounding_mode === 'none' so ungrounded
 * runs carry no descriptor block at all.
 *
 * @param {{ grounding_mode: string, files: Array<{ path: string, size: number, sha256: string }>, loaded_count: number, missing: string[] }} descriptor
 * @returns {string}
 */
function renderGroundingDescriptor(descriptor) {
  if (!descriptor || !descriptor.grounding_mode || descriptor.grounding_mode === GROUNDING_MODES.NONE) {
    return '';
  }

  const lines = [];
  lines.push('## Grounding Context');
  lines.push('');
  lines.push(`mode: ${descriptor.grounding_mode}`);
  lines.push('files:');
  if (!Array.isArray(descriptor.files) || descriptor.files.length === 0) {
    lines.push('- (none loaded)');
  } else {
    for (const entry of descriptor.files) {
      lines.push(`- ${entry.path} (sha256:${entry.sha256} size:${entry.size})`);
    }
  }
  if (Array.isArray(descriptor.missing) && descriptor.missing.length > 0) {
    lines.push('missing:');
    for (const rel of descriptor.missing) {
      lines.push(`- ${rel}`);
    }
  }
  lines.push('');
  lines.push('*Substrate content is held local-only per KERNEL.md declaration and is never written to tracked artifact paths. Full substrate was supplied to Codex via the execution pipe.*');
  lines.push('');
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

function sanitizeScope(value) {
  return String(value || 'general')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'general';
}

function isWithinProjectRoot(projectRoot, candidatePath) {
  if (!projectRoot || !candidatePath) return false;
  const relative = path.relative(projectRoot, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function selectLatestActionableSignal(state) {
  if (!state || !Array.isArray(state.liveSignals)) return null;
  return state.liveSignals[0] || null;
}

/**
 * composePromptBody — delegates to the shared bridge-prompt-body module
 * with depth 'full' (the Codex contract). Kept as a local function for
 * backward-compatible call sites within this file. opts.projectRoot lets
 * the shared module resolve the dispatched command's canonical spec mode
 * (REVIEW_ONLY wording); when omitted it falls back to the repo root.
 */
function composePromptBody(signalInfo, opts) {
  return _composePromptBodyShared(signalInfo, {
    depth: 'full',
    projectRoot: (opts && opts.projectRoot) || ''
  });
}

/**
 * buildPromptFromSignal — Build the execution form of a review prompt.
 * When signal.grounding_mode is 'kernel' or 'kernel_deep', the full
 * substrate text is prepended to the body for Codex to read over the
 * execution pipe. This is the form that reaches the model; it is NOT
 * safe for writing to tracked artifact paths (use buildPromptForArtifact
 * for the disk form).
 *
 * @param {object} signalInfo
 * @param {object} [opts]
 * @param {string} [opts.projectRoot]
 * @returns {string}
 */
function buildPromptFromSignal(signalInfo, opts) {
  const signal = signalInfo.signal;
  // Grounding is opt-in via signal.grounding_mode. It is a local-only
  // substrate, so absence of files is treated as 'none' rather than an
  // error. The bundle info is attached to the returned prompt (via a
  // non-enumerable helper, for callers that can read it) and is also
  // exposed via buildPromptFromSignalWithGrounding below for callers
  // that need the metadata explicitly.
  const groundingMode = normalizeGroundingMode(signal && signal.grounding_mode);
  const groundingOpts = (opts && typeof opts === 'object') ? opts : {};
  const grounding = loadGroundingBundle(groundingMode, { projectRoot: groundingOpts.projectRoot || '' });
  const body = composePromptBody(signalInfo, groundingOpts);
  const prompt = grounding.text ? `${grounding.text}\n${body}` : body;
  // Attach a non-enumerable grounding descriptor so callers that know to
  // look for it can record grounding_mode + files supplied in the
  // closeout artifact, without changing the existing return-type
  // contract (string) for callers that do not. The descriptor is the
  // containment-safe form (paths + hashes only, no substrate content).
  try {
    const descriptor = buildGroundingDescriptor(grounding, { projectRoot: groundingOpts.projectRoot || '' });
    Object.defineProperty(prompt, '__grounding', {
      value: Object.freeze({
        mode: grounding.mode,
        files: grounding.files.slice(),
        missing: grounding.missing.slice(),
        descriptor: Object.freeze(descriptor)
      }),
      enumerable: false
    });
  } catch (_) {
    // String primitives cannot carry properties; that's fine — the
    // explicit accessor buildPromptFromSignalWithGrounding is available
    // for callers that need the metadata.
  }
  return prompt;
}

/**
 * buildPromptForArtifact — Build the disk-safe form of a review prompt.
 * Instead of prepending the full substrate text, this form prepends a
 * rendered grounding descriptor (paths + sha256 + size only). The
 * substrate content is never written to tracked paths; it reaches Codex
 * only via the execution pipe in buildPromptFromSignal.
 *
 * For grounding_mode='none', the returned string is byte-identical to
 * the execution form (no descriptor block is emitted).
 *
 * @param {object} signalInfo
 * @param {object} [opts]
 * @param {string} [opts.projectRoot]
 * @returns {string}
 */
function buildPromptForArtifact(signalInfo, opts) {
  const signal = signalInfo && signalInfo.signal;
  const groundingOpts = (opts && typeof opts === 'object') ? opts : {};
  const groundingMode = normalizeGroundingMode(signal && signal.grounding_mode);
  const grounding = loadGroundingBundle(groundingMode, { projectRoot: groundingOpts.projectRoot || '' });
  const descriptor = buildGroundingDescriptor(grounding, { projectRoot: groundingOpts.projectRoot || '' });
  const header = renderGroundingDescriptor(descriptor);
  const body = composePromptBody(signalInfo, groundingOpts);
  return header ? `${header}${body}` : body;
}

/**
 * buildPromptFromSignalWithGrounding — Like buildPromptFromSignal, but
 * returns both the prompt text and an explicit grounding descriptor so
 * callers (e.g., the dispatch runner that writes run-result closeout
 * artifacts) can record the grounding_mode and the list of files that
 * were actually supplied to Codex.
 *
 * Behavior is otherwise identical — in particular, when grounding_mode
 * is 'none' or missing, the prompt is byte-identical to what
 * buildPromptFromSignal produced before grounding was added.
 *
 * @param {object} signalInfo
 * @param {object} [opts]
 * @param {string} [opts.projectRoot]
 * @returns {{ prompt: string, grounding: { mode: string, files: string[], missing: string[] } }}
 */
function buildPromptFromSignalWithGrounding(signalInfo, opts) {
  const groundingOpts = (opts && typeof opts === 'object') ? opts : {};
  const signal = signalInfo && signalInfo.signal;
  const mode = normalizeGroundingMode(signal && signal.grounding_mode);
  const grounding = loadGroundingBundle(mode, { projectRoot: groundingOpts.projectRoot || '' });
  const prompt = buildPromptFromSignal(signalInfo, groundingOpts);
  return {
    prompt,
    grounding: {
      mode: grounding.mode,
      files: grounding.files.slice(),
      missing: grounding.missing.slice()
    }
  };
}

function buildPromptFromPlan(planArtifactPath, activeWorkstreamsArtifactPath = '') {
  const artifact = safeReadJson(planArtifactPath);
  const activeArtifact = activeWorkstreamsArtifactPath ? safeReadJson(activeWorkstreamsArtifactPath) : null;
  const lines = [];
  lines.push('No live coordination signal is present. Use the current planning artifact.');
  lines.push('');
  lines.push('Read first:');
  lines.push(`- \`${path.relative(process.cwd(), planArtifactPath) || planArtifactPath}\``);
  if (masterPipelineIsComplete(artifact) && activeWorkstreamsArtifactPath) {
    lines.push(`- \`${path.relative(process.cwd(), activeWorkstreamsArtifactPath) || activeWorkstreamsArtifactPath}\``);
    lines.push('- `_dev/reports/analysis/plan-active-workstreams.md`');
  } else {
    lines.push('- `_dev/reports/analysis/plan-pipeline.md`');
  }
  lines.push('- `_dev/prompts/claude-master-run-order.md`');
  lines.push('');
  lines.push('Task:');
  lines.push('- verify whether the planning artifact is still coherent with the current source of truth');
  if (artifact?.next_recommended_command) {
    lines.push(`- current recommended command in plan artifact: \`${artifact.next_recommended_command}\``);
  }
  if (activeArtifact?.next_recommended_command && masterPipelineIsComplete(artifact)) {
    lines.push(`- current recommended command in active-workstreams artifact: \`${activeArtifact.next_recommended_command}\``);
  }
  lines.push('- if the planning artifact is stale, explain the drift and the exact next command');
  lines.push('');
  lines.push('Return:');
  lines.push('- findings first');
  lines.push('- exact next command');
  lines.push('- any operator decisions needed');
  return lines.join('\n');
}

function validateSignalForDispatch(signalInfo, projectRoot) {
  if (!signalInfo || !signalInfo.signal) {
    return { valid: false, errors: ['No signal provided'], previewOnly: true };
  }
  const signal = signalInfo.signal;
  const errors = [];

  // Structural validation
  const structResult = validateHandoffSignal(signal, { projectRoot });
  if (!structResult.valid) {
    errors.push(...structResult.errors);
  }

  // Dispatch-specific checks
  if (!signal.recommended_next_command || signal.recommended_next_command.trim() === '') {
    errors.push('recommended_next_command is empty — cannot dispatch without an explicit command');
  }

  if (!Array.isArray(signal.artifacts) || signal.artifacts.length === 0) {
    errors.push('artifacts array is empty — dispatch target has no context artifacts');
  } else if (projectRoot) {
    const missing = signal.artifacts.filter(a => {
      const resolved = path.resolve(projectRoot, a);
      return !fs.existsSync(resolved);
    });
    if (missing.length > 0) {
      errors.push(`artifacts missing on disk: ${missing.join(', ')}`);
    }
  }

  if (Array.isArray(signal.decision_context_artifacts) && projectRoot) {
    const missing = signal.decision_context_artifacts.filter(a => {
      const resolved = path.resolve(projectRoot, a);
      return !fs.existsSync(resolved);
    });
    if (missing.length > 0) {
      errors.push(`decision_context_artifacts missing on disk: ${missing.join(', ')}`);
    }
  }

  if (projectRoot && signal.execution && typeof signal.execution === 'object' && signal.execution.cwd) {
    const resolvedCwd = path.resolve(projectRoot, signal.execution.cwd);
    if (!isWithinProjectRoot(projectRoot, resolvedCwd)) {
      errors.push(`execution.cwd resolves outside project root: ${signal.execution.cwd}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    previewOnly: false
  };
}

function writeBridgePrompt(outputPath, content) {
  if (isPromptTargetPath(outputPath)) {
    const result = validatePasteTargetPrompt(outputPath, { content });
    if (!result.ok) {
      const violationLines = result.violations
        .map(v => `  - ${v.rule}${v.line ? ':' + v.line : ''}: ${v.message}`)
        .join('\n');
      process.stderr.write(
        `paste-target-prompt validator: REFUSING TO WRITE ${outputPath}\n${violationLines}\nFix the prompt body and retry.\n`
      );
      process.exit(1);
    }
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content);
  return outputPath;
}

function buildCodexBridge(projectRoot) {
  const state = buildLoopState(projectRoot);
  const latestSignal = selectLatestActionableSignal(state);

  if (latestSignal) {
    const safeScope = sanitizeScope(latestSignal.signal.scope);
    const dispatchValidation = validateSignalForDispatch(latestSignal, projectRoot);
    // Disk-bound `content` is the artifact form (descriptor only). The
    // execution form (full substrate) is built separately by callers
    // that dispatch to Codex via stdin — see codex-auto.js dispatch path.
    return {
      mode: 'live-signal',
      previewOnly: false,
      validated: dispatchValidation.valid,
      validationErrors: dispatchValidation.errors,
      scope: latestSignal.signal.scope || 'general',
      sourceSignalPath: latestSignal.filePath,
      outputPath: path.join(projectRoot, '_dev', 'reports', 'analysis', `codex-bridge-prompt__${safeScope}.md`),
      content: buildPromptForArtifact(latestSignal, { projectRoot })
    };
  }

  return {
    mode: 'plan-fallback',
    previewOnly: true,
    validated: false,
    scope: 'plan-pipeline',
    sourceSignalPath: '',
    outputPath: path.join(projectRoot, '_dev', 'reports', 'analysis', 'codex-bridge-prompt__plan-pipeline.md'),
    content: buildPromptFromPlan(state.planArtifactPath, state.activeWorkstreamsArtifactPath)
  };
}

// ---------------------------------------------------------------------------
// Bridge state tracking
// ---------------------------------------------------------------------------

/**
 * Valid bridge state transitions:
 *   handoff_prepared → bridge_active → feedback_received
 *
 * `blocked_on_actor_bridge` is the state when the current actor cannot
 * launch the bridge (e.g., Codex binary not found, validation failed).
 *
 * Artifact publication alone is NOT completion — `feedback_received`
 * is required before a bridge handoff can be considered done.
 *
 * @readonly
 * @enum {string}
 */
const BRIDGE_STATES = Object.freeze({
  HANDOFF_PREPARED: 'handoff_prepared',
  BRIDGE_ACTIVE: 'bridge_active',
  FEEDBACK_RECEIVED: 'feedback_received',
  BLOCKED_ON_ACTOR_BRIDGE: 'blocked_on_actor_bridge'
});

/**
 * Valid state transitions for bridge lifecycle.
 * @type {Record<string, string[]>}
 */
const BRIDGE_TRANSITIONS = Object.freeze({
  handoff_prepared: ['bridge_active', 'blocked_on_actor_bridge'],
  bridge_active: ['feedback_received', 'blocked_on_actor_bridge'],
  feedback_received: ['handoff_prepared'],
  blocked_on_actor_bridge: ['handoff_prepared']
});

/**
 * In-memory bridge state store, keyed by scope.
 * Persisted to `_dev/state/bridge-state.json` when written.
 * @type {Map<string, { state: string, scope: string, updated_at: string, history: Array<{ from: string, to: string, ts: string }> }>}
 */
const _bridgeStateCache = new Map();

/**
 * Path to the on-disk bridge state file.
 * @param {string} projectRoot
 * @returns {string}
 */
function bridgeStatePath(projectRoot) {
  return path.join(projectRoot, '_dev', 'state', 'bridge-state.json');
}

/**
 * Load bridge state from disk into cache.
 * @param {string} projectRoot
 */
function loadBridgeState(projectRoot) {
  const filePath = bridgeStatePath(projectRoot);
  const data = safeReadJson(filePath);
  if (data && typeof data === 'object') {
    for (const [scope, entry] of Object.entries(data)) {
      _bridgeStateCache.set(scope, entry);
    }
  }
}

/**
 * Persist current bridge state cache to disk.
 * @param {string} projectRoot
 */
function persistBridgeState(projectRoot) {
  const filePath = bridgeStatePath(projectRoot);
  const obj = Object.fromEntries(_bridgeStateCache.entries());
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/**
 * Get the current bridge state for a given scope.
 *
 * @param {string} projectRoot
 * @param {string} scope - The bridge scope (e.g., signal scope or task-id)
 * @returns {{ state: string, scope: string, updated_at: string, history: Array<{ from: string, to: string, ts: string }> } | null}
 */
function getBridgeState(projectRoot, scope) {
  if (_bridgeStateCache.size === 0) {
    loadBridgeState(projectRoot);
  }
  const safe = sanitizeScope(scope);
  return _bridgeStateCache.get(safe) || null;
}

/**
 * Transition the bridge state for a given scope.
 * Validates that the transition is allowed before applying.
 *
 * When transitioning to `feedback_received`, the opts.validated_by provenance
 * must represent a distinct intelligence from opts.produced_by (or from the
 * existing entry's produced_by). Distinct means different actor_id AND
 * different harness_id when both are type=intelligence.
 *
 * @param {string} projectRoot
 * @param {string} scope - The bridge scope
 * @param {string} newState - Target state (one of BRIDGE_STATES values)
 * @param {object} [opts] - Provenance options
 * @param {object} [opts.produced_by] - { actor_id, harness_id, actor_type }
 * @param {object} [opts.validated_by] - { actor_id, harness_id, actor_type }
 * @returns {{ success: boolean, previous: string|null, current: string, error?: string }}
 */
/**
 * Emit a bridge lifecycle trace event to the append-only trace log.
 * Diagnostic only — does not affect lifecycle truth.
 *
 * @param {string} projectRoot
 * @param {object} params
 * @param {string} params.scope
 * @param {string} params.from_state
 * @param {string} params.to_state
 * @param {boolean} params.success
 * @param {string} [params.error]
 * @param {object} [params.produced_by]
 * @param {object} [params.validated_by]
 */
function emitBridgeTraceEvent(projectRoot, params) {
  var logPath = path.join(projectRoot, '_dev', 'logs', 'bridge-lifecycle-trace.jsonl');
  var event = {
    event_type: 'bridge_lifecycle',
    timestamp: new Date().toISOString(),
    scope: params.scope || '',
    from_state: params.from_state || null,
    to_state: params.to_state || '',
    success: params.success,
    error: params.error || null,
    produced_by: params.produced_by || null,
    validated_by: params.validated_by || null
  };
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(event) + '\n');
  } catch (_) { /* trace is best-effort diagnostic */ }
}

function transitionBridgeState(projectRoot, scope, newState, opts) {
  const provOpts = opts || {};

  if (_bridgeStateCache.size === 0) {
    loadBridgeState(projectRoot);
  }

  const safe = sanitizeScope(scope);
  const existing = _bridgeStateCache.get(safe);
  const currentState = existing ? existing.state : null;

  // Initial state — allow setting to handoff_prepared or blocked_on_actor_bridge
  if (!currentState) {
    if (newState !== BRIDGE_STATES.HANDOFF_PREPARED && newState !== BRIDGE_STATES.BLOCKED_ON_ACTOR_BRIDGE) {
      emitBridgeTraceEvent(projectRoot, {
        scope: safe,
        from_state: currentState,
        to_state: newState,
        success: false,
        error: `Cannot initialize bridge state to "${newState}". Must start with "${BRIDGE_STATES.HANDOFF_PREPARED}" or "${BRIDGE_STATES.BLOCKED_ON_ACTOR_BRIDGE}".`
      });
      return {
        success: false,
        previous: null,
        current: newState,
        error: `Cannot initialize bridge state to "${newState}". Must start with "${BRIDGE_STATES.HANDOFF_PREPARED}" or "${BRIDGE_STATES.BLOCKED_ON_ACTOR_BRIDGE}".`
      };
    }
  } else {
    // Validate transition
    const allowed = BRIDGE_TRANSITIONS[currentState] || [];
    if (!allowed.includes(newState)) {
      emitBridgeTraceEvent(projectRoot, {
        scope: safe,
        from_state: currentState,
        to_state: newState,
        success: false,
        error: `Invalid bridge transition: "${currentState}" → "${newState}". Allowed: ${allowed.join(', ')}`
      });
      return {
        success: false,
        previous: currentState,
        current: newState,
        error: `Invalid bridge transition: "${currentState}" → "${newState}". Allowed: ${allowed.join(', ')}`
      };
    }
  }

  // Distinct-intelligence gate for feedback_received transitions (fail-closed)
  if (newState === BRIDGE_STATES.FEEDBACK_RECEIVED) {
    const existingProduced = existing ? normalizeProvenance(existing, 'produced_by') : null;
    const producedBy = provOpts.produced_by || existingProduced || null;
    const validatedBy = provOpts.validated_by || null;
    // Fail-closed: both producedBy and validatedBy are REQUIRED
    if (!producedBy || !validatedBy) {
      emitBridgeTraceEvent(projectRoot, {
        scope: safe,
        from_state: currentState,
        to_state: newState,
        success: false,
        error: 'feedback_received requires both produced_by and validated_by provenance (fail-closed)'
      });
      return {
        success: false,
        previous: currentState,
        current: newState,
        error: 'feedback_received requires both produced_by and validated_by provenance (fail-closed)'
      };
    }
    if (!isDistinctIntelligence(producedBy, validatedBy)) {
      emitBridgeTraceEvent(projectRoot, {
        scope: safe,
        from_state: currentState,
        to_state: newState,
        success: false,
        error: 'feedback_received requires distinct-intelligence validation: ' +
          'validated_by must be intelligence with different actor_id AND harness_id from produced_by'
      });
      return {
        success: false,
        previous: currentState,
        current: newState,
        error: 'feedback_received requires distinct-intelligence validation: ' +
          'validated_by must be intelligence with different actor_id AND harness_id from produced_by'
      };
    }
  }

  const now = new Date().toISOString();
  const history = existing ? [...(existing.history || [])] : [];
  if (currentState) {
    history.push({ from: currentState, to: newState, ts: now });
  }

  const entry = { state: newState, scope: safe, updated_at: now, history };

  // Persist provenance fields on the bridge state entry (including actor_type)
  if (provOpts.produced_by) {
    entry.produced_by_actor_id = provOpts.produced_by.actor_id;
    entry.produced_by_actor_type = provOpts.produced_by.actor_type || 'intelligence';
    entry.produced_by_harness_id = provOpts.produced_by.harness_id;
  } else if (existing && existing.produced_by_actor_id) {
    entry.produced_by_actor_id = existing.produced_by_actor_id;
    entry.produced_by_actor_type = existing.produced_by_actor_type || 'intelligence';
    entry.produced_by_harness_id = existing.produced_by_harness_id;
  }
  if (provOpts.validated_by) {
    entry.validated_by_actor_id = provOpts.validated_by.actor_id;
    entry.validated_by_actor_type = provOpts.validated_by.actor_type || 'intelligence';
    entry.validated_by_harness_id = provOpts.validated_by.harness_id;
  }

  _bridgeStateCache.set(safe, entry);
  persistBridgeState(projectRoot);

  // Emit canonical status snapshot on every transition
  try { writeStatusSnapshot(projectRoot); } catch (_) { /* best-effort */ }

  // Emit diagnostic trace event
  emitBridgeTraceEvent(projectRoot, {
    scope: safe,
    from_state: currentState,
    to_state: newState,
    success: true,
    produced_by: provOpts.produced_by,
    validated_by: provOpts.validated_by
  });

  return {
    success: true,
    previous: currentState,
    current: newState
  };
}

/**
 * Check whether a bridge handoff is truly complete (feedback_received).
 * Artifact publication alone is NOT completion.
 *
 * @param {string} projectRoot
 * @param {string} scope
 * @returns {boolean}
 */
function isBridgeComplete(projectRoot, scope) {
  const entry = getBridgeState(projectRoot, scope);
  return !!(entry && entry.state === BRIDGE_STATES.FEEDBACK_RECEIVED);
}

// ---------------------------------------------------------------------------
// Bridge patch lane
// ---------------------------------------------------------------------------

/**
 * BRIDGE_PATCH_LANE — States for bridge-originated patch proposals.
 *
 * A patch proposal flows: patch_proposed → patch_applied → patch_validated.
 * Closure (patch_validated) requires distinct-intelligence validation.
 *
 * @readonly
 * @enum {string}
 */
const BRIDGE_PATCH_LANE = Object.freeze({
  PATCH_PROPOSED: 'patch_proposed',
  PATCH_APPLIED: 'patch_applied',
  PATCH_VALIDATED: 'patch_validated'
});

/**
 * proposeBridgePatch — Create a bridge patch proposal artifact.
 *
 * Writes a JSON artifact to _dev/reports/analysis/bridge-patches/<timestamp>__<scope>.json.
 * The patch remains in patch_proposed state until a distinct intelligence validates it.
 *
 * @param {string} projectRoot
 * @param {string} scope - The bridge scope for this patch
 * @param {object} patchDetails - Patch content
 * @param {string} patchDetails.description - What the patch does
 * @param {string[]} [patchDetails.files_affected] - List of file paths
 * @param {string} [patchDetails.diff] - Optional unified diff content
 * @param {object} [patchDetails.produced_by] - Provenance: { actor_id, harness_id }
 * @returns {{ patchPath: string, state: string, scope: string }}
 */
function proposeBridgePatch(projectRoot, scope, patchDetails) {
  const safeScope = sanitizeScope(scope);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const patchDir = path.join(projectRoot, '_dev', 'reports', 'analysis', 'bridge-patches');
  fs.mkdirSync(patchDir, { recursive: true });

  const patchPath = path.join(patchDir, `${timestamp}__${safeScope}.json`);
  const artifact = {
    schema: 'BridgePatch/1.0',
    state: BRIDGE_PATCH_LANE.PATCH_PROPOSED,
    scope: safeScope,
    proposed_at: new Date().toISOString(),
    applied_at: null,
    validated_at: null,
    validated_by: null,
    description: patchDetails.description || '',
    files_affected: Array.isArray(patchDetails.files_affected) ? patchDetails.files_affected : [],
    diff: patchDetails.diff || null,
    produced_by: patchDetails.produced_by || null
  };

  fs.writeFileSync(patchPath, JSON.stringify(artifact, null, 2));
  return { patchPath, state: BRIDGE_PATCH_LANE.PATCH_PROPOSED, scope: safeScope };
}

/**
 * advanceBridgePatch — Transition a bridge patch to the next state.
 *
 * Transitions: patch_proposed → patch_applied → patch_validated.
 * The patch_validated transition requires distinct-intelligence validation.
 *
 * @param {string} patchPath - Absolute path to the patch artifact JSON
 * @param {string} newState - Target state (one of BRIDGE_PATCH_LANE values)
 * @param {object} [opts]
 * @param {object} [opts.validated_by] - { actor_id, harness_id } — required for patch_validated
 * @returns {{ success: boolean, previous: string, current: string, error?: string }}
 */
function advanceBridgePatch(patchPath, newState, opts) {
  const provOpts = opts || {};

  if (!fs.existsSync(patchPath)) {
    return { success: false, previous: null, current: newState, error: 'Patch artifact not found' };
  }

  let artifact;
  try {
    artifact = JSON.parse(fs.readFileSync(patchPath, 'utf8'));
  } catch (err) {
    return { success: false, previous: null, current: newState, error: `Parse error: ${err.message}` };
  }

  const currentState = artifact.state;
  const validTransitions = {
    [BRIDGE_PATCH_LANE.PATCH_PROPOSED]: [BRIDGE_PATCH_LANE.PATCH_APPLIED],
    [BRIDGE_PATCH_LANE.PATCH_APPLIED]: [BRIDGE_PATCH_LANE.PATCH_VALIDATED]
  };

  const allowed = validTransitions[currentState] || [];
  if (!allowed.includes(newState)) {
    return {
      success: false,
      previous: currentState,
      current: newState,
      error: `Invalid patch transition: "${currentState}" -> "${newState}". Allowed: ${allowed.join(', ')}`
    };
  }

  // Distinct-intelligence gate for patch_validated (fail-closed)
  if (newState === BRIDGE_PATCH_LANE.PATCH_VALIDATED) {
    const producedBy = artifact.produced_by || null;
    const validatedBy = provOpts.validated_by || null;
    // Fail-closed: both required
    if (!producedBy || !validatedBy) {
      return {
        success: false,
        previous: currentState,
        current: newState,
        error: 'patch_validated requires both produced_by and validated_by provenance (fail-closed)'
      };
    }
    if (!isDistinctIntelligence(producedBy, validatedBy)) {
      return {
        success: false,
        previous: currentState,
        current: newState,
        error: 'patch_validated requires distinct-intelligence validation: ' +
          'validated_by must be intelligence with different actor_id AND harness_id from produced_by'
      };
    }
    artifact.validated_at = new Date().toISOString();
    artifact.validated_by = validatedBy;
  }

  if (newState === BRIDGE_PATCH_LANE.PATCH_APPLIED) {
    artifact.applied_at = new Date().toISOString();
  }

  artifact.state = newState;
  fs.writeFileSync(patchPath, JSON.stringify(artifact, null, 2));

  return { success: true, previous: currentState, current: newState };
}

module.exports = {
  buildCodexBridge,
  buildPromptFromPlan,
  buildPromptFromSignal,
  buildPromptFromSignalWithGrounding,
  buildPromptForArtifact,
  composePromptBody,
  buildGroundingDescriptor,
  renderGroundingDescriptor,
  loadGroundingBundle,
  normalizeGroundingMode,
  GROUNDING_MODES,
  GROUNDING_BUNDLE_FILES,
  sanitizeScope,
  selectLatestActionableSignal,
  isWithinProjectRoot,
  validateSignalForDispatch,
  writeBridgePrompt,

  // Bridge state tracking
  BRIDGE_STATES,
  BRIDGE_TRANSITIONS,
  getBridgeState,
  transitionBridgeState,
  isBridgeComplete,
  loadBridgeState,
  bridgeStatePath,
  emitBridgeTraceEvent,

  // Bridge patch lane
  BRIDGE_PATCH_LANE,
  proposeBridgePatch,
  advanceBridgePatch,

  // Distinct-intelligence validation (re-exported from completion-classifier)
  isDistinctIntelligence
};
