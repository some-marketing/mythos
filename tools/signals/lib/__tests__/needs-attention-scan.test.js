'use strict';

// S4 tests: the needs-attention scanner surfaces ONLY live attention-request
// signals, sorts newest-first, and degrades gracefully.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { collectAttentionRequests, renderTable } = require('../../needs-attention-scan.js');
const { createAttentionRequest, createHandoffSignal } = require('../../../verify/lib/signal.cjs');

function tmpSignalsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'needs-attention-'));
  return dir;
}
function writeSig(dir, name, sig) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(sig, null, 2));
}

test('empty dir → no rows, friendly render', () => {
  const dir = tmpSignalsDir();
  const rows = collectAttentionRequests(dir);
  assert.strictEqual(rows.length, 0);
  assert.match(renderTable(rows), /Nothing is waiting on you/);
});

test('surfaces only attention-request, ignores other live signals', () => {
  const dir = tmpSignalsDir();
  writeSig(dir, 'a.json', createAttentionRequest('coordinator', 'scope-a', {
    gate_type: 'irreversible_destructive',
    question: 'Delete the old branch?',
    attempted_resolution: 'checked refs',
    recommended_default: 'yes, archived first',
  }));
  writeSig(dir, 'b.json', createHandoffSignal('codex', 'scope-b', 'ready-for-review', {
    recommended_next_actor: 'claude', recommended_next_command: '/review-progress x', next_step_detail: ['x'],
  }));
  writeSig(dir, 'junk.json', { not: 'a signal' });
  fs.writeFileSync(path.join(dir, 'bad.json'), '{ broken json');

  const rows = collectAttentionRequests(dir);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].raising_scope, 'scope-a');
  assert.strictEqual(rows[0].gate_type, 'irreversible_destructive');
  assert.strictEqual(rows[0].gate_is_real, true);
});

test('renderTable shows gate, question, and default for a real signal', () => {
  const dir = tmpSignalsDir();
  writeSig(dir, 'a.json', createAttentionRequest('coordinator', 'scope-a', {
    gate_type: 'budget_scope_timeline_commitment',
    question: 'Approve +$60/day?',
    attempted_resolution: 'pulled spend data',
    recommended_default: 'approve',
  }));
  const out = renderTable(collectAttentionRequests(dir));
  assert.match(out, /Approve \+\$60\/day/);
  assert.match(out, /budget_scope_timeline_commitment/);
  assert.match(out, /recommended default: approve/);
});
