/**
 * Canonical path and naming conventions for handoff bundles.
 */

import path from 'path';

/**
 * Compact ISO timestamp: 2026-03-09T16-29-35Z (hyphens in time, not colons)
 */
export function isoCompact(date) {
  const d = date || new Date();
  return d.toISOString()
    .replace(/\.\d+Z$/, 'Z')
    .replace(/:/g, '-');
}

/**
 * Bundle directory name.
 * @param {string} recipient - e.g. "{DEVELOPER_NAME}"
 * @param {string} [timestamp] - isoCompact timestamp; generated if omitted
 * @returns {string} e.g. "DEV_HANDOFF__{DEVELOPER_NAME}__payload_reporting__2026-03-09T16-29-35Z"
 */
export function bundleDirName(recipient, timestamp) {
  const ts = timestamp || isoCompact();
  return `DEV_HANDOFF__${recipient.toLowerCase()}__payload_reporting__${ts}`;
}

/**
 * Evidence sub-directory name for a run.
 * @param {string} formId - e.g. "12345"
 * @param {string} runId - e.g. "run_0006"
 * @returns {string} e.g. "12345_run_0006/"
 */
export function evidenceDirName(formId, runId) {
  return `${formId}_${runId}`;
}

/**
 * Raw payload file name.
 * @param {string} formId
 * @param {string} runId - e.g. "run_0006"
 * @param {"sent_payload"|"expected_payload"} type
 * @param {string} env - e.g. "A"
 * @returns {string} e.g. "12345__run_0006__sent_payload__A.json"
 */
export function rawPayloadName(formId, runId, type, env) {
  return `${formId}__${runId}__${type}__${env}.json`;
}

/**
 * Raw CSV export file name.
 * @param {string} formId
 * @param {string} runId - e.g. "run_0006"
 * @param {"wpforms_export"|"crm_export"} type
 * @returns {string} e.g. "12345__run_0006__wpforms_export.csv"
 */
export function rawCsvName(formId, runId, type) {
  return `${formId}__${runId}__${type}.csv`;
}

/**
 * Canonical payload report name.
 * @param {string} formId
 * @param {string} runId
 * @param {string} env
 * @param {string} createdon - isoCompact timestamp
 * @returns {string}
 */
export function canonicalReportName(formId, runId, env, createdon) {
  return `PROCESSED_PAYLOAD_SENT_TO_CRM__${formId}__${runId}__${env}__${createdon}__recipient.md`;
}

/**
 * Deep analysis report name.
 * @param {string} formId
 * @param {string} runId
 * @returns {string}
 */
export function deepAnalysisName(formId, runId) {
  return `DEEP_ANALYSIS__${formId}__${runId}__recipient.md`;
}

/**
 * Standard bundle sub-directory layout.
 * @param {string} bundleDir - Absolute path to bundle root
 * @returns {object} Map of logical names to absolute paths
 */
export function bundleSubDirs(bundleDir) {
  return {
    root: bundleDir,
    reports: path.join(bundleDir, 'reports'),
    raw: path.join(bundleDir, 'raw'),
    evidence: path.join(bundleDir, 'evidence'),
    llm: path.join(bundleDir, 'llm'),
    llmPrompts: path.join(bundleDir, 'llm', 'prompts'),
  };
}

export default {
  isoCompact,
  bundleDirName,
  evidenceDirName,
  rawPayloadName,
  rawCsvName,
  canonicalReportName,
  deepAnalysisName,
  bundleSubDirs,
};
