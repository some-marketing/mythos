'use strict';

const path = require('path');
const { ensureDir, exists, listFiles, readJson, writeJson } = require('./fs');
const { validateNamedModel } = require('./models');

/**
 * Provenance fields required on entries used as promotion-grade evidence.
 */
const PROVENANCE_FIELDS = [
  'produced_by_actor_id',
  'produced_by_actor_type',
  'produced_by_harness_id'
];

/**
 * Additional fields required when the producing actor is type=intelligence.
 * Validates that a distinct intelligence (different actor_id AND different
 * harness_id) performed the validation.
 */
const VALIDATION_FIELDS = [
  'validated_by_actor_id',
  'validated_by_actor_type',
  'validated_by_harness_id',
  'validation_artifact'
];

/**
 * Check whether an entry has complete provenance metadata.
 */
function hasProvenance(entry) {
  return PROVENANCE_FIELDS.every((f) => entry[f] != null && entry[f] !== '');
}

/**
 * Check whether an AI-produced entry has distinct-intelligence validation.
 *
 * Distinct requires: different actor_id AND different harness_id when both
 * producer and validator are type=intelligence.  Human review is supplemental
 * only and does not satisfy this gate.
 */
function hasDistinctIntelligenceValidation(entry) {
  if (entry.produced_by_actor_type !== 'intelligence') return true;

  const hasFields = VALIDATION_FIELDS.every(
    (f) => entry[f] != null && entry[f] !== ''
  );
  if (!hasFields) return false;

  // Human validator is supplemental — does not satisfy the gate
  if (entry.validated_by_actor_type !== 'intelligence') return false;

  const distinctActor = entry.validated_by_actor_id !== entry.produced_by_actor_id;
  const distinctHarness = entry.validated_by_harness_id !== entry.produced_by_harness_id;
  return distinctActor && distinctHarness;
}

/**
 * Initialize an empty learning ledger for a candidate.
 */
function initLedger(frameworkId) {
  const now = new Date().toISOString();
  return {
    framework_id: frameworkId,
    created_at: now,
    updated_at: now,
    feedback_count: 0,
    signal_count: 0,
    accepted_runs: 0,
    rejected_runs: 0,
    passing_signals: 0,
    failing_signals: 0,
    learning_ready: false,
    learning_status: 'no_evidence',
    learning_blockers: ['No feedback entries', 'No signal entries']
  };
}

/**
 * Load all feedback entries from a learning directory.
 */
function loadFeedbackEntries(learningRoot) {
  const feedbackDir = path.join(learningRoot, 'feedback');
  if (!exists(feedbackDir)) return [];
  return listFiles(feedbackDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const entry = readJson(path.join(feedbackDir, f));
      validateNamedModel('feedback-entry.schema.json', entry, `feedback/${f}`);
      return entry;
    });
}

/**
 * Load all signal entries from a learning directory.
 */
function loadSignalEntries(learningRoot) {
  const signalsDir = path.join(learningRoot, 'signals');
  if (!exists(signalsDir)) return [];
  return listFiles(signalsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const entry = readJson(path.join(signalsDir, f));
      validateNamedModel('signal-entry.schema.json', entry, `signals/${f}`);
      return entry;
    });
}

/**
 * Recompute the learning ledger from feedback and signal entries.
 */
function recomputeLedger(frameworkId, feedbackEntries, signalEntries) {
  const now = new Date().toISOString();

  const acceptedRuns = feedbackEntries.filter(
    (e) => e.outcome === 'accepted' || e.outcome === 'accepted_with_edits'
  ).length;
  const rejectedRuns = feedbackEntries.filter((e) => e.outcome === 'rejected').length;
  const passingSignals = signalEntries.filter((e) => e.result === 'pass').length;
  const failingSignals = signalEntries.filter((e) => e.result === 'fail').length;

  const allEntries = [...feedbackEntries, ...signalEntries];
  const readiness = computeLearningReadiness(feedbackEntries.length, signalEntries.length, allEntries);

  return {
    framework_id: frameworkId,
    created_at: now,
    updated_at: now,
    feedback_count: feedbackEntries.length,
    signal_count: signalEntries.length,
    accepted_runs: acceptedRuns,
    rejected_runs: rejectedRuns,
    passing_signals: passingSignals,
    failing_signals: failingSignals,
    learning_ready: readiness.learning_ready,
    learning_status: readiness.learning_status,
    learning_blockers: readiness.learning_blockers
  };
}

/**
 * Compute learning readiness from counts and entries.
 *
 * Minimum thresholds (conservative, advisory-level):
 * - At least 1 feedback entry (operator or user has assessed the framework)
 * - At least 1 signal entry (some internal evidence exists)
 * - All AI-produced entries must have distinct-intelligence validation
 */
function computeLearningReadiness(feedbackCount, signalCount, allEntries) {
  const blockers = [];
  if (feedbackCount < 1) blockers.push('No feedback entries');
  if (signalCount < 1) blockers.push('No signal entries');

  // Enforce distinct-intelligence validation on AI-produced evidence
  if (Array.isArray(allEntries)) {
    for (const entry of allEntries) {
      if (!hasProvenance(entry)) continue; // entries without provenance are not promotion-grade
      if (entry.produced_by_actor_type === 'intelligence' && !hasDistinctIntelligenceValidation(entry)) {
        blockers.push(
          `AI-produced entry ${entry.entry_id || '(unknown)'} lacks distinct-intelligence validation`
        );
      }
    }
  }

  const learningReady = blockers.length === 0;
  let learningStatus;
  if (learningReady) {
    learningStatus = 'learning_ready';
  } else if (feedbackCount > 0 || signalCount > 0) {
    learningStatus = 'evidence_in_progress';
  } else {
    learningStatus = 'no_evidence';
  }

  return {
    learning_ready: learningReady,
    learning_status: learningStatus,
    learning_blockers: blockers
  };
}

/**
 * Load or initialize the learning ledger for a candidate.
 */
function loadOrInitLedger(candidateRoot, frameworkId) {
  const learningRoot = path.join(candidateRoot, 'learning');
  const ledgerPath = path.join(learningRoot, 'learning-ledger.json');
  if (exists(ledgerPath)) {
    const ledger = readJson(ledgerPath);
    validateNamedModel('learning-ledger.schema.json', ledger, 'learning-ledger.json');
    return ledger;
  }
  return initLedger(frameworkId);
}

/**
 * Refresh the learning ledger by scanning feedback and signal entries on disk.
 */
function refreshLedger(candidateRoot, frameworkId) {
  const learningRoot = path.join(candidateRoot, 'learning');
  const feedbackEntries = loadFeedbackEntries(learningRoot);
  const signalEntries = loadSignalEntries(learningRoot);
  const ledger = recomputeLedger(frameworkId, feedbackEntries, signalEntries);

  // Preserve original created_at if ledger already exists
  const ledgerPath = path.join(learningRoot, 'learning-ledger.json');
  if (exists(ledgerPath)) {
    const existing = readJson(ledgerPath);
    if (existing.created_at) {
      ledger.created_at = existing.created_at;
    }
  }

  validateNamedModel('learning-ledger.schema.json', ledger, 'learning-ledger.json');
  ensureDir(learningRoot);
  writeJson(ledgerPath, ledger);
  return ledger;
}

/**
 * Write a feedback entry to the learning directory.
 */
function writeFeedbackEntry(learningRoot, entry) {
  validateNamedModel('feedback-entry.schema.json', entry, 'feedback entry');
  const feedbackDir = path.join(learningRoot, 'feedback');
  ensureDir(feedbackDir);
  const fileName = `${entry.entry_id}.json`;
  writeJson(path.join(feedbackDir, fileName), entry);
  return fileName;
}

/**
 * Write a signal entry to the learning directory.
 */
function writeSignalEntry(learningRoot, entry) {
  validateNamedModel('signal-entry.schema.json', entry, 'signal entry');
  const signalsDir = path.join(learningRoot, 'signals');
  ensureDir(signalsDir);
  const fileName = `${entry.entry_id}.json`;
  writeJson(path.join(signalsDir, fileName), entry);
  return fileName;
}

/**
 * Compute the learning gate result for promotion.
 *
 * @param {object} ledger - Learning ledger
 * @param {string} gateMode - 'advisory' or 'required'
 * @returns {{ pass: boolean, advisories: string[], blockers: string[] }}
 */
function computeLearningGate(ledger, gateMode) {
  const advisories = [];
  const blockers = [];

  if (!ledger || ledger.feedback_count < 1) {
    const msg = 'No feedback entries: operator or user has not assessed this framework.';
    if (gateMode === 'required') {
      blockers.push(msg);
    } else {
      advisories.push(msg);
    }
  }

  if (!ledger || ledger.signal_count < 1) {
    const msg = 'No signal entries: no internal evidence (validation, replay, audit) recorded.';
    if (gateMode === 'required') {
      blockers.push(msg);
    } else {
      advisories.push(msg);
    }
  }

  return {
    pass: blockers.length === 0,
    advisories,
    blockers
  };
}

module.exports = {
  computeLearningGate,
  computeLearningReadiness,
  hasDistinctIntelligenceValidation,
  hasProvenance,
  initLedger,
  loadFeedbackEntries,
  loadOrInitLedger,
  loadSignalEntries,
  PROVENANCE_FIELDS,
  recomputeLedger,
  refreshLedger,
  VALIDATION_FIELDS,
  writeFeedbackEntry,
  writeSignalEntry
};
