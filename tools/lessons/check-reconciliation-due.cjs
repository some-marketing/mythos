#!/usr/bin/env node
'use strict';

/**
 * check-reconciliation-due.cjs — STUB of the lessons-reconciliation due-check.
 *
 * This is a scaffold, not a working port. The original tool depended on a
 * private auto-run/signals stack (a Codex-specific auto-run status reader
 * and a live-signal scanner tied to that same private coordination
 * contract) that hasn't shipped here. Rather than leave broken requires,
 * this stub implements the PATTERN with a self-contained, genuinely
 * generic due-check: "has it been more than N days since the last
 * reconciliation artifact, or are there N or more unreconciled session-
 * learnings files?" — swap getReconciliationStatus() for your own real
 * cadence/signal logic once you have one.
 *
 * Mechanical tier: this script detects and reports; it performs no
 * reconciliation judgment itself. Wire its output to whatever review step
 * (a command, a task, an operator ping) your own guild uses to actually
 * reconcile lessons.
 *
 * Usage:
 *   node tools/lessons/check-reconciliation-due.cjs         # status only
 *   node tools/lessons/check-reconciliation-due.cjs --json   # machine output
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const ANALYSIS_DIR = path.join(PROJECT_ROOT, '_dev', 'reports', 'analysis');

const DUE_AFTER_DAYS = 7;
const DUE_AFTER_UNRECONCILED_COUNT = 5;

function safeReaddir(dirPath) {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

// Replace this with your own reconciliation cadence/signal logic.
function getReconciliationStatus(projectRoot) {
  const names = safeReaddir(ANALYSIS_DIR);
  const learningsFiles = names.filter((name) => name.startsWith('session-learnings__') && name.endsWith('.md'));
  const reconciliationFiles = names.filter((name) => name.startsWith('lessons-reconciliation__') && name.endsWith('.md'));

  let lastReconciledAt = null;
  for (const name of reconciliationFiles) {
    const stat = safeStat(path.join(ANALYSIS_DIR, name));
    if (stat && (!lastReconciledAt || stat.mtimeMs > lastReconciledAt)) lastReconciledAt = stat.mtimeMs;
  }

  const unreconciledLearnings = learningsFiles.filter((name) => {
    const stat = safeStat(path.join(ANALYSIS_DIR, name));
    return stat && (!lastReconciledAt || stat.mtimeMs > lastReconciledAt);
  });

  const daysSinceLastReconciliation = lastReconciledAt
    ? (Date.now() - lastReconciledAt) / (24 * 60 * 60 * 1000)
    : Infinity;

  const reasons = [];
  if (!Number.isFinite(daysSinceLastReconciliation)) {
    if (learningsFiles.length > 0) reasons.push('no reconciliation artifact has ever been produced');
  } else if (daysSinceLastReconciliation >= DUE_AFTER_DAYS) {
    reasons.push(`${Math.floor(daysSinceLastReconciliation)} days since last reconciliation (threshold ${DUE_AFTER_DAYS})`);
  }
  if (unreconciledLearnings.length >= DUE_AFTER_UNRECONCILED_COUNT) reasons.push(`${unreconciledLearnings.length} unreconciled session-learnings files (threshold ${DUE_AFTER_UNRECONCILED_COUNT})`);

  return {
    due: reasons.length > 0,
    reasons,
    notesSinceLastReconciliation: unreconciledLearnings.length,
    lessonsFiles: learningsFiles.map((name) => path.relative(projectRoot, path.join(ANALYSIS_DIR, name)))
  };
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');

  const status = getReconciliationStatus(PROJECT_ROOT);
  const result = {
    schema: 'LessonsReconciliationCheckStub/1.0',
    checked_at: new Date().toISOString(),
    due: status.due,
    reasons: status.reasons,
    notes_since_last_reconciliation: status.notesSinceLastReconciliation,
    lessons_files: status.lessonsFiles,
    recommended_next_command: status.due ? 'reconcile your lessons (wire this to your own reconcile command)' : ''
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write([
      `due: ${result.due} (${result.reasons.join(', ') || 'no trigger'})`,
      `notes since last reconciliation: ${result.notes_since_last_reconciliation}`
    ].join('\n') + '\n');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`check-reconciliation-due failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { getReconciliationStatus };
