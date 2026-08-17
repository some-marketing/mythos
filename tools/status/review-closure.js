#!/usr/bin/env node
'use strict';

/**
 * Review-closure status: a count-and-join view of work that still prevents
 * review closure. This module is read-only; it never closes, archives, or
 * mutates a lifecycle artifact.
 */

const fs = require('fs');
const path = require('path');

const { listActiveTaskPlans, listCompletedTaskPlans } = require('../signals/lib/decision-tree');
const { scanLiveHandoffSignals } = require('../signals/lib/pipeline-loop');
const { listAllTaskPlans } = require('../planning/lib/resolve-task-plan');

const DAY_MS = 86400000;
const DEFAULT_ARCHIVE_AGE_DAYS = 7;

function safeReadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function listFiles(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => path.join(dirPath, entry.name))
      .sort();
  } catch { return []; }
}

function relative(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function readRetentionPolicy(projectRoot) {
  return safeReadJson(path.join(projectRoot, 'tools', 'artifacts', 'retention-policy.json')) || {};
}

function isProtected(relPath, patterns) {
  return (patterns || []).some(pattern => {
    const regex = new RegExp('^' + String(pattern)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '__GLOBSTAR__')
      .replace(/\*/g, '[^/]*')
      .replace(/__GLOBSTAR__/g, '.*') + '$');
    return regex.test(relPath);
  });
}

function getArchiveableArtifacts(projectRoot, now = Date.now(), ageDays = DEFAULT_ARCHIVE_AGE_DAYS) {
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
  const policy = readRetentionPolicy(projectRoot);
  const protectedPatterns = Array.isArray(policy.protected)
    ? policy.protected
    : ((policy.surfaces && policy.surfaces['_dev/reports/analysis'] && policy.surfaces['_dev/reports/analysis'].protected) || []);
  const ageThresholdMs = ageDays * DAY_MS;
  const files = listFiles(analysisDir)
    .map(filePath => {
      try {
        const stat = fs.statSync(filePath);
        return { filePath, mtime: stat.mtimeMs, age: now - stat.mtimeMs };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  const candidates = files.filter((item, index) => index > 0 && item.age >= ageThresholdMs &&
    !isProtected(relative(projectRoot, item.filePath), protectedPatterns));
  return { count: candidates.length, age_days: ageDays, paths: candidates.map(item => relative(projectRoot, item.filePath)) };
}

function getDeferredMaintenance(projectRoot) {
  try {
    const closeout = require('../maintenance/lib/closeout-maintenance');
    const report = closeout.analyzeAndApplyCloseoutMaintenance(projectRoot, {
      execute: false,
      scope: 'latest',
      ageDays: DEFAULT_ARCHIVE_AGE_DAYS,
      emitDispatch: false,
      report: false
    });
    const conditions = Array.isArray(report.conditions) ? report.conditions : [];
    return { count: conditions.length, ids: conditions.map(condition => condition.id).filter(Boolean), available: true };
  } catch (error) {
    return { count: 0, ids: [], available: false, error: error.message };
  }
}

function getReviewClosure(projectRoot, options = {}) {
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const signals = scanLiveHandoffSignals(signalDir);
  const allPlans = listAllTaskPlans(projectRoot);
  const activePlans = listActiveTaskPlans(projectRoot);
  const completedPlans = listCompletedTaskPlans(projectRoot);
  const planIds = new Set(allPlans.map(plan => plan.taskId));
  const signalScopes = new Set(signals.map(item => item.signal.signal_scope || item.signal.scope).filter(Boolean));
  const completedIds = completedPlans.map(plan => plan.taskId);
  const outcomeDir = path.join(projectRoot, '_dev', 'reports', 'analysis', 'task-outcomes');
  const outcomeIds = new Set(listFiles(outcomeDir).filter(filePath => filePath.endsWith('.json')).map(filePath => path.basename(filePath, '.json')));
  const activeWithoutSignal = activePlans.map(plan => plan.taskId).filter(taskId => !signalScopes.has(taskId));
  const completedWithoutOutcome = completedIds.filter(taskId => !outcomeIds.has(taskId));
  const orphanedOutcomes = [...outcomeIds].filter(taskId => !planIds.has(taskId));
  const deferredMaintenance = getDeferredMaintenance(projectRoot);
  const archiveableArtifacts = getArchiveableArtifacts(projectRoot, options.now || Date.now(), options.archiveAgeDays || DEFAULT_ARCHIVE_AGE_DAYS);
  return {
    schema: 'ReviewClosure/1.0',
    counts: { live_signals: signals.length, active_plans: activePlans.length, completed_verified_outcomes: completedPlans.length, deferred_maintenance: deferredMaintenance.count, archiveable_artifacts: archiveableArtifacts.count },
    gaps: { active_plans_without_live_signal: activeWithoutSignal, completed_outcomes_without_artifact: completedWithoutOutcome, orphaned_outcome_artifacts: orphanedOutcomes },
    details: { live_signal_scopes: [...signalScopes], active_plan_ids: activePlans.map(plan => plan.taskId), completed_verified_outcome_ids: completedIds, deferred_maintenance_ids: deferredMaintenance.ids, archiveable_artifact_paths: archiveableArtifacts.paths },
    maintenance_available: deferredMaintenance.available,
    ...(deferredMaintenance.error ? { maintenance_error: deferredMaintenance.error } : {})
  };
}

function formatText(closure) {
  const c = closure.counts;
  const lines = [
    'Review closure:',
    `  Live signals:                 ${c.live_signals}`,
    `  Active plans:                 ${c.active_plans}`,
    `  Completed verified outcomes:  ${c.completed_verified_outcomes}`,
    `  Deferred maintenance:         ${c.deferred_maintenance}`,
    `  Archiveable artifacts:         ${c.archiveable_artifacts}`
  ];
  const gaps = closure.gaps;
  lines.push(`  Join gaps: ${gaps.active_plans_without_live_signal.length} active plans without live signals, ${gaps.completed_outcomes_without_artifact.length} completed outcomes without artifacts, ${gaps.orphaned_outcome_artifacts.length} orphaned outcome artifacts`);
  return lines.join('\n');
}

if (require.main === module) {
  const closure = getReviewClosure(path.resolve(__dirname, '../..'));
  console.log(process.argv.includes('--json') ? JSON.stringify(closure, null, 2) : formatText(closure));
}

module.exports = { getReviewClosure, getArchiveableArtifacts, formatText };
