'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Patterns that always block a commit unless an explicit override is provided.
 * Checked against both the full relative path and the basename.
 * @type {RegExp[]}
 */
const SENSITIVE_PATTERNS = [
  /^\.env$/,
  /^\.env\..+$/,
  /credentials/i,
  /secrets/i,
  /\.pem$/,
  /\.key$/,
  /_API_KEY/i,
  /_SECRET/i,
  /_TOKEN/i,
  /API_KEY/i,
  /SECRET_KEY/i,
  /ACCESS_TOKEN/i,
];

/**
 * Relative path from project root to the task-outcomes directory.
 * @type {string}
 */
const TASK_OUTCOMES_DIR = path.join('reports', 'task-outcomes');

/**
 * Relative path from project root to the verify-local artifacts directory.
 * @type {string}
 */
const VERIFY_LOCAL_DIR = path.join('reports', 'analysis');

/**
 * Relative path from project root to the override log file.
 * @type {string}
 */
const OVERRIDE_LOG_PATH = path.join('reports', 'logs', 'commit-overrides.jsonl');

/**
 * Branch defaults from canonical system.yaml.
 * The validator keeps local defaults so fixtures and direct callers do not
 * need to load the full system surface just to enforce boundaries.
 */
const DEFAULT_DEV_BRANCH = 'dev/workspace';
const DEFAULT_STABLE_BRANCH = 'main';

/**
 * Paths that are never allowed to become tracked anywhere in the repo.
 * These surfaces carry client auth state or credential-adjacent material and
 * remain blocked even when an override reason is provided.
 * @type {RegExp[]}
 */
const NEVER_TRACK_PATTERNS = [
  /(^|\/)automation\/auth\//,
  /(^|\/)\.credentials\//,
];

/**
 * Prefixes that must never be committed on the stable branch.
 * @type {string[]}
 */
const STABLE_BRANCH_FORBIDDEN_PREFIXES = [];

// ── Lane classification ───────────────────────────────────────────────────

/**
 * Classify a staged file into a lane based on its path.
 *
 * Lane taxonomy:
 * - `system`                      — tools/, instructions/, tests/, .claude/, root config
 * - `client/{CODE}`               — clients/{CODE}/
 * - `framework/{service}/{name}`  — frameworks/{service}/{name}/
 * - `shared`                      — shared/
 * - `unknown`                     — anything else
 *
 * @param {string} filePath - Relative path from project root.
 * @returns {string} Lane identifier.
 */
function classifyLane(filePath) {
  // Normalize separators for safety
  const normalized = filePath.replace(/\\/g, '/');

  // Client files: clients/{CODE}/...
  if (normalized.startsWith('clients/')) {
    const rest = normalized.substring('clients/'.length);
    const slashIdx = rest.indexOf('/');
    const code = slashIdx > 0 ? rest.substring(0, slashIdx) : rest;
    if (code && !code.startsWith('_')) {
      return 'client/' + code;
    }
  }

  // Framework files: frameworks/{service}/{name}/...
  if (normalized.startsWith('frameworks/')) {
    const rest = normalized.substring('frameworks/'.length);
    const parts = rest.split('/');
    if (parts.length >= 2 && !parts[0].startsWith('_') && !parts[1].startsWith('_')) {
      return 'framework/' + parts[0] + '/' + parts[1];
    }
  }

  // Shared files
  if (normalized.startsWith('shared/')) {
    return 'shared';
  }

  // System files: tools/, instructions/, tests/, .claude/, root config
  const systemPrefixes = ['tools/', 'instructions/', 'tests/', '.claude/'];
  for (const prefix of systemPrefixes) {
    if (normalized.startsWith(prefix)) {
      return 'system';
    }
  }

  // Root config files (no directory component, or common config names)
  if (!normalized.includes('/')) {
    return 'system';
  }

  return 'unknown';
}

/**
 * Extract the top-level lane family from a lane identifier.
 * Used to determine coherence between lanes.
 *
 * @param {string} lane - Full lane identifier (e.g. "client/ACME", "system").
 * @returns {string} Lane family (e.g. "client", "system", "framework", "shared").
 */
function laneFamily(lane) {
  const slash = lane.indexOf('/');
  return slash > 0 ? lane.substring(0, slash) : lane;
}

// ── Coherence check ───────────────────────────────────────────────────────

/**
 * Coherence rules for lane combinations.
 *
 * A set of lanes is coherent when:
 * - All files belong to a single lane, OR
 * - All lanes are `system` (includes tests since they classify as system), OR
 * - One non-system, non-client lane + system (e.g. framework work with its tooling/tests)
 *
 * Mixed client lanes, mixed framework lanes, and system + client are NOT coherent.
 * System + client requires an explicit mixed-lane override to proceed.
 *
 * @param {string[]} lanes - Unique lane identifiers found in staged files.
 * @returns {boolean} Whether the combination is coherent.
 */
function isCoherent(lanes) {
  if (lanes.length <= 1) return true;

  // All system lanes = coherent
  if (lanes.every(l => l === 'system')) return true;

  // Count non-system lanes
  const nonSystem = lanes.filter(l => l !== 'system');

  // System + client is NEVER coherent — mixed-lane by default
  const hasSystem = lanes.includes('system');
  const hasClient = nonSystem.some(l => laneFamily(l) === 'client');
  if (hasSystem && hasClient) return false;

  // Single non-system lane + system = coherent (framework + system tooling)
  if (nonSystem.length === 1) return true;

  // Multiple non-system lanes of the same family sharing the same scope = coherent
  // (e.g. two framework sub-paths under the same service/name)
  if (nonSystem.length > 1) {
    const unique = [...new Set(nonSystem)];
    if (unique.length === 1) return true;
  }

  return false;
}

// ── Sensitive file detection ──────────────────────────────────────────────

/**
 * Check whether a file path matches sensitive patterns.
 *
 * @param {string} filePath - Relative path from project root.
 * @returns {boolean} True if the file is sensitive.
 */
function isSensitive(filePath) {
  const basename = path.basename(filePath);
  return SENSITIVE_PATTERNS.some(function (pattern) {
    return pattern.test(basename) || pattern.test(filePath);
  });
}

/**
 * Check whether a file lives on a permanently blocked tracked surface.
 *
 * @param {string} filePath - Relative path from project root.
 * @returns {boolean} True if the file must never be tracked.
 */
function isNeverTrackPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return NEVER_TRACK_PATTERNS.some(function (pattern) {
    return pattern.test(normalized);
  });
}

/**
 * Check whether a file is forbidden on the stable branch.
 *
 * @param {string} filePath - Relative path from project root.
 * @param {string} branchName - Current branch name.
 * @param {string} stableBranch - Stable branch name.
 * @returns {boolean} True if the file is forbidden on the stable branch.
 */
function isStableBranchForbidden(filePath, branchName, stableBranch) {
  if (!branchName || branchName !== stableBranch) return false;
  const normalized = filePath.replace(/\\/g, '/');
  return STABLE_BRANCH_FORBIDDEN_PREFIXES.some(function (prefix) {
    return normalized === prefix.slice(0, -1) || normalized.startsWith(prefix);
  });
}

/**
 * Load .gitignore patterns from the project root and check whether a file
 * matches any of them. Only handles simple prefix/suffix patterns and exact
 * names — not full gitignore glob semantics, which would require a library.
 *
 * @param {string} projectRoot - Absolute path to repo root.
 * @param {string} filePath - Relative path from project root.
 * @returns {boolean} True if the file appears to match a .gitignore pattern.
 */
function matchesGitignore(projectRoot, filePath) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return false;

  var lines;
  try {
    lines = fs.readFileSync(gitignorePath, 'utf8').split('\n');
  } catch (_err) {
    return false;
  }

  const normalized = filePath.replace(/\\/g, '/');
  const basename = path.basename(normalized);

  for (const raw of lines) {
    const line = raw.trim();
    // Skip comments and empty lines
    if (!line || line.startsWith('#')) continue;
    // Skip negation patterns (allowlist entries)
    if (line.startsWith('!')) continue;

    // Strip trailing slash (directory indicator) for matching purposes
    const pattern = line.endsWith('/') ? line.slice(0, -1) : line;

    // Exact name match (e.g. ".env", "node_modules")
    if (basename === pattern || normalized === pattern) return true;

    // Prefix match for directory patterns (e.g. "secrets/", "reports/logs/")
    if (normalized.startsWith(pattern + '/') || normalized.startsWith(pattern)) {
      // Avoid false positives: only match at path boundaries
      if (normalized === pattern || normalized.startsWith(pattern + '/')) return true;
    }

    // Glob prefix match: "**/pattern" matches pattern anywhere in tree
    if (pattern.startsWith('**/')) {
      const suffix = pattern.substring(3);
      if (basename === suffix || normalized.includes('/' + suffix + '/') || normalized.endsWith('/' + suffix)) {
        return true;
      }
    }

    // Glob suffix match: "*.ext" matches by extension
    if (pattern.startsWith('*.')) {
      const ext = pattern.substring(1); // ".ext"
      if (basename.endsWith(ext)) return true;
    }
  }

  return false;
}

// ── Verification evidence ─────────────────────────────────────────────────

/**
 * Check whether verification evidence exists for a given plan ID.
 *
 * Looks for:
 * 1. Outcome artifact at `reports/task-outcomes/{planId}.json`
 * 2. Verify-local artifact at `reports/analysis/verify-local__{planId}.json`
 *
 * @param {string} projectRoot - Absolute path to repo root.
 * @param {string} planId - Task plan identifier.
 * @returns {{ found: boolean, path: string|null }} Verification evidence status.
 */
function checkVerificationEvidence(projectRoot, planId) {
  // Check outcome artifact
  const outcomePath = path.join(projectRoot, TASK_OUTCOMES_DIR, planId + '.json');
  if (fs.existsSync(outcomePath)) {
    return { found: true, path: outcomePath };
  }

  // Check verify-local artifact
  const verifyLocalPath = path.join(projectRoot, VERIFY_LOCAL_DIR, 'verify-local__' + planId + '.json');
  if (fs.existsSync(verifyLocalPath)) {
    return { found: true, path: verifyLocalPath };
  }

  return { found: false, path: null };
}

// ── Override recording ────────────────────────────────────────────────────

/**
 * Append an override record to the commit-overrides log.
 *
 * @param {string} projectRoot - Absolute path to repo root.
 * @param {object} record
 * @param {string} record.reason - Override reason.
 * @param {string[]} record.stagedFiles - Files being committed.
 * @param {string[]} record.bypassedRules - Rules that were bypassed.
 */
function recordOverride(projectRoot, record) {
  const logPath = path.join(projectRoot, OVERRIDE_LOG_PATH);
  const logDir = path.dirname(logPath);

  // Ensure directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  var entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    reason: record.reason,
    stagedFiles: record.stagedFiles,
    bypassedRules: record.bypassedRules,
  });

  fs.appendFileSync(logPath, entry + '\n', 'utf8');
}

// ── Main validator ────────────────────────────────────────────────────────

/**
 * Validate staged files against commit hygiene rules.
 *
 * The commit hygiene law blocks by default unless:
 * 1. Staged files belong to one coherent slice or lane
 * 2. The slice has a declared plan or explicit override authority
 * 3. Required verification has passed
 * 4. Required closeout/debrief artifacts exist when the slice claims completion
 * 5. Sensitive files remain blocked
 *
 * Exceptions allowed only through explicit recorded override reason.
 *
 * @param {string} projectRoot - Absolute path to Mythos repo root.
 * @param {string[]} stagedFiles - List of staged file paths (relative to projectRoot).
 * @param {object} [options]
 * @param {string} [options.overrideReason] - Explicit override reason to bypass blocking.
 * @param {string} [options.planId] - Task plan ID authorizing these changes.
 * @param {boolean} [options.verificationPassed] - Whether verification has passed.
 * @param {boolean} [options.allowMixedLane] - Explicit override flag to allow mixed system+client commits.
 * @param {string} [options.currentBranch] - Current branch name for stable-branch boundary enforcement.
 * @param {string} [options.devBranch] - Development branch name. Defaults to "dev/workspace".
 * @param {string} [options.stableBranch] - Stable branch name. Defaults to "main".
 * @returns {CommitValidation}
 */
function validateCommit(projectRoot, stagedFiles, options) {
  var opts = options || {};

  /** @type {string[]} */
  var errors = [];
  /** @type {string[]} */
  var warnings = [];
  /** @type {string[]} */
  var bypassedRules = [];
  /** @type {string[]} */
  var hardErrors = [];

  function pushHardError(message) {
    errors.push(message);
    hardErrors.push(message);
  }

  // ── Classify all staged files ──

  /** @type {Map<string, string[]>} lane -> files */
  var laneMap = new Map();
  for (var i = 0; i < stagedFiles.length; i++) {
    var file = stagedFiles[i];
    var lane = classifyLane(file);
    if (!laneMap.has(lane)) {
      laneMap.set(lane, []);
    }
    laneMap.get(lane).push(file);
  }

  var lanes = Array.from(laneMap.keys());
  var slices = lanes.filter(function (l) { return l !== 'system' && l !== 'unknown'; });
  var mixed = !isCoherent(lanes);

  var classification = {
    lanes: lanes,
    slices: slices,
    mixed: mixed,
  };

  var currentBranch = opts.currentBranch || null;
  var stableBranch = opts.stableBranch || DEFAULT_STABLE_BRANCH;
  var devBranch = opts.devBranch || DEFAULT_DEV_BRANCH;

  // ── Rule 5: Sensitive file check (always runs first) ──

  var sensitiveFiles = stagedFiles.filter(function (f) {
    return isSensitive(f) || matchesGitignore(projectRoot, f);
  });

  if (sensitiveFiles.length > 0) {
    pushHardError(
      'Sensitive files staged: ' + sensitiveFiles.join(', ') +
      '. Remove them. Override is not permitted for sensitive files.'
    );
  }

  var neverTrackFiles = stagedFiles.filter(function (f) {
    return isNeverTrackPath(f);
  });

  if (neverTrackFiles.length > 0) {
    pushHardError(
      'Credential-bearing auth surfaces staged: ' + neverTrackFiles.join(', ') +
      '. These paths must remain untracked on every branch.'
    );
  }

  var stableBranchViolations = stagedFiles.filter(function (f) {
    return isStableBranchForbidden(f, currentBranch, stableBranch);
  });

  if (stableBranchViolations.length > 0) {
    pushHardError(
      'Stable branch "' + stableBranch + '" cannot contain development artifacts: ' +
      stableBranchViolations.join(', ') +
      '. Keep these paths on "' + devBranch + '" only.'
    );
  }

  // ── Rule 1: Coherence check ──

  if (mixed) {
    // Check if this is a system+client mixed-lane situation
    var hasSystemLane = lanes.includes('system');
    var hasClientLane = lanes.some(function (l) { return laneFamily(l) === 'client'; });
    var isSystemClientMix = hasSystemLane && hasClientLane;

    if (isSystemClientMix && opts.allowMixedLane) {
      // Explicit override flag provided for mixed system+client commit
      bypassedRules.push('mixed-lane-override: system+client allowed via allowMixedLane flag');
    } else {
      var mixedMsg = 'Mixed lanes detected: ' + lanes.join(', ') +
        '. Commits must belong to one coherent slice or lane.';
      if (isSystemClientMix) {
        mixedMsg += ' System + client commits require the allowMixedLane flag to proceed.';
      }
      errors.push(mixedMsg);
    }
  }

  // ── Rule 2: Plan authority check ──

  if (!opts.planId && !opts.overrideReason) {
    errors.push(
      'No plan ID provided. ' +
      'Commits must reference a declared task plan or provide an explicit override reason.'
    );
  }

  // ── Rule 3: Verification check ──

  if (opts.planId) {
    if (!opts.verificationPassed) {
      var evidence = checkVerificationEvidence(projectRoot, opts.planId);
      if (!evidence.found) {
        errors.push(
          'No verification evidence found for plan "' + opts.planId + '". ' +
          'Run verification or pass verificationPassed: true.'
        );
      }
    }
    // If verificationPassed is explicitly true, trust the caller
  } else if (!opts.overrideReason) {
    // No planId and no override — verification cannot be checked, already errored above
    errors.push(
      'Verification cannot be confirmed without a plan ID or override. ' +
      'Provide a planId with verification evidence, or an overrideReason.'
    );
  }

  // ── Rule 4: Closeout artifacts (when the unknown lane suggests ad-hoc work) ──

  if (laneMap.has('unknown') && laneMap.get('unknown').length > 0) {
    warnings.push(
      'Files in unrecognized paths: ' + laneMap.get('unknown').join(', ') +
      '. Ensure these belong to a declared slice.'
    );
  }

  // ── Determine overall verdict ──

  var hasErrors = errors.length > 0;
  var allowed = !hasErrors;

  // ── Handle override ──

  if (opts.overrideReason && hasErrors) {
    if (hardErrors.length === 0) {
      bypassedRules = errors.slice(); // copy of all errors being bypassed
      allowed = true;

      recordOverride(projectRoot, {
        reason: opts.overrideReason,
        stagedFiles: stagedFiles,
        bypassedRules: bypassedRules,
      });
    }
  }

  return {
    allowed: allowed,
    errors: errors,
    warnings: warnings,
    classification: classification,
    overrideReason: opts.overrideReason || null,
    bypassedRules: bypassedRules,
  };
}

/**
 * @typedef {object} CommitValidation
 * @property {boolean} allowed - Whether the commit should proceed.
 * @property {string[]} errors - Blocking issues.
 * @property {string[]} warnings - Non-blocking concerns.
 * @property {object} classification - { lanes: string[], slices: string[], mixed: boolean }
 * @property {string|null} overrideReason - If override was used.
 * @property {string[]} bypassedRules - Rules bypassed via override.
 */

// ── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  validateCommit,
  classifyLane,
  isCoherent,
  isSensitive,
  isNeverTrackPath,
  isStableBranchForbidden,
  matchesGitignore,
  checkVerificationEvidence,
};
