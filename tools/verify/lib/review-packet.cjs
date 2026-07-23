'use strict';

/**
 * review-packet.cjs — ReviewPacket/1.0 builder and validator for Mythos.
 *
 * Standardizes how review information is passed between Claude instances
 * and to Codex. Provides factory, validation, upgrade, and read helpers.
 *
 * Usage:
 *   const { createReviewPacket, validateReviewPacket } = require('./lib/review-packet.cjs');
 *   const packet = createReviewPacket('framework audit', new Date().toISOString(), 'manifest.json');
 *   const result = validateReviewPacket(packet);
 *   // result.valid === true
 */

const fs = require('fs');
const path = require('path');

const REVIEW_PACKET_SCHEMA_VERSION = 'ReviewPacket/1.0';

const VALID_SEVERITIES = ['blocker', 'major', 'warning', 'info'];

/**
 * createReviewPacket — Factory that returns a ReviewPacket/1.0 object.
 *
 * @param {string} scope - What was reviewed
 * @param {string} reviewedAt - ISO-8601 timestamp of when the review was performed
 * @param {string|string[]} sourceOfTruth - Path(s) to authoritative document(s)
 * @param {object} [opts] - Optional fields
 * @param {Array} [opts.findings] - Structured findings array
 * @param {string} [opts.expectation_failures_path] - Path to this artifact (self-referential)
 * @param {Array} [opts.open_decisions] - Decisions needing operator input
 * @param {string[]} [opts.artifacts_produced] - Paths to all review output files
 * @param {object} [opts.next_step] - Exact bounded next step ({ command, actor, ... })
 * @param {string} [opts.signal_path] - Path to the coordination signal that triggered this review
 * @returns {object} A ReviewPacket/1.0 object
 */
function createReviewPacket(scope, reviewedAt, sourceOfTruth, opts = {}) {
  const packet = {
    schema: REVIEW_PACKET_SCHEMA_VERSION,
    scope,
    reviewed_at: reviewedAt,
    source_of_truth: sourceOfTruth,
    findings: opts.findings || [],
    expectation_failures_path: opts.expectation_failures_path || '',
    open_decisions: opts.open_decisions || [],
    artifacts_produced: opts.artifacts_produced || [],
    next_step: opts.next_step || { command: '', actor: '' }
  };

  if (opts.signal_path !== undefined) {
    packet.signal_path = opts.signal_path;
  }

  return packet;
}

/**
 * validateReviewPacket — Validates a packet object against ReviewPacket/1.0 requirements.
 *
 * @param {object} packet - The object to validate
 * @param {object} [opts] - Optional validation options
 * @param {string} [opts.projectRoot] - If provided, checks that artifacts_produced paths exist on disk
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateReviewPacket(packet, opts = {}) {
  const projectRoot = opts.projectRoot || '';
  const errors = [];

  if (!packet || typeof packet !== 'object') {
    return { valid: false, errors: ['Packet must be an object.'] };
  }

  if (packet.schema !== REVIEW_PACKET_SCHEMA_VERSION) {
    errors.push(`schema must be "${REVIEW_PACKET_SCHEMA_VERSION}".`);
  }

  if (typeof packet.scope !== 'string' || !packet.scope.trim()) {
    errors.push('scope must be a non-empty string.');
  }

  if (typeof packet.reviewed_at !== 'string' || !packet.reviewed_at.trim()) {
    errors.push('reviewed_at must be a non-empty string.');
  }

  // source_of_truth: string or non-empty array of strings
  if (typeof packet.source_of_truth === 'string') {
    if (!packet.source_of_truth.trim()) {
      errors.push('source_of_truth must be a non-empty string or a non-empty array of strings.');
    }
  } else if (Array.isArray(packet.source_of_truth)) {
    if (packet.source_of_truth.length === 0) {
      errors.push('source_of_truth must be a non-empty string or a non-empty array of strings.');
    } else {
      for (let i = 0; i < packet.source_of_truth.length; i++) {
        if (typeof packet.source_of_truth[i] !== 'string' || !packet.source_of_truth[i].trim()) {
          errors.push(`source_of_truth[${i}] must be a non-empty string.`);
        }
      }
    }
  } else {
    errors.push('source_of_truth must be a non-empty string or a non-empty array of strings.');
  }

  // findings
  if (!Array.isArray(packet.findings)) {
    errors.push('findings must be an array.');
  } else {
    for (let i = 0; i < packet.findings.length; i++) {
      const f = packet.findings[i];
      if (!f || typeof f !== 'object') {
        errors.push(`findings[${i}] must be an object.`);
        continue;
      }
      if (typeof f.id !== 'string' || !f.id.trim()) {
        errors.push(`findings[${i}].id must be a non-empty string.`);
      }
      if (!VALID_SEVERITIES.includes(f.severity)) {
        errors.push(`findings[${i}].severity must be one of: ${VALID_SEVERITIES.join(', ')}.`);
      }
      if (typeof f.expected !== 'string') {
        errors.push(`findings[${i}].expected must be a string.`);
      }
      if (typeof f.observed !== 'string') {
        errors.push(`findings[${i}].observed must be a string.`);
      }
    }
  }

  // open_decisions
  if (!Array.isArray(packet.open_decisions)) {
    errors.push('open_decisions must be an array.');
  } else {
    for (let i = 0; i < packet.open_decisions.length; i++) {
      const d = packet.open_decisions[i];
      if (!d || typeof d !== 'object') {
        errors.push(`open_decisions[${i}] must be an object.`);
        continue;
      }
      if (typeof d.id !== 'string' || !d.id.trim()) {
        errors.push(`open_decisions[${i}].id must be a non-empty string.`);
      }
      if (typeof d.question !== 'string' || !d.question.trim()) {
        errors.push(`open_decisions[${i}].question must be a non-empty string.`);
      }
      if (typeof d.context !== 'string') {
        errors.push(`open_decisions[${i}].context must be a string.`);
      }
    }
  }

  // artifacts_produced
  if (!Array.isArray(packet.artifacts_produced)) {
    errors.push('artifacts_produced must be an array.');
  } else if (projectRoot) {
    for (const artifact of packet.artifacts_produced) {
      const resolved = path.resolve(projectRoot, artifact);
      if (!fs.existsSync(resolved)) {
        errors.push(`artifact does not exist: ${artifact}`);
      }
    }
  }

  // next_step
  if (!packet.next_step || typeof packet.next_step !== 'object') {
    errors.push('next_step must be an object.');
  } else {
    if (typeof packet.next_step.command !== 'string' || !packet.next_step.command.trim()) {
      errors.push('next_step.command must be a non-empty string.');
    }
    if (typeof packet.next_step.actor !== 'string' || !packet.next_step.actor.trim()) {
      errors.push('next_step.actor must be a non-empty string.');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * upgradeExpectationFailures — Takes an existing expectation-failures JSON
 * and wraps it with ReviewPacket/1.0 fields.
 *
 * @param {object} json - An existing expectation-failures object with scope, reviewed_at, source_of_truth, failures
 * @param {object} [opts] - Optional overrides
 * @param {string} [opts.expectation_failures_path] - Self-referential path
 * @param {object} [opts.next_step] - Override for next_step
 * @param {string[]} [opts.artifacts_produced] - Override for artifacts_produced
 * @param {Array} [opts.open_decisions] - Override for open_decisions
 * @param {string} [opts.signal_path] - Coordination signal path
 * @returns {object} The upgraded ReviewPacket/1.0 object
 */
function upgradeExpectationFailures(json, opts = {}) {
  const upgraded = Object.assign({}, json);

  // Add the schema version
  upgraded.schema = REVIEW_PACKET_SCHEMA_VERSION;

  // Map failures to findings (preserving existing shape)
  if (Array.isArray(json.failures) && !upgraded.findings) {
    upgraded.findings = json.failures;
  }
  if (!Array.isArray(upgraded.findings)) {
    upgraded.findings = [];
  }

  // Add empty defaults for missing ReviewPacket fields
  if (upgraded.expectation_failures_path === undefined) {
    upgraded.expectation_failures_path = opts.expectation_failures_path || '';
  }
  if (!Array.isArray(upgraded.open_decisions)) {
    upgraded.open_decisions = opts.open_decisions || [];
  }
  if (!Array.isArray(upgraded.artifacts_produced)) {
    upgraded.artifacts_produced = opts.artifacts_produced || [];
  }
  if (!upgraded.next_step || typeof upgraded.next_step !== 'object') {
    upgraded.next_step = opts.next_step || { command: '', actor: '' };
  }

  if (opts.signal_path !== undefined) {
    upgraded.signal_path = opts.signal_path;
  }

  return upgraded;
}

/**
 * readReviewPacket — Reads and parses a JSON file. Returns null if not a ReviewPacket/1.0.
 *
 * @param {string} filePath - Path to the JSON file
 * @returns {object|null} The parsed ReviewPacket/1.0 object, or null
 */
function readReviewPacket(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.schema !== REVIEW_PACKET_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

module.exports = {
  REVIEW_PACKET_SCHEMA_VERSION,
  VALID_SEVERITIES,
  createReviewPacket,
  validateReviewPacket,
  upgradeExpectationFailures,
  readReviewPacket
};
