'use strict';

/**
 * Tests for the S4 auto-run kill switch.
 * Repo convention: node --test (NOT jest).
 *
 * Mocks: fs (for the disable flag) and dart (for the Blocked interrupt). Uses a
 * real temp dir for the integration smoke with S2 so runOnIsolatedBranch sees a
 * real flag file via the real isAutoRunDisabled.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const K = require('../auto-run-kill-switch.js');
const A = require('../auto-run-isolation.js');

// ---------------------------------------------------------------------------
// In-memory fs mock — just the calls these functions use.
// ---------------------------------------------------------------------------

/** @param {Set<string>} present absolute paths that "exist" */
function mockFs(present, overrides) {
  const files = new Set(present || []);
  return Object.assign(
    {
      files,
      existsSync(p) { return files.has(p); },
      mkdirSync() {},
      writeFileSync(p) { files.add(p); },
      rmSync(p) { files.delete(p); },
    },
    overrides
  );
}

// ---------------------------------------------------------------------------
// Global disable flag — isAutoRunDisabled.
// ---------------------------------------------------------------------------

describe('isAutoRunDisabled (global kill switch)', () => {
  it('flag PRESENT => true (disabled / HALT)', () => {
    const stateDir = '/x/state';
    const p = K.flagPath({ stateDir });
    const fsMock = mockFs([p]);
    assert.equal(K.isAutoRunDisabled({ stateDir, fs: fsMock }), true);
  });

  it('flag ABSENT => false (no global halt found)', () => {
    const stateDir = '/x/state';
    const fsMock = mockFs([]);
    assert.equal(K.isAutoRunDisabled({ stateDir, fs: fsMock }), false);
  });

  it('check THROWS => true (fail-safe: unreadable kill switch must HALT)', () => {
    const stateDir = '/x/state';
    const fsMock = mockFs([], {
      existsSync() { throw new Error('fs exploded'); },
    });
    assert.equal(K.isAutoRunDisabled({ stateDir, fs: fsMock }), true);
  });

  it('flagPath is <stateDir>/ambient-router/disabled', () => {
    const p = K.flagPath({ stateDir: '/s' });
    assert.equal(p, path.join('/s', 'ambient-router', 'disabled'));
  });

  it('disableAutoRun then enableAutoRun toggles the flag (operator helpers)', () => {
    const stateDir = '/x/state';
    const fsMock = mockFs([]);
    assert.equal(K.isAutoRunDisabled({ stateDir, fs: fsMock }), false);
    K.disableAutoRun({ stateDir, fs: fsMock });
    assert.equal(K.isAutoRunDisabled({ stateDir, fs: fsMock }), true);
    K.enableAutoRun({ stateDir, fs: fsMock });
    assert.equal(K.isAutoRunDisabled({ stateDir, fs: fsMock }), false);
  });
});

// ---------------------------------------------------------------------------
// Per-plan Blocked interrupt — isPlanBlocked.
// ---------------------------------------------------------------------------

/** Dart mock whose getTask returns a status by id. */
function mockDart(statusById) {
  return {
    async getTask(id) {
      return { id, status: statusById[id] };
    },
  };
}

describe('isPlanBlocked (per-plan kill switch)', () => {
  it('true iff a subtask is Blocked (via injected dart.getTask)', async () => {
    const dart = mockDart({ s1: 'Doing', s2: 'Blocked', s3: 'To-do' });
    assert.equal(await K.isPlanBlocked({ dart, subtaskIds: ['s1', 's2', 's3'] }), true);
  });

  it('false when NO subtask is Blocked', async () => {
    const dart = mockDart({ s1: 'Doing', s2: 'Done', s3: 'To-do' });
    assert.equal(await K.isPlanBlocked({ dart, subtaskIds: ['s1', 's2', 's3'] }), false);
  });

  it('case-insensitive Blocked match', async () => {
    const dart = mockDart({ s1: 'blocked' });
    assert.equal(await K.isPlanBlocked({ dart, subtaskIds: ['s1'] }), true);
  });

  it('tolerates {status:{title}} shape', async () => {
    const dart = { async getTask(id) { return { id, status: { title: 'Blocked' } }; } };
    assert.equal(await K.isPlanBlocked({ dart, subtaskIds: ['s1'] }), true);
  });

  it('supports an injected listSubtasks reader (parentId)', async () => {
    const listSubtasks = async ({ parentId }) => {
      assert.equal(parentId, 'PARENT');
      return [{ status: 'Doing' }, { status: 'Blocked' }];
    };
    assert.equal(await K.isPlanBlocked({ listSubtasks, parentId: 'PARENT' }), true);
  });

  it('a read error => true (fail-safe: unreadable plan state must HALT)', async () => {
    const dart = { async getTask() { throw new Error('dart down'); } };
    assert.equal(await K.isPlanBlocked({ dart, subtaskIds: ['s1'] }), true);
  });

  it('no reader provided => true (fail-safe HALT)', async () => {
    assert.equal(await K.isPlanBlocked({}), true);
  });
});

// ---------------------------------------------------------------------------
// SINGLE-PARENT-CARD read path (density-collapse model, 2026-07-14).
// A plan now projects to exactly ONE Dart card; isPlanBlocked's primary path
// reads THAT card directly via dart.getTask(parentId) when no subtaskIds /
// listSubtasks reader is supplied.
// ---------------------------------------------------------------------------

describe('isPlanBlocked — single-parent-card read path (density-collapse model)', () => {
  it('true when the single parent card is Blocked', async () => {
    const dart = { async getTask(id) { return { id, status: 'Blocked' }; } };
    assert.equal(await K.isPlanBlocked({ dart, parentId: 'PARENT-1' }), true);
  });

  it('false when the single parent card is NOT Blocked (no reason to halt found)', async () => {
    const dart = { async getTask(id) { return { id, status: 'Doing' }; } };
    assert.equal(await K.isPlanBlocked({ dart, parentId: 'PARENT-1' }), false);
  });

  it('reads the parentId passed, not any subtaskIds (subtaskIds absent/empty in the density-collapse model)', async () => {
    const seen = [];
    const dart = {
      async getTask(id) { seen.push(id); return { id, status: 'To-do' }; },
    };
    await K.isPlanBlocked({ dart, parentId: 'PARENT-ONLY', subtaskIds: [] });
    assert.deepEqual(seen, ['PARENT-ONLY'], 'must read the parent card exactly once, never any subtask id');
  });

  it('case-insensitive Blocked match on the parent card', async () => {
    const dart = { async getTask(id) { return { id, status: 'blocked' }; } };
    assert.equal(await K.isPlanBlocked({ dart, parentId: 'P' }), true);
  });

  it('tolerates {status:{title}} shape on the parent card', async () => {
    const dart = { async getTask(id) { return { id, status: { title: 'Blocked' } }; } };
    assert.equal(await K.isPlanBlocked({ dart, parentId: 'P' }), true);
  });

  // ── THE REQUIRED FAIL-SAFE TESTS for the new single-parent-card path ──────
  // Philosophy-grounding adjustment (2026-07-14): the existing fail-safe
  // contract ("if ANY read throws, return TRUE") must be re-verified against
  // this new read path specifically, not just the legacy subtaskIds path.

  it('FAIL-SAFE: the parent-card read THROWS => true (HALT) — required re-verification for the new path', async () => {
    const dart = { async getTask() { throw new Error('dart down'); } };
    assert.equal(
      await K.isPlanBlocked({ dart, parentId: 'PARENT-1' }),
      true,
      'an unreadable single parent card must HALT, never silently proceed'
    );
  });

  it('FAIL-SAFE: the parent-card read returns MALFORMED data (null) => true (HALT)', async () => {
    const dart = { async getTask() { return null; } };
    assert.equal(
      await K.isPlanBlocked({ dart, parentId: 'PARENT-1' }),
      true,
      'a malformed (null) parent-card read must HALT, never be treated as "not blocked"'
    );
  });

  it('FAIL-SAFE: the parent-card read returns MALFORMED data (non-object) => true (HALT)', async () => {
    const dart = { async getTask() { return 'not-a-task-object'; } };
    assert.equal(
      await K.isPlanBlocked({ dart, parentId: 'PARENT-1' }),
      true,
      'a malformed (non-object) parent-card read must HALT'
    );
  });

  it('legacy per-step subtaskIds path still HALTs on read error (regression guard: new path did not weaken the old one)', async () => {
    const dart = { async getTask() { throw new Error('dart down'); } };
    assert.equal(await K.isPlanBlocked({ dart, subtaskIds: ['s1', 's2'] }), true);
  });

  // ── Amendment repair (20260714T162312Z, MAJOR 1): malformed-but-object-shaped
  // parent reads must HALT, not fall through as "no reason to halt". Before the
  // repair, readStatus({}) === null and `[null].some(...)` === false, so these
  // all incorrectly returned false (no-halt). ──────────────────────────────────

  it('FAIL-SAFE: parent-card read is an empty object {} => true (HALT) — no readable status at all', async () => {
    const dart = { async getTask() { return {}; } };
    assert.equal(
      await K.isPlanBlocked({ dart, parentId: 'PARENT-1' }),
      true,
      'an object with no status field is unreadable and must HALT'
    );
  });

  it('FAIL-SAFE: parent-card read has an id but no status ({ id: "P" }) => true (HALT)', async () => {
    const dart = { async getTask(id) { return { id }; } };
    assert.equal(
      await K.isPlanBlocked({ dart, parentId: 'PARENT-1' }),
      true,
      'a real-looking card missing status must still HALT'
    );
  });

  it('FAIL-SAFE: parent-card status is an empty object ({ status: {} }) => true (HALT)', async () => {
    const dart = { async getTask() { return { status: {} }; } };
    assert.equal(
      await K.isPlanBlocked({ dart, parentId: 'PARENT-1' }),
      true,
      '{ status: {} } has no readable .title string and must HALT'
    );
  });

  it('FAIL-SAFE: parent-card status is an empty string ({ status: "" }) => true (HALT)', async () => {
    const dart = { async getTask() { return { status: '' }; } };
    assert.equal(
      await K.isPlanBlocked({ dart, parentId: 'PARENT-1' }),
      true,
      'an empty-string status is not a valid non-empty status and must HALT'
    );
  });
});

// ---------------------------------------------------------------------------
// HALT-ONLY invariant — the security boundary.
// ---------------------------------------------------------------------------

describe('HALT-ONLY invariant (no authorize/resume/may-run)', () => {
  it('the exported surface contains NO authorize/resume/start/continue/grant function', () => {
    const forbidden = /authoriz|resume|may.?run|greenlight|grant|allow|start|continue|approve|enable.*run/i;
    for (const [name, val] of Object.entries(K)) {
      if (typeof val !== 'function') continue;
      // enableAutoRun is an operator helper that CLEARS the halt flag; it is not
      // a per-run authorization decision and is the lone "enable"-named export.
      if (name === 'enableAutoRun') continue;
      assert.ok(
        !forbidden.test(name),
        `kill switch must expose no authorize/resume/may-run function, found: ${name}`
      );
    }
  });

  it('the decision functions return only a boolean halt signal (never an authorization object)', async () => {
    // isAutoRunDisabled -> boolean.
    const disabled = K.isAutoRunDisabled({ stateDir: '/x', fs: mockFs([]) });
    assert.equal(typeof disabled, 'boolean');

    // isPlanBlocked -> boolean. There is no `{ authorized: ... }` / `{ mayRun }`
    // / `{ resume }` shape anywhere in the return.
    const dart = mockDart({ s1: 'Blocked' });
    const blocked = await K.isPlanBlocked({ dart, subtaskIds: ['s1'] });
    assert.equal(typeof blocked, 'boolean');
    assert.equal(blocked, true);
  });

  it('a FALSE result is "no reason to halt", NOT an authorization to run', () => {
    // Proven structurally: the only consumer of these booleans (S2) starts ONLY
    // when isDisabled() is false AND its own gate/classification independently
    // permits it. The kill switch alone can never start a run — see the S2
    // integration smoke below, where a non-disabled switch still does not by
    // itself authorize anything; S2's own segment logic decides what runs.
    const notDisabled = K.isAutoRunDisabled({ stateDir: '/x', fs: mockFs([]) });
    assert.equal(notDisabled, false);
    // The module exposes no function we could call to convert this false into a
    // run authorization — asserted by the forbidden-surface test above.
    assert.equal(typeof K.authorizeRun, 'undefined');
    assert.equal(typeof K.mayRun, 'undefined');
    assert.equal(typeof K.resumeRun, 'undefined');
  });
});

// ---------------------------------------------------------------------------
// Integration smoke with S2 — flag present => runOnIsolatedBranch does NOT start.
// Uses a REAL temp dir + the REAL isAutoRunDisabled (no fs mock).
// ---------------------------------------------------------------------------

describe('S2 integration: isAutoRunDisabled wired as runOnIsolatedBranch isDisabled', () => {
  function tmpStateDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'smos-killswitch-'));
  }
  function planOf(steps) { return { schema: 'TaskPlan/1.0', bounded_plan: { steps } }; }
  function safeStep(id) { return { id, title: 'tidy ' + id, description: 'internal cleanup', files_touched: [] }; }
  function gatingStep(id) { return { id, title: 'raise budget', description: 'increase daily budget', files_touched: [] }; }
  function mockGit() { const calls = []; return { calls, createBranch(n) { calls.push(n); } }; }

  it('disable flag PRESENT => S2 runOnIsolatedBranch does NOT start (no branch, no steps)', () => {
    const stateDir = tmpStateDir();
    try {
      K.disableAutoRun({ stateDir }); // create the REAL flag file
      assert.equal(K.isAutoRunDisabled({ stateDir }), true);

      const git = mockGit();
      const ran = [];
      const res = A.runOnIsolatedBranch({
        planId: 'PK', planJson: planOf([safeStep('S1'), gatingStep('S2')]),
        execStep: (s) => ran.push(s.id), git, stamp: 's',
        isDisabled: () => K.isAutoRunDisabled({ stateDir }),
      });

      assert.equal(res.started, false);
      assert.equal(res.disabled, true);
      assert.equal(res.branch, null);
      assert.deepEqual(res.ran, []);
      assert.deepEqual(git.calls, [], 'no isolated branch created while disabled');
      assert.deepEqual(ran, [], 'no step executed while disabled');
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('disable flag ABSENT => S2 may proceed (kill switch found no reason to halt)', () => {
    const stateDir = tmpStateDir();
    try {
      assert.equal(K.isAutoRunDisabled({ stateDir }), false);
      const git = mockGit();
      const ran = [];
      const res = A.runOnIsolatedBranch({
        planId: 'PK', planJson: planOf([safeStep('S1'), gatingStep('S2')]),
        execStep: (s) => ran.push(s.id), git, stamp: 's',
        isDisabled: () => K.isAutoRunDisabled({ stateDir }),
      });
      // The kill switch did not halt; S2's OWN segment logic still governs what
      // runs (only the safe prefix, stopping at the gate). The switch authorized
      // nothing on its own.
      assert.equal(res.started, true);
      assert.deepEqual(res.ran, ['S1']);
      assert.equal(res.stopped_at, 'S2');
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
