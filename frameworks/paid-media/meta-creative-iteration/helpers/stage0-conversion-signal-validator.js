'use strict';
//
// Stage 0 — Conversion Signal Sanity Validator
//
// Pure function: takes Meta insights evidence + client project posture, returns
// pass / block / needs-operator-confirmation.
//
// Read-only. No network. No write surfaces. Composes upstream by being called
// from the Stage 0 prompt with the result of meta_export_insights.

const fs = require('fs');
const path = require('path');

function loadProjectPosture(clientProjectPath) {
  if (!fs.existsSync(clientProjectPath)) {
    throw new Error(`client_project_path not found: ${clientProjectPath}`);
  }
  const project = JSON.parse(fs.readFileSync(clientProjectPath, 'utf8'));
  const meta = project && project.meta_integration;
  if (!meta || !meta.ad_account_id) {
    throw new Error(`client project at ${clientProjectPath} is missing meta_integration.ad_account_id`);
  }
  return {
    ad_account_id: meta.ad_account_id,
    expected_conversion_event: (meta.compliance_posture && meta.compliance_posture.expected_conversion_event) || null,
    industry_category: meta.compliance_posture && meta.compliance_posture.industry_category
  };
}

function classifyEvidence({ insightsEvidence, operatorEvidence, expectedEvent }) {
  // Operator-supplied evidence takes precedence as a trust ladder. If neither, returns block.
  if (operatorEvidence && operatorEvidence.confirmed === true) {
    return {
      events_observed_last_7d: operatorEvidence.events_observed_last_7d || null,
      verdict: 'pass',
      evidence_source: 'operator_attestation'
    };
  }

  if (!insightsEvidence) {
    return {
      events_observed_last_7d: 0,
      verdict: 'block',
      evidence_source: 'meta_export_insights',
      missing_or_broken: ['no insights evidence supplied'],
      minimal_fix_proposed: 'run meta_export_insights for the past 7 days against the {CLIENT_CODE} ad account and pass the result to this validator'
    };
  }

  // insightsEvidence is expected to be the structured output of meta_export_insights or a
  // shape with rows/data containing per-event counts.
  const rows = insightsEvidence.data || insightsEvidence.rows || insightsEvidence;
  const eventsCount = countEventOccurrences(rows, expectedEvent);

  if (eventsCount === 0) {
    return {
      events_observed_last_7d: 0,
      verdict: 'block',
      evidence_source: 'meta_export_insights',
      missing_or_broken: [
        `expected event "${expectedEvent}" did not fire in the supplied insights window`
      ],
      minimal_fix_proposed: `verify pixel/CAPI installation for event "${expectedEvent}"; run a manual test event from the destination page; if test events land but ad-driven events do not, check ad-set conversion-event configuration in Ads Manager`
    };
  }

  if (eventsCount < 5) {
    return {
      events_observed_last_7d: eventsCount,
      verdict: 'needs-operator-confirmation',
      evidence_source: 'meta_export_insights',
      note: `event count (${eventsCount}) is non-zero but very low; operator should confirm whether this represents real traffic or only test events`
    };
  }

  return {
    events_observed_last_7d: eventsCount,
    verdict: 'pass',
    evidence_source: 'meta_export_insights'
  };
}

function countEventOccurrences(rows, eventName) {
  if (!Array.isArray(rows) || !eventName) return 0;
  let total = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    // Several Meta insights shapes use action breakdowns; check both common keys.
    const actions = row.actions || row.action_values || row.events || [];
    if (Array.isArray(actions)) {
      for (const a of actions) {
        if (a && (a.action_type === eventName || a.event_name === eventName)) {
          const v = Number(a.value || a.count || 0);
          if (Number.isFinite(v)) total += v;
        }
      }
    }
    // Some shapes name the event directly as a key.
    if (typeof row[eventName] === 'number') total += row[eventName];
  }
  return total;
}

function validateConversionSignal({ clientProjectPath, insightsEvidence, operatorEvidence, destinationPageUrl }) {
  const posture = loadProjectPosture(clientProjectPath);
  if (!posture.expected_conversion_event) {
    return {
      timestamp: new Date().toISOString(),
      ad_account_id: posture.ad_account_id,
      ad_account_id_source: 'client_project.json',
      expected_conversion_event: null,
      destination_page_url: destinationPageUrl || null,
      evidence_source: 'meta_export_insights',
      events_observed_last_7d: 0,
      verdict: 'needs-operator-confirmation',
      missing_or_broken: ['client project.json is missing meta_integration.compliance_posture.expected_conversion_event'],
      minimal_fix_proposed: 'add expected_conversion_event to compliance_posture in the client project.json; example values: Lead, CompleteRegistration, Purchase, Subscribe',
      operator_override_reason: null
    };
  }

  const classification = classifyEvidence({
    insightsEvidence,
    operatorEvidence,
    expectedEvent: posture.expected_conversion_event
  });

  return {
    timestamp: new Date().toISOString(),
    ad_account_id: posture.ad_account_id,
    ad_account_id_source: 'client_project.json',
    expected_conversion_event: posture.expected_conversion_event,
    destination_page_url: destinationPageUrl || null,
    operator_override_reason: null,
    ...classification
  };
}

module.exports = {
  validateConversionSignal,
  countEventOccurrences,
  loadProjectPosture
};
