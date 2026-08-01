#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs } = require('../workspace/lib/args');
const { runEndSessionCloseout } = require('../maintenance/lib/end-session-closeout');
const { closeoutRepoAwareness } = require('../context/repo-awareness.cjs');
const {
  acknowledgeGrounding,
  ensureBoot,
  enterPlanMode,
  loadState,
  runManagedShell,
  runManagedSignal,
  statePathFor,
  writeState
} = require('./lib/managed-runtime');
const {
  RUNTIME_AUTHORITY_ID
} = require('../runtime/managed-runtime');
const { runSmosCommand } = require('../commands/smos-command-runner.cjs');
const { runCodexHook, emit: emitCoordinationHook } = require('./lib/hook-emulation');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function printHelp() {
  process.stdout.write(`Usage: node tools/codex/smos-launcher.js <action> [options]

Managed Mythos runtime entrypoint (authority: ${RUNTIME_AUTHORITY_ID}).

  Actions:
  boot                         Run the managed session-start bootstrap once
  plan                         Emit the managed plan-mode reminder and mark plan mode entered
  ground --target <path>       Acknowledge grounding for a target before system-level mutation
  shell --command "<cmd>"      Run a shell command through the managed pre-bash wrapper
                               Add --target <path> for potentially mutating commands
  command "/slash args"        Run a deterministic Mythos command handler
  bridge --target <actor>      Dispatch through the canonical Mythos bridge
         --task "<summary>"    Supports codex, claude, gemini, opencode,
         [--command <cmd>]     opencode-local, and openrouter
         [--scope <scope>] [--context <a,b,c>] [--run-now] [--json]
  signal [selectors]           Resolve authority and run the Codex bridge for one coordination signal
  end-session [selector]        Emit EndSessionCloseout/1.0 for --system, --client CODE, or --scope <workstream>
  state                        Print the managed runtime session state

Signal selectors:
  --file <signal.json>
  --scope <signal-scope>
  --actor <name>
  --execute
  --model <model>
  --dry-run
  --json

Examples:
  npm run codex:mythos -- boot
  npm run codex:mythos -- plan
  npm run codex:mythos -- ground --target tools/planning/assess-similarity.js
  npm run codex:mythos -- shell --command "git status"
  npm run codex:mythos -- shell --command "touch output.txt" --target clients/example.txt
  npm run codex:mythos -- command "/review-task-plan task-id"
  npm run codex:mythos -- bridge --target gemini --task "review this" --run-now --json
  npm run codex:mythos -- signal --scope codex-bridge__task-review --dry-run
  npm run codex:mythos -- end-session --system
`);
}

function printResult(result) {
  if (result.stdout) process.stdout.write(`${result.stdout}\n`);
  if (result.stderr) process.stderr.write(`${result.stderr}\n`);
}

function shouldEnsureBoot(action) {
  return action !== 'state' && action !== 'ground' && action !== 'shell' && action !== 'command';
}

function executeAction(projectRoot, state, action, args = {}) {
  if (action === 'state') {
    return {
      state,
      boot: null,
      persistState: false,
      result: {
        exitCode: 0,
        stdout: JSON.stringify({
          ...state,
          state_path: path.relative(projectRoot, statePathFor(projectRoot))
        }, null, 2),
        stderr: ''
      }
    };
  }

  let currentState = state;
  let boot = null;

  if (action === 'shell') {
    const shell = runManagedShell(projectRoot, currentState, {
      command: args.command || '',
      cwd: args.cwd || '',
      target: args.target || ''
    });
    currentState = shell.state;
    return {
      state: currentState,
      boot: null,
      persistState: !shell.blocked,
      result: shell
    };
  }

  if (shouldEnsureBoot(action)) {
    boot = ensureBoot(projectRoot, currentState, {
      cwd: args.cwd ? path.resolve(projectRoot, args.cwd) : projectRoot
    });
    currentState = boot.state;
  }

  let result;

  switch (action) {
    case 'boot':
      result = {
        exitCode: boot.result.exitCode,
        stdout: boot.ran ? '' : 'Managed Codex session already booted for this session state.',
        stderr: ''
      };
      break;

    case 'plan': {
      const plan = enterPlanMode(projectRoot, currentState);
      currentState = plan.state;
      result = {
        exitCode: plan.result.exitCode,
        stdout: plan.result.stdout,
        stderr: ''
      };
      break;
    }

    case 'ground': {
      const target = String(args.target || '').trim();
      if (!target) {
        result = { exitCode: 1, stdout: '', stderr: 'Missing --target for ground action.' };
        break;
      }
      const grounded = acknowledgeGrounding(projectRoot, currentState, target);
      currentState = grounded.state;
      result = { exitCode: 0, stdout: grounded.message, stderr: '' };
      break;
    }

    case 'command': {
      const commandString = args.command || args._.slice(1).join(' ');
      const hookResult = runCodexHook({
        event: 'userprompt-submit',
        command: commandString,
        cwd: process.cwd(),
        projectRoot
      });
      if (hookResult.exitCode !== 0) {
        result = {
          exitCode: hookResult.exitCode,
          stdout: hookResult.stdout,
          stderr: 'Codex UserPromptSubmit hook emulation failed before command dispatch.'
        };
        break;
      }
      result = runSmosCommand(projectRoot, commandString, {
        json: !args.text,
        write: !args.no_write
      });
      if (hookResult.stdout) {
        result.stdout = [hookResult.stdout, result.stdout].filter(Boolean).join('\n');
      }
      break;
    }

    case 'bridge': {
      const bridgeArgs = [
        path.join(projectRoot, 'tools', 'signals', 'dispatch-bridge.js')
      ];
      const passthrough = [
        ['--target', args.target],
        ['--task', args.task || args._.slice(1).join(' ')],
        ['--command', args.command],
        ['--source', args.source || 'codex'],
        ['--scope', args.scope],
        ['--context', args.context],
        ['--validation-command', args.validation_command || args['validation-command']]
      ];
      for (const [flag, value] of passthrough) {
        if (value) bridgeArgs.push(flag, String(value));
      }
      if (args.run_now) bridgeArgs.push('--run-now');
      if (args.json) bridgeArgs.push('--json');

      const { buildNextTraceEnv } = require('../telemetry/dispatches/lib/trace-context.cjs');
      const nextEnv = buildNextTraceEnv({
        scope: args.scope || 'dispatch-bridge',
        executionMode: 'managed'
      });

      const spawned = spawnSync(process.execPath, bridgeArgs, {
        cwd: projectRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, ...nextEnv }
      });
      result = {
        exitCode: spawned.status ?? 1,
        stdout: spawned.stdout || '',
        stderr: spawned.error ? spawned.error.message : (spawned.stderr || '')
      };

      // FIRE HOOKS AFTER DISPATCH
      const hookResult = runCodexHook({
        event: 'SubagentStop',
        command: args.target || 'bridge',
        projectRoot
      });
      if (hookResult.stdout) result.stdout += `\n${hookResult.stdout}`;
      
      try {
        emitCoordinationHook('SubagentStop', {
          sessionId: state.session_id,
          actorId: args.target || 'bridge',
          cwd: projectRoot
        }, { projectRoot });
      } catch {}

      break;
    }

    case 'signal': {
      const signal = runManagedSignal(projectRoot, currentState, {
        file: args.file || '',
        scope: args.scope || args._[1] || '',
        actor: args.actor || '',
        execute: Boolean(args.execute),
        model: args.model || '',
        dryRun: Boolean(args.dry_run),
        json: Boolean(args.json)
      });
      currentState = signal.state;
      result = signal;

      // FIRE HOOKS AFTER SIGNAL (if executed)
      if (['executed', 'override-executed'].includes(currentState.authority.status)) {
        const hookResult = runCodexHook({
          event: 'SubagentStop',
          command: args.actor || 'signal-actor',
          projectRoot
        });
        if (hookResult.stdout) result.stdout += `\n${hookResult.stdout}`;

        try {
          emitCoordinationHook('SubagentStop', {
            sessionId: state.session_id,
            actorId: args.actor || 'signal-actor',
            cwd: projectRoot
          }, { projectRoot });
        } catch {}
      }

      break;
    }

    case 'end-session': {
      const closeout = runEndSessionCloseout(projectRoot, {
        argv: args._.slice(1),
        system: Boolean(args.system),
        client: args.client || '',
        scope: args.scope || ''
      });
      const repoAwareness = closeoutRepoAwareness(projectRoot, {
        sessionId: currentState.session_id,
        source: 'managed-end-session',
        scope: closeout.scope && closeout.scope.scope_key || args.scope || args.client || 'system',
        handoffPath: closeout.output_paths.markdown,
        recommendedNextCommand: closeout.ready_for_clear ? '/whats-next' : '/shutdown'
      });
      result = {
        exitCode: 0,
        stdout: JSON.stringify({
          ok: true,
          ready_for_clear: closeout.ready_for_clear,
          blockers: closeout.blockers.map((blocker) => blocker.id),
          json_path: closeout.output_paths.json,
          md_path: closeout.output_paths.markdown,
          repo_awareness_closeout_path: repoAwareness.paths.closeout_path
        }, null, 2),
        stderr: ''
      };
      break;
    }

    default:
      result = { exitCode: 1, stdout: '', stderr: `Unknown action: ${action}` };
  }

  return {
    state: currentState,
    boot,
    persistState: true,
    result
  };
}

function main() {
  const args = parseArgs(process.argv);
  const action = String(args._[0] || '').trim();

  if (!action || action === 'help' || args.help || args.h) {
    printHelp();
    process.exit(0);
  }

  let state = loadState(PROJECT_ROOT);
  if (action === 'state') {
    const { result } = executeAction(PROJECT_ROOT, state, action, args);
    printResult(result);
    return;
  }

  const execution = executeAction(PROJECT_ROOT, state, action, args);
  state = execution.state;
  if (execution.boot && execution.boot.ran && execution.boot.result.stdout) {
    process.stdout.write(`${execution.boot.result.stdout}\n`);
  }
  if (execution.persistState) {
    writeState(PROJECT_ROOT, state);
  }

  printResult(execution.result);
  process.exit(execution.result.exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  executeAction,
  main,
  shouldEnsureBoot
};
