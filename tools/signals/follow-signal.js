#!/usr/bin/env node
'use strict';

const path = require('path');

const { spawnSync } = require('child_process');
const { parseArgs } = require('../workspace/lib/args');
const { formatDecision, resolveAuthority } = require('./lib/follow-signal');

function printHelp() {
  console.log(`Usage: node tools/signals/follow-signal.js [<signal-scope>] [options]

Resolve and verify the exact next command authorized by a live coordination signal
or approved task plan. Supports --execute for agent-side execution and --allow-override
for explicit operator bypass of blocked authority.

Options:
  --file <signal.json>       Resolve one explicit coordination signal file
  --task-plan <id|path>      Resolve one task-plan artifact
  --actor <name>             Resolve one actor-targeted live signal
  --execute                  Upgrade allowed to executed status (signals agent to run)
  --allow-override <reason>  Override a blocked decision with operator reason
  --allow-ignored            Explicitly override a previously ignored signal scope
  --json                     Print structured JSON
  --project-root <path>      Override the project root (defaults to cwd)
  --help                     Show this help
`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    printHelp();
    process.exit(0);
  }

  const projectRoot = path.resolve(args.project_root || process.cwd());
  const decision = resolveAuthority(projectRoot, {
    ...args,
    scope: args._[0] || ''
  });

  if (args.json) {
    console.log(JSON.stringify(decision, null, 2));
  } else {
    console.log(formatDecision(decision));
  }

  const succession = ['executed', 'override-executed'].includes(decision.status);
  if (succession && decision.exact_command) {
    const parts = decision.exact_command.replace(/^\//, '').split(/\s+/);
    const scriptName = parts[0];
    const scriptArgs = parts.slice(1);

    const npmArgs = ['run', scriptName];
    if (scriptArgs.length > 0) {
      npmArgs.push('--', ...scriptArgs);
    }

    console.log(`\nExecuting: npm ${npmArgs.join(' ')}\n`);

    // Keystone emission (P1): the follow-signal npm exec is a real shell
    // boundary. Auto-seed the root, write the child span, then propagate. FULLY
    // FAIL-OPEN — telemetry failure falls back to the inherited env (codex review).
    const followScope = decision.authority.scope || 'follow-signal';
    let followEnv = { ...process.env, CLAUDE_FOLLOW_SIGNAL: 'true' };
    try {
      const { buildNextTraceEnv } = require('../telemetry/dispatches/lib/trace-context.cjs');
      const { detectExecutionMode } = require('../telemetry/dispatches/lib/managed-mode-detect.cjs');
      const { emitChildSpan, ensureRootTraceEnv } = require('../telemetry/dispatches/lib/emit-span.cjs');
      // Recover the source signal's lineage so the root trace_id == the signal's
      // lineage_root_session_id (physical-equivalence). decision.authority only
      // carries the signal FILE path, so read the lineage fields from it (codex
      // review). Fail-soft — null lineage just mints a fresh root.
      let followLineage = null;
      try {
        const sf = decision.authority && decision.authority.signal_file;
        if (sf) {
          const sig = JSON.parse(require('fs').readFileSync(path.resolve(projectRoot, sf), 'utf8'));
          followLineage = sig.lineage_root_session_id || sig.produced_by_session_id || null;
        }
      } catch (_) { /* lineage best-effort */ }
      ensureRootTraceEnv(projectRoot, {
        scope: followScope,
        lineageRootSessionId: followLineage,
        emitSource: 'follow-signal:root'
      });
      const nextEnv = buildNextTraceEnv({
        scope: followScope,
        executionMode: detectExecutionMode(decision.exact_command)
      });
      emitChildSpan(projectRoot, nextEnv, {
        subagent_type: scriptName,
        actor_role: 'worker',
        actor_reason: `follow-signal exec: ${decision.exact_command}`,
        routing_decision: 'delegate-down',
        scope_identity: followScope,
        status: 'ok',
        emit_source: 'follow-signal'
      });
      followEnv = { ...process.env, ...nextEnv, CLAUDE_FOLLOW_SIGNAL: 'true' };
    } catch (telemetryErr) {
      process.stderr.write(`[follow-signal] telemetry fail-open: ${telemetryErr.message}\n`);
    }

    const result = spawnSync('npm', npmArgs, {
      cwd: projectRoot,
      stdio: 'inherit',
      env: followEnv
    });

    if (result.status !== 0) {
      console.error(`\nExecution failed with exit code ${result.status}`);
      process.exit(result.status || 1);
    }
  }

  const successStatuses = ['allowed', 'executed', 'override-allowed', 'override-executed'];
  if (successStatuses.includes(decision.status)) {
    process.exit(0);
  }

  process.exit(2);
}

main();
