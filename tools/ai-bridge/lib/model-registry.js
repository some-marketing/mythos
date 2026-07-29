'use strict';

const fs = require('fs');
const path = require('path');

const {
  MODEL_CAPABILITIES,
  createModelSelection
} = require('./provider-contract');

const GENERIC_PROVIDER_IDS = Object.freeze(['ollama', 'openai-compatible']);
const SELECTION_SOURCES = Object.freeze([
  'run_override',
  'project_default',
  'client_default',
  'global_default',
  'workflow_default',
  'fallback'
]);

const WORKFLOW_CAPABILITY_REQUIREMENTS = Object.freeze({
  verification: Object.freeze(['chat', 'verification']),
  classification: Object.freeze(['chat', 'classification']),
  drafting: Object.freeze(['chat', 'drafting']),
  analysis: Object.freeze(['chat', 'analysis'])
});

const DEFAULT_WORKFLOW_MODEL_CANDIDATES = Object.freeze({
  verification: Object.freeze(['ollama:qwen2.5-coder:14b', 'openai-compatible:gpt-4.1-mini']),
  classification: Object.freeze(['ollama:qwen2.5-coder:14b', 'openai-compatible:gpt-4.1-mini']),
  drafting: Object.freeze(['ollama:qwen2.5-coder:14b', 'openai-compatible:gpt-4.1-mini']),
  analysis: Object.freeze(['ollama:qwen2.5-coder:14b', 'openai-compatible:gpt-4.1-mini'])
});

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeCapabilityList(values) {
  const list = Array.isArray(values) ? values : [];
  const deduped = [...new Set(list.filter((value) => typeof value === 'string' && value.trim()))];
  for (const capability of deduped) {
    if (!MODEL_CAPABILITIES.includes(capability)) {
      throw new Error(`Unknown model capability in registry: "${capability}"`);
    }
  }
  return deduped;
}

function qualifyModelId(provider, providerModelId) {
  if (!provider) throw new Error('qualifyModelId requires a provider');
  if (!providerModelId) throw new Error('qualifyModelId requires a providerModelId');
  return `${provider}:${providerModelId}`;
}

function splitModelId(modelId) {
  const raw = String(modelId || '').trim();
  if (!raw) return { provider: null, provider_model_id: '' };

  for (const provider of GENERIC_PROVIDER_IDS) {
    const prefix = `${provider}:`;
    if (raw.startsWith(prefix)) {
      return {
        provider,
        provider_model_id: raw.slice(prefix.length)
      };
    }
  }

  return {
    provider: null,
    provider_model_id: raw
  };
}

function hasRequiredCapabilities(descriptor, requiredCapabilities) {
  const descriptorCapabilities = Array.isArray(descriptor && descriptor.capabilities)
    ? descriptor.capabilities
    : [];
  return requiredCapabilities.every((capability) => descriptorCapabilities.includes(capability));
}

function findNearestConfigFile(startPath, fileName) {
  let current = path.resolve(startPath || process.cwd());
  let stat;
  try {
    stat = fs.statSync(current);
  } catch {
    return null;
  }
  if (stat.isFile()) current = path.dirname(current);

  while (true) {
    const candidate = path.join(current, fileName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function extractModelConfig(obj) {
  if (!obj || typeof obj !== 'object') {
    return {
      default_model: '',
      workflow_defaults: {},
      aliases: {},
      provider_endpoints: {}
    };
  }

  const runtime = obj.runtime && typeof obj.runtime === 'object' ? obj.runtime : {};
  const selection = runtime.model_selection && typeof runtime.model_selection === 'object'
    ? runtime.model_selection
    : {};
  const models = runtime.models && typeof runtime.models === 'object'
    ? runtime.models
    : {};
  const ai = runtime.ai && typeof runtime.ai === 'object'
    ? runtime.ai
    : {};

  const workflowDefaults = {
    ...(selection.workflow_defaults || {}),
    ...(models.workflow_defaults || {}),
    ...(ai.workflow_defaults || {})
  };

  const aliases = {
    ...(selection.aliases || {}),
    ...(models.aliases || {}),
    ...(ai.aliases || {})
  };

  const providerEndpoints = {
    ...(selection.provider_endpoints || {}),
    ...(models.provider_endpoints || {}),
    ...(ai.provider_endpoints || {})
  };

  return {
    default_model: selection.default_model || models.default_model || ai.default_model || '',
    workflow_defaults: workflowDefaults,
    aliases,
    provider_endpoints: providerEndpoints
  };
}

function loadProjectAndClientConfig(context = {}) {
  const anchorPath = context.anchorPath || context.filePath || process.cwd();
  const explicitProjectPath = context.projectPath || null;
  const projectPath = explicitProjectPath || findNearestConfigFile(anchorPath, 'project.json');
  const project = projectPath ? readJsonIfExists(projectPath) : null;

  let clientPath = context.clientPath || null;
  if (!clientPath && project && project.client_code) {
    const candidate = path.join(process.cwd(), 'clients', project.client_code, 'client.json');
    if (fs.existsSync(candidate)) clientPath = candidate;
  }
  if (!clientPath && projectPath) {
    clientPath = findNearestConfigFile(path.dirname(projectPath), 'client.json');
  }

  const client = clientPath ? readJsonIfExists(clientPath) : null;

  return {
    projectPath,
    project,
    clientPath,
    client
  };
}

function loadGlobalConfig() {
  const workflowDefaults = {};
  for (const workflowType of Object.keys(WORKFLOW_CAPABILITY_REQUIREMENTS)) {
    const envKey = `MYTHOS_MODEL_${workflowType.toUpperCase()}`;
    if (process.env[envKey]) {
      workflowDefaults[workflowType] = process.env[envKey];
    }
  }

  return {
    default_model: process.env.MYTHOS_DEFAULT_MODEL || '',
    workflow_defaults: workflowDefaults,
    aliases: {},
    provider_endpoints: {}
  };
}

function mergeConfigs(...configs) {
  const merged = {
    default_model: '',
    workflow_defaults: {},
    aliases: {},
    provider_endpoints: {}
  };

  for (const config of configs) {
    if (!config) continue;
    if (config.default_model) merged.default_model = config.default_model;
    Object.assign(merged.workflow_defaults, config.workflow_defaults || {});
    Object.assign(merged.aliases, config.aliases || {});
    Object.assign(merged.provider_endpoints, config.provider_endpoints || {});
  }

  return merged;
}

function resolveAliases(modelId, aliases) {
  const seen = new Set();
  let current = String(modelId || '').trim();
  while (current && aliases && aliases[current] && !seen.has(current)) {
    seen.add(current);
    current = String(aliases[current] || '').trim();
  }
  return current;
}

function defaultProviderOrderForWorkflow(workflowType) {
  if (workflowType === 'verification' || workflowType === 'classification' || workflowType === 'drafting' || workflowType === 'analysis') {
    return ['ollama', 'openai-compatible'];
  }
  return [];
}

async function loadProviderInventory(providerName, adapters, inventoryCache) {
  if (inventoryCache[providerName]) return inventoryCache[providerName];

  const adapter = adapters[providerName];
  if (!adapter) {
    inventoryCache[providerName] = {
      provider: providerName,
      health: { reachable: false, error: 'Provider adapter not available' },
      inventory: []
    };
    return inventoryCache[providerName];
  }

  const [health, listed] = await Promise.all([
    adapter.checkHealth(),
    adapter.listModels()
  ]);

  const inventory = Array.isArray(listed && listed.models) ? listed.models : [];
  inventoryCache[providerName] = {
    provider: providerName,
    health,
    inventory
  };
  return inventoryCache[providerName];
}

function normalizeCandidateValue(candidate) {
  if (Array.isArray(candidate)) return candidate.filter(Boolean).map((value) => String(value).trim()).filter(Boolean);
  if (typeof candidate === 'string' && candidate.trim()) return [candidate.trim()];
  return [];
}

async function resolveCandidate(candidateValue, source, workflowType, requiredCapabilities, adapters, inventoryCache, aliases) {
  const candidates = normalizeCandidateValue(candidateValue).map((value) => resolveAliases(value, aliases));
  const providerOrder = defaultProviderOrderForWorkflow(workflowType);

  for (const candidate of candidates) {
    const split = splitModelId(candidate);
    const explicitProviders = split.provider ? [split.provider] : providerOrder;

    for (const providerName of explicitProviders) {
      const providerInventory = await loadProviderInventory(providerName, adapters, inventoryCache);
      if (!providerInventory.health.reachable) continue;

      const found = providerInventory.inventory.find((descriptor) => {
        if (split.provider_model_id && descriptor.provider_model_id === split.provider_model_id) return true;
        if (split.provider_model_id && descriptor.id === candidate) return true;
        return false;
      });

      if (found && hasRequiredCapabilities(found, requiredCapabilities)) {
        return {
          descriptor: found,
          selection: createModelSelection({
            requested_model: source === 'run_override' ? candidate : null,
            resolved_model_id: found.id,
            resolved_provider: found.provider,
            workflow_type: workflowType,
            selection_source: source,
            fallback_chain: providerOrder,
            required_capabilities: requiredCapabilities,
            reason: `Resolved ${source} candidate "${candidate}" to "${found.id}".`
          })
        };
      }

      if (!found && split.provider && providerInventory.health.reachable) {
        const assumedDescriptor = {
          id: qualifyModelId(providerName, split.provider_model_id),
          provider: providerName,
          provider_model_id: split.provider_model_id,
          capabilities: [],
          available: true
        };
        return {
          descriptor: assumedDescriptor,
          selection: createModelSelection({
            requested_model: source === 'run_override' ? candidate : null,
            resolved_model_id: assumedDescriptor.id,
            resolved_provider: providerName,
            workflow_type: workflowType,
            selection_source: source,
            fallback_chain: providerOrder,
            required_capabilities: requiredCapabilities,
            reason: `Resolved explicit ${source} candidate "${candidate}" through reachable provider "${providerName}" without inventory confirmation.`
          })
        };
      }
    }
  }

  return null;
}

async function resolveFallback(workflowType, requiredCapabilities, adapters, inventoryCache) {
  const providerOrder = defaultProviderOrderForWorkflow(workflowType);
  const fallbackChain = [];

  for (const providerName of providerOrder) {
    const providerInventory = await loadProviderInventory(providerName, adapters, inventoryCache);
    fallbackChain.push(providerName);
    if (!providerInventory.health.reachable) continue;

    const match = providerInventory.inventory.find((descriptor) => hasRequiredCapabilities(descriptor, requiredCapabilities));
    if (match) {
      return {
        descriptor: match,
        selection: createModelSelection({
          requested_model: null,
          resolved_model_id: match.id,
          resolved_provider: match.provider,
          workflow_type: workflowType,
          selection_source: 'fallback',
          fallback_chain: fallbackChain,
          required_capabilities: requiredCapabilities,
          reason: `Selected first available capability-compatible fallback "${match.id}".`
        })
      };
    }
  }

  return {
    descriptor: null,
    selection: createModelSelection({
      requested_model: null,
      resolved_model_id: null,
      resolved_provider: null,
      workflow_type: workflowType,
      selection_source: 'fallback',
      fallback_chain: fallbackChain,
      required_capabilities: requiredCapabilities,
      reason: `No reachable generic provider exposed a model with capabilities: ${requiredCapabilities.join(', ')}.`
    })
  };
}

function getRequiredCapabilities(workflowType) {
  return normalizeCapabilityList(WORKFLOW_CAPABILITY_REQUIREMENTS[workflowType] || []);
}

function createDefaultRegistryConfig(context = {}) {
  const { project, client } = loadProjectAndClientConfig(context);
  const globalConfig = loadGlobalConfig();
  const clientConfig = extractModelConfig(client);
  const projectConfig = extractModelConfig(project);

  return {
    ...mergeConfigs(globalConfig, clientConfig, projectConfig),
    project,
    client
  };
}

async function resolveModelSelection(workflowType, opts = {}) {
  const requiredCapabilities = getRequiredCapabilities(workflowType);
  const adapters = opts.adapters || {};
  const inventoryCache = {};
  const config = opts.config || createDefaultRegistryConfig(opts);
  const aliases = config.aliases || {};

  const candidates = [
    { source: 'run_override', value: opts.model || opts.model_id || opts.requested_model || '' },
    { source: 'project_default', value: config.project && extractModelConfig(config.project).workflow_defaults[workflowType] },
    { source: 'project_default', value: config.project && extractModelConfig(config.project).default_model },
    { source: 'client_default', value: config.client && extractModelConfig(config.client).workflow_defaults[workflowType] },
    { source: 'client_default', value: config.client && extractModelConfig(config.client).default_model },
    { source: 'global_default', value: config.workflow_defaults && config.workflow_defaults[workflowType] },
    { source: 'global_default', value: config.default_model },
    { source: 'workflow_default', value: DEFAULT_WORKFLOW_MODEL_CANDIDATES[workflowType] || [] }
  ];

  for (const candidate of candidates) {
    if (!candidate.value) continue;
    const resolved = await resolveCandidate(
      candidate.value,
      candidate.source,
      workflowType,
      requiredCapabilities,
      adapters,
      inventoryCache,
      aliases
    );
    if (resolved) {
      return {
        ...resolved,
        required_capabilities: requiredCapabilities
      };
    }
  }

  const fallback = await resolveFallback(workflowType, requiredCapabilities, adapters, inventoryCache);
  return {
    ...fallback,
    required_capabilities: requiredCapabilities
  };
}

module.exports = {
  GENERIC_PROVIDER_IDS,
  SELECTION_SOURCES,
  WORKFLOW_CAPABILITY_REQUIREMENTS,
  DEFAULT_WORKFLOW_MODEL_CANDIDATES,
  qualifyModelId,
  splitModelId,
  hasRequiredCapabilities,
  getRequiredCapabilities,
  readJsonIfExists,
  extractModelConfig,
  loadProjectAndClientConfig,
  createDefaultRegistryConfig,
  resolveModelSelection
};
