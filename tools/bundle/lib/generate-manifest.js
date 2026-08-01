/**
 * Generate LLM_MANIFEST.json for the bundle.
 */

const REPORTING_PHILOSOPHY =
  'Observational reporting only. All findings describe what was observed vs. what was expected. ' +
  'Interpretive statements must use HYPOTHESIS: label with evidence citations. ' +
  'No root-cause diagnoses, no code suggestions, no architecture decisions.';

const REPORTING_EXPECTATIONS = {
  labels_allowed: [
    'OBSERVED',
    'EXPECTED',
    'HYPOTHESIS',
    'QUESTION',
    'EVIDENCE',
    'COMPARISON',
  ],
  labels_forbidden: [
    'ROOT CAUSE',
    'FIX',
    'SOLUTION',
    'RECOMMENDATION',
    'IMPLEMENT',
    'DIAGNOSIS',
  ],
};

const REQUIRED_PROMPTS = [
  'llm/prompts/13_PAYLOAD_DEEP_ANALYSIS_AND_{DEVELOPER_NAME}_HANDOFF.md',
  'llm/prompts/16_CHANGELOG_CAPTURE_FROM_DEV.md',
];

/**
 * Generate LLM_MANIFEST.json content.
 * @param {object} input - Parsed bundle-input.json
 * @param {string} bundleId - Bundle directory name
 * @param {string} createdAt - ISO 8601 timestamp
 * @returns {object} LLM_MANIFEST.json content
 */
export function generateManifest(input, bundleId, createdAt) {
  const changelogStatus = input.changelog?.status || 'ABSENT';

  const manifest = {
    bundle_version: '3.0',
    bundle_id: bundleId,
    created_at: createdAt,
    created_by: 'generate-handoff-bundle.js',
    recipient: input.recipient,
    scope: input.scope,
    reporting_philosophy: REPORTING_PHILOSOPHY,
    required_prompts: REQUIRED_PROMPTS,
    reporting_expectations: REPORTING_EXPECTATIONS,
    changelog_status: changelogStatus,
  };

  if (input.changelog?.path) {
    manifest.canonical_changelog_path = input.changelog.path;
  }
  if (input.changelog?.note) {
    manifest.changelog_note = input.changelog.note;
  }

  if (input.stakeholder_gate) {
    manifest.stakeholder_gate = {
      triggered: input.stakeholder_gate.triggered,
      items_total: input.stakeholder_gate.items_total || 0,
      items_answered: input.stakeholder_gate.items_answered || 0,
      items_categorized_issue: input.stakeholder_gate.items_categorized_issue || 0,
      items_categorized_note: input.stakeholder_gate.items_categorized_note || 0,
    };
    if (input.stakeholder_gate.triggered) {
      manifest.stakeholder_gate.answers_file = 'raw/stakeholder_answers.md';
    }
  }

  manifest.runs = input.runs.map(r => ({
    form_id: r.form_id,
    testcase: r.testcase_id,
    run_id: r.run_id,
    env: r.env,
    crm_table: r.crm_table || 'crd99_crmstagings',
    form_type: r.form_type || null,
    t_score: null,
    lead_type_in_payload: null,
    key_issues: [],
  }));

  manifest.open_questions_count = 0;
  manifest.open_questions_file = 'QUESTIONS_FOR_DEVELOPER.md';

  manifest.entry_points = {
    start_here: 'For_Recipient.md',
    questions: 'QUESTIONS_FOR_DEVELOPER.md',
    full_index: 'INDEX.md',
    machine_index: 'INDEX.json',
  };

  return manifest;
}

export default { generateManifest };
