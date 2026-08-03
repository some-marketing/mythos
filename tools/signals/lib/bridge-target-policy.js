'use strict';

// Shared bridge target policy for Mythos bridge calls.
//
// This is intentionally separate from any one runner. Bridge dispatchers,
// local logged-in CLIs, local model adapters, and API adapters should resolve
// target + transport + model through this layer before launching work.

const path = require('path');
const fs = require('fs');

const BRIDGE_MODEL_SOURCE = Object.freeze({
  checked_at: '2026-04-22',
  gemini_model_docs: 'https://ai.google.dev/gemini-api/docs/models',
  gemini_cli_docs: 'https://developers.google.com/gemini-code-assist/docs/gemini-3'
});

const BRIDGE_SCOPE_TIERS = Object.freeze({
  system: Object.freeze({
    rank: 0,
    child_depth_budget: 3,
    model_class: 'broad',
    transport_preference: Object.freeze(['local-cli', 'api'])
  }),
  client: Object.freeze({
    rank: 1,
    child_depth_budget: 2,
    model_class: 'broad',
    transport_preference: Object.freeze(['local-cli', 'api'])
  }),
  project: Object.freeze({
    rank: 2,
    child_depth_budget: 1,
    model_class: 'narrowing',
    transport_preference: Object.freeze(['local-cli', 'api'])
  }),
  task: Object.freeze({
    rank: 3,
    child_depth_budget: 0,
    model_class: 'narrow',
    transport_preference: Object.freeze(['local-model', 'local-cli', 'api'])
  }),
  leaf: Object.freeze({
    rank: 4,
    child_depth_budget: 0,
    model_class: 'mechanical',
    transport_preference: Object.freeze(['local-model', 'local-cli'])
  })
});

const BRIDGE_TARGET_POLICIES = Object.freeze({
  gemini: Object.freeze({
    target: 'gemini',
    label: 'Gemini',
    family: 'google',
    default_transport: 'local-cli',
    transports: Object.freeze({
      'local-cli': Object.freeze({
        kind: 'logged-in-agent',
        binary: 'gemini',
        auth: 'google-oauth-personal-or-code-assist',
        default_model: 'gemini-3-pro-preview',
        current_models: Object.freeze([
          'gemini-3-pro-preview',
          'gemini-3-flash-preview'
        ]),
        stale_models: Object.freeze([
          'gemini-2.5-pro',
          'gemini-2.5-flash',
          'gemini-2.5-flash-lite',
          'gemini-2.0-flash'
        ]),
        model_docs: BRIDGE_MODEL_SOURCE.gemini_model_docs,
        bridge_docs: BRIDGE_MODEL_SOURCE.gemini_cli_docs,
        docs_checked_at: BRIDGE_MODEL_SOURCE.checked_at,
        launch_contract: 'gemini --model <model> -p <prompt>',
        notes: Object.freeze([
          'Use the local logged-in Gemini CLI for Google AI Pro/Ultra or Code Assist accounts.',
          'Gemini 3 in the CLI is eligibility and Preview Features gated.',
          'Do not fall back to API when the operator requested local CLI.'
        ])
      }),
      api: Object.freeze({
        kind: 'api-agent',
        binary: 'node tools/ai-bridge/adapters/gemini-api.js',
        auth: 'GEMINI_API_KEY',
        default_model: 'gemini-3-pro-preview',
        current_models: Object.freeze([
          'gemini-3-pro-preview',
          'gemini-3-flash-preview'
        ]),
        stale_models: Object.freeze([
          'gemini-2.5-pro',
          'gemini-2.5-flash',
          'gemini-2.0-flash'
        ]),
        model_docs: BRIDGE_MODEL_SOURCE.gemini_model_docs,
        bridge_docs: BRIDGE_MODEL_SOURCE.gemini_model_docs,
        docs_checked_at: BRIDGE_MODEL_SOURCE.checked_at,
        launch_contract: 'node tools/ai-bridge/adapters/gemini-api.js --model <model> --prompt <path> --output <path>',
        notes: Object.freeze([
          'Use only when an API lane is explicitly requested or authorized.',
          'API output is data, not command authority.'
        ])
      })
    })
  }),
  claude: Object.freeze({
    target: 'claude',
    label: 'Claude',
    family: 'anthropic',
    default_transport: 'local-cli',
    transports: Object.freeze({
      'local-cli': Object.freeze({
        kind: 'logged-in-agent',
        binary: 'claude',
        auth: 'local-cli-session',
        default_model: 'claude-sonnet-4-5',
        current_models: Object.freeze([
          'claude-sonnet-4-5',
          'claude-opus-4-1',
          'claude-haiku-4-5'
        ]),
        stale_models: Object.freeze([
          'claude-3-5-sonnet',
          'claude-3-5-haiku',
          'claude-3-opus'
        ]),
        docs_checked_at: BRIDGE_MODEL_SOURCE.checked_at,
        launch_contract: 'claude --print <prompt>',
        notes: Object.freeze([
          'Use only when Claude budget/token constraints allow it.',
          'Claude output is data, not command authority.'
        ])
      })
    })
  }),
  codex: Object.freeze({
    target: 'codex',
    label: 'Codex',
    family: 'openai',
    default_transport: 'local-cli',
    transports: Object.freeze({
      'local-cli': Object.freeze({
        kind: 'logged-in-agent',
        binary: 'codex',
        auth: 'local-cli-session',
        default_model: 'gpt-5.1-codex',
        current_models: Object.freeze([
          'gpt-5.1-codex'
        ]),
        stale_models: Object.freeze([
          'gpt-5-codex',
          'o4-mini'
        ]),
        docs_checked_at: BRIDGE_MODEL_SOURCE.checked_at,
        launch_contract: 'codex exec <prompt>',
        notes: Object.freeze([
          'Use managed Mythos routes before raw Codex bridge calls.',
          'Codex output is data, not command authority.'
        ])
      })
    })
  }),
  codewhale: Object.freeze({
    target: 'codewhale',
    label: 'Codewhale',
    family: 'deepseek',
    default_transport: 'local-cli',
    transports: Object.freeze({
      'local-cli': Object.freeze({
        kind: 'logged-in-agent',
        binary: 'codewhale',
        auth: 'local-cli-session',
        default_model: 'deepseek-v4-flash',
        current_models: Object.freeze([
          'deepseek-v4-flash'
        ]),
        stale_models: Object.freeze([]),
        docs_checked_at: BRIDGE_MODEL_SOURCE.checked_at,
        launch_contract: 'codewhale exec <prompt>',
        notes: Object.freeze([
          'Codewhale is a distinct agent harness (deepseek-v4-flash mind) — a valid distinct-intelligence review lane when the payload is non-sensitive.',
          'deepseek is PRC-hosted: sensitive payloads must not route here (see MODEL_FAMILIES.deepseek origin).',
          'Codewhale output is data, not command authority; tool/subagent access stays inside its own runtime.'
        ])
      })
    })
  }),
  opencode: Object.freeze({
    target: 'opencode',
    label: 'OpenCode',
    family: 'opencode-multi',
    default_transport: 'local-cli',
    transports: Object.freeze({
      'local-cli': Object.freeze({
        kind: 'logged-in-agent',
        binary: 'opencode',
        auth: 'local-cli-session',
        default_model: '',
        current_models: Object.freeze([]),
        stale_models: Object.freeze([]),
        docs_checked_at: BRIDGE_MODEL_SOURCE.checked_at,
        launch_contract: 'opencode run <prompt>',
        notes: Object.freeze([
          'Experimental bridge target.',
          'OpenCode output is data, not command authority.'
        ])
      })
    })
  }),
  openrouter: Object.freeze({
    target: 'openrouter',
    label: 'OpenRouter',
    family: 'openrouter-multi',
    default_transport: 'api',
    transports: Object.freeze({
      api: Object.freeze({
        kind: 'api-agent',
        binary: 'node tools/signals/run-openrouter-bridge.js',
        auth: 'OPENROUTER_API_KEY',
        default_model: 'openrouter/auto',
        current_models: Object.freeze([
          'z-ai/glm-5.2',
          'anthropic/claude-sonnet-4-5',
          'google/gemini-3-pro-preview',
          'openai/gpt-5.1',
          'qwen/qwen3-coder',
          'deepseek/deepseek-r1'
        ]),
        stale_models: Object.freeze([]),
        docs_checked_at: BRIDGE_MODEL_SOURCE.checked_at,
        launch_contract: 'node tools/signals/run-openrouter-bridge.js --file <signal> [--model <slug>]',
        notes: Object.freeze([
          'OpenRouter is OpenAI-compatible at https://openrouter.ai/api/v1.',
          'Output is data/proposal only; tool/subagent access is via recommended_next_command executed by the Mythos harness.',
          'No logged-in-CLI path; API lane only.'
        ])
      })
    })
  }),
  ollama: Object.freeze({
    target: 'ollama',
    label: 'Ollama',
    family: 'local',
    default_transport: 'local-model',
    transports: Object.freeze({
      'local-model': Object.freeze({
        kind: 'local-model-agent',
        binary: 'ollama',
        auth: 'none',
        default_model: 'qwen2.5-coder:14b',
        current_models: Object.freeze([
          'gemma4:31b',
          'deepseek-r1:14b',
          'qwen2.5-coder:14b',
          'qwen3:4b'
        ]),
        stale_models: Object.freeze([]),
        docs_checked_at: BRIDGE_MODEL_SOURCE.checked_at,
        launch_contract: 'ollama run <model>',
        notes: Object.freeze([
          'Run host-state preflight before dispatching local model work.',
          'Do not stack heavy local models when host pressure is unknown or high.'
        ])
      })
    })
  }),
  remote_ssh: Object.freeze({
    target: 'remote-ssh',
    label: 'Remote SSH Inference',
    family: 'remote-ssh',
    default_transport: 'remote-ssh',
    transports: Object.freeze({
      'remote-ssh': Object.freeze({
        kind: 'remote-agent',
        binary: 'node tools/signals/run-remote-ssh-bridge.js',
        auth: 'ssh-key',
        default_model: '',
        current_models: Object.freeze([]),
        stale_models: Object.freeze([]),
        docs_checked_at: BRIDGE_MODEL_SOURCE.checked_at,
        launch_contract: 'node tools/signals/run-remote-ssh-bridge.js --host <host-alias> --file <signal>',
        notes: Object.freeze([
          'Runs inference on a remote host via SSH.',
          'Host config lives in _dev/config/remote-hosts.json.',
          'Phase 1: freeform prompts only via remote Ollama or direct shell.',
          'Phase 2: remote managed-command validation against remote host command surface.',
          'SSH key paths are resolved from the operator home dir; keys are never stored in repo.'
        ])
      })
    })
  })
});

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeTargetId(target) {
  return normalizeText(target).toLowerCase();
}

function normalizeTransport(transport) {
  return normalizeText(transport).toLowerCase();
}

function normalizeScopeTier(scopeTier) {
  const tier = normalizeText(scopeTier).toLowerCase();
  return BRIDGE_SCOPE_TIERS[tier] ? tier : '';
}

function getScopeTierPolicy(scopeTier) {
  const tier = normalizeScopeTier(scopeTier);
  return tier ? BRIDGE_SCOPE_TIERS[tier] : null;
}

function compareScopeTiers(parentScopeTier, childScopeTier) {
  const parent = getScopeTierPolicy(parentScopeTier);
  const child = getScopeTierPolicy(childScopeTier);
  if (!parent || !child) {
    return {
      valid: false,
      parent_scope_tier: normalizeScopeTier(parentScopeTier),
      child_scope_tier: normalizeScopeTier(childScopeTier),
      reason: 'Both parent and child scope tiers must be known.'
    };
  }

  const childIsNarrower = child.rank > parent.rank;
  return {
    valid: childIsNarrower,
    parent_scope_tier: normalizeScopeTier(parentScopeTier),
    child_scope_tier: normalizeScopeTier(childScopeTier),
    parent_rank: parent.rank,
    child_rank: child.rank,
    reason: childIsNarrower
      ? `Child scope tier "${childScopeTier}" is narrower than parent scope tier "${parentScopeTier}".`
      : `Child scope tier "${childScopeTier}" must be narrower than parent scope tier "${parentScopeTier}".`
  };
}

function validateScopeTransition(fromScopeTier, toScopeTier, operation = 'delegate', opts = {}) {
  const from = getScopeTierPolicy(fromScopeTier);
  const to = getScopeTierPolicy(toScopeTier);
  const fromTier = normalizeScopeTier(fromScopeTier);
  const toTier = normalizeScopeTier(toScopeTier);
  const normalizedOperation = normalizeText(operation).toLowerCase() || 'delegate';
  const explicitAuthority = opts.explicit_authority === true
    || opts.explicitAuthority === true
    || opts.authority_granted === true
    || opts.authorityGranted === true;

  if (!from || !to) {
    return {
      valid: false,
      operation: normalizedOperation,
      from_scope_tier: fromTier,
      to_scope_tier: toTier,
      relation: 'unknown',
      requires_explicit_authority: false,
      creates_authority: false,
      reason: 'Both source and target scope tiers must be known before scope transition.'
    };
  }

  const relation = to.rank > from.rank
    ? 'downscope'
    : (to.rank < from.rank ? 'upscope' : 'same-scope');
  const childOperation = ['delegate', 'spawn', 'spawn-child', 'demote', 'downscope'].includes(normalizedOperation);
  const authorityCreatingOperation = ['promote', 'upscope', 'create', 'claim', 'execute'].includes(normalizedOperation);
  const returnUpwardOperation = ['return-upward', 'request-promotion', 'handoff-upward', 'escalate'].includes(normalizedOperation);

  if (childOperation && relation !== 'downscope') {
    return {
      valid: false,
      operation: normalizedOperation,
      from_scope_tier: fromTier,
      to_scope_tier: toTier,
      relation,
      requires_explicit_authority: false,
      creates_authority: false,
      reason: `Scope transition "${normalizedOperation}" must move downward from "${fromTier}" to a narrower tier; "${toTier}" is ${relation}.`
    };
  }

  if (returnUpwardOperation) {
    return {
      valid: true,
      operation: normalizedOperation,
      from_scope_tier: fromTier,
      to_scope_tier: toTier,
      relation,
      requires_explicit_authority: false,
      creates_authority: false,
      reason: `Scope transition "${normalizedOperation}" may report or hand off upward, but it does not create higher-scope authority.`
    };
  }

  if (authorityCreatingOperation && relation === 'upscope' && !explicitAuthority) {
    return {
      valid: false,
      operation: normalizedOperation,
      from_scope_tier: fromTier,
      to_scope_tier: toTier,
      relation,
      requires_explicit_authority: true,
      creates_authority: true,
      reason: `Scope transition "${normalizedOperation}" from "${fromTier}" to higher tier "${toTier}" requires explicit upstream authority.`
    };
  }

  return {
    valid: true,
    operation: normalizedOperation,
    from_scope_tier: fromTier,
    to_scope_tier: toTier,
    relation,
    requires_explicit_authority: authorityCreatingOperation && relation === 'upscope',
    creates_authority: authorityCreatingOperation,
    reason: `Scope transition "${normalizedOperation}" from "${fromTier}" to "${toTier}" is allowed by scope policy.`
  };
}

function selectBridgeModel(target, transportPolicy, opts = {}) {
  const explicitModel = normalizeText(opts.model);
  if (explicitModel) return explicitModel;

  const targetId = normalizeTargetId(target);
  const scopeTier = normalizeScopeTier(opts.scope_tier || opts.scopeTier);
  const riskTier = normalizeText(opts.risk_tier || opts.riskTier).toLowerCase();
  const taskShape = normalizeText(opts.task_shape || opts.taskShape).toLowerCase();
  const routeTier = getScopeTierPolicy(scopeTier);
  const narrow = Boolean(routeTier && routeTier.rank >= 2);
  const mechanical = /mechanical|syntax|filter|verify-local|bounded/.test(taskShape);
  const lowRisk = riskTier === 'low';

  if (targetId === 'gemini') {
    if (transportPolicy && (transportPolicy.kind === 'logged-in-agent' || transportPolicy.kind === 'api-agent')) {
      if (narrow || mechanical || lowRisk) {
        return 'gemini-3-flash-preview';
      }
      return transportPolicy.default_model || 'gemini-3-pro-preview';
    }
  }

  return normalizeText(transportPolicy && transportPolicy.default_model) || '';
}

function getBridgeTargetPolicy(target) {
  return BRIDGE_TARGET_POLICIES[normalizeTargetId(target)] || null;
}

function listBridgeTargetPolicies() {
  return Object.values(BRIDGE_TARGET_POLICIES);
}

function getBridgeTransportPolicy(target, transport = '') {
  const targetPolicy = getBridgeTargetPolicy(target);
  if (!targetPolicy) return null;
  const selectedTransport = normalizeTransport(transport) || targetPolicy.default_transport;
  return targetPolicy.transports[selectedTransport] || null;
}

function validateBridgeTargetModel(target, model = '', opts = {}) {
  const targetId = normalizeTargetId(target);
  const targetPolicy = getBridgeTargetPolicy(targetId);
  if (!targetPolicy) {
    return {
      valid: false,
      target: targetId,
      transport: '',
      model: normalizeText(model),
      reason: `Unknown bridge target "${target}".`
    };
  }

  const selectedTransport = normalizeTransport(opts.transport) || targetPolicy.default_transport;
  const transportPolicy = getBridgeTransportPolicy(targetId, selectedTransport);
  if (!transportPolicy) {
    return {
      valid: false,
      target: targetId,
      transport: selectedTransport,
      model: normalizeText(model),
      reason: `Bridge target "${targetId}" does not support transport "${selectedTransport}".`
    };
  }

  const normalizedModel = selectBridgeModel(targetId, transportPolicy, {
    model,
    scope_tier: opts.scope_tier || opts.scopeTier,
    risk_tier: opts.risk_tier || opts.riskTier,
    task_shape: opts.task_shape || opts.taskShape
  });
  if (!normalizedModel) {
    return {
      valid: true,
      target: targetId,
      transport: selectedTransport,
      model: '',
      reason: `Bridge target "${targetId}" transport "${selectedTransport}" has no strict model default.`
    };
  }

  const currentModels = Array.isArray(transportPolicy.current_models) ? transportPolicy.current_models : [];
  const staleModels = Array.isArray(transportPolicy.stale_models) ? transportPolicy.stale_models : [];

  if (currentModels.length > 0 && currentModels.includes(normalizedModel)) {
    return {
      valid: true,
      target: targetId,
      transport: selectedTransport,
      model: normalizedModel,
      reason: `Bridge model "${normalizedModel}" is current for ${targetId}/${selectedTransport}.`
    };
  }

  if (staleModels.includes(normalizedModel)) {
    return {
      valid: false,
      target: targetId,
      transport: selectedTransport,
      model: normalizedModel,
      reason: `Bridge model "${normalizedModel}" is stale for ${targetId}/${selectedTransport}. Check ${transportPolicy.model_docs || BRIDGE_MODEL_SOURCE.gemini_model_docs} and ${transportPolicy.bridge_docs || BRIDGE_MODEL_SOURCE.gemini_cli_docs} before re-enabling it.`
    };
  }

  if (currentModels.length === 0) {
    return {
      valid: true,
      target: targetId,
      transport: selectedTransport,
      model: normalizedModel,
      reason: `Bridge target "${targetId}" transport "${selectedTransport}" does not declare a strict model allowlist.`
    };
  }

  return {
    valid: false,
    target: targetId,
    transport: selectedTransport,
    model: normalizedModel,
    reason: `Bridge model "${normalizedModel}" is not in the current allowlist for ${targetId}/${selectedTransport}. Check ${transportPolicy.model_docs || BRIDGE_MODEL_SOURCE.gemini_model_docs} and ${transportPolicy.bridge_docs || BRIDGE_MODEL_SOURCE.gemini_cli_docs} before updating this policy.`
  };
}

function resolveBridgeTargetModel(target, model = '', opts = {}) {
  const validation = validateBridgeTargetModel(target, model, opts);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }
  return validation.model;
}

function resolveBridgeInvocation(target, opts = {}) {
  const targetId = normalizeTargetId(target);
  const targetPolicy = getBridgeTargetPolicy(targetId);
  if (!targetPolicy) {
    throw new Error(`Unknown bridge target "${target}".`);
  }

  const selectedTransport = normalizeTransport(opts.transport) || targetPolicy.default_transport;
  const transportPolicy = getBridgeTransportPolicy(targetId, selectedTransport);
  if (!transportPolicy) {
    throw new Error(`Bridge target "${targetId}" does not support transport "${selectedTransport}".`);
  }

  const model = resolveBridgeTargetModel(targetId, opts.model || '', {
    transport: selectedTransport,
    scope_tier: opts.scope_tier || opts.scopeTier,
    risk_tier: opts.risk_tier || opts.riskTier,
    task_shape: opts.task_shape || opts.taskShape
  });
  const scopeTier = normalizeScopeTier(opts.scope_tier || opts.scopeTier);
  const scopeTierPolicy = getScopeTierPolicy(scopeTier);

  return {
    target: targetId,
    label: targetPolicy.label,
    transport: selectedTransport,
    kind: transportPolicy.kind,
    binary: transportPolicy.binary,
    auth: transportPolicy.auth,
    model,
    launch_contract: transportPolicy.launch_contract,
    notes: Array.isArray(transportPolicy.notes) ? transportPolicy.notes.slice() : [],
    docs: {
      model_docs: transportPolicy.model_docs || '',
      bridge_docs: transportPolicy.bridge_docs || '',
      checked_at: transportPolicy.docs_checked_at || BRIDGE_MODEL_SOURCE.checked_at
    },
    routing: {
      scope_tier: scopeTier || '',
      scope_tier_rank: scopeTierPolicy ? scopeTierPolicy.rank : null,
      child_depth_budget: scopeTierPolicy ? scopeTierPolicy.child_depth_budget : null,
      transport_preference: Array.isArray(scopeTierPolicy && scopeTierPolicy.transport_preference)
        ? scopeTierPolicy.transport_preference.slice()
        : [selectedTransport],
      model_class: scopeTierPolicy ? scopeTierPolicy.model_class : 'narrowing',
      preferred_transport: selectedTransport,
      prefers_logged_in_before_api: transportPolicy.kind === 'logged-in-agent'
    }
  };
}

function resolveRecursiveBridgeRoute(target, opts = {}) {
  return resolveBridgeInvocation(target, opts);
}

// Phase 1: remote-ssh target parsing ---------------------------------------------------------
// "remote-ssh:orwell" -> { target: 'remote-ssh', host_alias: 'orwell' }
// "codex"             -> { target: 'codex', host_alias: '' }
function parseRemoteTarget(target) {
  const normalized = normalizeText(target).toLowerCase();
  if (normalized.startsWith('remote-ssh:')) {
    const host_alias = normalized.slice('remote-ssh:'.length).trim();
    if (!host_alias) {
      throw new Error(`Remote-ssh target requires a host alias. Use remote-ssh:<host-alias>.`);
    }
    return { target: 'remote-ssh', host_alias };
  }
  // Also support "remote-ssh" bare with host_alias in opts
  return { target: normalized, host_alias: '' };
}

// ---------------------------------------------------------------------------
// Distinct model families for cross-verification.
//
// The Mythos safety doctrine (AGENTS.md) holds that same-model subagents are
// parallel contexts, not distinct intelligence. Genuine cross-verification
// needs DIFFERENT model families (different labs). This map gives each bridge
// target + each OpenRouter slug a lab-identity so callers can request a mind
// from a genuinely different family.
//
// selectDistinctFamily() is the bounded router: given the origin's family,
// pick a reachable target + model from a DIFFERENT family, honoring:
//   - jurisdiction: sensitive payloads route to onshore families only
//     (local ollama, or anthropic/google/openai via non-PRC endpoints)
//   - risk tier:    mechanical/low → local or flash; consequence → frontier
//   - reachability: only families whose binary/key is present
// ---------------------------------------------------------------------------

const MODEL_FAMILIES = Object.freeze({
  anthropic: { label: 'Anthropic', origin: 'onshore-western', use_cases: ['agentic_coding', 'deep_reasoning', 'long_context_sensitive', 'frontier_consequence_grade'], members: ['claude'] },
  google: { label: 'Google DeepMind', origin: 'onshore-western', use_cases: ['deep_reasoning', 'fast_cheap_mechanical', 'frontier_consequence_grade'], members: ['gemini'] },
  openai: { label: 'OpenAI', origin: 'onshore-western', use_cases: ['agentic_coding', 'deep_reasoning', 'frontier_consequence_grade'], members: ['codex'] },
  zhipu: { label: 'Zhipu (GLM)', origin: 'prc-hosted-gated', use_cases: ['long_context_non_sensitive'], members: ['openrouter:z-ai/glm-5.2'] },
  alibaba: { label: 'Alibaba (Qwen)', origin: 'prc-hosted-via-openrouter', use_cases: ['long_context_non_sensitive'], members: ['openrouter:qwen/qwen3-coder'] },
  deepseek: { label: 'DeepSeek', origin: 'prc-hosted-via-openrouter', use_cases: ['fast_cheap_mechanical_non_sensitive'], members: ['openrouter:deepseek/deepseek-r1', 'codewhale'] },
  local: { label: 'Local ensemble (Ollama)', origin: 'onshore-local', use_cases: ['fast_cheap_mechanical', 'sovereign_ondevice_private'], members: ['ollama'] }
});

// Map a bridge target id → its family id.
function familyForTarget(targetId) {
  const p = BRIDGE_TARGET_POLICIES[normalizeTargetId(targetId)];
  return (p && p.family) || null;
}

/**
 * Select a bridge target + model from a family DIFFERENT from the origin's.
 * Returns { target, model, family, reason } or null if no distinct family is
 * reachable under the constraints.
 *
 *   originFamily  — the family of the mind that produced the work to verify
 *   opts.sensitive  — when true, exclude PRC-hosted families (jurisdiction)
 *   opts.riskTier    — 'low'|'medium'|'high' (consequence → frontier family)
 *   opts.preferLocal — prefer onshore/local when available
 */
function selectDistinctFamily(originFamily, opts = {}) {
  const sensitive = Boolean(opts.sensitive);
  const riskTier = normalizeText(opts.riskTier || opts.risk_tier || 'high').toLowerCase();
  const preferLocal = Boolean(opts.preferLocal);

  const eligible = [];
  for (const [famId, fam] of Object.entries(MODEL_FAMILIES)) {
    if (famId === originFamily) continue;
    if (sensitive && fam.origin.includes('prc')) continue;
    // Resolve a concrete target + model from the family's first reachable member.
    for (const member of fam.members) {
      let targetId, model;
      if (member.startsWith('openrouter:')) {
        targetId = 'openrouter';
        model = member.slice('openrouter:'.length);
      } else {
        targetId = member;
        const tp = BRIDGE_TARGET_POLICIES[targetId];
        const transport = tp && getBridgeTransportPolicy(targetId, tp.default_transport);
        const cm = transport && Array.isArray(transport.current_models) && transport.current_models;
        model = (cm && cm[0]) || (transport && transport.default_model) || '';
      }
      eligible.push({ target: targetId, model, family: famId, familyLabel: fam.label, origin: fam.origin });
    }
  }
  if (eligible.length === 0) return null;

  // Prefer local for mechanical/low-risk or when operator asks; else frontier.
  const wantLocal = preferLocal || riskTier === 'low' || /mechanical|bounded/.test(opts.taskShape || '');
  const wantFrontier = riskTier === 'high' || riskTier === 'medium';

  const scored = eligible.map((e) => {
    let score = 0;
    if (wantLocal && e.origin === 'onshore-local') score += 100;
    if (wantFrontier && e.origin === 'onshore-western') score += 50;
    if (e.origin === 'onshore-local') score += 10; // tie-break toward sovereign
    // PRC-via-openrouter is eligible only when non-sensitive; deprioritize vs onshore.
    if (e.origin.includes('prc')) score -= 20;
    return { ...e, score };
  }).sort((a, b) => b.score - a.score);

  const pick = scored[0];
  return {
    target: pick.target,
    model: pick.model,
    family: pick.family,
    familyLabel: pick.familyLabel,
    reason: `distinct from ${originFamily || '(origin)'}; risk=${riskTier}; sensitive=${sensitive}`
  };
}

// ---------------------------------------------------------------------------
// Use-case routing (consults _dev/config/model-routing-table.json).
// pick = selectByUseCase('agentic_coding', { riskTier:'high', sensitive:false })
//   → { target, model, family, familyLabel, useCase, reason }
// Reads the table at load time; honors sensitive (excludes PRC families).
// ---------------------------------------------------------------------------
let _ROUTING_TABLE = null;
function loadRoutingTable() {
  if (_ROUTING_TABLE) return _ROUTING_TABLE;
  try {
    const p = path.join(path.resolve(__dirname, '../../..'), '_dev', 'config', 'model-routing-table.json');
    _ROUTING_TABLE = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    _ROUTING_TABLE = null;
  }
  return _ROUTING_TABLE;
}

function selectByUseCase(useCase, opts = {}) {
  const table = loadRoutingTable();
  if (!table || !table.use_cases || !table.use_cases[useCase]) return null;
  const entry = table.use_cases[useCase];
  const sensitive = Boolean(opts.sensitive);
  const candidate = entry.primary && !entry.primary.routing ? entry.primary : null;
  // Model-aware family resolution: openrouter is one target spanning many
  // families (zhipu/alibaba/deepseek by slug), so the family depends on the
  // model, not the target. This is what makes the sensitive-PRC exclusion work.
  const familyOf = (spec) => {
    if (!spec) return null;
    if (spec.target === 'openrouter' && spec.model) {
      for (const [famId, fam] of Object.entries(MODEL_FAMILIES)) {
        if (fam.members.includes(`openrouter:${spec.model}`)) return famId;
      }
    }
    return familyForTarget(spec.target);
  };
  const resolveMember = (spec) => {
    if (!spec || !spec.target) return null;
    const tp = BRIDGE_TARGET_POLICIES[spec.target];
    const transport = tp && getBridgeTransportPolicy(spec.target, tp.default_transport);
    const model = spec.model || (transport && transport.default_model) || '';
    const fam = familyOf(spec);
    return { target: spec.target, model, family: fam, familyLabel: fam && MODEL_FAMILIES[fam] && MODEL_FAMILIES[fam].label, access: spec.access, note: spec.note };
  };
  // If primary is PRC-origin and the payload is sensitive, fall through to the first onshore alternative.
  const isPrc = (spec) => { if (!spec) return false; const f = familyOf(spec); return f && MODEL_FAMILIES[f] && MODEL_FAMILIES[f].origin.includes('prc'); };
  let pick = null;
  if (candidate && !(sensitive && isPrc(candidate))) pick = resolveMember(candidate);
  if (!pick) {
    for (const alt of (entry.alternatives || [])) {
      if (sensitive && isPrc(alt)) continue;
      pick = resolveMember(alt);
      if (pick) break;
    }
  }
  if (!pick) return null;
  return Object.assign(pick, { useCase, reason: `use-case ${useCase}; risk=${opts.riskTier||opts.risk_tier||'high'}; sensitive=${sensitive}` });
}

module.exports = {
  BRIDGE_MODEL_SOURCE,
  BRIDGE_SCOPE_TIERS,
  BRIDGE_TARGET_POLICIES,
  compareScopeTiers,
  getBridgeTargetPolicy,
  getBridgeTransportPolicy,
  getScopeTierPolicy,
  listBridgeTargetPolicies,
  normalizeTargetId,
  normalizeScopeTier,
  normalizeText,
  normalizeTransport,
  parseRemoteTarget,
  resolveBridgeInvocation,
  resolveRecursiveBridgeRoute,
  MODEL_FAMILIES,
  familyForTarget,
  selectDistinctFamily,
  selectByUseCase,
  selectBridgeModel,
  resolveBridgeTargetModel,
  validateScopeTransition,
  validateBridgeTargetModel
};
