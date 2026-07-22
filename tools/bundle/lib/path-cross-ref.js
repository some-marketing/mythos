/**
 * Cross-reference all paths declared in INDEX.json and LLM_MANIFEST.json
 * against actual files within the bundle directory.
 *
 * @module path-cross-ref
 */

import fs from 'fs';
import path from 'path';

/**
 * Collect a path entry for the results array.
 * @param {string} bundleDir
 * @param {string} relPath
 * @param {string} referencedIn
 * @returns {{path: string, referenced_in: string, exists: boolean}}
 */
function entry(bundleDir, relPath, referencedIn) {
  if (!relPath || typeof relPath !== 'string') return null;
  const abs = path.resolve(bundleDir, relPath);
  return { path: relPath, referenced_in: referencedIn, exists: fs.existsSync(abs) };
}

/**
 * Verify all paths referenced in INDEX.json and LLM_MANIFEST.json exist
 * within the bundle.
 *
 * @param {string} bundleDir - Absolute path to bundle root
 * @param {object} indexJson - Parsed INDEX.json
 * @param {object} manifestJson - Parsed LLM_MANIFEST.json
 * @returns {Array<{path: string, referenced_in: string, exists: boolean}>}
 */
export function crossRefPaths(bundleDir, indexJson, manifestJson) {
  const results = [];

  const add = (relPath, ref) => {
    const e = entry(bundleDir, relPath, ref);
    if (e) results.push(e);
  };

  // --- INDEX.json paths ---

  // runs[]
  if (Array.isArray(indexJson?.runs)) {
    for (const run of indexJson.runs) {
      const tag = `INDEX.json runs[${run.testcase || '?'}/${run.run_id || '?'}/${run.env || '?'}]`;
      add(run.canonical_report, tag);
      add(run.deep_analysis, tag);
      add(run.sent_payload, tag);
      add(run.expected_payload, tag);
      add(run.evidence_dir, tag);
    }
  }

  // raw_artifacts
  if (indexJson?.raw_artifacts) {
    const ra = indexJson.raw_artifacts;
    for (const key of ['sent_payloads', 'expected_payloads', 'crm_exports', 'wpforms_exports']) {
      if (Array.isArray(ra[key])) {
        for (const p of ra[key]) {
          add(p, `INDEX.json raw_artifacts.${key}`);
        }
      }
    }
  }

  // llm_harness
  if (indexJson?.llm_harness) {
    const lh = indexJson.llm_harness;
    add(lh.manifest, 'INDEX.json llm_harness.manifest');
    add(lh.agents, 'INDEX.json llm_harness.agents');
    add(lh.claude, 'INDEX.json llm_harness.claude');
  }

  // --- LLM_MANIFEST.json paths ---

  // entry_points
  if (manifestJson?.entry_points) {
    const ep = manifestJson.entry_points;
    add(ep.start_here, 'LLM_MANIFEST.json entry_points.start_here');
    add(ep.questions, 'LLM_MANIFEST.json entry_points.questions');
    add(ep.full_index, 'LLM_MANIFEST.json entry_points.full_index');
    add(ep.machine_index, 'LLM_MANIFEST.json entry_points.machine_index');
  }

  // stakeholder_gate.answers_file
  if (manifestJson?.stakeholder_gate?.triggered && manifestJson.stakeholder_gate.answers_file) {
    add(manifestJson.stakeholder_gate.answers_file, 'LLM_MANIFEST.json stakeholder_gate.answers_file');
  }

  return results;
}

export default { crossRefPaths };
