'use strict';
//
// Stage 6 — Insights Readout with `do_not_decide_yet` Gate
//
// Read-only. Joins insights by framework_id from the local Stage 5 store,
// compares against Stage 5a pre-registered thresholds, returns one of three
// states: decide / monitor / do_not_decide_yet.
//
// Hard gate: refuses to fire without a valid locked Stage 5a artifact.
// Distinguishes observed result from interpretation. Never post-hoc.

const fs = require('fs');
const { validatePreregistration } = require('./stage5a-preregistration-writer');

const MODELED_REPORTING_CAVEAT =
  "Meta's reporting is increasingly modeled/obfuscated. Framework-class attribution is for our learning, not for claims about the platform's optimization geometry.";

function loadAndValidatePreregistration(prereregistrationPath) {
  if (!fs.existsSync(prereregistrationPath)) {
    return { valid: false, errors: [`pre-registration file not found at ${prereregistrationPath}`] };
  }
  const payload = JSON.parse(fs.readFileSync(prereregistrationPath, 'utf8'));
  if (!payload.locked) {
    return { valid: false, errors: ['pre-registration is not locked; refuse to read out until operator approves'] };
  }
  const v = validatePreregistration(payload);
  if (!v.valid) return v;
  return { valid: true, payload };
}

// Per-cell classification.
function classifyCell({ frameworkId, observedMetricValue, sampleSize, attributionWindowStatus, prereregistration, stoppingRulesTriggered }) {
  // Stopping rule pre-empts everything.
  if (stoppingRulesTriggered && stoppingRulesTriggered.length > 0) {
    return {
      framework_id: frameworkId,
      observed_metric_value: observedMetricValue,
      sample_size: sampleSize,
      attribution_window_status: attributionWindowStatus,
      state: 'decide',
      stopping_rule_triggered: stoppingRulesTriggered[0],
      interpretation_note: 'pre-registered stopping rule fired; this is a decide state by Stage 5a contract'
    };
  }

  // Sample-size floor.
  if (sampleSize < prereregistration.sample_size_minimum) {
    return {
      framework_id: frameworkId,
      observed_metric_value: observedMetricValue,
      sample_size: sampleSize,
      attribution_window_status: attributionWindowStatus,
      state: 'do_not_decide_yet',
      stopping_rule_triggered: null,
      interpretation_note: `sample_size=${sampleSize} below pre-registered minimum=${prereregistration.sample_size_minimum}; do not interpret observed value`
    };
  }

  // Attribution window.
  if (attributionWindowStatus !== 'closed') {
    return {
      framework_id: frameworkId,
      observed_metric_value: observedMetricValue,
      sample_size: sampleSize,
      attribution_window_status: attributionWindowStatus,
      state: 'do_not_decide_yet',
      stopping_rule_triggered: null,
      interpretation_note: 'attribution window still open; observed value will shift as conversions land'
    };
  }

  // If we get here, sample size is sufficient and the window is closed. Without a
  // dedicated decide-vs-monitor heuristic the safe call is `monitor` — observed
  // value is reportable but the framework does not auto-call winners. Operator
  // makes the call at Stage 7 with full context.
  return {
    framework_id: frameworkId,
    observed_metric_value: observedMetricValue,
    sample_size: sampleSize,
    attribution_window_status: attributionWindowStatus,
    state: 'monitor',
    stopping_rule_triggered: null,
    interpretation_note: 'sufficient data; observed value is reportable but no stopping rule has fired — Stage 7 evaluates next-iteration response'
  };
}

function readout({ prereregistrationPath, cellInputs }) {
  const v = loadAndValidatePreregistration(prereregistrationPath);
  if (!v.valid) {
    return {
      timestamp: new Date().toISOString(),
      preregistration_path: prereregistrationPath,
      preregistration_valid: false,
      errors: v.errors,
      modeled_reporting_caveat: MODELED_REPORTING_CAVEAT,
      cells: []
    };
  }
  const prereg = v.payload;

  if (!Array.isArray(cellInputs)) {
    return {
      timestamp: new Date().toISOString(),
      preregistration_path: prereregistrationPath,
      preregistration_valid: true,
      errors: ['cellInputs must be an array (one per framework_id under test)'],
      modeled_reporting_caveat: MODELED_REPORTING_CAVEAT,
      cells: []
    };
  }

  const cells = cellInputs.map((c) =>
    classifyCell({
      frameworkId: c.framework_id,
      observedMetricValue: c.observed_metric_value,
      sampleSize: c.sample_size,
      attributionWindowStatus: c.attribution_window_status,
      prereregistration: prereg,
      stoppingRulesTriggered: c.stopping_rules_triggered
    })
  );

  return {
    timestamp: new Date().toISOString(),
    preregistration_path: prereregistrationPath,
    preregistration_valid: true,
    modeled_reporting_caveat: MODELED_REPORTING_CAVEAT,
    cells
  };
}

module.exports = {
  readout,
  classifyCell,
  loadAndValidatePreregistration,
  MODELED_REPORTING_CAVEAT
};
