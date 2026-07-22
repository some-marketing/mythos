#!/usr/bin/env node
'use strict';

const { parseArgs } = require('./lib/args');
const { computePromotionReadiness, loadCandidate } = require('./lib/capture-candidate');
const { die, requireCandidateRoot } = require('./lib/workspace');
const { refreshLedger, computeLearningGate } = require('./lib/learning-ledger');

function help() {
  console.log(`
Show candidate maturity, replay summary, and promotion blockers.

Usage:
  node tools/workspace/candidate-status.js --candidate <candidate-root>
`.trim());
}

const args = parseArgs(process.argv);
if (args.help || args.h) {
  help();
  process.exit(0);
}

const candidateArg = args.candidate;
if (!candidateArg) die('Missing --candidate <candidate-root>');

const ctx = requireCandidateRoot(candidateArg);
const candidate = loadCandidate(ctx.candidateRoot);
const readiness = computePromotionReadiness(ctx.candidateRoot, candidate, ctx);

// Refresh learning ledger from disk
const frameworkId = `${candidate.service_category}/${candidate.framework_name}`;
const ledger = refreshLedger(ctx.candidateRoot, frameworkId);
const gateMode = candidate.learning_required || 'advisory';
const learningGate = computeLearningGate(ledger, gateMode);

console.log(`Candidate: ${ctx.candidateRoot}`);
console.log(`- status: ${candidate.status}`);
console.log(`- promotion ready: ${readiness.promotionReady ? 'yes' : 'no'}`);
console.log(`- evidence count: ${readiness.evidenceCount}`);
console.log(
  `- preflight summary: total=${readiness.replaySummary.total}, pass=${readiness.replaySummary.pass}, fail=${readiness.replaySummary.fail}, partial=${readiness.replaySummary.partial}`
);
if (readiness.preflightOnly && readiness.replaySummary.total > 0) {
  console.log(`- replay type: preflight only (no manual replay evidence recorded)`);
}
console.log(`- learning maturity:`);
console.log(`  - status: ${ledger.learning_status}`);
console.log(`  - feedback entries: ${ledger.feedback_count}`);
console.log(`  - signal entries: ${ledger.signal_count}`);
console.log(`  - learning ready: ${ledger.learning_ready ? 'yes' : 'no'}`);
console.log(`  - gate mode: ${gateMode}`);
console.log(`  - gate pass: ${learningGate.pass ? 'yes' : 'no'}`);
if (learningGate.advisories.length) {
  console.log(`  - advisories:`);
  for (const adv of learningGate.advisories) {
    console.log(`    - ${adv}`);
  }
}
if (learningGate.blockers.length) {
  console.log(`  - learning blockers:`);
  for (const blocker of learningGate.blockers) {
    console.log(`    - ${blocker}`);
  }
}
if (readiness.blockingIssues.length) {
  console.log(`- structural blockers:`);
  for (const issue of readiness.blockingIssues) {
    console.log(`  - ${issue}`);
  }
}
