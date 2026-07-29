'use strict';

const { loadProfile, listProfiles } = require('./profile-loader.cjs');
const { selectLane } = require('./lane-selector.cjs');

/**
 * Convert a simple glob pattern to a regex.
 * Supports ** (any path depth) and * (single segment).
 * No external dependency needed — patterns are simple enough.
 */
function patternToRegex(pattern) {
  let re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex chars (except * and ?)
    .replace(/\*\*/g, '{{GLOBSTAR}}')        // placeholder for **
    .replace(/\*/g, '[^/]+')                 // * = one path segment
    .replace(/{{GLOBSTAR}}/g, '.*');          // ** = any depth
  return new RegExp('^' + re + '$');
}

/**
 * Match changed paths, commands, or skills against all known profiles.
 * Returns an array of matching profile objects (may be empty).
 */
function matchProfiles(changedPaths, command, skill) {
  const profileIds = listProfiles();
  const matched = [];

  for (const id of profileIds) {
    let profile;
    try {
      profile = loadProfile(id);
    } catch {
      continue; // skip invalid profiles
    }

    const m = profile.match || {};
    let hit = false;

    // Match by changed paths
    if (!hit && Array.isArray(m.changed_paths) && Array.isArray(changedPaths)) {
      hit = m.changed_paths.some(pattern => {
        const re = patternToRegex(pattern);
        return changedPaths.some(p => re.test(p));
      });
    }

    // Match by command
    if (!hit && Array.isArray(m.commands) && command) {
      hit = m.commands.includes(command);
    }

    // Match by skill
    if (!hit && Array.isArray(m.skills) && skill) {
      hit = m.skills.includes(skill);
    }

    if (hit) matched.push(profile);
  }

  return matched;
}

/**
 * Select execution lane for a matched profile.
 * Uses the profile's execution settings and lane selector to determine
 * the appropriate lane for a given workflow context.
 *
 * @param {object} profile - A matched task profile
 * @param {object} [context] - Workflow context (safe to omit)
 * @param {string} [context.workflow_type] - Workflow type
 * @param {boolean} [context.acceptance_grade] - Whether this is acceptance-grade
 * @param {string} [context.risk_tier] - Risk tier
 * @param {string} [context.cloud_override_reason] - Cloud override reason
 * @param {boolean} [context.operator_requested_cloud] - Operator requested cloud
 * @returns {object|null} Lane assignment or null if no profile
 */
function selectLaneForProfile(profile, context) {
  if (!profile) return null;
  var ctx = context || {};
  var exec = profile.execution || {};
  var le = exec.lane_eligibility || {};

  var cloudEligible = le.cloud_eligible !== false;

  var assignment = selectLane({
    workflow_type: ctx.workflow_type || null,
    acceptance_grade: le.acceptance_grade || ctx.acceptance_grade || false,
    risk_tier: ctx.risk_tier || 'low',
    local_eligible: le.local_eligible !== false,
    cloud_override_reason: cloudEligible ? (ctx.cloud_override_reason || null) : null,
    operator_requested_cloud: cloudEligible ? (ctx.operator_requested_cloud || false) : false
  });

  // If profile blocks cloud but lane selected cloud, flag the conflict
  if (!cloudEligible && assignment.location === 'cloud') {
    assignment.governance_check = {
      valid: false,
      violations: (assignment.governance_check ? assignment.governance_check.violations : []).concat('cloud_blocked_by_profile')
    };
  }

  return assignment;
}

module.exports = {
  patternToRegex,
  matchProfiles,
  selectLaneForProfile
};
