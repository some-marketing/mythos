'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { applyRuntimeOptions, parseArgs, participantSlots, resolveOrigin } = require('../convene');
const { parseActorOverrides, resolveTriad } = require('../lib/profiles');

describe('convene profile resolution', () => {
  it('defaults to the local council actor roster', () => {
    const args = parseArgs(['node', 'convene.js', '--task', 'review plan', '--scope', 'plan-review']);
    const triad = resolveTriad(args);

    assert.equal(args.origin, 'local-qwen');
    assert.equal(args.localOnly, true);
    assert.equal(triad.id, 'local-council');
    assert.deepEqual(
      triad.slots.map((slot) => [slot.id, slot.actor]),
      [
        ['alpha', 'local-qwen'],
        ['now', 'local-deepseek'],
        ['omega', 'local-coder']
      ]
    );
  });

  it('still supports the legacy kernel roster when explicitly requested', () => {
    const args = parseArgs(['node', 'convene.js', '--allow-frontier', '--profile', 'kernel', '--origin', 'codex', '--task', 'review plan', '--scope', 'plan-review']);
    const triad = resolveTriad(args);

    assert.equal(args.localOnly, false);
    assert.equal(triad.id, 'kernel');
    assert.deepEqual(
      triad.slots.map((slot) => [slot.id, slot.actor]),
      [
        ['alpha', 'claude'],
        ['now', 'codex'],
        ['omega', 'gemini']
      ]
    );
  });

  it('resolves origin by legacy actor id and excludes only that slot', () => {
    const args = parseArgs(['node', 'convene.js', '--allow-frontier', '--profile', 'kernel', '--origin', 'codex', '--task', 'review plan', '--scope', 'plan-review']);
    const triad = resolveTriad(args);
    const origin = resolveOrigin(triad, args.origin);
    const participants = participantSlots(args, triad);

    assert.equal(origin.id, 'now');
    assert.deepEqual(participants.map((slot) => slot.actor), ['claude', 'gemini']);
  });

  it('supports explicit profile and slot actor overrides', () => {
    const args = parseArgs([
      'node',
      'convene.js',
      '--allow-frontier',
      '--profile',
      'code-review',
      '--actor',
      'edge=gemini',
      '--task',
      'review patch',
      '--scope',
      'patch-review'
    ]);
    const triad = resolveTriad(args);

    assert.equal(triad.id, 'code-review');
    assert.deepEqual(
      triad.slots.map((slot) => [slot.id, slot.actor]),
      [
        ['intent', 'claude'],
        ['truth', 'codex'],
        ['edge', 'gemini']
      ]
    );
  });

  it('applies local-only runtime options to participant slots', () => {
    const args = parseArgs(['node', 'convene.js', '--task', 'review plan', '--scope', 'plan-review']);
    const triad = resolveTriad(args);

    applyRuntimeOptions(args, triad);

    assert.equal(triad.local_only, true);
    assert.deepEqual(
      triad.slots.map((slot) => [slot.id, slot.local_only, slot.risk_tier, slot.task_shape, slot.scope_tier]),
      [
        ['alpha', true, 'low', 'deliberation', 'system'],
        ['now', true, 'low', 'deliberation', 'system'],
        ['omega', true, 'low', 'deliberation', 'system']
      ]
    );
  });

  it('rejects malformed actor override entries', () => {
    assert.throws(
      () => parseActorOverrides(['now']),
      /Expected slot=actor/
    );
  });

  it('supports --only by slot id', () => {
    const args = parseArgs([
      'node',
      'convene.js',
      '--allow-frontier',
      '--origin',
      'intent',
      '--profile',
      'code-review',
      '--only',
      'truth',
      '--task',
      'review patch',
      '--scope',
      'patch-review'
    ]);
    const triad = resolveTriad(args);
    const participants = participantSlots(args, triad);

    assert.deepEqual(participants.map((slot) => [slot.id, slot.actor]), [['truth', 'codex']]);
  });

  it('requires slot-id origin when actor overrides make origin actor ambiguous', () => {
    const args = parseArgs([
      'node',
      'convene.js',
      '--allow-frontier',
      '--profile',
      'kernel',
      '--origin',
      'codex',
      '--actor',
      'alpha=codex',
      '--task',
      'review plan',
      '--scope',
      'plan-review'
    ]);
    const triad = resolveTriad(args);

    assert.throws(
      () => resolveOrigin(triad, args.origin),
      /Ambiguous --origin/
    );
  });
});
