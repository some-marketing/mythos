'use strict';

const fs = require('fs');
const path = require('path');
const { parseAliasRegistry } = require('../../instructions/lib/engine.js');

function aliasRegistryPath(projectRoot) {
  return path.join(projectRoot, 'instructions', 'canonical', 'command-aliases.yaml');
}

function loadAliasRegistry(projectRoot) {
  const registryPath = aliasRegistryPath(projectRoot);
  if (!fs.existsSync(registryPath)) {
    return {
      registryPath,
      schema: 'SMOSCommandAliasRegistry/absent',
      aliases: []
    };
  }

  let registry;
  try {
    const raw = fs.readFileSync(registryPath, 'utf8');
    registry = /^(?:\{|\[)/.test(raw.trimStart()) ? JSON.parse(raw) : parseAliasRegistry(raw);
  } catch (err) {
    throw new Error(`Failed to parse command alias registry ${registryPath}: ${err.message}`);
  }

  return {
    registryPath,
    schema: registry.schema || 'SMOSCommandAliasRegistry/unknown',
    aliases: Array.isArray(registry.aliases) ? registry.aliases : []
  };
}

function aliasMap(projectRoot) {
  const registry = loadAliasRegistry(projectRoot);
  const aliases = new Map();
  for (const alias of registry.aliases) {
    if (!alias || !alias.id) continue;
    aliases.set(String(alias.id).trim().toLowerCase(), alias);
  }
  return aliases;
}

function resolveCommandAlias(projectRoot, commandId) {
  const typedCommand = String(commandId || '').trim().toLowerCase();
  const aliases = aliasMap(projectRoot);
  const alias = aliases.get(typedCommand);

  if (!alias) {
    return {
      isAlias: false,
      typedCommand,
      resolvedCommand: typedCommand,
      executionCommand: typedCommand,
      authoritySource: typedCommand,
      expansionEdges: [typedCommand],
      alias: null
    };
  }

  const immediateTarget = String(alias.execution_target || alias.target || alias.resolves_to || typedCommand).trim().toLowerCase();
  const trail = [typedCommand];
  let executionCommand = immediateTarget;
  while (aliases.has(executionCommand)) {
    const nextAlias = aliases.get(executionCommand);
    const nextCommand = String(nextAlias.execution_target || nextAlias.target || nextAlias.resolves_to || executionCommand).trim().toLowerCase();
    const canonicalSelfTarget = nextCommand === executionCommand
      && fs.existsSync(path.join(projectRoot, 'instructions', 'canonical', 'commands', `${executionCommand}.yaml`));
    if (canonicalSelfTarget) break;
    if (trail.includes(executionCommand)) {
      throw new Error(`Command alias cycle detected: ${[...trail, executionCommand].join(' -> ')}`);
    }
    trail.push(executionCommand);
    executionCommand = nextCommand;
  }
  return {
    isAlias: true,
    typedCommand,
    resolvedCommand: String(alias.target || alias.resolves_to || immediateTarget).trim().toLowerCase(),
    executionCommand,
    authoritySource: String(alias.authority_source || executionCommand).trim().toLowerCase(),
    expansionEdges: Array.isArray(alias.expansion_edges) ? alias.expansion_edges : trail.includes(executionCommand) ? trail : [...trail, executionCommand],
    alias
  };
}

function listAliasIds(projectRoot) {
  return loadAliasRegistry(projectRoot).aliases
    .map((alias) => String(alias.id || '').trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

module.exports = {
  aliasRegistryPath,
  listAliasIds,
  loadAliasRegistry,
  resolveCommandAlias
};
