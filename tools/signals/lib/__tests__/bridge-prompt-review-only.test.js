'use strict';

/**
 * Tests for REVIEW_ONLY wording in the bridge prompt generator (lessons
 * synthesis 2026-06-03→2026-06-10 root 4; 2026-06-04 / 2026-06-08 P5):
 * when the dispatched command's canonical spec is REVIEW_ONLY, the prompt
 * must say "writes analysis artifacts only; do not implement product/system
 * fixes" instead of a bare "do not implement".
 *
 * Run: node --test tools/signals/lib/__tests__/bridge-prompt-review-only.test.js
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  composePromptBody,
  resolveCommandSpecMode,
  REVIEW_ONLY_ARTIFACT_CLAUSE
} = require('../bridge-prompt-body');

// Temp project root with fixture command specs (never the live repo surfaces).
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-prompt-review-only-'));
const specDir = path.join(tempRoot, 'instructions', 'canonical', 'commands');
fs.mkdirSync(specDir, { recursive: true });

fs.writeFileSync(path.join(specDir, 'fixture-review-cmd.yaml'), JSON.stringify({
  id: 'fixture-review-cmd',
  mode: 'REVIEW_ONLY',
  review_rules: ['This command is REVIEW_ONLY. It writes analysis artifacts only.'],
  cadence_triggers: {
    bridge_signal: { execution: { mode: 'patch-allowed' } }
  }
}, null, 2));

fs.writeFileSync(path.join(specDir, 'fixture-patch-cmd.yaml'), JSON.stringify({
  id: 'fixture-patch-cmd',
  mode: 'PATCH_ALLOWED'
}, null, 2));

after(() => {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch (_) { /* best-effort */ }
});

function makeSignalInfo(command, overrides = {}) {
  return {
    name: 'ready-for-review__test.json',
    filePath: path.join(tempRoot, '_dev', 'reports', 'signals', 'ready-for-review__test.json'),
    signal: {
      schema: 'HandoffSignal/1.0',
      signal_type: 'ready-for-review',
      lifecycle_state: 'live',
      source: 'claude',
      scope: 'review-only-wording-test',
      signal_scope: 'review-only-wording-test',
      timestamp: '2026-06-10T00:00:00.000Z',
      artifacts: ['_dev/reports/analysis/example.md'],
      decision_context_artifacts: [],
      validation: { ran: true, summary: 'node --test x: 1 pass, 0 fail' },
      recommended_next_actor: 'codex',
      recommended_next_command: command,
      next_step_detail: [`Run ${command}.`],
      blocked_by: [],
      ready_for_clear: false,
      execution: { mode: 'patch-allowed', workload: 'review', timeout_ms: 600000 },
      ...overrides
    }
  };
}

describe('resolveCommandSpecMode', () => {
  it('resolves the top-level mode from a fixture spec', () => {
    assert.equal(resolveCommandSpecMode('/fixture-review-cmd 2026-06-08', tempRoot), 'REVIEW_ONLY');
    assert.equal(resolveCommandSpecMode('/fixture-patch-cmd', tempRoot), 'PATCH_ALLOWED');
  });

  it('does not mistake a nested execution.mode for the top-level mode', () => {
    // fixture-review-cmd carries a nested patch-allowed execution block.
    assert.equal(resolveCommandSpecMode('/fixture-review-cmd', tempRoot), 'REVIEW_ONLY');
  });

  it('returns empty for unknown commands and non-slash input', () => {
    assert.equal(resolveCommandSpecMode('/no-such-command-here', tempRoot), '');
    assert.equal(resolveCommandSpecMode('freeform', tempRoot), '');
    assert.equal(resolveCommandSpecMode('', tempRoot), '');
  });
});

describe('composePromptBody — REVIEW_ONLY artifact clause', () => {
  for (const depth of ['full', 'review', 'light']) {
    it(`depth=${depth}: REVIEW_ONLY command prompt carries the analysis-artifacts-only clause`, () => {
      const prompt = composePromptBody(makeSignalInfo('/fixture-review-cmd 2026-06-08'), {
        depth,
        actorId: 'codex',
        projectRoot: tempRoot
      });
      assert.ok(
        prompt.includes(REVIEW_ONLY_ARTIFACT_CLAUSE),
        `expected the REVIEW_ONLY clause in the ${depth} prompt`
      );
      assert.ok(
        prompt.includes('writes analysis artifacts only; do not implement product/system fixes'),
        'clause must use the proven 2026-06-10 drain-prompt phrasing'
      );
    });

    it(`depth=${depth}: non-REVIEW_ONLY command prompt does not carry the clause`, () => {
      const prompt = composePromptBody(makeSignalInfo('/fixture-patch-cmd'), {
        depth,
        actorId: 'codex',
        projectRoot: tempRoot
      });
      assert.ok(!prompt.includes(REVIEW_ONLY_ARTIFACT_CLAUSE));
    });
  }

  it('unknown command spec adds no mode-specific wording', () => {
    const prompt = composePromptBody(makeSignalInfo('/no-such-command-here'), {
      depth: 'full',
      actorId: 'codex',
      projectRoot: tempRoot
    });
    assert.ok(!prompt.includes(REVIEW_ONLY_ARTIFACT_CLAUSE));
  });
});
