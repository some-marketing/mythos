'use strict';

const fs = require('fs');
const path = require('path');

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
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
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

  const executionCommand = String(alias.execution_target || alias.target || typedCommand).trim().toLowerCase();
  return {
    isAlias: true,
    typedCommand,
    resolvedCommand: String(alias.target || executionCommand).trim().toLowerCase(),
    executionCommand,
    authoritySource: String(alias.authority_source || executionCommand).trim().toLowerCase(),
    expansionEdges: Array.isArray(alias.expansion_edges) ? alias.expansion_edges : [typedCommand, executionCommand],
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
