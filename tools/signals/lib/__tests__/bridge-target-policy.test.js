'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  getBridgeTargetPolicy,
  getBridgeTransportPolicy,
  listBridgeTargetPolicies,
  getScopeTierPolicy,
  resolveBridgeInvocation,
  resolveRecursiveBridgeRoute,
  resolveBridgeTargetModel,
  validateScopeTransition,
  validateBridgeTargetModel
} = require('../bridge-target-policy');

describe('bridge target policy', () => {
  it('classifies bridge target transports across logged-in, local-model, and API lanes', () => {
    assert.equal(getBridgeTransportPolicy('gemini', 'local-cli').kind, 'logged-in-agent');
    assert.equal(getBridgeTransportPolicy('gemini', 'api').kind, 'api-agent');
    assert.equal(getBridgeTransportPolicy('ollama', 'local-model').kind, 'local-model-agent');
    assert.equal(getBridgeTransportPolicy('claude', 'local-cli').kind, 'logged-in-agent');
    assert.equal(getBridgeTransportPolicy('codex', 'local-cli').kind, 'logged-in-agent');
    assert.ok(listBridgeTargetPolicies().some((policy) => policy.target === 'gemini'));
    assert.equal(getBridgeTransportPolicy('gemini', 'local-cli').docs_checked_at, '2026-04-22');
  });

  it('resolves Gemini local CLI invocation through the shared policy', () => {
    const invocation = resolveBridgeInvocation('gemini', { transport: 'local-cli' });

    assert.equal(invocation.target, 'gemini');
    assert.equal(invocation.transport, 'local-cli');
    assert.equal(invocation.kind, 'logged-in-agent');
    assert.equal(invocation.binary, 'gemini');
    assert.equal(invocation.auth, 'google-oauth-personal-or-code-assist');
    assert.equal(invocation.model, 'gemini-3-pro-preview');
    assert.match(invocation.launch_contract, /gemini --model <model> -p <prompt>/);
    assert.match(invocation.docs.model_docs, /ai\.google\.dev\/gemini-api\/docs\/models/);
    assert.match(invocation.docs.bridge_docs, /developers\.google\.com\/gemini-code-assist\/docs\/gemini-3/);
    assert.equal(invocation.docs.checked_at, '2026-04-22');
  });

  it('rejects stale Gemini models for both local CLI and API transports', () => {
    const local = validateBridgeTargetModel('gemini', 'gemini-2.5-pro', { transport: 'local-cli' });
    const api = validateBridgeTargetModel('gemini', 'gemini-2.5-pro', { transport: 'api' });

    assert.equal(local.valid, false);
    assert.equal(api.valid, false);
    assert.match(local.reason, /stale/i);
    assert.match(api.reason, /stale/i);
    assert.throws(
      () => resolveBridgeTargetModel('gemini', 'gemini-2.5-pro', { transport: 'local-cli' }),
      /stale/i
    );
  });

  it('selects a narrower Gemini model class when the scope tier and task shape are mechanical', () => {
    const route = resolveRecursiveBridgeRoute('gemini', {
      scope_tier: 'leaf',
      risk_tier: 'low',
      task_shape: 'mechanical verification'
    });

    assert.equal(route.transport, 'local-cli');
    assert.equal(route.model, 'gemini-3-flash-preview');
    assert.equal(route.routing.scope_tier, 'leaf');
    assert.equal(route.routing.child_depth_budget, 0);
    assert.equal(route.routing.model_class, 'mechanical');
    assert.equal(route.routing.prefers_logged_in_before_api, true);
  });

  it('keeps non-strict targets callable while still resolving their bridge class', () => {
    const claude = resolveBridgeInvocation('claude', { transport: 'local-cli', model: 'sonnet' });
    const ollama = resolveBridgeInvocation('ollama', { transport: 'local-model', model: 'qwen2.5-coder:14b' });

    assert.equal(claude.kind, 'logged-in-agent');
    assert.equal(claude.model, 'sonnet');
    assert.equal(ollama.kind, 'local-model-agent');
    assert.equal(ollama.model, 'qwen2.5-coder:14b');
  });

  it('reports unknown targets and unsupported transports before dispatch', () => {
    assert.equal(getBridgeTargetPolicy('missing'), null);
    assert.equal(getBridgeTransportPolicy('gemini', 'local-model'), null);
    assert.throws(
      () => resolveBridgeInvocation('missing'),
      /Unknown bridge target/
    );
    assert.throws(
      () => resolveBridgeInvocation('gemini', { transport: 'local-model' }),
      /does not support transport/
    );
  });

  it('exposes scope-tier depth budgets for recursive delegation consumers', () => {
    const projectTier = getScopeTierPolicy('project');

    assert.equal(projectTier.child_depth_budget, 1);
    assert.equal(projectTier.rank, 2);
  });

  it('enforces two-way scope transitions without letting low scope self-create higher authority', () => {
    const down = validateScopeTransition('project', 'leaf', 'delegate');
    assert.equal(down.valid, true);
    assert.equal(down.relation, 'downscope');

    const blockedCreate = validateScopeTransition('leaf', 'project', 'create');
    assert.equal(blockedCreate.valid, false);
    assert.equal(blockedCreate.requires_explicit_authority, true);
    assert.match(blockedCreate.reason, /requires explicit upstream authority/i);

    const upwardReport = validateScopeTransition('leaf', 'project', 'return-upward');
    assert.equal(upwardReport.valid, true);
    assert.equal(upwardReport.creates_authority, false);

    const authorizedPromotion = validateScopeTransition('leaf', 'project', 'promote', {
      explicit_authority: true
    });
    assert.equal(authorizedPromotion.valid, true);
    assert.equal(authorizedPromotion.creates_authority, true);
  });
});
