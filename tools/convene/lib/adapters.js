'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// User-populated custom dispatch config. Ship a documented example alongside
// this file (convene-adapters.example.json); the real file is git-ignorable
// and never committed with populated values by default.
const CUSTOM_ADAPTERS_PATH = path.join(__dirname, '..', 'convene-adapters.json');

const ADAPTERS = Object.freeze({
  claude: Object.freeze({
    actor: 'claude',
    command: 'claude',
    argv: ['-p', '--output-format', 'text']
  }),
  codex: Object.freeze({
    actor: 'codex',
    command: 'codex',
    argv: ['exec', '-s', 'read-only', '-']
  }),
  gemini: Object.freeze({
    actor: 'gemini',
    command: 'gemini',
    argv: ['-p', 'Read the full task from stdin below and respond per the instructions.', '--output-format', 'text'],
    env: { GOOGLE_GENAI_USE_GCA: 'true' }
  }),

  // Manual dispatch — the universal fallback. No subprocess is spawned; the
  // runner writes the slot's prompt to prompts/<slot>__<actor>.md (already
  // part of every convene run's artifact set) and reports where to paste the
  // reply. Use this for any model/harness that has no CLI you can shell out
  // to, or as a placeholder while you wire up a custom adapter below.
  manual: Object.freeze({
    actor: 'manual',
    manual: true
  }),

  // Local Ollama lobes — `ollama run <model>` reads the prompt from stdin and prints
  // the completion to stdout (same stdin-prompt contract as the cloud CLIs). Zero cloud:
  // the deliberation runs entirely on local models (the de-Clauding lane). Requires
  // `ollama serve` running + the model pulled; use a higher --timeout (14b/31b load
  // slowly), and reasoning models (deepseek-r1) may emit <think> in their output.
  'local-qwen': Object.freeze({
    actor: 'local-qwen', command: 'ollama', argv: ['run', 'qwen3:4b']
  }),
  'local-deepseek': Object.freeze({
    actor: 'local-deepseek', command: 'ollama', argv: ['run', 'deepseek-r1:14b']
  }),
  'local-coder': Object.freeze({
    actor: 'local-coder', command: 'ollama', argv: ['run', 'qwen2.5-coder:14b']
  }),
  'local-gemma': Object.freeze({
    actor: 'local-gemma', command: 'ollama', argv: ['run', 'gemma4:31b']
  }),

  // OpenRouter bridge — calls any OpenRouter-hosted model via API.
  // The actor name encodes the model: openrouter-<model-slug>.
  // Example: openrouter-claude-sonnet-4, openrouter-gpt-4o, openrouter-gemini-2.5-pro
  // The model ID is extracted from the actor name after 'openrouter-'.
  'openrouter': Object.freeze({
    actor: 'openrouter',
    command: 'node',
    argv: ['tools/convene/lib/openrouter-bridge.js', '--model'],
    dynamic_model: true
  })
});

const FRONTIER_ACTORS = Object.freeze(new Set([
  'claude',
  'codex',
  'gemini',
  'openrouter'
]));

function normalizeActor(actor) {
  return String(actor || '').trim().toLowerCase();
}

/**
 * Load user-configured custom adapters from convene-adapters.json, if present.
 *
 * Shape: { "<actorName>": { "command": "...", "argv": ["..."], "cwd": "...", "env": {...} } }
 *
 * Each entry shells out to `command` with `argv` exactly like a built-in
 * adapter — the prompt is written to the child's stdin and its stdout is
 * captured as the response. This is how you wire convene up to any CLI-driven
 * model or harness that isn't one of the built-ins above (a local harness,
 * an in-house wrapper script, another vendor's CLI, etc).
 *
 * Missing or malformed config is silently treated as "no custom adapters" —
 * convene must never fail to run because an optional file is absent.
 */
function loadCustomAdapters() {
  try {
    if (!fs.existsSync(CUSTOM_ADAPTERS_PATH)) return {};
    const raw = JSON.parse(fs.readFileSync(CUSTOM_ADAPTERS_PATH, 'utf8'));
    const out = {};
    for (const [actor, def] of Object.entries(raw || {})) {
      const normalized = normalizeActor(actor);
      if (!normalized || !def || typeof def !== 'object' || !def.command) continue;
      out[normalized] = Object.freeze({
        actor: normalized,
        command: String(def.command),
        argv: Array.isArray(def.argv) ? def.argv.slice() : [],
        env: def.env && typeof def.env === 'object' ? { ...def.env } : undefined,
        cwd: def.cwd ? String(def.cwd) : undefined
      });
    }
    return out;
  } catch (err) {
    process.stderr.write(`[convene] ignoring malformed convene-adapters.json: ${err.message}\n`);
    return {};
  }
}

function listAdapters() {
  return Array.from(new Set([...Object.keys(ADAPTERS), ...Object.keys(loadCustomAdapters())]));
}

function getAdapter(actor) {
  const normalized = normalizeActor(actor);
  // Check exact match first (built-ins)
  if (ADAPTERS[normalized]) {
    return ADAPTERS[normalized];
  }
  // Check for openrouter-<model> dynamic actors
  if (normalized.startsWith('openrouter-')) {
    return ADAPTERS['openrouter'];
  }
  // Check user-configured custom adapters
  const custom = loadCustomAdapters();
  if (custom[normalized]) {
    return custom[normalized];
  }
  return null;
}

const { resolveConveneModel } = require('./model-tiering');

function isFrontierActor(actor) {
  const normalized = normalizeActor(actor);
  return FRONTIER_ACTORS.has(normalized) || normalized.startsWith('openrouter-');
}

function resolveAdapter(actor, options = {}) {
  let adapter = getAdapter(actor);

  // Universal fallback: any actor name with no built-in and no custom-adapter
  // entry resolves to manual mode rather than throwing. This is what lets an
  // operator type any slot/actor name and get a usable (if manual) run.
  if (!adapter) {
    adapter = Object.freeze({ actor: normalizeActor(actor), manual: true });
  }

  if (adapter.manual) {
    return {
      ...adapter,
      argv: [],
      env: null,
      cwd: REPO_ROOT,
      pinned_model: null
    };
  }

  if (options.local_only && isFrontierActor(actor)) {
    throw new Error(`Local-only convene blocks frontier actor "${actor}". Use --profile local-council or pass --allow-frontier for an explicit exception.`);
  }

  let argv = adapter.argv.slice();

  // Handle dynamic model extraction for openrouter-<model> actors
  if (adapter.dynamic_model && actor.startsWith('openrouter-')) {
    const modelId = actor.slice('openrouter-'.length);
    if (!modelId) {
      throw new Error(`Actor "${actor}" is an OpenRouter actor but missing model ID. Expected format: openrouter-<model-slug>`);
    }
    argv = [...adapter.argv, modelId];
  }

  // Optional model-pin injection (see lib/model-tiering.js for the config file
  // this reads). When a pin resolves, inject ['--model', model] into the argv.
  const pinnedModel = resolveConveneModel({
    actor,
    riskTier: options.risk_tier || options.riskTier,
    taskShape: options.task_shape || options.taskShape,
    scopeTier: options.scope_tier || options.scopeTier
  });
  if (pinnedModel) {
    argv = ['--model', pinnedModel, ...argv];
  }

  return {
    ...adapter,
    argv,
    pinned_model: pinnedModel || null,
    env: adapter.env ? { ...adapter.env } : null,
    cwd: adapter.cwd ? path.resolve(REPO_ROOT, adapter.cwd) : REPO_ROOT
  };
}

module.exports = {
  REPO_ROOT,
  CUSTOM_ADAPTERS_PATH,
  getAdapter,
  isFrontierActor,
  listAdapters,
  loadCustomAdapters,
  resolveAdapter
};
