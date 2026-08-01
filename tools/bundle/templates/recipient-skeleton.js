import { canonicalReportName, deepAnalysisName, evidenceDirName, isoCompact } from '../lib/bundle-paths.js';

export function recipientSkeleton(bundleId, scope, runs, changelogStatus, createdAt) {
  const stamp = isoCompact(new Date(createdAt));
  const lines = [
    '# Payload Analysis — Recipient Handoff',
    '',
    '<!-- MANAGED:METADATA:START -->',
    `**Bundle:** \`${bundleId}\``,
    `**Scope:** ${scope}`,
    `**Runs:** ${runs.length}`,
    `**Changelog:** ${changelogStatus}`,
    '<!-- MANAGED:METADATA:END -->',
    '',
    '---',
    '## Executive Summary',
    '',
    '<!-- LLM:EXECUTIVE_SUMMARY -->',
    '',
    '---',
    '## Per-Run Observations',
    '',
    '<!-- MANAGED:RUN_INDEX:START -->',
  ];
  for (const run of runs) {
    const report = run.canonical_report || `reports/${canonicalReportName(run.form_id, run.run_id, run.env, stamp)}`;
    const analysis = run.deep_analysis || `reports/${deepAnalysisName(run.form_id, run.run_id)}`;
    const evidence = run.evidence_dir || `evidence/${evidenceDirName(run.form_id, run.run_id)}/`;
    lines.push(`### ${run.form_id} / ${run.run_id} (Env ${run.env})`, '');
    lines.push(`- **Canonical report:** \`${report}\``);
    lines.push(`- **Deep analysis:** \`${analysis}\``);
    lines.push(`- **Evidence:** \`${evidence}\``, '');
  }
  lines.push('<!-- MANAGED:RUN_INDEX:END -->', '');
  for (const run of runs) lines.push(`<!-- LLM:RUN_${run.form_id} -->`, '');
  lines.push(
    '---', '## Cross-Run Patterns', '', '<!-- LLM:CROSS_RUN_PATTERNS -->', '',
    '---', '## Open Questions', '', '<!-- LLM:OPEN_QUESTIONS -->', '',
    '---', '## Evidence Guide', '', '<!-- LLM:EVIDENCE_GUIDE -->', ''
  );
  return lines.join('\n');
}

export default { recipientSkeleton };
