'use strict';

/**
 * closure-evidence.cjs — L8 of the lessons-loop mechanization (convene
 * 20260610T175230Z): closing a signal whose recommended command produces
 * artifacts requires either the artifacts existing or a durable deferral
 * record. "Advisory-with-ledger is just a polite way to build a landfill of
 * ignored failures" — closure without evidence is how dead lanes stayed
 * invisible (March lessons-automation signals were bulk-closed with the work
 * never landed; the lane stayed dead for its whole active history).
 *
 * Exemptions per the convene: `superseded` and `duplicate` closures remain
 * legal when the successor preserves the obligation — callers must name the
 * successor, which gets recorded in the closure log.
 *
 * REGISTRY: maps recommended_next_command patterns to the artifacts that
 * command is contracted to produce. Placeholders: <date> = YYYY-MM-DD from the
 * command args. Extend as more artifact-producing commands join the gate.
 */

const fs = require('fs');
const path = require('path');

const ARTIFACT_CONTRACTS = [
  {
    // /reconcile-lessons <date>  (also: latest — no date to check, exempt)
    pattern: /^\/reconcile-lessons\s+(\d{4}-\d{2}-\d{2})\s*$/,
    artifacts: (m) => [
      `_dev/reports/analysis/lessons-reconciliation__${m[1]}.md`,
      `_dev/reports/analysis/lessons-reconciliation__${m[1]}.expectation-failures.json`
    ]
  }
  // Add further artifact-producing command contracts here.
];

const EXEMPT_REASONS = new Set(['superseded', 'duplicate']);

/**
 * Evaluate whether closing this signal needs evidence and whether it has it.
 * @returns {{required: boolean, satisfied: boolean, missing: string[], command: string}}
 */
function closureEvidence(signal, projectRoot) {
  const command = String((signal && signal.recommended_next_command) || '').trim();
  for (const contract of ARTIFACT_CONTRACTS) {
    const m = contract.pattern.exec(command);
    if (!m) continue;
    const expected = contract.artifacts(m);
    const missing = expected.filter((rel) => !fs.existsSync(path.join(projectRoot, rel)));
    return { required: true, satisfied: missing.length === 0, missing, command };
  }
  return { required: false, satisfied: true, missing: [], command };
}

/**
 * Write a durable deferral record for a closure without evidence.
 * A deferral must be durable; erasure is not a substitute for execution.
 * @returns {string} relative path of the record
 */
function writeDeferralRecord(signal, info, reason, projectRoot) {
  const dir = path.join(projectRoot, '_dev', 'reports', 'analysis', 'signal-deferrals');
  fs.mkdirSync(dir, { recursive: true });
  const base = String((info && info.name) || 'unknown-signal').replace(/\.json$/, '');
  const recordPath = path.join(dir, `${base}.md`);
  const lines = [
    `# Deferral record — ${base}`,
    '',
    `- Deferred at: ${new Date().toISOString()}`,
    `- Signal scope: ${(signal && (signal.signal_scope || signal.scope)) || 'unknown'}`,
    `- Obligated command: \`${(signal && signal.recommended_next_command) || ''}\``,
    `- Deferral reason: ${reason}`,
    '',
    'This signal was closed WITHOUT its contracted output artifacts. The obligation',
    'is preserved here, not erased (closure-requires-evidence, convene 20260610T175230Z',
    'item L8). Whoever picks this up should run the obligated command or formally',
    'retire the obligation with operator approval.'
  ];
  fs.writeFileSync(recordPath, lines.join('\n') + '\n');
  return path.relative(projectRoot, recordPath);
}

module.exports = { ARTIFACT_CONTRACTS, EXEMPT_REASONS, closureEvidence, writeDeferralRecord };
