'use strict';

/**
 * managed-command-registry.js — Registry of Mythos dispatches that are "managed" 
 * (i.e. have a canonical spec and a dedicated runner).
 */

const path = require('path');
const { listAliasIds } = require('../../commands/lib/command-aliases.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

const MANAGED_COMMANDS = new Set([
  'plan-task',
  'run-plan',
  'execute-plan',
  'follow-signal',
  'dispatch-bridge',
  'orchestrate-loop',
  'review-progress',
  'amend-plan',
  'debrief-run',
  'normalize-signals',
  'mythos-status',
  'telemetry-status'
]);

function managedSet(projectRoot = PROJECT_ROOT) {
  const commands = new Set(MANAGED_COMMANDS);
  for (const aliasId of listAliasIds(projectRoot)) {
    commands.add(aliasId);
  }
  return commands;
}

function isManaged(commandId, projectRoot = PROJECT_ROOT) {
  if (!commandId) return false;
  // Handle leading slash if present
  const id = commandId.startsWith('/') ? commandId.slice(1) : commandId;
  return managedSet(projectRoot).has(id.split(' ')[0].toLowerCase());
}

function listManaged(projectRoot = PROJECT_ROOT) {
  return Array.from(managedSet(projectRoot));
}

module.exports = {
  isManaged,
  listManaged,
  MANAGED_COMMANDS
};
