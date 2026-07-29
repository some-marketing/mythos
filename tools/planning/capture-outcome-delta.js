#!/usr/bin/env node
'use strict';

/**
 * capture-outcome-delta.js — Captures the difference between a planned task
 * and its actual execution outcome.
 *
 * Usage:
 *   node tools/planning/capture-outcome-delta.js --task-id <id> --completed <bool> [--json]
 *
 * Reads the plan artifact, prompts for outcome details, and writes
 * the outcome delta to _dev/reports/analysis/task-outcomes/<task-id>.json
 */

const fs = require('fs');
const path = require('path');

const { resolveTaskPlanPaths } = require('./lib/resolve-task-plan');

const ROOT = process.env.MYTHOS_PROJECT_ROOT
  ? path.resolve(process.env.MYTHOS_PROJECT_ROOT)
  : path.resolve(__dirname, '../..');
const OUTCOMES_DIR = path.join(ROOT, '_dev/reports/analysis/task-outcomes');

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { json: args.includes('--json') };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--task-id' && args[i + 1]) result.taskId = args[i + 1];
    if (args[i] === '--completed' && args[i + 1]) { result.completed = args[i + 1] === 'true'; i++; continue; }
    if (args[i] === '--divergences' && args[i + 1]) result.divergences = args[i + 1].split(',');
    if (args[i] === '--gates-triggered' && args[i + 1]) result.gatesTriggered = args[i + 1].split(',');
    if (args[i] === '--corrections' && args[i + 1]) result.corrections = args[i + 1].split(',');
    if (args[i] === '--should-harden' && args[i + 1]) result.shouldHarden = args[i + 1] === 'true';
    if (args[i] === '--hardening-notes' && args[i + 1]) result.hardeningNotes = args[i + 1];
    if (args[i] === '--produced-by-actor-id' && args[i + 1]) result.producedByActorId = args[i + 1];
    if (args[i] === '--produced-by-actor-type' && args[i + 1]) result.producedByActorType = args[i + 1];
    if (args[i] === '--produced-by-harness-id' && args[i + 1]) result.producedByHarnessId = args[i + 1];
    if (args[i] === '--validated-by-actor-id' && args[i + 1]) result.validatedByActorId = args[i + 1];
    if (args[i] === '--validated-by-actor-type' && args[i + 1]) result.validatedByActorType = args[i + 1];
    if (args[i] === '--validated-by-harness-id' && args[i + 1]) result.validatedByHarnessId = args[i + 1];
    if (args[i] === '--validation-artifact' && args[i + 1]) result.validationArtifact = args[i + 1];
    if (args[i] === '--validation-method' && args[i + 1]) result.validationMethod = args[i + 1];
    if (args[i] === '--validation-confidence' && args[i + 1]) result.validationConfidence = args[i + 1];
    if (args[i] === '--all-steps-done' && args[i + 1]) result.allStepsDone = args[i + 1] === 'true';
    if (args[i] === '--verification-passed' && args[i + 1]) result.verificationPassed = args[i + 1] === 'true';
    if (args[i] === '--no-open-blockers' && args[i + 1]) result.noOpenBlockers = args[i + 1] === 'true';
    if (args[i] === '--operator-acceptance' && args[i + 1]) result.operatorAcceptance = args[i + 1] === 'true';
  }

  return result;
}

function main() {
  const args = parseArgs();

  if (!args.taskId) {
    console.error('Usage: node capture-outcome-delta.js --task-id <id> --completed <bool>');
    console.error('  Optional: --divergences "a,b" --gates-triggered "x,y" --corrections "p,q"');
    console.error('           --should-harden true --hardening-notes "notes"');
    process.exit(1);
  }

  // Check plan exists
  let plan = null;
  let planPath = null;
  try {
    const resolved = resolveTaskPlanPaths(ROOT, args.taskId);
    if (resolved && fs.existsSync(resolved.jsonPath)) {
      planPath = resolved.jsonPath;
      plan = JSON.parse(fs.readFileSync(resolved.jsonPath, 'utf8'));
    }
  } catch (e) {
    console.error(`Warning: could not resolve plan for ${args.taskId}: ${e.message}`);
  }

  // Build outcome delta
  const delta = {
    task_id: args.taskId,
    timestamp: new Date().toISOString(),
    plan_existed: plan !== null,
    plan_path: plan ? planPath : null,
    completion_evidence: {
      all_steps_done: args.allStepsDone || false,
      verification_passed: args.verificationPassed || false,
      no_open_blockers: args.noOpenBlockers || false,
      operator_acceptance_received: args.operatorAcceptance || false
    },
    outcome_delta: {
      completed: args.completed !== undefined ? args.completed : null,
      divergences: args.divergences || [],
      gates_triggered: args.gatesTriggered || [],
      corrections_made: args.corrections || [],
      should_harden_framework: args.shouldHarden || false,
      hardening_notes: args.hardeningNotes || ''
    },
    produced_by_actor_id: args.producedByActorId || null,
    produced_by_actor_type: args.producedByActorType || null,
    produced_by_harness_id: args.producedByHarnessId || null,
    produced_at: new Date().toISOString(),
    validated_by_actor_id: args.validatedByActorId || null,
    validated_by_actor_type: args.validatedByActorType || null,
    validated_by_harness_id: args.validatedByHarnessId || null,
    validated_at: args.validatedByActorId ? new Date().toISOString() : null,
    validation_artifact: args.validationArtifact || null,
    validation_method: args.validationMethod || null,
    validation_confidence: args.validationConfidence || null
  };

  // Backward-compatible mirror for older consumers; top-level is canonical.
  delta.outcome_delta.completion_evidence = delta.completion_evidence;

  // Add plan context if available
  if (plan) {
    delta.plan_context = {
      top_framework: plan.similarity_assessment?.top_framework || 'unknown',
      match_score: plan.similarity_assessment?.match_score || 0,
      step_count: plan.bounded_plan?.steps?.length || 0,
      gap_count: (plan.bounded_plan?.steps || []).filter(s => s.is_gap).length
    };
  }

  // Write outcome
  if (!fs.existsSync(OUTCOMES_DIR)) {
    fs.mkdirSync(OUTCOMES_DIR, { recursive: true });
  }
  const outPath = path.join(OUTCOMES_DIR, `${args.taskId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(delta, null, 2) + '\n', 'utf8');

  // Also emit a trace event if trace-writer is available
  try {
    const { writeStandaloneEvent } = require('../trace/lib/trace-writer');
    writeStandaloneEvent(
      'task_outcome',
      'operator',
      delta.plan_context?.top_framework || args.taskId,
      'planning/task-outcomes',
      {
        task_id: args.taskId,
        outcome_class: args.completed ? 'pass' : 'partial',
        divergences: delta.outcome_delta.divergences,
        gates_triggered: delta.outcome_delta.gates_triggered,
        corrections: delta.outcome_delta.corrections_made,
        should_harden: delta.outcome_delta.should_harden_framework
      }
    );
  } catch (e) {
    // trace-writer not available — non-fatal
  }

  if (args.json) {
    console.log(JSON.stringify(delta, null, 2));
  } else {
    console.log(`Outcome delta written to: ${outPath}`);
    console.log(`  Completed: ${delta.outcome_delta.completed}`);
    console.log(`  Divergences: ${delta.outcome_delta.divergences.length}`);
    console.log(`  Gates triggered: ${delta.outcome_delta.gates_triggered.length}`);
    console.log(`  Corrections: ${delta.outcome_delta.corrections_made.length}`);
    console.log(`  Should harden: ${delta.outcome_delta.should_harden_framework}`);
    if (delta.plan_context) {
      console.log(`  Plan framework: ${delta.plan_context.top_framework} (score: ${delta.plan_context.match_score})`);
    }
  }
}

main();
