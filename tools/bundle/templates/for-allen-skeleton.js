/**
 * For_{DEVELOPER_NAME}.md skeleton template.
 * Uses <!-- LLM:SECTION_NAME --> markers where the LLM must inject analytical content.
 */

import { canonicalReportName, deepAnalysisName, evidenceDirName, isoCompact } from '../lib/bundle-paths.js';

/**
 * Generate For_{DEVELOPER_NAME}.md skeleton content.
 * @param {string} bundleId
 * @param {string} scope
 * @param {object[]} runs - Run descriptors from bundle-input
 * @param {string} changelogStatus - "PRESENT" or "ABSENT"
 * @param {string} createdAt - ISO 8601 timestamp
 * @returns {string} Markdown content with LLM placeholders
 */
export function forAllenSkeleton(bundleId, scope, runs, changelogStatus, createdAt) {
  const ts = isoCompact(new Date(createdAt));

  const lines = [];
  lines.push(`# Payload Analysis — For {DEVELOPER_NAME}`);
  lines.push('');
  lines.push('<!-- MANAGED:METADATA:START -->');
  lines.push(`**Bundle:** \`${bundleId}\``);
  lines.push(`**Scope:** ${scope}`);
  lines.push(`**Runs:** ${runs.length}`);
  lines.push(`**Changelog:** ${changelogStatus}`);
  lines.push('<!-- MANAGED:METADATA:END -->');
  lines.push('');

  // Executive Summary
  lines.push('---');
  lines.push('## Executive Summary');
  lines.push('');
  lines.push('<!-- LLM:EXECUTIVE_SUMMARY -->');
  lines.push('');

  // Per-Run Observations
  lines.push('---');
  lines.push('## Per-Run Observations');
  lines.push('');

  lines.push('<!-- MANAGED:RUN_INDEX:START -->');
  for (const run of runs) {
    const reportPath = run.canonical_report || `reports/${canonicalReportName(run.form_id, run.run_id, run.env, ts)}`;
    const analysisPath = run.deep_analysis || `reports/${deepAnalysisName(run.form_id, run.run_id)}`;
    const evidencePath = run.evidence_dir || `evidence/${evidenceDirName(run.form_id, run.run_id)}/`;

    lines.push(`### ${run.form_id} / ${run.run_id} (Env ${run.env})`);
    lines.push('');
    lines.push(`- **Canonical report:** \`${reportPath}\``);
    lines.push(`- **Deep analysis:** \`${analysisPath}\``);
    lines.push(`- **Evidence:** \`${evidencePath}\``);
    lines.push('');
  }
  lines.push('<!-- MANAGED:RUN_INDEX:END -->');
  lines.push('');

  for (const run of runs) {
    lines.push(`<!-- LLM:RUN_${run.form_id} -->`);
    lines.push('');
  }

  // Cross-Run Patterns
  lines.push('---');
  lines.push('## Cross-Run Patterns');
  lines.push('');
  lines.push('<!-- LLM:CROSS_RUN_PATTERNS -->');
  lines.push('');

  // Open Questions
  lines.push('---');
  lines.push('## Open Questions');
  lines.push('');
  lines.push('<!-- LLM:OPEN_QUESTIONS -->');
  lines.push('');

  // Evidence Guide
  lines.push('---');
  lines.push('## Evidence Guide');
  lines.push('');
  lines.push('<!-- LLM:EVIDENCE_GUIDE -->');
  lines.push('');

  return lines.join('\n');
}

export default { forAllenSkeleton };
