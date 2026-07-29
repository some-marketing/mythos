#!/usr/bin/env node
'use strict';

/**
 * needs-attention-scan.js — Layer 2 (S4) of the ambient-orchestrator contract.
 *
 * READ-ONLY render of live `attention-request` HandoffSignals — the things
 * a lower layer could not resolve and legitimately bubbled UP to the operator.
 * This is the visibility surface for the bubble-up rail: it makes "what needs
 * your judgment right now" glanceable, so autonomous lower layers can't hide
 * decisions behind silent churn.
 *
 * Usage:
 *   node tools/signals/needs-attention-scan.js          # table
 *   node tools/signals/needs-attention-scan.js --json    # structured
 *
 * Boundaries: does NOT dispatch, mutate, close, or answer signals. Render only.
 * Plan: ambient-orchestrator-layer-2-runtime-bubble-up-contract (S4).
 */

const path = require('path');
const { listLiveHandoffSignals } = require('../verify/lib/signal.cjs');
const { describeGate, isBubbleUpGate } = require('../kernel/lib/bubble-up-gates.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SIGNALS_DIR = path.join(PROJECT_ROOT, '_dev/reports/signals');

/**
 * Collect live attention-request signals as plain rows. Pure (no IO besides the
 * read) and exported for testing.
 */
function collectAttentionRequests(signalDir) {
  const live = listLiveHandoffSignals(signalDir);
  return live
    .filter((info) => info.signal && info.signal.signal_type === 'attention-request')
    .map((info) => {
      const s = info.signal;
      return {
        file: info.name,
        raising_scope: s.raising_scope || s.scope || '(unknown)',
        gate_type: s.gate_type || '(none)',
        gate_is_real: isBubbleUpGate(s.gate_type),
        question: s.question || '(no question recorded)',
        recommended_default: s.recommended_default || '(no default recorded)',
        timestamp: s.timestamp || '',
      };
    })
    .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
}

function renderTable(rows) {
  if (rows.length === 0) {
    return 'needs-attention: no live attention-request signals. Nothing is waiting on you.';
  }
  const lines = [`needs-attention: ${rows.length} signal(s) awaiting operator judgment`, ''];
  for (const r of rows) {
    const gate = describeGate(r.gate_type);
    const gateLabel = gate ? `${r.gate_type} — ${gate.summary}` : `${r.gate_type}${r.gate_is_real ? '' : ' (NOT a valid gate!)'}`;
    lines.push(`• [${r.raising_scope}]  gate: ${gateLabel}`);
    lines.push(`    Q: ${r.question}`);
    lines.push(`    recommended default: ${r.recommended_default}`);
    lines.push(`    (${r.file})`);
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const rows = collectAttentionRequests(SIGNALS_DIR);
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ count: rows.length, signals: rows }, null, 2) + '\n');
  } else {
    process.stdout.write(renderTable(rows) + '\n');
  }
}

module.exports = { collectAttentionRequests, renderTable };

if (require.main === module) {
  try {
    main();
  } catch (e) {
    process.stdout.write(`needs-attention-scan: error (${e.message})\n`);
    process.exit(0); // read-only surface must never hard-fail a caller
  }
}
