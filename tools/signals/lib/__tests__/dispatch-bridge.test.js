'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildDispatchResult } = require('../dispatch-bridge');

function actorWorkOrder(overrides = {}) {
  const value = {
    schema: 'ActorWorkOrder/1.0',
    dispatch_id: 'bridge-dispatch-1',
    continuity: { current_state: 'Plan exists.', question_work: 'Review it.', desired_state: 'Verdict exists.' },
    actor: { target: 'codex', model: 'gpt-5-codex', mind: 'codex', command: '/review-progress test-scope' },
    execution: { mode: 'REVIEW_ONLY', required_mcp: [] },
    custody: { scope: 'system:test', owner: 'coordinator' },
    privacy: { access: 'repository', allowed_refs: [] },
    disclosure: { model: 'gpt-5-codex', mind: 'codex' },
    max_retries: 1
  };
  return { ...value, ...overrides };
}

function writeManagedRegistry(root) {
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '- Implemented managed commands: /review-progress\n', 'utf8');
}

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-bridge-test-'));
}

function cleanupTempRoot(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (_) { /* best-effort */ }
}

const BASE_OPTS = {
  source: 'operator',
  target: 'codex',
  task: 'test task'
};

const RESOLVER_COMMANDS = [
  '/follow-signal',
  '/follow-signal --execute',
  '/follow-signal --execute --foo',
  '/run-plan',
  '/run-plan some-task-id',
  '/execute-plan master',
  '/advance-pipeline',
  '/advance-pipeline master'
];

function isResolverOrRecursiveError(message) {
  return /leaf command|resolver|recursive authority command/i.test(String(message || ''));
}

describe('buildDispatchResult — resolver commands are rejected', () => {
  for (const command of RESOLVER_COMMANDS) {
    it(`rejects "${command}"`, () => {
      const projectRoot = makeTempRoot();
      try {
        assert.throws(
          () => buildDispatchResult(projectRoot, { ...BASE_OPTS, command }),
          (err) => {
            assert.ok(err instanceof Error, 'thrown value must be an Error');
            assert.ok(
              isResolverOrRecursiveError(err.message),
              `error message should mention "leaf command", "resolver", or "recursive authority command"; got: ${err.message}`
            );
            return true;
          }
        );
      } finally {
        cleanupTempRoot(projectRoot);
      }
    });
  }

  it('rejects whitespace-padded resolver command "  /follow-signal  "', () => {
    const projectRoot = makeTempRoot();
    try {
      assert.throws(
        () => buildDispatchResult(projectRoot, { ...BASE_OPTS, command: '  /follow-signal  ' }),
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(
            isResolverOrRecursiveError(err.message),
            `error should mention leaf command / resolver / recursive; got: ${err.message}`
          );
          return true;
        }
      );
    } finally {
      cleanupTempRoot(projectRoot);
    }
  });
});

describe('buildDispatchResult — non-resolver leaf commands pass the resolver check', () => {
  const LEAF_COMMANDS = [
    '/improve-framework wordpress/qa',
    '/debrief-run test-scope',
    '/review-progress test-scope'
  ];

  for (const command of LEAF_COMMANDS) {
    it(`does not reject "${command}" for resolver/recursive reasons`, () => {
      const projectRoot = makeTempRoot();
      try {
        try {
          buildDispatchResult(projectRoot, { ...BASE_OPTS, command });
        } catch (err) {
          assert.ok(
            !isResolverOrRecursiveError(err.message),
            `leaf command must not fail the resolver/recursive check; got: ${err.message}`
          );
        }
      } finally {
        cleanupTempRoot(projectRoot);
      }
    });
  }

  it('does not reject resolver-prefix-lookalike "/run-plan-extra foo"', () => {
    const projectRoot = makeTempRoot();
    try {
      try {
        buildDispatchResult(projectRoot, { ...BASE_OPTS, command: '/run-plan-extra foo' });
      } catch (err) {
        assert.ok(
          !isResolverOrRecursiveError(err.message),
          `resolver-prefix-lookalike must not trip the resolver check; got: ${err.message}`
        );
      }
    } finally {
      cleanupTempRoot(projectRoot);
    }
  });
});

describe('buildDispatchResult — empty command still rejected', () => {
  it('rejects empty-string command with existing "required" error', () => {
    const projectRoot = makeTempRoot();
    try {
      assert.throws(
        () => buildDispatchResult(projectRoot, { ...BASE_OPTS, command: '' }),
        /command is required/i
      );
    } finally {
      cleanupTempRoot(projectRoot);
    }
  });
});

describe('buildDispatchResult — referenced artifact chronology', () => {
  it('records artifact mtimes on the dispatch signal', () => {
    const projectRoot = makeTempRoot();
    try {
      const contextPath = path.join(projectRoot, 'context.md');
      fs.writeFileSync(contextPath, '# Context\n', 'utf8');

      const result = buildDispatchResult(projectRoot, {
        ...BASE_OPTS,
        command: '/review-progress test-scope',
        context: 'context.md',
        scope: 'chronology-records-mtimes'
      });
      const signal = JSON.parse(fs.readFileSync(path.join(projectRoot, result.dispatch_signal_path), 'utf8'));

      assert.ok(Array.isArray(signal.referenced_artifacts_chronology));
      assert.equal(signal.referenced_artifacts_chronology.length, 2);
      assert.deepEqual(
        signal.referenced_artifacts_chronology.map((entry) => entry.path).sort(),
        ['_dev/reports/analysis/dispatch-bridge-prompt__chronology-records-mtimes.md', 'context.md']
      );
      for (const entry of signal.referenced_artifacts_chronology) {
        assert.equal(entry.exists_at_signal_write, true);
        assert.equal(entry.signal_timestamp, signal.timestamp);
        assert.equal(entry.pre_existed_signal, true);
        assert.ok(Number.isFinite(entry.observed_mtime_ms));
        assert.ok(Number.isFinite(entry.signal_timestamp_ms));
      }
    } finally {
      cleanupTempRoot(projectRoot);
    }
  });

  it('rejects a referenced artifact whose mtime is after the signal timestamp', () => {
    const projectRoot = makeTempRoot();
    try {
      const contextPath = path.join(projectRoot, 'future-context.md');
      fs.writeFileSync(contextPath, '# Future context\n', 'utf8');
      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(contextPath, future, future);

      assert.throws(
        () => buildDispatchResult(projectRoot, {
          ...BASE_OPTS,
          command: '/review-progress test-scope',
          context: 'future-context.md',
          scope: 'chronology-future-mtime'
        }),
        /chronology violation/i
      );
    } finally {
      cleanupTempRoot(projectRoot);
    }
  });
});

describe('buildDispatchResult — actor work-order preflight', () => {
  it('embeds the validated order and pairs a ready capability receipt', () => {
    const projectRoot = makeTempRoot();
    try {
      writeManagedRegistry(projectRoot);
      const workOrder = actorWorkOrder();
      const result = buildDispatchResult(projectRoot, {
        ...BASE_OPTS,
        command: '/review-progress test-scope',
        scope: 'work-order-ready',
        actor_work_order: workOrder,
        env: { SMOS_ACTOR_WORK_ORDER_MODE: 'enforce' }
      });
      const signal = JSON.parse(fs.readFileSync(path.join(projectRoot, result.dispatch_signal_path), 'utf8'));
      assert.deepEqual(signal.execution.actor_work_order, workOrder);
      assert.equal(result.actor_capability_receipt.ready, true);
      assert.equal(result.actor_work_order_mode, 'enforce');
    } finally {
      cleanupTempRoot(projectRoot);
    }
  });

  it('blocks a missing work order in enforce mode', () => {
    const projectRoot = makeTempRoot();
    try {
      assert.throws(() => buildDispatchResult(projectRoot, {
        ...BASE_OPTS,
        command: '/review-progress test-scope',
        env: { SMOS_ACTOR_WORK_ORDER_MODE: 'enforce' }
      }), /actor_work_order is required/);
    } finally {
      cleanupTempRoot(projectRoot);
    }
  });

  it('blocks target, command, MCP, and private-surface mismatches before dispatch', () => {
    const projectRoot = makeTempRoot();
    try {
      writeManagedRegistry(projectRoot);
      const workOrder = actorWorkOrder({
        actor: { target: 'claude', model: 'claude-sonnet', mind: 'claude', command: '/other' },
        execution: { mode: 'REVIEW_ONLY', required_mcp: ['playwright'] },
        privacy: { access: 'private-bounded', allowed_refs: [] },
        disclosure: { model: 'claude-sonnet', mind: 'claude' },
        fable_conduct: false
      });
      assert.throws(() => buildDispatchResult(projectRoot, {
        ...BASE_OPTS,
        command: '/review-progress test-scope',
        actor_work_order: workOrder,
        env: { SMOS_ACTOR_WORK_ORDER_MODE: 'enforce' }
      }), /target does not match|command does not match|missing MCP|privacy/i);
    } finally {
      cleanupTempRoot(projectRoot);
    }
  });

  it('uses a stable dispatch result identity for restart-safe failure decisions', () => {
    const projectRoot = makeTempRoot();
    try {
      writeManagedRegistry(projectRoot);
      const opts = {
        ...BASE_OPTS,
        command: '/review-progress test-scope',
        scope: 'stable-result-identity',
        actor_work_order: actorWorkOrder(),
        env: { SMOS_ACTOR_WORK_ORDER_MODE: 'enforce' }
      };
      const first = buildDispatchResult(projectRoot, opts);
      const second = buildDispatchResult(projectRoot, opts);
      assert.equal(first.analysis_artifacts.json, second.analysis_artifacts.json);
      assert.match(first.analysis_artifacts.json, /bridge-dispatch-1/);
    } finally {
      cleanupTempRoot(projectRoot);
    }
  });
});
