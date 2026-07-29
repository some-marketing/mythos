/**
 * Generate SUMMARY.json skeleton for the bundle.
 * LLM fills in key_findings, open_questions, known_issues after analysis.
 */

/**
 * Generate SUMMARY.json content.
 * @param {string} bundleId
 * @param {string} createdAt - ISO 8601 timestamp
 * @param {object[]} runs - Run descriptors from bundle-input
 * @returns {object} SUMMARY.json content
 */
export function generateSummary(bundleId, createdAt, runs) {
  return {
    bundle_id: bundleId,
    created_at: createdAt,
    updated_at: createdAt,
    status: 'draft',
    runs: runs.map(r => ({
      testcase: r.testcase_id,
      run_id: r.run_id,
      env: r.env,
      form_id: r.form_id,
      verdict: 'unknown',
    })),
    key_findings: [],
    open_questions: [],
    known_issues: [],
    evidence_paths: {},
  };
}

export default { generateSummary };
