'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { CUSTOM_ADAPTERS_PATH, getAdapter, listAdapters, resolveAdapter } = require('../lib/adapters');

describe('convene adapters', () => {
  it('resolves built-in adapters unchanged', () => {
    const adapter = resolveAdapter('codex', {});
    assert.equal(adapter.command, 'codex');
    assert.deepEqual(adapter.argv, ['exec', '-s', 'read-only', '-']);
  });

  it('falls back to manual mode for any unknown actor name instead of throwing', () => {
    const adapter = resolveAdapter('some-unregistered-model', {});
    assert.equal(adapter.manual, true);
    assert.equal(adapter.actor, 'some-unregistered-model');
  });

  it('the explicit "manual" actor resolves to manual mode', () => {
    const adapter = resolveAdapter('manual', {});
    assert.equal(adapter.manual, true);
  });

  it('local-only blocks frontier actors but not manual mode', () => {
    assert.throws(() => resolveAdapter('codex', { local_only: true }), /Local-only convene blocks/);
    // manual mode is never a frontier actor — must not throw under local_only.
    assert.doesNotThrow(() => resolveAdapter('manual', { local_only: true }));
  });

  describe('custom adapters config (convene-adapters.json)', () => {
    const hadExisting = fs.existsSync(CUSTOM_ADAPTERS_PATH);
    const backupPath = `${CUSTOM_ADAPTERS_PATH}.bak-test`;

    it('loads a user-populated custom adapter and prefers it over manual fallback', () => {
      if (hadExisting) fs.renameSync(CUSTOM_ADAPTERS_PATH, backupPath);
      try {
        fs.writeFileSync(CUSTOM_ADAPTERS_PATH, JSON.stringify({
          'my-custom-actor': { command: 'echo', argv: ['hello'] }
        }));
        const adapter = getAdapter('my-custom-actor');
        assert.ok(adapter);
        assert.equal(adapter.command, 'echo');
        assert.deepEqual(adapter.argv, ['hello']);
        assert.ok(listAdapters().includes('my-custom-actor'));
      } finally {
        fs.rmSync(CUSTOM_ADAPTERS_PATH, { force: true });
        if (hadExisting) fs.renameSync(backupPath, CUSTOM_ADAPTERS_PATH);
      }
    });

    it('ignores a malformed custom adapters file rather than throwing', () => {
      if (hadExisting) fs.renameSync(CUSTOM_ADAPTERS_PATH, backupPath);
      try {
        fs.writeFileSync(CUSTOM_ADAPTERS_PATH, '{ not valid json');
        assert.doesNotThrow(() => getAdapter('anything'));
        const adapter = resolveAdapter('anything', {});
        assert.equal(adapter.manual, true);
      } finally {
        fs.rmSync(CUSTOM_ADAPTERS_PATH, { force: true });
        if (hadExisting) fs.renameSync(backupPath, CUSTOM_ADAPTERS_PATH);
      }
    });
  });
});
