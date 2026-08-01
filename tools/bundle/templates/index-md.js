/**
 * INDEX.md template — human-readable bundle index.
 */

import { canonicalReportName, deepAnalysisName, rawPayloadName, rawCsvName, evidenceDirName, isoCompact } from '../lib/bundle-paths.js';

/**
 * Generate INDEX.md content.
 * @param {string} bundleId
 * @param {string} createdAt - ISO 8601 timestamp
 * @param {string} scope
 * @param {object[]} runs - Run descriptors from bundle-input
 * @returns {string} Markdown content
 */
export function indexMdTemplate(bundleId, createdAt, scope, runs) {
  const ts = isoCompact(new Date(createdAt));

  const lines = [];
  lines.push(`# Bundle Index`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Bundle ID | \`${bundleId}\` |`);
  lines.push(`| Created | ${createdAt} |`);
  lines.push(`| Scope | ${scope} |`);
  lines.push(`| Runs | ${runs.length} |`);
  lines.push('');

  lines.push('## Start Here');
  lines.push('');
  lines.push('1. `LLM_MANIFEST.json` — Machine-readable manifest (read first)');
  lines.push('2. `For_Recipient.md` — Observation summary for developer');
  lines.push('3. `QUESTIONS_FOR_DEVELOPER.md` — Items needing developer input');
  lines.push('4. `SUMMARY.json` — Structured findings, questions, known issues');
  lines.push('');

  lines.push('## Runs');
  lines.push('');
  lines.push('| Form ID | Testcase | Run | Env | Report | Deep Analysis |');
  lines.push('|---------|----------|-----|-----|--------|---------------|');

  for (const r of runs) {
    const report = r.canonical_report || `reports/${canonicalReportName(r.form_id, r.run_id, r.env, ts)}`;
    const analysis = r.deep_analysis || `reports/${deepAnalysisName(r.form_id, r.run_id)}`;
    lines.push(`| ${r.form_id} | ${r.testcase_id} | ${r.run_id} | ${r.env} | \`${report}\` | \`${analysis}\` |`);
  }
  lines.push('');

  lines.push('## Raw Artifacts');
  lines.push('');
  lines.push('| Type | Path |');
  lines.push('|------|------|');

  for (const r of runs) {
    const sentPayload = r.sent_payload || `raw/${rawPayloadName(r.form_id, r.run_id, 'sent_payload', r.env)}`;
    const expectedPayload = r.expected_payload || `raw/${rawPayloadName(r.form_id, r.run_id, 'expected_payload', r.env)}`;
    lines.push(`| Sent payload (${r.form_id}, ${r.env}) | \`${sentPayload}\` |`);
    lines.push(`| Expected payload (${r.form_id}, ${r.env}) | \`${expectedPayload}\` |`);
  }
  lines.push('');

  lines.push('## Evidence');
  lines.push('');
  for (const r of runs) {
    const evidenceDir = r.evidence_dir || `evidence/${evidenceDirName(r.form_id, r.run_id)}/`;
    lines.push(`- \`${evidenceDir}\` — ${r.form_id} / ${r.run_id}`);
  }
  lines.push('');

  lines.push('## LLM Harness');
  lines.push('');
  lines.push('- `AGENTS.md` — Session bootstrap instructions');
  lines.push('- `CLAUDE.md` — Claude context file');
  lines.push('- `.cursorrules` — Cursor context file');
  lines.push('- `llm/prompts/` — Reference prompts');
  lines.push('');

  return lines.join('\n');
}

export default { indexMdTemplate };
