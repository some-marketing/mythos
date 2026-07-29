#!/usr/bin/env node
'use strict';

const {
  appendHookEvent,
  finish,
  readPayload,
  shouldEmit,
  toolInput,
  toolName,
  writeOut
} = require('./lib/compat-dispatch.cjs');

function normalizedCommand(input) {
  const command = String(input.command || input.cmd || ((input.tool_input || {}).command) || '').trim();
  return ' ' + command.toLowerCase().split('|').map((part) => part.trim()).join(' | ').replace(/\s+/g, ' ').trim() + ' ';
}

function dangerousCommandNotice(payload) {
  const registry = [
    { label: 'rm -rf', all: [' rm -rf '] },
    { label: 'git push --force', all: [' git push ', ' --force '] },
    { label: 'git reset --hard', all: [' git reset ', ' --hard '] },
    { label: 'DROP TABLE', all: [' drop table '] },
    { label: 'DELETE FROM', all: [' delete from '] },
    { label: 'chmod 777', all: [' chmod 777 '] },
    { label: 'curl | sh', all: [' curl '], any: [' | sh ', ' | bash '] },
    { label: 'eval', all: [' eval '] },
    { label: '> /dev/sda', all: [' > /dev/sda '] },
    { label: 'mkfs', any: [' mkfs ', ' mkfs.', '/mkfs.'] },
    { label: 'kill -9', all: [' kill -9 '] },
    { label: 'pkill', all: [' pkill '] }
  ];
  const n = normalizedCommand(toolInput(payload));
  const hit = registry.find((item) =>
    (!item.all || item.all.every((token) => n.includes(token.toLowerCase()))) &&
    (!item.any || item.any.some((token) => n.includes(token.toLowerCase())))
  );
  if (!hit) return;
  appendHookEvent({ matcher: 'Bash', event: 'dangerous-command-detected', detail: { pattern: hit.label } });
  writeOut(`GUARDRAIL: Dangerous command detected — [${hit.label}]. Confirm with the operator before executing. (guardrails.md § Non-negotiable Rules, rule 5).`);
}

function debriefReminder(payload) {
  const c = String(toolInput(payload).command || toolInput(payload).cmd || '').trim();
  if (!/^git commit(?:\s|$)/.test(c)) return;
  appendHookEvent({ matcher: 'Bash', event: 'debrief-reminder-emitted', detail: { trigger: 'git-commit' } });
  if (!shouldEmit(payload, 'debrief-reminder')) return;
  writeOut('GUARDRAIL REMINDER: Have you debriefed this work? Rule 8 requires a debrief before committing. Write outcome_delta, divergences, and corrections to the plan artifact or to _dev/reports/analysis/ before this commit. (guardrails.md § Non-negotiable Rules, rule 8).');
}

function subagentNoSpawn(payload) {
  if (!process.env.CLAUDE_SUBAGENT_ID) return;
  appendHookEvent({ matcher: 'Agent', event: 'subagent-nesting-detected' });
  if (!shouldEmit(payload, 'subagent-no-spawn')) return;
  writeOut('GUARDRAIL WARNING: Subagent nesting detected. Rule 6 caps depth at 2. If you are already at depth 2 (subagent of a subagent), you MUST NOT spawn this agent. Return to your caller instead. (guardrails.md § rule 6)');
}

function planModeReminder(payload) {
  appendHookEvent({ matcher: 'EnterPlanMode', event: 'plan-mode-entered', detail: { policy: 'routing-document' } });
  if (!shouldEmit(payload, 'plan-mode-routing-document')) return;
  writeOut('GUARDRAIL REMINDER: Plan mode artifacts in this project are routing documents. They describe which Mythos scripts to invoke (node tools/planning/assess-similarity.js, node tools/signals/follow-signal.js), not freestanding execution plans. Do not define stages or exit criteria directly — route through the planning tools. (guardrails.md § Planning Policy)');
}

// Fail-open wrapper: the mutation-plan gate (quality-process family) must
// never break dispatch even if its module fails to load.
function runMutationPlanGate(toolToken, payload) {
  try {
    return require('./pretool-mutation-plan-gate.cjs').main({ tool: toolToken, payload });
  } catch {
    return { status: 0 };
  }
}

function main() {
  const payload = readPayload();
  const tool = toolName(payload);
  const lower = tool.toLowerCase();

  if (tool === 'EnterPlanMode') planModeReminder(payload);

  if (tool === 'Agent' || tool === 'Task') {
    subagentNoSpawn(payload);
    const result = require('./pretool-delegation-altitude.cjs').main({ tool: lower, payload });
    if (result && result.status === 2) finish(2);
  }

  // Secret-access gate (existential-safety family, FIRST — safety before
  // hygiene, mech-rebase-tranche-1 T1/B1). Detects .env* reads/writes and
  // key-shaped env token disclosure on Bash, and Write/Edit/MultiEdit
  // targeting .env*. Extends (does not replace) the advisory private-surface
  // checker below. Observe-only when MYTHOS_SECRET_ACCESS_GATE is unset;
  // blocking when =1 (operator flips, never the agent). Degrade path is
  // OPERATOR-KEYED ONLY — no inline bypass_justification (grounding
  // adjustment 1). Fail-open on any internal error.
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'Bash') {
    try {
      const saGate = require('./pretool-secret-access-gate.cjs');
      const saResult = saGate.main({ tool: tool.toLowerCase(), payload });
      if (saResult && saResult.status === 2) finish(2);
    } catch (_) {
      // fail-open: a broken gate must never brick a session
    }
  }

  // Write-boundary gate (harness-critical, FIRST).
  // Blocks writes/deletes that resolve outside the Mythos workspace or into a
  // declared observed/external repo (denylist wins even for subagents).
  // Observe-only when MYTHOS_WRITE_BOUNDARY_GATE is unset; blocking when =1.
  // Fail-open on any internal error. NEVER disable: it is the consent gate.
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'Bash') {
    try {
      const wbGate = require('./pretool-write-boundary-gate.cjs');
      const wbResult = wbGate.main({ tool: tool.toLowerCase(), payload });
      if (wbResult && wbResult.status === 2) finish(2);
    } catch (_) {
      // fail-open: a broken gate must never brick a session
    }
  }

  // Loop-protocol layer gate (ARMED, fail-open). Denies ONLY a definitively-
  // identified loop instance (env MYTHOS_LOOP_INSTANCE resolves in the manifest)
  // writing a definitively-L1/protected path. A non-loop actor (no env signal)
  // always passes. Fail-open on any internal error.
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
    try {
      const loopGate = require('./pretool-loop-layer-gate.cjs');
      const loopResult = loopGate.main({ payload });
      if (loopResult && loopResult.notice) process.stderr.write(loopResult.notice + '\n');
      if (loopResult && loopResult.status === 2) finish(2);
    } catch (_) {
      // fail-open: a broken gate must never brick a session
    }
  }

  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
    let result = require('./pretool-delegation-altitude.cjs').main({ tool: 'edit', payload });
    if (result && result.status === 2) finish(2);
    // tier-s2c: mutation-plan gate (quality-process tier add, REPORT-ONLY
    // while the rule mode is report-only; exit-2 path engages only after the
    // operator flips add_registry.adds.mutation-plan-gate.mode to blocking).
    const mutationGate = runMutationPlanGate('edit', payload);
    if (mutationGate && mutationGate.status === 2) {
      if (mutationGate.message) process.stderr.write(mutationGate.message + '\n');
      finish(2);
    }
    result = require('./pretool-arc-guard.cjs').main();
    if (result === 2 || (result && result.status === 2)) finish(2);
    const convene = require('../../verify/hooks/pre-write-convene-required.cjs').evaluate(toolInput(payload));
    if (convene.notice) process.stdout.write(convene.notice);
    if (!convene.allow) {
      process.stderr.write(convene.message + '\n');
      finish(2);
    }
  }

  if (tool === 'Bash') {
    const privateSurface = require('../../body/private-surface-prebash.cjs');
    const surfaceResult = privateSurface.run(privateSurface.normalizeCommand(toolInput(payload).command || toolInput(payload).cmd || ''));
    if (surfaceResult && surfaceResult.action === 'blocked') finish(2);
    const result = require('./pretool-delegation-altitude.cjs').main({ tool: 'bash', payload });
    if (result && result.status === 2) finish(2);
    // tier-s2c: mutating-Bash lane of the mutation-plan gate (report-only).
    const mutationGate = runMutationPlanGate('bash', payload);
    if (mutationGate && mutationGate.status === 2) {
      if (mutationGate.message) process.stderr.write(mutationGate.message + '\n');
      finish(2);
    }
    dangerousCommandNotice(payload);
    debriefReminder(payload);

    // Git custody gate: hard-block git add/commit of paths owned by another session.
    // Enforcing for FOREIGN paths (positive proof); unknown paths pass.
    // Fail-open on any internal error.
    try {
      const gcGate = require('./pretool-git-custody-gate.cjs');
      const gcResult = gcGate.main({ tool: 'bash', payload });
      if (gcResult && gcResult.status === 2) finish(2);
    } catch (_) {
      // fail-open
    }
  }

  // Orchestrator-worker gate (parked, wired here per 3-mind synthesis).
  // Blocks the coordinator from self-executing mutation/analysis work that
  // should be delegated to a submind. Observe-only when MYTHOS_ORCHESTRATOR_GATE
  // is unset; blocking when =1. Subagents are exempt (they are the workers).
  // Fail-open on any internal error.
  try {
    const owGate = require('./pretool-orchestrator-worker-gate.cjs');
    const owResult = owGate.main({ tool: lower, payload });
    if (owResult && owResult.status === 2) finish(2);
  } catch (_) {
    // fail-open: a broken gate must never brick a session
  }

  finish(0);
}

main();
