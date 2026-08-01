#!/usr/bin/env node
'use strict';

const path = require('path');

const { parseArgs } = require('../workspace/lib/args');
const {
  buildDispatchResult,
  SUPPORTED_TARGETS
} = require('./lib/dispatch-bridge');
const { parseRemoteTarget } = require('./lib/bridge-target-policy');
const { appendHookEvent } = require('../claude/lib/hook-telemetry.cjs');
const { validateTargetCommandCompat } = require('./lib/target-command-policy.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function help() {
  console.log(`
Create a first-class dispatch-bridge handoff for a distinct actor.

Usage:
  node tools/signals/dispatch-bridge.js --target <actor> --task "<summary>" --command </slash-command> [options]

Required:
  --target <actor>     One of: ${SUPPORTED_TARGETS.join(', ')}
                       Remote SSH: remote-ssh:<host-alias> (e.g. remote-ssh:orwell)
  --task <summary>     Task or review to hand off
  --command <command>  Exact slash command the target actor should run

Options:
  --source <actor>     Producing actor (default: operator)
  --scope <scope>      Stable signal_scope override
  --context <a,b,c>    Comma-separated artifact paths to attach
  --run-now            Immediately invoke the existing runner when supported
  --json               Print machine-readable output
  --help               Show this help
`.trim());
}

function formatText(result) {
  const lines = [
    `Dispatch signal: ${result.dispatch_signal_path}`,
    `Target actor: ${result.target}`,
    `Signal scope: ${result.signal_scope}`,
    `Task state: ${result.local_task_state}`,
    `Runner: ${result.runner.id}`,
    `Prompt artifact: ${result.prompt_path}`,
    `Analysis artifact: ${result.analysis_artifacts.markdown}`
  ];

  if (result.dispatch_result) {
    lines.push(`Dispatch status: ${result.dispatch_status}`);
    if (result.dispatch_result.completion_signal_path) {
      lines.push(`Completion signal: ${result.dispatch_result.completion_signal_path}`);
    }
  } else {
    lines.push(`Expected completion: ${result.expected_completion_signal_path}`);
  }

  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    process.exit(0);
  }

  // Phase 0 guardrail: reject empty/invalid target and task before any signal work.
  // This prevents downstream 'undefined' propagation into the tool display layer
  // (see _dev/transcripts/pi-crash-2026-06-05.md for prior crash evidence).
  if (!args.target || typeof args.target !== 'string' || !args.target.trim()) {
    console.error('ERROR: --target is required.');
    console.error('  Local actors: codex, claude, gemini, opencode, openrouter');
    console.error('  Remote SSH:   remote-ssh:<host-alias> (e.g. remote-ssh:orwell)');
    process.exit(1);
  }
  if (!args.task || typeof args.task !== 'string' || !args.task.trim()) {
    console.error('ERROR: --task is required.');
    process.exit(1);
  }

  // Parse remote-ssh:<host> syntax and validate target before dispatch.
  let effectiveTarget, hostAlias;
  try {
    const parsed = parseRemoteTarget(args.target);
    effectiveTarget = parsed.target;
    hostAlias = parsed.host_alias || '';
    if (effectiveTarget.startsWith('openrouter-')) {
      effectiveTarget = 'openrouter';
    }
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }

  // Ensure the resolved target is in the supported set.
  if (!SUPPORTED_TARGETS.includes(effectiveTarget)) {
    console.error(
      `ERROR: Unsupported target actor "${effectiveTarget}". ` +
      `Expected one of: ${SUPPORTED_TARGETS.join(', ')}`
    );
    process.exit(1);
  }

  try {
    // improve-002: optional pre-dispatch validation command. Caller provides a
    // shell command; we run it, capture exit + stdout tail, and feed the
    // summary into the coordination signal's validation block. Non-zero exit
    // halts dispatch so unverified claims never ship as "validation ran".
    let validation = null;
    const validationCommand = args['validation-command'] || args.validation_command;
    if (validationCommand) {
      const { spawnSync } = require('child_process');
      const child = spawnSync(String(validationCommand), {
        shell: true,
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
      });
      const stdout = String(child.stdout || '').trim();
      const stderr = String(child.stderr || '').trim();
      const lastLine = (stdout.split('\n').filter(Boolean).pop() || '').slice(0, 240);
      const exitCode = typeof child.status === 'number' ? child.status : -1;
      const summary = `exit=${exitCode}; ${lastLine || '(no stdout)'}`;
      if (exitCode !== 0) {
        console.error(`ERROR: validation command failed (exit=${exitCode}). Dispatch halted.`);
        if (stderr) console.error(stderr);
        process.exit(1);
      }
      validation = { ran: true, summary };
    }

    // Target-command compatibility gate — reject impossible actor/command
    // pairs before any signal is produced. Use the *parsed* effective target
    // (e.g. "remote-ssh" from "remote-ssh:orwell") so remote-ssh is handled
    // correctly as a freeform-prompt-target. Source-of-truth registry is read
    // from on-disk surfaces at call time.
    const compat = validateTargetCommandCompat({
      target: effectiveTarget,
      command: args.command,
      projectRoot: PROJECT_ROOT
    });
    if (!compat.allowed) {
      console.error(
        `ERROR: target-command compatibility rejected. ` +
        `target=${args.target || '(none)'} command=${args.command || '(none)'}\n` +
        `reason: ${compat.reason}\n` +
        `registry_source: ${compat.registry_source}\n` +
        `No signal was written.`
      );
      process.exit(1);
    }

    const sourceSignalPath = args.signal || args.file;
    let signalObj = null;
    if (sourceSignalPath) {
      const fs = require('fs');
      try {
        const absPath = path.isAbsolute(sourceSignalPath) ? sourceSignalPath : path.resolve(PROJECT_ROOT, sourceSignalPath);
        signalObj = JSON.parse(fs.readFileSync(absPath, 'utf8'));
      } catch (_) {}
    }

    const buildOpts = {
      source: args.source,
      target: args.target,           // pass original "remote-ssh:orwell" here
      task: args.task,
      command: args.command,
      scope: args.scope,
      context: args.context,
      validation,
      run_now: Boolean(args.run_now),
      dry_run: Boolean(args.dry_run),
      signal_obj: signalObj
    };
    // Pass host_alias hint for downstream scope derivation / runner selection
    if (hostAlias) {
      buildOpts.host_alias = hostAlias;
    }

    const result = buildDispatchResult(PROJECT_ROOT, buildOpts);

    try {
      appendHookEvent({
        source: 'dispatch-bridge',
        matcher: 'BridgeDispatch',
        event: 'bridge-dispatched',
        detail: { target: result.target, scope: result.signal_scope, signal_path: result.dispatch_signal_path }
      });
    } catch (_) { /* fail-soft */ }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(formatText(result));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
