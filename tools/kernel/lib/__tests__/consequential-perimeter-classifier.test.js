'use strict';

/**
 * Tests for the consequential-perimeter classifier (S1).
 * Repo convention: node --test (NOT jest).
 *
 * Coverage: positive + negative for EVERY predicate; fail-closed on
 * empty/garbled/unknown; step-level decisions + first_gate_step_id; the
 * self-protection invariant (classifier + runner + confinement paths gate).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const C = require('../consequential-perimeter-classifier.js');

/** Build a minimal plan with a single step. */
function planWith(step) {
  return { schema: 'TaskPlan/1.0', bounded_plan: { steps: [step] } };
}
function step(overrides) {
  return Object.assign({ id: 'S1', title: 't', description: '', files_touched: [] }, overrides);
}
/** Normalize a single raw step for helper-level tests. */
function ctx(rawStep) {
  return C.normalizeStep(rawStep, 0);
}

// ---------------------------------------------------------------------------
// Predicate table shape.
// ---------------------------------------------------------------------------
describe('predicate table', () => {
  it('exports all 13 named predicates with matches docs', () => {
    const names = C.PREDICATES.map((p) => p.name);
    assert.deepEqual(names, [
      'spends_money',
      'touches_client_live_property',
      'sends_to_external_party',
      'executes_network_egress',
      'destructive_or_irreversible',
      'credential_access',
      'edits_own_confinement',
      'commits_scope_budget_timeline',
      'accepts_client_facing_risk',
      'same_rank_authority_conflict',
      'requires_human_judgment',
      'approval_required_by_manifest',
      'high_risk_routing',
    ]);
    assert.ok(C.PREDICATES.every((p) => typeof p.matches === 'string' && p.matches.length > 0));
    assert.ok(C.PREDICATES.every((p) => typeof p.fn === 'function'));
    assert.ok(C.PREDICATES.every((p) => p.scope === 'step' || p.scope === 'plan'));
    // Exactly one plan-scoped predicate (high_risk_routing); the other 12 are step-scoped.
    assert.equal(C.PLAN_PREDICATES.length, 1);
    assert.equal(C.STEP_PREDICATES.length, 12);
  });
});

// ---------------------------------------------------------------------------
// Per-predicate positive + negative.
// ---------------------------------------------------------------------------
describe('spends_money', () => {
  it('positive: budget step trips', () => {
    assert.equal(C.spendsMoney(ctx(step({ description: 'raise the daily budget to $50' }))).tripped, true);
  });
  it('positive: ad spend token trips', () => {
    assert.equal(C.spendsMoney(ctx(step({ description: 'increase ad spend' }))).tripped, true);
  });
  it('negative: local refactor does not trip', () => {
    assert.equal(C.spendsMoney(ctx(step({ description: 'rename a helper function' }))).tripped, false);
  });
});

describe('touches_client_live_property', () => {
  it('positive: WordPress surface trips', () => {
    assert.equal(C.touchesClientLiveProperty(ctx(step({ description: 'edit the WordPress homepage' }))).tripped, true);
  });
  it('positive: campaign mutation trips', () => {
    assert.equal(C.touchesClientLiveProperty(ctx(step({ description: 'mutate campaign bid strategy' }))).tripped, true);
  });
  it('mixed-signal (blocker 2): read-only inspect THEN edit prod WordPress => trips', () => {
    assert.equal(
      C.touchesClientLiveProperty(ctx(step({ description: 'read-only inspect first, then edit the live WordPress homepage' }))).tripped,
      true,
    );
  });
  it('negative: read-only with NO live surface does NOT trip', () => {
    assert.equal(C.touchesClientLiveProperty(ctx(step({ description: 'read-only inspection of the local repo config' }))).tripped, false);
  });
  it('negative: pure repo work does not trip', () => {
    assert.equal(C.touchesClientLiveProperty(ctx(step({ description: 'refactor internal module' }))).tripped, false);
  });
});

describe('high_risk_routing (plan-scoped, blocker 3)', () => {
  it('positive: routing_expectations.risk_tier=high trips', () => {
    assert.equal(C.highRiskRouting({ routing_expectations: { risk_tier: 'high' } }).tripped, true);
  });
  it('positive: routing_expectations.big=true trips', () => {
    assert.equal(C.highRiskRouting({ routing_expectations: { big: true } }).tripped, true);
  });
  it('positive: requires_convene marker trips', () => {
    assert.equal(C.highRiskRouting({ requires_convene: true }).tripped, true);
  });
  it('negative: low-risk routing does not trip', () => {
    assert.equal(C.highRiskRouting({ routing_expectations: { risk_tier: 'low' } }).tripped, false);
  });
  it('negative: no routing metadata does not trip', () => {
    assert.equal(C.highRiskRouting({}).tripped, false);
  });
});

describe('sends_to_external_party', () => {
  it('positive: send email trips', () => {
    assert.equal(C.sendsToExternalParty(ctx(step({ description: 'send email to the client with the report' }))).tripped, true);
  });
  it('positive: webhook trips', () => {
    assert.equal(C.sendsToExternalParty(ctx(step({ description: 'fire a webhook to the third-party endpoint' }))).tripped, true);
  });
  it('negative: internal write does not trip', () => {
    assert.equal(C.sendsToExternalParty(ctx(step({ description: 'write a local report file' }))).tripped, false);
  });
});

describe('destructive_or_irreversible', () => {
  it('positive: delete trips', () => {
    assert.equal(C.destructiveOrIrreversible(ctx(step({ description: 'delete the stale records' }))).tripped, true);
  });
  it('positive: force-push trips', () => {
    assert.equal(C.destructiveOrIrreversible(ctx(step({ description: 'git push --force to the branch' }))).tripped, true);
  });
  it('negative: "harm" does not false-match rm', () => {
    assert.equal(C.destructiveOrIrreversible(ctx(step({ description: 'avoid harm to the form layout' }))).tripped, false);
  });
});

describe('credential_access', () => {
  it('positive: rotate token trips', () => {
    assert.equal(C.credentialAccess(ctx(step({ description: 'rotate token for the API client' }))).tripped, true);
  });
  it('positive: .env trips', () => {
    assert.equal(C.credentialAccess(ctx(step({ description: 'read a value from .env' }))).tripped, true);
  });
  it('negative: ordinary code does not trip', () => {
    assert.equal(C.credentialAccess(ctx(step({ description: 'parse the manifest json' }))).tripped, false);
  });
});

describe('edits_own_confinement', () => {
  it('positive: tools/kernel path trips', () => {
    assert.equal(C.editsOwnConfinement(ctx(step({ files_touched: ['tools/kernel/lib/foo.js (NEW)'] }))).tripped, true);
  });
  it('positive: instructions/canonical trips', () => {
    assert.equal(C.editsOwnConfinement(ctx(step({ files_touched: ['instructions/canonical/dispatch-routing-rule.yaml (M)'] }))).tripped, true);
  });
  it('positive: .claude path trips', () => {
    assert.equal(C.editsOwnConfinement(ctx(step({ files_touched: ['.claude/settings.json (M)'] }))).tripped, true);
  });
  it('positive: a *-gate*.cjs hook trips', () => {
    assert.equal(C.editsOwnConfinement(ctx(step({ files_touched: ['tools/foo/some-gate-thing.cjs (M)'] }))).tripped, true);
  });
  it('positive: process-tier-rule trips', () => {
    assert.equal(C.editsOwnConfinement(ctx(step({ files_touched: ['instructions/canonical/process-tier-rule.yaml (M)'] }))).tripped, true);
  });
  it('positive: runner run-plan.js trips (control-plane)', () => {
    assert.equal(C.editsOwnConfinement(ctx(step({ files_touched: ['tools/codex/commands/run-plan.js (M)'] }))).tripped, true);
  });
  it('positive: smos-launcher.js trips (control-plane)', () => {
    assert.equal(C.editsOwnConfinement(ctx(step({ files_touched: ['tools/codex/smos-launcher.js (M)'] }))).tripped, true);
  });
  it('positive: tools/commands registry trips', () => {
    assert.equal(C.editsOwnConfinement(ctx(step({ files_touched: ['tools/commands/registry.js (M)'] }))).tripped, true);
  });
  it('negative: ordinary repo file does not trip', () => {
    assert.equal(C.editsOwnConfinement(ctx(step({ files_touched: ['tools/image-optimize/run.js (M)'] }))).tripped, false);
  });
  it('negative: a non-kernel client file does not trip', () => {
    assert.equal(C.editsOwnConfinement(ctx(step({ files_touched: ['clients/{CLIENT_CODE}/notes.md (M)'] }))).tripped, false);
  });
});

describe('judgment / commitment predicates (flags + tokens)', () => {
  it('commits_scope_budget_timeline: flag trips', () => {
    assert.equal(C.commitsScopeBudgetTimeline(ctx(step({ commits_scope_budget_timeline: true })), { flags: {} }).tripped, true);
  });
  it('commits_scope_budget_timeline: token trips', () => {
    assert.equal(C.commitsScopeBudgetTimeline(ctx(step({ description: 'make a timeline commitment to the client' })), { flags: {} }).tripped, true);
  });
  it('commits_scope_budget_timeline: negative', () => {
    assert.equal(C.commitsScopeBudgetTimeline(ctx(step({ description: 'tidy code' })), { flags: {} }).tripped, false);
  });

  it('accepts_client_facing_risk: flag trips', () => {
    assert.equal(C.acceptsClientFacingRisk(ctx(step({ accepts_client_facing_risk: true })), { flags: {} }).tripped, true);
  });
  it('accepts_client_facing_risk: negative', () => {
    assert.equal(C.acceptsClientFacingRisk(ctx(step({ description: 'tidy code' })), { flags: {} }).tripped, false);
  });

  it('same_rank_authority_conflict: token trips', () => {
    assert.equal(C.sameRankAuthorityConflict(ctx(step({ description: 'resolve a same-rank authority conflict' })), { flags: {} }).tripped, true);
  });
  it('same_rank_authority_conflict: negative', () => {
    assert.equal(C.sameRankAuthorityConflict(ctx(step({ description: 'tidy code' })), { flags: {} }).tripped, false);
  });

  it('requires_human_judgment: flag trips', () => {
    assert.equal(C.requiresHumanJudgment(ctx(step({ requires_human_judgment: true })), { flags: {} }).tripped, true);
  });
  it('requires_human_judgment: negative', () => {
    assert.equal(C.requiresHumanJudgment(ctx(step({ description: 'tidy code' })), { flags: {} }).tripped, false);
  });

  it('approval_required_by_manifest: plan-level flag trips', () => {
    assert.equal(C.approvalRequiredByManifest(ctx(step({})), { flags: { approval_required_by_manifest: true } }).tripped, true);
  });
  it('approval_required_by_manifest: token trips', () => {
    assert.equal(C.approvalRequiredByManifest(ctx(step({ description: 'operator approval required before proceeding' })), { flags: {} }).tripped, true);
  });
  it('approval_required_by_manifest: negative', () => {
    assert.equal(C.approvalRequiredByManifest(ctx(step({ description: 'tidy code' })), { flags: {} }).tripped, false);
  });
});

// ---------------------------------------------------------------------------
// classifyPlan — fail-closed + step-level decisions.
// ---------------------------------------------------------------------------
describe('classifyPlan: fail-closed', () => {
  it('null plan => unknown + gate', () => {
    const r = C.classifyPlan(null);
    assert.equal(r.decision, 'gate');
    assert.equal(r.unknown, true);
  });
  it('garbled (non-object) => unknown + gate', () => {
    const r = C.classifyPlan(42);
    assert.equal(r.decision, 'gate');
    assert.equal(r.unknown, true);
  });
  it('empty steps => unknown + gate', () => {
    const r = C.classifyPlan({ bounded_plan: { steps: [] } });
    assert.equal(r.decision, 'gate');
    assert.equal(r.unknown, true);
  });
  it('no steps array => unknown + gate', () => {
    const r = C.classifyPlan({ title: 'no steps here' });
    assert.equal(r.decision, 'gate');
    assert.equal(r.unknown, true);
  });
  it('unrecognized step shape => that step gates + unknown', () => {
    const r = C.classifyPlan({ bounded_plan: { steps: [{ note: 'no title/desc/files' }] } });
    assert.equal(r.decision, 'gate');
    assert.equal(r.unknown, true);
    assert.equal(r.steps[0].decision, 'gate');
    assert.ok(r.steps[0].tripped.some((t) => t.predicate === C.UNKNOWN_PREDICATE));
  });
  it('unparseable files_touched entry => gate + unknown (cannot rule out confinement)', () => {
    const r = C.classifyPlan({ bounded_plan: { steps: [{ id: 'S1', description: 'x', files_touched: [123] }] } });
    assert.equal(r.decision, 'gate');
    assert.equal(r.unknown, true);
  });
  it('accepts a JSON string plan', () => {
    const r = C.classifyPlan(JSON.stringify(planWith(step({ description: 'rename a local helper', files_touched: ['tools/x/y.js (M)'] }))));
    assert.equal(r.decision, 'auto-run');
  });
});

// ---------------------------------------------------------------------------
// CODEX S1-REVIEW REGRESSION PROBES — the 3 bypasses found by direct probe.
// ---------------------------------------------------------------------------
describe('codex regression: blocker 1 — files_touched omission', () => {
  it('a step with NO files_touched key => gate + unknown (fail-closed)', () => {
    // No files_touched key at all: cannot rule out a confinement edit.
    const r = C.classifyPlan({ bounded_plan: { steps: [{ id: 'S1', description: 'do some local work' }] } });
    assert.equal(r.decision, 'gate');
    assert.equal(r.unknown, true);
    assert.equal(r.steps[0].decision, 'gate');
    assert.ok(r.steps[0].tripped.some((t) => t.predicate === C.UNKNOWN_PREDICATE));
  });
  it('an explicit files_touched:[] is NOT force-gated by the omission rule', () => {
    // Legitimate no-file step (e.g. a pure analysis note): explicit [] must stay auto-run.
    const r = C.classifyPlan({ bounded_plan: { steps: [{ id: 'S1', description: 'summarize findings into the report context', files_touched: [] }] } });
    assert.equal(r.decision, 'auto-run');
    assert.equal(r.unknown, false);
    // And it does not carry a fail-closed unknown sentinel.
    assert.ok(!r.steps[0].tripped.some((t) => t.predicate === C.UNKNOWN_PREDICATE));
  });
});

describe('codex regression: blocker 2 — read-only does not suppress a co-present mutation', () => {
  it('"read-only inspect ... then edit prod WordPress" => gate', () => {
    const r = C.classifyPlan(planWith(step({
      description: 'read-only inspect first, then edit the live WordPress homepage',
    })));
    assert.equal(r.decision, 'gate');
    assert.ok(r.tripped.some((t) => t.predicate === 'touches_client_live_property'));
  });
});

describe('codex regression: blocker 3 — risk_tier high folds into the perimeter', () => {
  it('a plan with routing_expectations.risk_tier=high => gate even if every step is otherwise safe', () => {
    const r = C.classifyPlan({
      routing_expectations: { risk_tier: 'high' },
      bounded_plan: {
        steps: [step({ id: 'S1', description: 'refactor a local helper', files_touched: ['tools/x/y.js (M)'] })],
      },
    });
    assert.equal(r.decision, 'gate');
    assert.equal(r.plan_decision, 'gate');
    assert.equal(r.first_gate_step_id, 'S1');
    assert.ok(r.tripped.some((t) => t.predicate === 'high_risk_routing'));
  });
});

describe('classifyPlan: purely-local repo refactor => auto-run', () => {
  it('all-safe plan auto-runs with no tripped predicates', () => {
    const plan = {
      bounded_plan: {
        steps: [
          step({ id: 'S1', description: 'refactor a utility module', files_touched: ['tools/image-optimize/run.js (M)'] }),
          step({ id: 'S2', description: 'add a unit test', files_touched: ['tools/image-optimize/__tests__/run.test.js (NEW)'] }),
        ],
      },
    };
    const r = C.classifyPlan(plan);
    assert.equal(r.decision, 'auto-run');
    assert.equal(r.plan_decision, 'auto-run');
    assert.equal(r.unknown, false);
    assert.equal(r.first_gate_step_id, null);
    assert.equal(r.tripped.length, 0);
    assert.ok(r.steps.every((s) => s.decision === 'auto-run'));
  });
});

describe('classifyPlan: step-level safe-prefix semantics', () => {
  it('auto-runs safe prefix and reports the first gating step', () => {
    const plan = {
      bounded_plan: {
        steps: [
          step({ id: 'S1', description: 'prepare a local draft', files_touched: ['tools/x/draft.js (NEW)'] }),
          step({ id: 'S2', description: 'raise the campaign budget', files_touched: [] }),
          step({ id: 'S3', description: 'delete old branches', files_touched: [] }),
        ],
      },
    };
    const r = C.classifyPlan(plan);
    assert.equal(r.steps[0].decision, 'auto-run');
    assert.equal(r.steps[1].decision, 'gate');
    assert.equal(r.steps[2].decision, 'gate');
    assert.equal(r.first_gate_step_id, 'S2');
    assert.equal(r.plan_decision, 'gate');
  });
});

describe('classifyPlan: budget step gates', () => {
  it('a plan with a budget step gates', () => {
    const r = C.classifyPlan(planWith(step({ description: 'increase the daily budget' })));
    assert.equal(r.decision, 'gate');
    assert.ok(r.tripped.some((t) => t.predicate === 'spends_money'));
  });
});

describe('classifyPlan: WordPress prod file gates', () => {
  it('touching a WordPress prod surface gates', () => {
    const r = C.classifyPlan(planWith(step({ description: 'publish to the live WordPress site' })));
    assert.equal(r.decision, 'gate');
    assert.ok(r.tripped.some((t) => t.predicate === 'touches_client_live_property'));
  });
});

// ---------------------------------------------------------------------------
// SELF-PROTECTION INVARIANT.
// ---------------------------------------------------------------------------
describe('self-protection invariant', () => {
  it('a plan editing tools/kernel/** gates via edits_own_confinement', () => {
    const r = C.classifyPlan(planWith(step({ description: 'tweak a kernel lib', files_touched: ['tools/kernel/lib/something.js (M)'] })));
    assert.equal(r.decision, 'gate');
    assert.ok(r.tripped.some((t) => t.predicate === 'edits_own_confinement'));
  });

  it('a plan editing the classifier ITSELF gates via edits_own_confinement', () => {
    const r = C.classifyPlan(planWith(step({
      description: 'modify the perimeter classifier',
      files_touched: ['tools/kernel/lib/consequential-perimeter-classifier.js (M)'],
    })));
    assert.equal(r.decision, 'gate');
    assert.ok(r.tripped.some((t) => t.predicate === 'edits_own_confinement'));
  });

  it('a plan editing the runner tools/codex/commands/run-plan.js gates via edits_own_confinement', () => {
    const r = C.classifyPlan(planWith(step({
      description: 'add branch isolation to the runner',
      files_touched: ['tools/codex/commands/run-plan.js (M)'],
    })));
    assert.equal(r.decision, 'gate');
    assert.ok(r.tripped.some((t) => t.predicate === 'edits_own_confinement'));
  });
});

// ---------------------------------------------------------------------------
// Network Egress Classifier.
// ---------------------------------------------------------------------------
describe('executes_network_egress', () => {
  it('positive: step command with curl trips', () => {
    const r = C.classifyPlan(planWith(step({
      command: 'curl https://api.stripe.com',
    })));
    assert.equal(r.decision, 'gate');
    assert.ok(r.tripped.some((t) => t.predicate === 'executes_network_egress'));
  });

  it('positive: step description with raw URL trips', () => {
    const r = C.classifyPlan(planWith(step({
      description: 'fetch from https://untrusted-api.com',
    })));
    assert.equal(r.decision, 'gate');
    assert.ok(r.tripped.some((t) => t.predicate === 'executes_network_egress'));
  });

  it('negative: local loopback does NOT trip', () => {
    const r = C.classifyPlan(planWith(step({
      command: 'node my-script.js --target=http://localhost:8080/health',
    })));
    assert.equal(r.decision, 'auto-run');
  });
});
