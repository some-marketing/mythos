/**
 * Generate INDEX.json and INDEX.md for the bundle.
 */

import { canonicalReportName, deepAnalysisName, rawPayloadName, rawCsvName, evidenceDirName, isoCompact } from './bundle-paths.js';
import { indexMdTemplate } from '../templates/index-md.js';

/**
 * Generate INDEX.json structure.
 * @param {string} bundleId
 * @param {string} createdAt - ISO 8601 timestamp
 * @param {string} scope
 * @param {object[]} runs - Run descriptors from bundle-input
 * @param {object} [extra] - Optional overrides (stakeholder_answers, dev_changelog paths)
 * @returns {object} INDEX.json content
 */
export function generateIndexJson(bundleId, createdAt, scope, runs, extra = {}) {
  const ts = isoCompact(new Date(createdAt));

  const runEntries = runs.map(r => ({
    form_id: r.form_id,
    testcase: r.testcase_id,
    run_id: r.run_id,
    env: r.env,
    crm_table: r.crm_table || 'crd99_crmstagings',
    canonical_report: `reports/${canonicalReportName(r.form_id, r.run_id, r.env, ts)}`,
    deep_analysis: `reports/${deepAnalysisName(r.form_id, r.run_id)}`,
    sent_payload: `raw/${rawPayloadName(r.form_id, r.run_id, 'sent_payload', r.env)}`,
    expected_payload: `raw/${rawPayloadName(r.form_id, r.run_id, 'expected_payload', r.env)}`,
    evidence_dir: `evidence/${evidenceDirName(r.form_id, r.run_id)}/`,
  }));

  const sentPayloads = runs.map(r => `raw/${rawPayloadName(r.form_id, r.run_id, 'sent_payload', r.env)}`);
  const expectedPayloads = runs.map(r => `raw/${rawPayloadName(r.form_id, r.run_id, 'expected_payload', r.env)}`);
  const crmExports = runs.filter(r => r.crm_csv_path).map(r => `raw/${rawCsvName(r.form_id, r.run_id, 'crm_export')}`);
  const wpformsExports = runs.filter(r => r.wpforms_csv_path).map(r => `raw/${rawCsvName(r.form_id, r.run_id, 'wpforms_export')}`);

  const rawArtifacts = {
    sent_payloads: sentPayloads,
    expected_payloads: expectedPayloads,
    crm_exports: crmExports,
    wpforms_exports: wpformsExports,
  };
  if (extra.stakeholder_answers) rawArtifacts.stakeholder_answers = extra.stakeholder_answers;
  if (extra.dev_changelog) rawArtifacts.dev_changelog = extra.dev_changelog;

  return {
    bundle_id: bundleId,
    created_at: createdAt,
    scope,
    runs: runEntries,
    summary_documents: {
      for_{DEVELOPER_NAME}: 'For_{DEVELOPER_NAME}.md',
      questions: 'QUESTIONS_FOR_DEVELOPER.md',
      index_md: 'INDEX.md',
      index_json: 'INDEX.json',
    },
    raw_artifacts: rawArtifacts,
    llm_harness: {
      manifest: 'LLM_MANIFEST.json',
      agents: 'llm/AGENTS.md',
      claude: 'llm/CLAUDE.md',
    },
  };
}

/**
 * Generate INDEX.md markdown content.
 * @param {string} bundleId
 * @param {string} createdAt
 * @param {string} scope
 * @param {object[]} runs
 * @returns {string} Markdown content
 */
export function generateIndexMd(bundleId, createdAt, scope, runs) {
  return indexMdTemplate(bundleId, createdAt, scope, runs);
}

export default { generateIndexJson, generateIndexMd };
