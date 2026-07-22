#!/usr/bin/env node
'use strict';

const path = require('path');
const { parseArgs } = require('../workspace/lib/args');
const {
  loadCanonicalCommand,
  parseSlashCommand
} = require('./lib/command-registry.cjs');
const { resolveCommandAlias } = require('./lib/command-aliases.cjs');
const { reviewTaskPlan } = require('./handlers/review-task-plan.cjs');
const { routeCommand } = require('./handlers/route.cjs');
const { conceptPromote } = require('./handlers/concept-promote.cjs');
const { debriefRun } = require('./handlers/debrief-run.cjs');

const PROJECT_ROOT = process.env.MYTHOS_PROJECT_ROOT
  ? path.resolve(process.env.MYTHOS_PROJECT_ROOT)
  : path.resolve(__dirname, '..', '..');

// Every handler registered here has zero dependency outside this directory,
// node builtins, and the tools/planning + tools/verify direct export units
// that ship alongside this one. See README.md for the full list of handlers
// that were NOT ported (and why), and for how to add your own.
const HANDLERS = Object.freeze({
  'review-task-plan': reviewTaskPlan,
  'route': routeCommand,
  'concept-promote': conceptPromote,
  'debrief-run': debriefRun
});

function runMythosCommand(projectRoot, commandString, options = {}) {
  const parsed = parseSlashCommand(commandString);
  if (!parsed.ok) {
    return { exitCode: 1, stdout: '', stderr: parsed.error };
  }

  const typedCanonical = loadCanonicalCommand(projectRoot, parsed.commandId);
  const resolution = resolveCommandAlias(projectRoot, parsed.commandId);
  const executionCommand = resolution.executionCommand;
  const canonical = typedCanonical || loadCanonicalCommand(projectRoot, executionCommand);

  if (!canonical) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Unknown command: /${parsed.commandId}`
    };
  }

  const handler = HANDLERS[executionCommand];
  if (!handler) {
    const aliasNote = resolution.isAlias ? ` Alias /${resolution.typedCommand} resolves to /${executionCommand}.` : '';
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Command /${parsed.commandId} is canonical but has no deterministic executable handler in this runner yet.${aliasNote} Canonical spec: ${path.relative(projectRoot, canonical.specPath)}. See README.md for the ported-vs-stubbed handler list and how to add one.`
    };
  }

  const handlerOptions = {
    ...options,
    commandResolution: resolution
  };
  return handler(projectRoot, parsed.argsText, handlerOptions);
}

function main() {
  const args = parseArgs(process.argv);
  const commandString = args.command || args._.join(' ');
  const result = runMythosCommand(PROJECT_ROOT, commandString, {
    json: !args.text,
    write: !args.no_write
  });

  if (result.stdout) process.stdout.write(result.stdout + '\n');
  if (result.stderr) process.stderr.write(result.stderr + '\n');
  process.exit(result.exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  HANDLERS,
  runMythosCommand
};
