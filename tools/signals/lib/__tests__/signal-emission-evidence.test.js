'use strict';

/**
 * Tests for the signal-emission evidence gate (lessons synthesis
 * 2026-06-03→2026-06-10 root 1; validated-with-corrections per
 * codex-review__lessons-synthesis-validation__20260610.md):
 *   (a) validation.ran=true requires concrete command/result evidence
 *   (b) validation.ran=false requires an explicit reason
 *   (c) completion-signal recommended_next_command must match the completion
 *       report's "Exact next command" section verbatim (warn-level detection)
 *
 * Run: node --test tools/signals/lib/__tests__/signal-emission-evidence.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createHandoffSignal,
  hasConcreteValidationEvidence,
  validateValidationEvidence,
  validateHandoffSignal,
  validateActorRunFeedbackSignal
} = require('../../../verify/lib/signal.cjs');

const {
  extractExactNextCommandFromReport,
  checkCompletionCommandConsistency
} = require('../codex-auto');

const { buildDispatchResult } = require('../dispatch-bridge');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'signal-emission-evidence-'));
}

function cleanupTempRoot(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (_) { /* best-effort */ }
}

describe('hasConcreteValidationEvidence', () => {
  it('rejects empty and whitespace summaries', () => {
    assert.equal(hasConcreteValidationEvidence(''), false);
    assert.equal(hasConcreteValidationEvidence('   '), false);
    assert.equal(hasConcreteValidationEvidence(undefined), false);
  });

  it('rejects boilerplate assertions', () => {
    for (const boilerplate of ['ok', 'done', 'success', 'Validated.', 'tests passed', 'LGTM', 'all good']) {
      assert.equal(
        hasConcreteValidationEvidence(boilerplate),
        false,
        `expected boilerplate to be rejected: "${boilerplate}"`
      );
    }
  });

  it('rejects result-only or date-only summaries lacking a named command source (Codex review 2026-06-10 MEDIUM)', () => {
    for (const weak of ['review completed 2026-06-10', 'all checks pass', '12 tests green']) {
      assert.equal(
        hasConcreteValidationEvidence(weak),
        false,
        `expected result-without-command to be rejected: "${weak}"`
      );
    }
  });

  it('accepts summaries carrying command AND result evidence', () => {
    const concrete = [
      'node --test tools/signals/lib/__tests__/closure-evidence.test.js: 8 pass, 0 fail',
      'codex exec outcome: success (exit 0)',
      '`codex exec --cd /tmp -` outcome: cli_failure (exit 1)',
      'Due-check getLessonsReconciliationStatus (tools/signals/lib/codex-auto.js): due (turn-cadence-3), 4 automated run note(s) across uncovered date(s): 2026-06-08. Obligated command: /reconcile-lessons 2026-06-08.'
    ];
    for (const summary of concrete) {
      assert.equal(
        hasConcreteValidationEvidence(summary),
        true,
        `expected concrete evidence to be accepted: "${summary}"`
      );
    }
  });
});

describe('validateValidationEvidence', () => {
  it('fails on a non-object validation block', () => {
    assert.equal(validateValidationEvidence(null).valid, false);
    assert.equal(validateValidationEvidence('ran').valid, false);
  });

  it('ran=true with empty summary fails', () => {
    const result = validateValidationEvidence({ ran: true, summary: '' });
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /non-empty validation\.summary/);
  });

  it('ran=true with boilerplate summary fails', () => {
    const result = validateValidationEvidence({ ran: true, summary: 'done' });
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /boilerplate/);
  });

  it('ran=true with concrete evidence passes', () => {
    const result = validateValidationEvidence({
      ran: true,
      summary: 'node --test tools/x.test.js: 12 pass, 0 fail'
    });
    assert.equal(result.valid, true);
  });

  it('ran=false without any reason fails', () => {
    const result = validateValidationEvidence({ ran: false, summary: '' });
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /explicit reason/);
  });

  it('ran=false with a reason in summary passes', () => {
    const result = validateValidationEvidence({
      ran: false,
      summary: 'not run — pre-execution dispatch request; validation occurs in the target actor run.'
    });
    assert.equal(result.valid, true);
  });

  it('ran=false with a generator-local reason field passes', () => {
    const result = validateValidationEvidence({
      ran: false,
      summary: '',
      reason: 'review-only request: no executable surface in this slice.'
    });
    assert.equal(result.valid, true);
  });
});

describe('validateHandoffSignal — requireValidationEvidence opt-in', () => {
  it('default-validation signal stays valid WITHOUT the flag (backward compat)', () => {
    const signal = createHandoffSignal('claude', 'test-scope', 'ready-for-review', {
      recommended_next_actor: 'codex',
      recommended_next_command: '/lint-attributions',
      next_step_detail: ['Run the command.']
    });
    const result = validateHandoffSignal(signal);
    assert.equal(result.valid, true, result.errors.join('; '));
  });

  it('default-validation signal FAILS with the flag (ran=false, no reason)', () => {
    const signal = createHandoffSignal('claude', 'test-scope', 'ready-for-review', {
      recommended_next_actor: 'codex',
      recommended_next_command: '/lint-attributions',
      next_step_detail: ['Run the command.']
    });
    const result = validateHandoffSignal(signal, { requireValidationEvidence: true });
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /explicit reason/);
  });

  it('signal with an explicit ran=false reason passes with the flag', () => {
    const signal = createHandoffSignal('claude', 'test-scope', 'ready-for-review', {
      recommended_next_actor: 'codex',
      recommended_next_command: '/lint-attributions',
      next_step_detail: ['Run the command.'],
      validation: { ran: false, summary: 'not run — dispatch request; the target actor validates.' }
    });
    const result = validateHandoffSignal(signal, { requireValidationEvidence: true });
    assert.equal(result.valid, true, result.errors.join('; '));
  });

  it('signal claiming ran=true with boilerplate fails with the flag', () => {
    const signal = createHandoffSignal('claude', 'test-scope', 'ready-for-review', {
      recommended_next_actor: 'codex',
      recommended_next_command: '/lint-attributions',
      next_step_detail: ['Run the command.'],
      validation: { ran: true, summary: 'ok' }
    });
    const result = validateHandoffSignal(signal, { requireValidationEvidence: true });
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /boilerplate/);
  });
});

describe('validateActorRunFeedbackSignal — concrete-evidence requirement', () => {
  function makeFeedbackSignal(summary) {
    const signal = createHandoffSignal('codex', 'test-scope', 'ready-for-review', {
      artifacts: [
        '_dev/reports/analysis/codex-cli-run__20260610T000000Z__test-scope.md',
        '_dev/reports/analysis/codex-last-message__20260610T000000Z__test-scope.md'
      ],
      validation: { ran: true, summary },
      recommended_next_actor: 'claude',
      recommended_next_command: '/review-progress test-scope',
      next_step_detail: ['Read the completion report.']
    });
    signal.run_outcome = { outcome: 'success', exitCode: 0, signal: null, success: true };
    return signal;
  }

  it('boilerplate validation.summary fails', () => {
    const result = validateActorRunFeedbackSignal(makeFeedbackSignal('ok'), { expectedActor: 'codex' });
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /boilerplate/);
  });

  it('command/result evidence in validation.summary passes', () => {
    const result = validateActorRunFeedbackSignal(
      makeFeedbackSignal('`codex exec --cd . -` outcome: success (exit 0)'),
      { expectedActor: 'codex' }
    );
    assert.equal(result.valid, true, result.errors.join('; '));
  });
});

describe('extractExactNextCommandFromReport', () => {
  it('extracts a backticked command from a numbered section heading', () => {
    const report = [
      '## Stdout',
      '',
      '4. Lessons from this review',
      '- none',
      '',
      '5. Exact next command',
      '',
      '`/reconcile-lessons 2026-06-08`',
      '',
      '6. Operator decisions needed'
    ].join('\n');
    assert.equal(extractExactNextCommandFromReport(report), '/reconcile-lessons 2026-06-08');
  });

  it('extracts a same-line command after a colon', () => {
    const report = 'Findings first.\nExact next command: `/repair-plan foo`\nEvidence used: x';
    assert.equal(extractExactNextCommandFromReport(report), '/repair-plan foo');
  });

  it('returns empty string when no section is declared', () => {
    assert.equal(extractExactNextCommandFromReport('Findings only, no command section.'), '');
    assert.equal(extractExactNextCommandFromReport(''), '');
  });

  it('matches bold numbered headings on real Codex report shapes (Codex review 2026-06-10 HIGH)', () => {
    const report = [
      '## Message',
      '',
      '5. **Exact next command**',
      '',
      '`/repair-plan harness-memory-adapters-manifest-and-contract`',
      '',
      '6. **Operator decisions needed**'
    ].join('\n');
    assert.equal(
      extractExactNextCommandFromReport(report),
      '/repair-plan harness-memory-adapters-manifest-and-contract'
    );
  });

  it('skips the prompt-template echo and takes the actor answer (last command-like wins)', () => {
    const report = [
      'Prompt contract:',
      '5. Exact next command — optional next prompt stub if useful',
      '',
      '## Stdout',
      '',
      '**Exact next command:** `/reconcile-lessons 2026-06-05`'
    ].join('\n');
    assert.equal(extractExactNextCommandFromReport(report), '/reconcile-lessons 2026-06-05');
  });

  it('a template echo alone yields no command', () => {
    const report = '5. Exact next command — optional next prompt stub if useful';
    assert.equal(extractExactNextCommandFromReport(report), '');
  });

  it('does not bleed into the next section when the value line is absent', () => {
    const report = [
      '5. **Exact next command**',
      '6. **Operator decisions needed**',
      '- approve the rollout'
    ].join('\n');
    assert.equal(extractExactNextCommandFromReport(report), '');
  });
});

describe('checkCompletionCommandConsistency', () => {
  const report = '5. Exact next command\n\n`/reconcile-lessons 2026-06-08`\n';

  it('matches when the signal carries the report command verbatim', () => {
    const result = checkCompletionCommandConsistency(report, '/reconcile-lessons 2026-06-08');
    assert.equal(result.matches, true);
    assert.equal(result.declared, '/reconcile-lessons 2026-06-08');
  });

  it('flags broadening — signal command differs from the declared command', () => {
    const result = checkCompletionCommandConsistency(report, '/review-progress lessons-reconciliation');
    assert.equal(result.matches, false);
    assert.equal(result.declared, '/reconcile-lessons 2026-06-08');
  });

  it('cannot mismatch when the report declares no command', () => {
    const result = checkCompletionCommandConsistency('no section here', '/anything');
    assert.equal(result.matches, true);
    assert.equal(result.declared, '');
  });
});

describe('dispatch-bridge — emitted signal carries an explicit ran=false reason', () => {
  it('writes a dispatch signal whose validation block states why validation did not run', () => {
    const projectRoot = makeTempRoot();
    try {
      const result = buildDispatchResult(projectRoot, {
        source: 'operator',
        target: 'codex',
        task: 'emission evidence test task',
        command: '/lint-attributions'
      });
      const signalPath = path.join(projectRoot, result.dispatch_signal_path);
      const signal = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
      assert.equal(signal.validation.ran, false);
      assert.ok(
        String(signal.validation.summary || '').trim().length > 0,
        'dispatch signal validation.summary must carry an explicit not-run reason'
      );
      assert.match(signal.validation.summary, /not run/i);
    } finally {
      cleanupTempRoot(projectRoot);
    }
  });
});
