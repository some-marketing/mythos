'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Relative path from project root to the ownership archive directory. */
const OWNERSHIP_ARCHIVE_DIR = path.join('_dev', 'oversight', 'ownership');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Ensure a directory exists, creating it recursively if needed.
 * @param {string} dirPath
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Compute the overlap between two arrays of file paths.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {string[]} Paths present in both arrays.
 */
function intersect(a, b) {
  var setB = {};
  for (var i = 0; i < b.length; i++) {
    setB[b[i]] = true;
  }
  var result = [];
  for (var j = 0; j < a.length; j++) {
    if (setB[a[j]]) {
      result.push(a[j]);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a single worker ownership report.
 *
 * Report schema:
 *   worker_id       {string}   - Unique worker identifier.
 *   owned_files     {string[]} - Files this worker claims to own.
 *   current_substep {string}   - Current substep being worked.
 *   overlap_risk    {number}   - 0 = no overlap detected, >0 = overlap count.
 *   blockers        {string[]} - Active blockers for this worker.
 *
 * @param {object} report - Worker ownership report object.
 * @returns {{ valid: boolean, errors: string[], report: object }}
 */
function validateOwnership(report) {
  var errors = [];

  if (!report || typeof report !== 'object') {
    return { valid: false, errors: ['Report is null or not an object'], report: null };
  }

  if (!report.worker_id || typeof report.worker_id !== 'string') {
    errors.push('Missing or invalid worker_id');
  }

  if (!Array.isArray(report.owned_files)) {
    errors.push('owned_files must be an array');
  }

  if (typeof report.current_substep !== 'string') {
    errors.push('current_substep must be a string');
  }

  if (typeof report.overlap_risk !== 'number') {
    errors.push('overlap_risk must be a number');
  } else if (report.overlap_risk > 0) {
    errors.push('overlap_risk is ' + report.overlap_risk +
      ' — writes are blocked until overlap is resolved');
  }

  if (!Array.isArray(report.blockers)) {
    errors.push('blockers must be an array');
  }

  var writeBlocked = typeof report.overlap_risk === 'number' && report.overlap_risk > 0;

  return {
    valid: errors.length === 0 && !writeBlocked,
    errors: errors,
    report: report,
    write_blocked: writeBlocked
  };
}

// ---------------------------------------------------------------------------
// Overlap detection
// ---------------------------------------------------------------------------

/**
 * Check for file-ownership overlap across multiple worker reports.
 * Returns overlap details and flags any workers whose writes should be blocked.
 *
 * @param {object[]} reports - Array of ownership report objects.
 * @returns {{ has_overlap: boolean, overlaps: Array<{ workers: string[], files: string[] }>, flagged_workers: string[] }}
 */
function checkOverlap(reports) {
  if (!Array.isArray(reports) || reports.length < 2) {
    return { has_overlap: false, overlaps: [], flagged_workers: [] };
  }

  var overlaps = [];
  var flaggedSet = {};

  for (var i = 0; i < reports.length; i++) {
    var a = reports[i];
    if (!a || !Array.isArray(a.owned_files)) continue;

    for (var j = i + 1; j < reports.length; j++) {
      var b = reports[j];
      if (!b || !Array.isArray(b.owned_files)) continue;

      var shared = intersect(a.owned_files, b.owned_files);
      if (shared.length > 0) {
        overlaps.push({
          workers: [a.worker_id, b.worker_id],
          files: shared
        });
        flaggedSet[a.worker_id] = true;
        flaggedSet[b.worker_id] = true;
      }
    }
  }

  return {
    has_overlap: overlaps.length > 0,
    overlaps: overlaps,
    flagged_workers: Object.keys(flaggedSet)
  };
}

// ---------------------------------------------------------------------------
// Delegation-aware validation
// ---------------------------------------------------------------------------

/**
 * Validate that a worker's ownership claim falls within its delegation scope.
 *
 * @param {object} report - Worker ownership report (same shape as validateOwnership).
 * @param {object} delegationContract - DelegationContract/1.0 object.
 * @returns {{ valid: boolean, errors: string[], out_of_scope: string[] }}
 */
function validateDelegatedOwnership(report, delegationContract) {
  var errors = [];
  var outOfScope = [];

  if (!report || typeof report !== 'object') {
    return { valid: false, errors: ['Report is null or not an object'], out_of_scope: [] };
  }
  if (!delegationContract || typeof delegationContract !== 'object') {
    return { valid: false, errors: ['Delegation contract is null or not an object'], out_of_scope: [] };
  }

  var scope = delegationContract.scope || {};
  var allowedPaths = Array.isArray(scope.allowed_paths) ? scope.allowed_paths : [];
  var deniedPaths = Array.isArray(scope.denied_paths) ? scope.denied_paths : [];
  var ownedFiles = Array.isArray(report.owned_files) ? report.owned_files : [];

  // Check worker_id matches
  if (report.worker_id && delegationContract.worker_id && report.worker_id !== delegationContract.worker_id) {
    errors.push('Worker ID mismatch: report=' + report.worker_id + ', contract=' + delegationContract.worker_id);
  }

  // Check each owned file is within allowed paths
  for (var i = 0; i < ownedFiles.length; i++) {
    var file = ownedFiles[i];
    var inAllowed = false;

    for (var j = 0; j < allowedPaths.length; j++) {
      if (file === allowedPaths[j] || file.startsWith(allowedPaths[j] + '/')) {
        inAllowed = true;
        break;
      }
    }

    // Check against denied paths
    var inDenied = false;
    for (var k = 0; k < deniedPaths.length; k++) {
      if (file === deniedPaths[k] || file.startsWith(deniedPaths[k] + '/')) {
        inDenied = true;
        break;
      }
    }

    if (!inAllowed || inDenied) {
      outOfScope.push(file);
    }
  }

  if (outOfScope.length > 0) {
    errors.push(outOfScope.length + ' file(s) outside delegation scope: ' + outOfScope.join(', '));
  }

  // Check delegation is active
  if (delegationContract.status !== 'active') {
    errors.push('Delegation contract is not active (status: ' + delegationContract.status + ')');
  }

  return {
    valid: errors.length === 0,
    errors: errors,
    out_of_scope: outOfScope
  };
}

// ---------------------------------------------------------------------------
// Archival
// ---------------------------------------------------------------------------

/**
 * Archive an ownership report to the durable storage directory.
 *
 * @param {string} projectRoot - Absolute path to the Mythos repo root.
 * @param {object} report - Validated ownership report.
 * @returns {{ archived: boolean, path: string }}
 */
function archiveReport(projectRoot, report) {
  var archiveDir = path.join(projectRoot, OWNERSHIP_ARCHIVE_DIR);
  ensureDir(archiveDir);

  var ts = new Date().toISOString().replace(/[:.]/g, '-');
  var filename = (report.worker_id || 'unknown') + '__' + ts + '.json';
  var filePath = path.join(archiveDir, filename);

  var envelope = {
    archived_at: new Date().toISOString(),
    report: report
  };

  fs.writeFileSync(filePath, JSON.stringify(envelope, null, 2), 'utf8');

  return { archived: true, path: filePath };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  validateOwnership: validateOwnership,
  checkOverlap: checkOverlap,
  validateDelegatedOwnership: validateDelegatedOwnership,
  archiveReport: archiveReport,
  OWNERSHIP_ARCHIVE_DIR: OWNERSHIP_ARCHIVE_DIR
};
