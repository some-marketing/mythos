#!/usr/bin/env node
'use strict';

/**
 * posttool-arc-rest-check.cjs — PostToolUse hook.
 * 
 * s06 mechanical rest trigger check.
 *
 * A0/A1 advisory-only surface. This hook records would-rest evidence for
 * mechanical triggers, but it must not transition actor arc state before A3
 * operator ratification.
 */

const { resolveActorId, readCurrentArc } = require('../lib/arc-state-writer.cjs');
const {
  evaluateScopeExpansionAttempted
} = require('../lib/rest-trigger-evaluators.cjs');
const { resolveTarget } = require('../guard-now-write.cjs');

function readToolInput() {
  const raw = process.env.CLAUDE_TOOL_INPUT || '{}';
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function appendAdvisoryEvent(event) {
  try {
    const { appendHookEvent } = require('../../claude/lib/hook-telemetry.cjs');
    return appendHookEvent(event);
  } catch (err) {
    process.stderr.write(
      `[posttool-arc-rest-check] advisory telemetry write failed: ${err.message}\n`
    );
    throw err;
  }
}

function recordScopeExpansionAdvisory(actorId, currentArc, target) {
  const result = evaluateScopeExpansionAttempted(actorId, target, { currentArc });
  if (!result.triggered) return null;

  appendAdvisoryEvent({
    matcher: '.*',
    event: 'auto-rest-advisory',
    detail: {
      trigger_id: result.trigger_id,
      actor_id: actorId,
      arc_id: currentArc.arc_id || null,
      advisory_outcome: result.advisory_outcome,
      evidence: result.evidence
    }
  });
  return result;
}

function main() {
  const actorId = resolveActorId();
  const currentArc = readCurrentArc(actorId);

  if (!currentArc || currentArc.lifecycle_state !== 'executing') return 0;

  const target = resolveTarget(readToolInput());
  if (!target) return 0;

  recordScopeExpansionAdvisory(actorId, currentArc, target);

  return 0;
}

if (require.main === module) {
  try {
    main();
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[posttool-arc-rest-check] ${err.message}\n`);
    process.exit(0);
  }
}

module.exports = {
  readToolInput,
  recordScopeExpansionAdvisory,
  appendAdvisoryEvent,
  main
};
