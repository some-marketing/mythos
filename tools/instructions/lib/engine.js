const path = require('path');
const fs = require('fs');
const { readText, readJsonAsYaml, exists, listFiles } = require('./io');
const {
  renderGeneric,
  renderCodex,
  renderOpenCode,
  renderCursorRoot,
  renderCursorRule,
  renderClaudeRouter,
  renderClaudeProject,
  renderClaudeGuardrails
} = require('./render');

function loadKernel(rootDir) {
  const kernelSafetyPath = path.join(rootDir, 'instructions', 'canonical', 'kernel', 'safety.yaml');
  if (!exists(kernelSafetyPath)) return null;
  return readJsonAsYaml(kernelSafetyPath);
}

function ensureKernelSafety(system, kernel) {
  if (!kernel) return;

  if (kernel.immutable !== true) {
    throw new Error('Canonical kernel safety must declare "immutable": true.');
  }

  const kernelRules = Array.isArray(kernel.safety_rules) ? kernel.safety_rules : [];
  const systemRules = Array.isArray(system?.safety_rules) ? system.safety_rules : [];
  const missingRules = kernelRules.filter((rule) => !systemRules.includes(rule));

  if (missingRules.length > 0) {
    throw new Error(
      `System safety_rules weaken kernel safety. Missing kernel rules in instructions/canonical/system.yaml: ${missingRules.join(', ')}`
    );
  }
}

// Minimal, dependency-free parser for the simple alias registry schema:
// a top-level `aliases:` map of `alias-key: { resolves_to, status }`. Tolerates
// the JSON-compatible form used elsewhere in the canonical layer as well as the
// commented YAML form. The registry carries up to four alias domains beside
// each other; each normalizes to an ordered array of { id, resolves_to, status }.
const ALIAS_DOMAIN_KEYS = ['aliases', 'framework_aliases', 'skill_aliases', 'tool_aliases'];

function emptyAliasRegistry() {
  const out = {};
  for (const key of ALIAS_DOMAIN_KEYS) out[key] = [];
  return out;
}

function parseAliasRegistry(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return emptyAliasRegistry();
  let maps = null;
  try {
    maps = JSON.parse(trimmed);
  } catch (_) {
    maps = parseSimpleAliasYaml(trimmed);
  }
  const out = emptyAliasRegistry();
  if (!maps || typeof maps !== 'object') return out;
  for (const key of ALIAS_DOMAIN_KEYS) {
    const domainMap = maps[key];
    if (!domainMap || typeof domainMap !== 'object') continue;
    out[key] = Object.entries(domainMap).map(([id, entry]) => ({
      id,
      resolves_to: entry && entry.resolves_to,
      status: entry && entry.status
    }));
  }
  return out;
}

// Minimal, dependency-free reader for the simple alias schema. Returns the raw
// nested maps keyed by top-level domain (aliases, framework_aliases, …). Only
// the known alias domains are collected; other top-level keys (version, notes)
// are ignored.
function parseSimpleAliasYaml(raw) {
  const maps = {};
  let currentDomain = null;
  let currentEntry = null;
  for (const line of raw.split('\n')) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const match = trimmedLine.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = stripQuotes(match[2].trim());
    if (indent === 0) {
      currentDomain = ALIAS_DOMAIN_KEYS.includes(key) ? key : null;
      currentEntry = null;
      if (currentDomain) maps[currentDomain] = maps[currentDomain] || {};
    } else if (currentDomain && indent <= 2) {
      currentEntry = key;
      maps[currentDomain][currentEntry] = {};
    } else if (currentDomain && currentEntry) {
      maps[currentDomain][currentEntry][key] = value;
    }
  }
  return maps;
}

function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

// Load the full alias registry (all domains). Absent file -> empty domains, so
// the generator stays byte-identical when no aliases ship.
function loadAliasRegistry(rootDir) {
  const aliasPath = path.join(rootDir, 'instructions', 'canonical', 'command-aliases.yaml');
  if (!exists(aliasPath)) return emptyAliasRegistry();
  return parseAliasRegistry(readText(aliasPath));
}

// Back-compatible helper: the command-alias domain only.
function loadCommandAliases(rootDir) {
  return loadAliasRegistry(rootDir).aliases;
}

// Load the Core doctrine (system kernel philosophy). Absent file -> null, so the
// generated shared body carries no doctrine section and stays byte-identical.
// The generator reads only this tracked canonical file — never the external
// user-side Mirror config or any environment-provided home directory.
function loadCoreDoctrine(rootDir) {
  const doctrinePath = path.join(rootDir, 'instructions', 'canonical', 'kernel', 'doctrine.md');
  if (!exists(doctrinePath)) return null;
  const text = readText(doctrinePath);
  return text && text.trim() ? text : null;
}

function loadCanonical(rootDir) {
  const canonicalDir = path.join(rootDir, 'instructions', 'canonical');
  const system = readJsonAsYaml(path.join(canonicalDir, 'system.yaml'));
  const kernel = loadKernel(rootDir);
  const guardrails = readText(path.join(canonicalDir, 'guardrails.md'));
  const routing = readText(path.join(canonicalDir, 'routing.md'));
  const aliasRegistry = loadAliasRegistry(rootDir);
  const doctrine = loadCoreDoctrine(rootDir);

  const frameworkBaseDir = path.join(canonicalDir, 'frameworks');
  const frameworkSpecDirs = fs.readdirSync(frameworkBaseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(frameworkBaseDir, d.name));
  const frameworkSpecs = frameworkSpecDirs
    .flatMap((dir) => listFiles(dir).filter((f) => f.endsWith('.yaml')))
    .map((f) => readJsonAsYaml(f));

  return {
    system,
    kernel,
    guardrails,
    routing,
    frameworkSpecs,
    aliasRegistry,
    commandAliases: aliasRegistry.aliases,
    doctrine
  };
}

function loadAdapters(rootDir) {
  const adapterDir = path.join(rootDir, 'instructions', 'adapters');
  const files = listFiles(adapterDir)
    .filter((f) => f.endsWith('.yaml'))
    .filter((f) => !f.endsWith('targets.example.yaml'))
    .filter((f) => !f.endsWith('targets.local.yaml'));

  const adapters = {};
  for (const file of files) {
    const data = readJsonAsYaml(file);
    adapters[data.harness_id] = data;
  }

  const localTargets = path.join(adapterDir, 'targets.local.yaml');
  if (exists(localTargets)) {
    const overrides = readJsonAsYaml(localTargets);
    for (const [harnessId, targetOverrides] of Object.entries(overrides.overrides || {})) {
      if (adapters[harnessId]) {
        adapters[harnessId].target_paths = {
          ...adapters[harnessId].target_paths,
          ...targetOverrides
        };
      }
    }
  }

  return adapters;
}

function loadFrameworkFromManifest(rootDir, frameworkRef) {
  const manifestPath = path.join(rootDir, frameworkRef.manifest);
  const manifest = JSON.parse(readText(manifestPath));
  return {
    id: frameworkRef.id,
    prompt_count: manifest.prompt_count,
    execution_modes: manifest.execution_modes || [],
    mcp_requirements: manifest.mcp_requirements || []
  };
}

function buildModel(rootDir) {
  const canonical = loadCanonical(rootDir);
  ensureKernelSafety(canonical.system, canonical.kernel);
  const adapters = loadAdapters(rootDir);
  const frameworks = canonical.system.frameworks.map((f) => loadFrameworkFromManifest(rootDir, f));
  return {
    canonical,
    adapters,
    kernel: canonical.kernel,
    system: canonical.system,
    frameworks
  };
}

function planOutputs(rootDir, opts = {}) {
  const model = buildModel(rootDir);
  const outputs = [];

  const generic = model.adapters.generic;
  outputs.push({
    harness: 'generic',
    path: path.join(rootDir, generic.target_paths.root_instructions),
    content: renderGeneric(model)
  });

  const codex = model.adapters.codex;
  outputs.push({
    harness: 'codex',
    path: path.join(rootDir, codex.target_paths.root_instructions),
    content: renderCodex(model)
  });

  const cursor = model.adapters.cursor;
  outputs.push({
    harness: 'cursor',
    path: path.join(rootDir, cursor.target_paths.root_rules),
    content: renderCursorRoot(model)
  });
  outputs.push({
    harness: 'cursor',
    path: path.join(rootDir, cursor.target_paths.main_rule),
    content: renderCursorRule(model)
  });

  const opencode = model.adapters.opencode;
  outputs.push({
    harness: 'opencode',
    path: path.join(rootDir, opencode.target_paths.root_instructions),
    content: renderOpenCode(model)
  });

  const claude = model.adapters.claude;
  const defaultWriteClaude = Boolean(model.system?.policy?.default_write_claude);
  const writeClaude = typeof opts.writeClaude === 'boolean' ? opts.writeClaude : defaultWriteClaude;
  if (writeClaude) {
    outputs.push({
      harness: 'claude',
      path: path.join(rootDir, claude.target_paths.root_router),
      content: renderClaudeRouter(model)
    });
    outputs.push({
      harness: 'claude',
      path: path.join(rootDir, claude.target_paths.project_instructions),
      content: renderClaudeProject(model)
    });
    outputs.push({
      harness: 'claude',
      path: path.join(rootDir, claude.target_paths.guardrails),
      content: renderClaudeGuardrails(model, model.canonical.guardrails)
    });
  } else {
    outputs.push({
      harness: 'claude-preview',
      path: path.join(rootDir, 'instructions/generated/claude/CLAUDE.md'),
      content: renderClaudeRouter(model)
    });
    outputs.push({
      harness: 'claude-preview',
      path: path.join(rootDir, 'instructions/generated/claude/.claude.CLAUDE.md'),
      content: renderClaudeProject(model)
    });
    outputs.push({
      harness: 'claude-preview',
      path: path.join(rootDir, 'instructions/generated/claude/.claude.guardrails.md'),
      content: renderClaudeGuardrails(model, model.canonical.guardrails)
    });
  }

  return { model, outputs };
}

module.exports = {
  ensureKernelSafety,
  buildModel,
  planOutputs,
  loadCommandAliases,
  loadAliasRegistry,
  loadCoreDoctrine,
  parseAliasRegistry
};
