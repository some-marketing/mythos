/**
 * Artifact copy utilities for handoff bundles.
 * Reuses safeCp pattern from make-dev-handoff.js.
 */

import fs from 'fs';
import path from 'path';
import { mkdirp } from './fs.js';
import { rawPayloadName, rawCsvName } from './bundle-paths.js';

/**
 * Recursive copy, filtering .DS_Store and node_modules.
 * @param {string} src - Source path
 * @param {string} dest - Destination path
 * @returns {boolean} true if copy succeeded
 */
export function safeCp(src, dest) {
  if (!fs.existsSync(src)) return false;
  mkdirp(path.dirname(dest));
  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    filter: (s) => {
      const base = path.basename(s);
      if (base === '.DS_Store') return false;
      if (base === 'node_modules') return false;
      return true;
    },
  });
  return true;
}

/**
 * Copy entire runset evidence directory into the bundle.
 * @param {string} evidenceSrcDir - Absolute path to evidence source (e.g. testcases/.../runs/run_0006)
 * @param {string} bundleEvidenceDir - Absolute path to bundle evidence sub-dir
 * @returns {string[]} List of copied top-level entries
 */
export function copyEvidence(evidenceSrcDir, bundleEvidenceDir) {
  const copied = [];
  if (!fs.existsSync(evidenceSrcDir)) return copied;

  mkdirp(bundleEvidenceDir);
  const entries = fs.readdirSync(evidenceSrcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(evidenceSrcDir, entry.name);
    const dest = path.join(bundleEvidenceDir, entry.name);
    if (safeCp(src, dest)) {
      copied.push(entry.name);
    }
  }
  return copied;
}

/**
 * Copy raw inputs (payloads, CSVs) for a single run into the bundle raw/ dir.
 * @param {object} run - Run descriptor from bundle-input.json
 * @param {string} bundleRawDir - Absolute path to bundle raw/ directory
 * @returns {string[]} List of copied file paths (relative to bundleRawDir)
 */
export function copyRawInputs(run, bundleRawDir) {
  const copied = [];
  mkdirp(bundleRawDir);

  // Sent payload
  if (run.sent_payload_path) {
    const destName = rawPayloadName(run.form_id, run.run_id, 'sent_payload', run.env);
    if (safeCp(run.sent_payload_path, path.join(bundleRawDir, destName))) {
      copied.push(destName);
    }
  }

  // Expected payload
  if (run.expected_payload_path) {
    const destName = rawPayloadName(run.form_id, run.run_id, 'expected_payload', run.env);
    if (safeCp(run.expected_payload_path, path.join(bundleRawDir, destName))) {
      copied.push(destName);
    }
  }

  // WPForms CSV
  if (run.wpforms_csv_path) {
    const destName = rawCsvName(run.form_id, run.run_id, 'wpforms_export');
    if (safeCp(run.wpforms_csv_path, path.join(bundleRawDir, destName))) {
      copied.push(destName);
    }
  }

  // CRM CSV
  if (run.crm_csv_path) {
    const destName = rawCsvName(run.form_id, run.run_id, 'crm_export');
    if (safeCp(run.crm_csv_path, path.join(bundleRawDir, destName))) {
      copied.push(destName);
    }
  }

  return copied;
}

export default { safeCp, copyEvidence, copyRawInputs };
