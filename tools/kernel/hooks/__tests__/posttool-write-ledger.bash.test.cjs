'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const { main } = require('../posttool-write-ledger.cjs');

const HOOK_SCRIPT = path.join(__dirname, '..', 'posttool-write-ledger.cjs');

function readLedger(tmpDir, sessionId) {
  const logFile = path.join(tmpDir, '_dev', 'state', 'active-sessions', sessionId, 'write_log.json');
  return JSON.parse(fs.readFileSync(logFile, 'utf8'));
}

function withTmpProject(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-write-ledger-bash-test-'));
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_PROJECT_DIR;
  }
}

test('posttool-write-ledger (Bash) - redirect command appends a tagged entry', async (t) => {
  withTmpProject((tmpDir) => {
    const payload = {
      session_id: 'bash-redirect-session',
      tool_name: 'Bash',
      cwd: tmpDir,
      tool_input: { command: 'echo hi > out/notes.txt' }
    };
    main(payload);

    const log = readLedger(tmpDir, 'bash-redirect-session');
    assert.strictEqual(log.paths.length, 1);
    const entry = log.paths[0];
    assert.strictEqual(entry.path, path.join('out', 'notes.txt'));
    assert.strictEqual(entry.tool, 'Bash');
    assert.strictEqual(entry.mechanism, 'redirect');
    assert.strictEqual(entry.confidence, 'literal');
    assert.ok(entry.at, 'entry has an at timestamp');
  });
});

test('posttool-write-ledger (Bash) - cp appends a tagged entry', async (t) => {
  withTmpProject((tmpDir) => {
    const payload = {
      session_id: 'bash-cp-session',
      tool_name: 'Bash',
      cwd: tmpDir,
      tool_input: { command: 'cp src/a.txt dest/a.txt' }
    };
    main(payload);

    const log = readLedger(tmpDir, 'bash-cp-session');
    assert.strictEqual(log.paths.length, 1);
    const entry = log.paths[0];
    assert.strictEqual(entry.path, path.join('dest', 'a.txt'));
    assert.strictEqual(entry.tool, 'Bash');
    assert.strictEqual(entry.mechanism, 'cp');
  });
});

test('posttool-write-ledger (Bash) - node -e appends exactly one opaque sentinel', async (t) => {
  withTmpProject((tmpDir) => {
    const payload = {
      session_id: 'bash-opaque-session',
      tool_name: 'Bash',
      cwd: tmpDir,
      tool_input: { command: 'node -e "require(\'fs\').writeFileSync(\'x\',\'y\')"' }
    };
    main(payload);

    const log = readLedger(tmpDir, 'bash-opaque-session');
    assert.strictEqual(log.paths.length, 1, 'exactly one sentinel, not one per opaque reason');
    const entry = log.paths[0];
    assert.strictEqual(entry.opaque, true);
    assert.strictEqual(entry.tool, 'Bash');
    assert.ok(Array.isArray(entry.reasons) && entry.reasons.length > 0);
    assert.ok(entry.reasons.includes('inline-interpreter-writes-unknown'));
    assert.ok(entry.at, 'sentinel has an at timestamp');
    assert.strictEqual(entry.path, undefined, 'sentinel carries no path key');
  });
});

test('posttool-write-ledger (Bash) - Write/Edit/MultiEdit entry shapes unchanged (regression)', async (t) => {
  withTmpProject((tmpDir) => {
    main({
      session_id: 'shape-regression-session',
      tool_name: 'Write',
      tool_input: { file_path: 'foo/bar.txt' }
    });
    main({
      session_id: 'shape-regression-session',
      tool_name: 'Edit',
      tool_input: { file_path: 'foo/baz.txt' }
    });
    main({
      session_id: 'shape-regression-session',
      tool_name: 'MultiEdit',
      tool_input: { file_path: 'foo/qux.txt', edits: [{ file_path: 'foo/quux.txt' }] }
    });

    const log = readLedger(tmpDir, 'shape-regression-session');
    assert.strictEqual(log.paths.length, 4);
    for (const entry of log.paths) {
      assert.deepStrictEqual(Object.keys(entry).sort(), ['at', 'path', 'tool']);
    }
  });
});

test('posttool-write-ledger (Bash) - updated_at is present and fresh after append', async (t) => {
  withTmpProject((tmpDir) => {
    const before = Date.now();
    main({
      session_id: 'updated-at-session',
      tool_name: 'Bash',
      cwd: tmpDir,
      tool_input: { command: 'cp a.txt b.txt' }
    });
    const after = Date.now();

    const log = readLedger(tmpDir, 'updated-at-session');
    assert.ok(log.updated_at, 'updated_at field present at top level');
    const ms = Date.parse(log.updated_at);
    assert.ok(Number.isFinite(ms), 'updated_at parses as a valid date');
    assert.ok(ms >= before - 1000 && ms <= after + 1000, 'updated_at is fresh');
  });
});

test('posttool-write-ledger (Bash) - dedup hit still refreshes updated_at without duplicating the entry (F2)', async (t) => {
  withTmpProject((tmpDir) => {
    main({
      session_id: 'dedup-refresh-session',
      tool_name: 'Write',
      tool_input: { file_path: 'foo/bar.txt' }
    });

    const firstLog = readLedger(tmpDir, 'dedup-refresh-session');
    assert.strictEqual(firstLog.paths.length, 1);
    const firstUpdatedAt = firstLog.updated_at;

    // Force the clock forward so a second-precision ISO timestamp is
    // guaranteed to differ, then re-append the identical path.
    const start = Date.now();
    while (Date.now() - start < 5) { /* busy-wait a few ms */ }

    main({
      session_id: 'dedup-refresh-session',
      tool_name: 'Write',
      tool_input: { file_path: 'foo/bar.txt' }
    });

    const secondLog = readLedger(tmpDir, 'dedup-refresh-session');
    assert.strictEqual(secondLog.paths.length, 1, 'still exactly one entry — the dedup hit did not duplicate it');
    assert.ok(secondLog.updated_at, 'updated_at present after the dedup-hit invocation');
    assert.notStrictEqual(secondLog.updated_at, firstUpdatedAt, 'updated_at refreshed even though nothing new was added');
    assert.ok(Date.parse(secondLog.updated_at) >= Date.parse(firstUpdatedAt), 'updated_at moved forward, not backward');
  });
});

test('posttool-write-ledger (process) - malformed payload (file_path as a number) exits 0, no uncaught throw (F3)', async (t) => {
  withTmpProject((tmpDir) => {
    const malformedPayload = JSON.stringify({
      session_id: 'malformed-payload-session',
      tool_name: 'Write',
      // file_path as a number, not a string — path.isAbsolute() throws a
      // TypeError on a non-string argument, which previously escaped the
      // stdin 'end' callback as an uncaught async exception and crashed
      // the hook process.
      tool_input: { file_path: 12345 }
    });

    const result = spawnSync(process.execPath, [HOOK_SCRIPT], {
      input: malformedPayload,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir }
    });

    assert.strictEqual(result.status, 0, 'process exits 0 (fail-open), not a crash');
    assert.ok(!result.signal, 'process was not killed by a signal');
    assert.ok(
      !/Uncaught|TypeError/.test(result.stderr || ''),
      `no uncaught exception surfaced on stderr: ${result.stderr}`
    );
  });
});

test('posttool-write-ledger (process) - malformed payload (file_path as an object) exits 0, no uncaught throw (F3)', async (t) => {
  withTmpProject((tmpDir) => {
    const malformedPayload = JSON.stringify({
      session_id: 'malformed-payload-object-session',
      tool_name: 'Write',
      tool_input: { file_path: { nested: 'value' } }
    });

    const result = spawnSync(process.execPath, [HOOK_SCRIPT], {
      input: malformedPayload,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir }
    });

    assert.strictEqual(result.status, 0, 'process exits 0 (fail-open), not a crash');
    assert.ok(!result.signal, 'process was not killed by a signal');
    assert.ok(
      !/Uncaught|TypeError/.test(result.stderr || ''),
      `no uncaught exception surfaced on stderr: ${result.stderr}`
    );
  });
});

test('posttool-write-ledger (Bash) - fail-open: extractor throwing never corrupts the ledger or throws', async (t) => {
  withTmpProject((tmpDir) => {
    const extractorPath = require.resolve('../lib/bash-write-extract.cjs');
    const original = require.cache[extractorPath];
    // Monkeypatch the cached module's export to throw, simulating a crash
    // inside extraction. Restore in `finally` regardless of test outcome.
    const originalExports = original ? original.exports : require('../lib/bash-write-extract.cjs');
    const patched = {
      extractBashWrites() {
        throw new Error('simulated extractor crash');
      }
    };
    require.cache[extractorPath] = { ...original, exports: patched };

    try {
      assert.doesNotThrow(() => {
        main({
          session_id: 'fail-open-session',
          tool_name: 'Bash',
          cwd: tmpDir,
          tool_input: { command: 'cp a.txt b.txt' }
        });
      });

      const logFile = path.join(tmpDir, '_dev', 'state', 'active-sessions', 'fail-open-session', 'write_log.json');
      // Fail-open: no candidates could be extracted, so nothing was appended
      // and the ledger file was never created — not corrupted, just absent.
      assert.ok(!fs.existsSync(logFile), 'no ledger file written when extraction crashes');
    } finally {
      if (original) require.cache[extractorPath] = original;
      else delete require.cache[extractorPath];
      void originalExports;
    }
  });
});

// --- B3: run_shell_command parity -------------------------------------------
//
// dispatch-posttool.cjs routes both 'Bash' and 'run_shell_command' tool
// names into this hook. Both must share the extraction/cap/sentinel path,
// but the entry's `tool` field must record whichever name actually
// invoked it — never hardcode 'Bash' for a run_shell_command payload.

test('posttool-write-ledger (run_shell_command) - redirect command captures a candidate tagged with its own tool name', async (t) => {
  withTmpProject((tmpDir) => {
    const payload = {
      session_id: 'run-shell-command-session',
      tool_name: 'run_shell_command',
      cwd: tmpDir,
      tool_input: { command: 'echo hi > out/notes.txt' }
    };
    main(payload);

    const log = readLedger(tmpDir, 'run-shell-command-session');
    assert.strictEqual(log.paths.length, 1);
    const entry = log.paths[0];
    assert.strictEqual(entry.path, path.join('out', 'notes.txt'));
    assert.strictEqual(entry.tool, 'run_shell_command', 'provenance stays honest, not relabeled as Bash');
    assert.strictEqual(entry.mechanism, 'redirect');
    assert.strictEqual(entry.confidence, 'literal');
  });
});

// --- B3: consumer compatibility proofs --------------------------------------
//
// Fixture-driven shape-tolerance tests for every downstream write_log.json
// reader found by grep, proving each tolerates the three B2/B3 entry shapes
// (Bash/run_shell_command candidate, opaque sentinel, cap note) without
// crashing or miscounting. Readers whose consumed function is not exported
// are documented n/a with the exact source guard cited instead of a test.

test('consumer: pretool-git-custody-gate.cjs classifyPath (exported) classifies a Bash-candidate path as own and ignores sentinel/cap-note entries without crashing', async (t) => {
  withTmpProject((tmpDir) => {
    const { classifyPath } = require('../pretool-git-custody-gate.cjs');

    const sessionsDir = path.join(tmpDir, '_dev', 'state', 'active-sessions');
    const sessionId = 'custody-gate-session';
    fs.mkdirSync(path.join(sessionsDir, sessionId), { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, sessionId, 'write_log.json'),
      JSON.stringify({
        paths: [
          { path: 'out/notes.txt', at: '2026-08-12T00:00:00Z', tool: 'Bash', mechanism: 'redirect', confidence: 'literal' },
          { opaque: true, at: '2026-08-12T00:00:01Z', tool: 'Bash', reasons: ['inline-interpreter-writes-unknown'] },
          { truncated_entries: true, at: '2026-08-12T00:00:02Z', tool: 'Bash', dropped: 3 }
        ]
      })
    );

    assert.doesNotThrow(() => {
      const result = classifyPath('out/notes.txt', sessionId, sessionsDir, fs, null, new Map());
      assert.strictEqual(result.classification, 'own', 'Bash-candidate path entry is recognized as own');
    });

    // A path that only appears as an opaque/cap-note shape (no `path` key)
    // must never be misclassified as own from those entries.
    assert.doesNotThrow(() => {
      const result = classifyPath('never-appears-as-a-path.txt', sessionId, sessionsDir, fs, null, new Map());
      assert.strictEqual(result.classification, 'unknown');
    });
  });
});

test('consumer: tools/context/context-budget.cjs sessionWriteLedgerPaths (exported) picks up a Bash-candidate path and ignores sentinel/cap-note entries', async (t) => {
  withTmpProject((tmpDir) => {
    const { sessionWriteLedgerPaths } = require('../../../context/context-budget.cjs');

    const sessionId = 'context-budget-session';
    const sessionDir = path.join(tmpDir, '_dev', 'state', 'active-sessions', sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, 'write_log.json'),
      JSON.stringify({
        paths: [
          { path: 'out/notes.txt', at: '2026-08-12T00:00:00Z', tool: 'run_shell_command', mechanism: 'redirect', confidence: 'literal' },
          { opaque: true, at: '2026-08-12T00:00:01Z', tool: 'Bash', reasons: ['dynamic-target'] },
          { truncated_entries: true, at: '2026-08-12T00:00:02Z', tool: 'Bash', dropped: 2 }
        ]
      })
    );

    const paths = sessionWriteLedgerPaths(tmpDir, sessionId);
    assert.deepStrictEqual([...paths], ['out/notes.txt'], 'only the path-bearing candidate is included; sentinel/cap-note entries yield no path and are silently skipped');
  });
});

test('consumer: tools/sessions/lib/active-session-registry.js adoptSessionCustody (exported) copies a Bash-candidate path forward and never crashes on sentinel/cap-note entries', async (t) => {
  withTmpProject((tmpDir) => {
    const registryPath = require.resolve('../../../sessions/lib/active-session-registry.js');
    delete require.cache[registryPath];
    const registry = require(registryPath);
    registry.setDataDir(path.join(tmpDir, '_dev', 'state', 'active-sessions'));

    try {
      const fromDir = path.join(tmpDir, '_dev', 'state', 'active-sessions', 'from-session');
      fs.mkdirSync(fromDir, { recursive: true });
      fs.writeFileSync(
        path.join(fromDir, 'write_log.json'),
        JSON.stringify({
          paths: [
            { path: 'out/notes.txt', at: '2026-08-12T00:00:00Z', tool: 'Bash', mechanism: 'redirect', confidence: 'literal' },
            { opaque: true, at: '2026-08-12T00:00:01Z', tool: 'Bash', reasons: ['dynamic-target'] },
            { truncated_entries: true, at: '2026-08-12T00:00:02Z', tool: 'Bash', dropped: 1 }
          ]
        })
      );

      let out;
      assert.doesNotThrow(() => {
        out = registry.adoptSessionCustody({ fromSessionId: 'from-session', toSessionId: 'to-session', now: new Date() });
      });
      assert.strictEqual(out.adopted, true);
      // adoptSessionCustody derives `p` per entry (typeof entry === 'string'
      // ? entry : entry.path) and skips any entry where `p` is falsy — so
      // the sentinel and cap-note entries (no `.path` key) are correctly
      // excluded from adoption, not copied forward as bogus "paths". Only
      // the one real Bash-candidate path is adopted.
      assert.strictEqual(out.adopted_count, 1);
      assert.deepStrictEqual(out.paths, ['out/notes.txt']);
    } finally {
      registry.resetDataDir();
    }
  });
});

test('consumer: tools/hygiene/auto-commit.js resolveCustodySet ledger reader — n/a, not exported', async (t) => {
  // auto-commit.js exports only { isSensitive, isGovernanceGated,
  // isNarrativeIncompleteReview, GOVERNANCE_GATED_PATHS } — resolveCustodySet
  // and its inline ledger-reading loop are not part of the module surface,
  // so this cannot be exercised as a fixture-driven unit call without
  // invoking the full hygiene flow (out of scope per the B3 brief).
  //
  // Source guard cited (tools/hygiene/auto-commit.js:264-266):
  //   const p = typeof entry === 'string' ? entry : (entry.path || '');
  //   if (p) custodySet.add(p.replace(/^\/+/, ''));
  // A sentinel/cap-note entry has no `.path` key, so `entry.path` is
  // `undefined`, the `|| ''` fallback makes `p` the empty string, and the
  // `if (p)` guard skips it — same tolerance shape as every other reader,
  // verified by inspection rather than by a fixture call.
  assert.ok(true, 'documented n/a — see comment');
});

test('consumer: tools/sessions/lib/active-session-registry.js ledgerDirLastActivityMs — n/a, not exported and shape-irrelevant', async (t) => {
  // ledgerDirLastActivityMs is not exported (only registerSession, heartbeat,
  // closeSession, sweepExpired, listSessionDirs, listActive, getSession,
  // getCurrentSessionId, setCurrentSessionId, adoptSessionCustody,
  // setCurrentTask, findByWorkingSurface are). It is also structurally
  // unaffected by entry shape: it reads only the ledger's top-level
  // `updated_at` field (tools/sessions/lib/active-session-registry.js:247-249)
  // and never inspects `paths` entries at all, so none of the three new
  // shapes change its behavior.
  assert.ok(true, 'documented n/a — see comment');
});

test('posttool-write-ledger (Bash) - 32-cap: candidates beyond the cap are dropped with a truncated_entries note', async (t) => {
  withTmpProject((tmpDir) => {
    // 40 mkdir targets in one command -> 40 literal candidates, well past the cap.
    const targets = Array.from({ length: 40 }, (_, i) => `dir${i}`).join(' ');
    main({
      session_id: 'cap-session',
      tool_name: 'Bash',
      cwd: tmpDir,
      tool_input: { command: `mkdir ${targets}` }
    });

    const log = readLedger(tmpDir, 'cap-session');
    const pathEntries = log.paths.filter(e => e.path);
    const capNotes = log.paths.filter(e => e.truncated_entries === true);

    assert.strictEqual(pathEntries.length, 32, 'appended candidates capped at 32');
    assert.strictEqual(capNotes.length, 1, 'exactly one truncated_entries note');
    assert.strictEqual(capNotes[0].tool, 'Bash');
    assert.strictEqual(capNotes[0].dropped, 8);
  });
});
