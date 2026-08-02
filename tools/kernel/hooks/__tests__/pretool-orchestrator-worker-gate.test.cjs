#!/usr/bin/env node
'use strict';

/**
 * Tests for pretool-orchestrator-worker-gate.cjs
 *
 * Run: node tools/kernel/hooks/__tests__/pretool-orchestrator-worker-gate.test.cjs
 *
 * Covers:
 *   - fail-open: any throw -> allow (status 0)
 *   - subagent exemption (CLAUDE_SUBAGENT_ID set -> always allow)
 *   - disabled-default (no MYTHOS_ORCHESTRATOR_GATE -> observe-only, status 0)
 *   - classify/block/allow matrix for all tool classes
 *   - delegation event resets counters and is always allowed
 *   - orchestration_write paths allowed, mutation paths blocked (enforcing)
 *   - kill-switch file disables enforcement
 *   - per-session state written under _dev/state/orchestrator-worker-gate/
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Load module under test
const gate = require('../pretool-orchestrator-worker-gate.cjs');

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    pass += 1;
    process.stdout.write(`  PASS  ${name}\n`);
  } catch (err) {
    fail += 1;
    process.stderr.write(`  FAIL  ${name}\n    ${err.stack || err.message}\n`);
  }
}

// -- Sandbox helpers ------------------------------------------------------------

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owgate-test-'));
  const sessionId = `owgate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const stateDir = path.join(root, '_dev', 'state', 'orchestrator-worker-gate');
  fs.mkdirSync(stateDir, { recursive: true });
  return { root, sessionId, stateDir };
}

// Create a mock fs that stubs existsSync for the kill-switch path.
// Real state reads/writes go to a real tmpdir.
function makeInject(sb, { killSwitchExists = false } = {}) {
  // We wrap the real fs but override existsSync for the disabled marker.
  const disabledMarker = path.join(sb.stateDir, 'disabled');
  return {
    fs: {
      ...fs,
      readFileSync: (...args) => {
        // Redirect stateDir reads to our sandbox
        return fs.readFileSync(...args);
      },
      writeFileSync: (...args) => fs.writeFileSync(...args),
      mkdirSync: (...args) => fs.mkdirSync(...args),
      existsSync: (p) => {
        if (p === disabledMarker) return killSwitchExists;
        return fs.existsSync(p);
      },
    },
    path,
  };
}

function makePayload(sb, toolName, toolInput = {}) {
  return {
    session_id: sb.sessionId,
    tool_name: toolName,
    tool_input: toolInput,
  };
}

function runGate(sb, toolName, toolInput = {}, opts = {}) {
  const savedEnv = {
    CLAUDE_SUBAGENT_ID: process.env.CLAUDE_SUBAGENT_ID,
    CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR,
    MYTHOS_ORCHESTRATOR_GATE: process.env.MYTHOS_ORCHESTRATOR_GATE,
  };

  // Set env for this call
  delete process.env.CLAUDE_SUBAGENT_ID;
  process.env.CLAUDE_PROJECT_DIR = sb.root;
  if (opts.enforcing) {
    process.env.MYTHOS_ORCHESTRATOR_GATE = '1';
  } else {
    delete process.env.MYTHOS_ORCHESTRATOR_GATE;
  }
  if (opts.subagent) {
    process.env.CLAUDE_SUBAGENT_ID = 'test-subagent-id';
  }

  let result;
  try {
    result = gate.main(
      { tool: toolName.toLowerCase(), payload: makePayload(sb, toolName, toolInput) },
      makeInject(sb, opts)
    );
  } finally {
    // Restore env
    if (savedEnv.CLAUDE_SUBAGENT_ID !== undefined) process.env.CLAUDE_SUBAGENT_ID = savedEnv.CLAUDE_SUBAGENT_ID;
    else delete process.env.CLAUDE_SUBAGENT_ID;
    if (savedEnv.CLAUDE_PROJECT_DIR !== undefined) process.env.CLAUDE_PROJECT_DIR = savedEnv.CLAUDE_PROJECT_DIR;
    else delete process.env.CLAUDE_PROJECT_DIR;
    if (savedEnv.MYTHOS_ORCHESTRATOR_GATE !== undefined) process.env.MYTHOS_ORCHESTRATOR_GATE = savedEnv.MYTHOS_ORCHESTRATOR_GATE;
    else delete process.env.MYTHOS_ORCHESTRATOR_GATE;
  }
  return result;
}

function readState(sb) {
  const stateFile = path.join(sb.stateDir, sb.sessionId + '.json');
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

// -- TESTS ----------------------------------------------------------------------

process.stdout.write('\npretool-orchestrator-worker-gate.cjs tests\n');
process.stdout.write('-'.repeat(60) + '\n');

// -- 1. Fail-open: exception in hook must never block --------------------------
process.stdout.write('\n[1] Fail-open invariant\n');

check('exception inside _main -> status 0 (fail-open)', () => {
  // Pass a payload that triggers a throw by injecting a fs that throws
  const sb = makeSandbox();
  const result = gate.main(
    { tool: 'write', payload: { session_id: sb.sessionId, tool_name: 'Write', tool_input: { file_path: '/any/file.js' } } },
    {
      fs: {
        ...fs,
        readFileSync: () => { throw new Error('injected-test-error'); },
        writeFileSync: () => {},
        mkdirSync: () => {},
        existsSync: () => false,
      },
      path,
    }
  );
  // The outer try/catch in main() must catch this and return allow
  assert.strictEqual(result.status, 0, 'must return status 0 on exception');
});

check('malformed stdin (no payload, no options) -> status 0', () => {
  // Call main with no options and no payload - simulates broken stdin
  const sb = makeSandbox();
  process.env.CLAUDE_PROJECT_DIR = sb.root;
  // Pass an empty payload (simulates empty/bad stdin result)
  const result = gate.main({ tool: '', payload: {} }, makeInject(sb));
  delete process.env.CLAUDE_PROJECT_DIR;
  assert.strictEqual(result.status, 0, 'empty tool -> fail-open allow');
});

// -- 2. Subagent exemption -----------------------------------------------------
process.stdout.write('\n[2] Subagent exemption\n');

check('CLAUDE_SUBAGENT_ID set -> allow all (even mutation Write)', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Write', { file_path: 'src/critical.js' }, { subagent: true, enforcing: true });
  assert.strictEqual(result.status, 0, 'subagent must always be allowed');
  assert.strictEqual(result.class, 'exempt', 'class must be exempt');
  assert.strictEqual(result.reason, 'subagent');
});

check('CLAUDE_SUBAGENT_ID set -> allow Bash mutation', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'npm install' }, { subagent: true, enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'exempt');
});

// -- 3. Disabled-default (observe-only mode) -----------------------------------
process.stdout.write('\n[3] Observe-only mode (MYTHOS_ORCHESTRATOR_GATE not set)\n');

check('mutation Write in observe-only mode -> status 0 (allowed, logged)', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Write', { file_path: 'src/somefeature.js' }, { enforcing: false });
  assert.strictEqual(result.status, 0, 'observe-only must allow');
  assert.strictEqual(result.class, 'mutation');
  assert.strictEqual(result.reason, 'observed');
});

check('observe-only: state file records "observed" counter', () => {
  const sb = makeSandbox();
  runGate(sb, 'Write', { file_path: 'src/notanorchpath.ts' }, { enforcing: false });
  const state = readState(sb);
  assert.ok(state, 'state file must be created');
  assert.strictEqual(state.observed, 1, 'observed counter must be 1');
  assert.strictEqual(state.blocked, 0, 'blocked counter must be 0');
});

check('analysis_execution Bash in observe-only mode -> status 0', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'find . -name "*.ts"' }, { enforcing: false });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'analysis_execution');
});

check('kill-switch file -> always allow regardless of enforcing flag', () => {
  const sb = makeSandbox();
  // Create the disabled marker
  fs.writeFileSync(path.join(sb.stateDir, 'disabled'), '');
  const result = runGate(sb, 'Write', { file_path: 'src/critical.js' }, { enforcing: true, killSwitchExists: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.reason, 'kill-switch-file');
});

// -- 4. classify + block/allow matrix -----------------------------------------
process.stdout.write('\n[4] Classify / block / allow matrix (enforcing mode)\n');

// trivial_read -> always allowed
check('Read -> trivial_read -> allow', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Read', { file_path: 'foo.md' }, { enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'trivial_read');
});

check('Bash: git status -> trivial_read -> allow', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'git status' }, { enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'trivial_read');
});

check('Bash: git diff -- one/path.ts -> trivial_read -> allow', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'git diff -- src/foo.ts' }, { enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'trivial_read');
});

check('Bash: git log -> trivial_read -> allow', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'git log --oneline -10' }, { enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'trivial_read');
});

check('Bash: ls -> trivial_read -> allow', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'ls -la tools/' }, { enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'trivial_read');
});

check('Bash: node tools/signals/follow-signal.js -> orchestration_write -> allow', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'node tools/signals/follow-signal.js system --execute' }, { enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'orchestration_write');
});

check('Bash: node tools/planning/assess-similarity.js -> orchestration_write -> allow', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'node tools/planning/assess-similarity.js --json' }, { enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'orchestration_write');
});

check('Bash: node tools/sessions/consume-boundary.cjs -> orchestration_write -> allow', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'node tools/sessions/consume-boundary.cjs system' }, { enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'orchestration_write');
});

// orchestration_write -> always allowed
check('Write to _dev/reports/signals/ -> orchestration_write -> allow', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Write', { file_path: '_dev/reports/signals/foo.json' }, { enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'orchestration_write');
});

check('Write to _dev/reports/analysis/ -> orchestration_write -> allow', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Write', { file_path: '_dev/reports/analysis/task-plans/foo__plan.json' }, { enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'orchestration_write');
});

check('Edit to handoff.md -> orchestration_write -> allow', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Edit', { file_path: '_dev/handoffs/handoff-2026-06-18.md' }, { enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'orchestration_write');
});

check('Edit to next-session.md -> orchestration_write -> allow', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Edit', { file_path: '_dev/state/next-session.md' }, { enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'orchestration_write');
});

check('Edit to Mythos-memories/ -> orchestration_write -> allow', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Edit', { file_path: 'Mythos-memories/memory/MEMORY.md' }, { enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'orchestration_write');
});

check('absolute Edit to root Mythos-memories/ -> orchestration_write -> allow', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Edit', { file_path: path.join(sb.root, 'Mythos-memories', 'memory', 'MEMORY.md') }, { enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'orchestration_write');
});

check('Edit to root legacy sm_os-memories/ -> orchestration_write -> allow', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Edit', { file_path: 'sm_os-memories/memory/MEMORY.md' }, { enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'orchestration_write');
});

check('Edit through a Mythos-memories symlink -> blocked', () => {
  const sb = makeSandbox();
  const trackedTarget = path.join(sb.root, 'src');
  const memoryRoot = path.join(sb.root, 'Mythos-memories');
  fs.mkdirSync(trackedTarget, { recursive: true });
  fs.mkdirSync(memoryRoot, { recursive: true });
  fs.symlinkSync(trackedTarget, path.join(memoryRoot, 'tracked-link'), 'dir');
  const result = runGate(
    sb,
    'Edit',
    { file_path: 'Mythos-memories/tracked-link/output.md' },
    { enforcing: true }
  );
  assert.strictEqual(result.status, 2, 'symlink escape must be blocked');
  assert.strictEqual(result.class, 'mutation');
});

check('generic handoff filename cannot re-allow a rejected memory symlink', () => {
  const sb = makeSandbox();
  const trackedTarget = path.join(sb.root, 'src');
  const memoryRoot = path.join(sb.root, 'Mythos-memories');
  fs.mkdirSync(trackedTarget, { recursive: true });
  fs.mkdirSync(memoryRoot, { recursive: true });
  fs.symlinkSync(trackedTarget, path.join(memoryRoot, 'tracked-link'), 'dir');
  const result = runGate(
    sb,
    'Edit',
    { file_path: 'Mythos-memories/tracked-link/handoff.md' },
    { enforcing: true }
  );
  assert.strictEqual(result.status, 2, 'generic artifact glob must not bypass memory containment');
  assert.strictEqual(result.class, 'mutation');
});

check('alternate memory-root casing cannot re-allow a handoff symlink', () => {
  const sb = makeSandbox();
  const trackedTarget = path.join(sb.root, 'src');
  const memoryRoot = path.join(sb.root, 'Mythos-memories');
  fs.mkdirSync(trackedTarget, { recursive: true });
  fs.mkdirSync(memoryRoot, { recursive: true });
  fs.symlinkSync(trackedTarget, path.join(memoryRoot, 'tracked-link'), 'dir');
  const result = runGate(
    sb,
    'Edit',
    { file_path: 'mythos-memories/tracked-link/handoff.md' },
    { enforcing: true }
  );
  assert.strictEqual(result.status, 2, 'case variation must not bypass memory containment');
  assert.strictEqual(result.class, 'mutation');
});

check('legacy memory symlink cannot re-enter through a generic handoff glob', () => {
  const sb = makeSandbox();
  const trackedTarget = path.join(sb.root, 'src');
  const memoryRoot = path.join(sb.root, 'sm_os-memories');
  fs.mkdirSync(trackedTarget, { recursive: true });
  fs.mkdirSync(memoryRoot, { recursive: true });
  fs.symlinkSync(trackedTarget, path.join(memoryRoot, 'tracked-link'), 'dir');
  const result = runGate(
    sb,
    'Edit',
    { file_path: 'sm_os-memories/tracked-link/handoff.md' },
    { enforcing: true }
  );
  assert.strictEqual(result.status, 2, 'legacy symlink must not bypass containment');
  assert.strictEqual(result.class, 'mutation');
});

check('alternate legacy-root casing cannot re-enter through a generic handoff glob', () => {
  const sb = makeSandbox();
  const result = runGate(
    sb,
    'Edit',
    { file_path: 'SM_OS-MEMORIES/tracked-link/handoff.md' },
    { enforcing: true }
  );
  assert.strictEqual(result.status, 2, 'legacy case variation must not bypass containment');
  assert.strictEqual(result.class, 'mutation');
});

check('Edit through a hard-linked memory target -> blocked', () => {
  const sb = makeSandbox();
  const memoryRoot = path.join(sb.root, 'Mythos-memories');
  const trackedTarget = path.join(sb.root, 'tracked.md');
  fs.mkdirSync(memoryRoot, { recursive: true });
  fs.writeFileSync(trackedTarget, 'tracked');
  fs.linkSync(trackedTarget, path.join(memoryRoot, 'memory.md'));
  const result = runGate(
    sb,
    'Edit',
    { file_path: 'Mythos-memories/memory.md' },
    { enforcing: true }
  );
  assert.strictEqual(result.status, 2, 'hard-linked target must be blocked');
  assert.strictEqual(result.class, 'mutation');
});

for (const unsafePath of [
  'mythos-memories/memory/MEMORY.md',
  'MYTHOS-MEMORIES/memory/MEMORY.md',
  'clients/example/Mythos-memories/memory/MEMORY.md',
]) {
  check(`Edit to non-canonical memory lookalike ${unsafePath} -> blocked`, () => {
    const sb = makeSandbox();
    const result = runGate(sb, 'Edit', { file_path: unsafePath }, { enforcing: true });
    assert.strictEqual(result.status, 2);
    assert.strictEqual(result.class, 'mutation');
  });
}

// Agent / Task -> delegation -> always allowed
check('Agent tool -> delegation -> allow', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Agent', { description: 'worker task' }, { enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'delegation');
});

check('Task tool -> delegation -> allow', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Task', {}, { enforcing: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.class, 'delegation');
});

check('delegation event increments state.delegations', () => {
  const sb = makeSandbox();
  runGate(sb, 'Agent', {}, { enforcing: true });
  const state = readState(sb);
  assert.strictEqual(state.delegations, 1);
});

// mutation -> BLOCK in enforcing mode
check('Write to src/foo.ts -> mutation -> BLOCKED (enforcing)', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Write', { file_path: 'src/feature.ts' }, { enforcing: true });
  assert.strictEqual(result.status, 2, 'mutation Write must be blocked');
  assert.strictEqual(result.class, 'mutation');
});

check('Edit to tools/lib/index.js -> mutation -> BLOCKED (enforcing)', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Edit', { file_path: 'tools/lib/index.js' }, { enforcing: true });
  assert.strictEqual(result.status, 2);
  assert.strictEqual(result.class, 'mutation');
});

check('Bash: npm install -> mutation -> BLOCKED (enforcing)', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'npm install' }, { enforcing: true });
  assert.strictEqual(result.status, 2);
  assert.strictEqual(result.class, 'mutation');
});

check('Bash: node scripts/build.js -> mutation -> BLOCKED (enforcing)', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'node scripts/build.js' }, { enforcing: true });
  assert.strictEqual(result.status, 2);
  assert.strictEqual(result.class, 'mutation');
});

check('Bash: git commit -> mutation -> BLOCKED (enforcing)', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'git commit -m "feat: x"' }, { enforcing: true });
  assert.strictEqual(result.status, 2);
  assert.strictEqual(result.class, 'mutation');
});

check('Bash: echo "x" > file.json -> mutation -> BLOCKED (enforcing)', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'echo "x" > file.json' }, { enforcing: true });
  assert.strictEqual(result.status, 2);
  assert.strictEqual(result.class, 'mutation');
});

check('Bash: rm -rf dist/ -> mutation -> BLOCKED (enforcing)', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'rm -rf dist/' }, { enforcing: true });
  assert.strictEqual(result.status, 2);
  assert.strictEqual(result.class, 'mutation');
});

// analysis_execution -> BLOCK in enforcing mode
check('Bash: find . -name "*.ts" -> analysis_execution -> BLOCKED (enforcing)', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'find . -name "*.ts"' }, { enforcing: true });
  assert.strictEqual(result.status, 2);
  assert.strictEqual(result.class, 'analysis_execution');
});

check('Bash: jq . artifacts.json -> analysis_execution -> BLOCKED (enforcing)', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'jq .field artifacts.json' }, { enforcing: true });
  assert.strictEqual(result.status, 2);
  assert.strictEqual(result.class, 'analysis_execution');
});

check('Bash: grep -r "pattern" . -> analysis_execution -> BLOCKED (enforcing)', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'grep -r "TODO" .' }, { enforcing: true });
  assert.strictEqual(result.status, 2);
  assert.strictEqual(result.class, 'analysis_execution');
});

check('Bash: for f in *.json; do ... -> analysis_execution -> BLOCKED (enforcing)', () => {
  const sb = makeSandbox();
  const result = runGate(sb, 'Bash', { command: 'for f in *.json; do cat $f; done' }, { enforcing: true });
  assert.strictEqual(result.status, 2);
  assert.strictEqual(result.class, 'analysis_execution');
});

// -- 5. Block message content --------------------------------------------------
process.stdout.write('\n[5] Block message content\n');

check('BLOCK_MESSAGE contains delegation instructions', () => {
  assert.ok(gate.BLOCK_MESSAGE.includes('BLOCKED_BY_ALTITUDE'), 'must contain BLOCKED_BY_ALTITUDE');
  assert.ok(gate.BLOCK_MESSAGE.includes('dispatch-bridge'), 'must mention dispatch-bridge');
  assert.ok(gate.BLOCK_MESSAGE.includes('Agent tool'), 'must mention Agent tool');
  assert.ok(gate.BLOCK_MESSAGE.includes('subagent'), 'must mention subagent');
});

// -- 6. State file written correctly ------------------------------------------
process.stdout.write('\n[6] State file persistence\n');

check('mutation block in enforcing mode increments blocked counter', () => {
  const sb = makeSandbox();
  runGate(sb, 'Write', { file_path: 'src/x.ts' }, { enforcing: true });
  const state = readState(sb);
  assert.ok(state, 'state file must exist');
  assert.strictEqual(state.blocked, 1);
  assert.ok(Array.isArray(state.log), 'log must be array');
  assert.strictEqual(state.log.length, 1);
  assert.strictEqual(state.log[0].class, 'mutation');
  assert.strictEqual(state.log[0].mode, 'blocking');
});

check('multiple blocks accumulate counter', () => {
  const sb = makeSandbox();
  runGate(sb, 'Write', { file_path: 'src/a.ts' }, { enforcing: true });
  runGate(sb, 'Bash', { command: 'npm install' }, { enforcing: true });
  const state = readState(sb);
  assert.strictEqual(state.blocked, 2);
});

check('delegation resets delegated_at_turn (truthy timestamp)', () => {
  const sb = makeSandbox();
  runGate(sb, 'Agent', {}, { enforcing: true });
  const state = readState(sb);
  assert.ok(state.delegated_at_turn > 0, 'delegated_at_turn must be set');
});

// -- 7. classifyBash unit tests ------------------------------------------------
process.stdout.write('\n[7] classifyBash unit tests\n');

check('classifyBash: git status -> trivial_read', () => {
  assert.strictEqual(gate.classifyBash('git status'), 'trivial_read');
});

check('classifyBash: git diff -- foo.ts -> trivial_read', () => {
  assert.strictEqual(gate.classifyBash('git diff -- foo.ts'), 'trivial_read');
});

check('classifyBash: ls -la -> trivial_read', () => {
  assert.strictEqual(gate.classifyBash('ls -la'), 'trivial_read');
});

check('classifyBash: npm run build -> mutation', () => {
  assert.strictEqual(gate.classifyBash('npm run build'), 'mutation');
});

check('classifyBash: python3 analyze.py -> mutation', () => {
  assert.strictEqual(gate.classifyBash('python3 analyze.py'), 'mutation');
});

check('classifyBash: tsc -> mutation', () => {
  assert.strictEqual(gate.classifyBash('tsc'), 'mutation');
});

check('classifyBash: rm file.txt -> mutation', () => {
  assert.strictEqual(gate.classifyBash('rm file.txt'), 'mutation');
});

check('classifyBash: find . -type f -> analysis_execution', () => {
  assert.strictEqual(gate.classifyBash('find . -type f'), 'analysis_execution');
});

check('classifyBash: jq .x f.json -> analysis_execution', () => {
  assert.strictEqual(gate.classifyBash('jq .x f.json'), 'analysis_execution');
});

check('classifyBash: for f in x; do echo; done -> analysis_execution', () => {
  assert.strictEqual(gate.classifyBash('for f in x; do echo $f; done'), 'analysis_execution');
});

check('classifyBash: git log -> trivial_read', () => {
  assert.strictEqual(gate.classifyBash('git log --oneline'), 'trivial_read');
});

check('classifyBash: canonical orchestration node command -> orchestration_write', () => {
  assert.strictEqual(gate.classifyBash('node tools/signals/follow-signal.js system --execute'), 'orchestration_write');
  assert.strictEqual(gate.classifyBash('node tools/planning/assess-similarity.js --json'), 'orchestration_write');
  assert.strictEqual(gate.classifyBash('node tools/sessions/consume-boundary.cjs system'), 'orchestration_write');
});

check('classifyBash: cat single-file -> trivial_read', () => {
  assert.strictEqual(gate.classifyBash('cat README.md'), 'trivial_read');
});

check('classifyBash: cat piped -> analysis_execution', () => {
  assert.strictEqual(gate.classifyBash('cat foo.json | jq .'), 'analysis_execution');
});

// -- 8. isOrchestrationPath unit tests ----------------------------------------
process.stdout.write('\n[8] isOrchestrationPath unit tests\n');

check('_dev/reports/signals/foo.json -> orchestration', () => {
  assert.ok(gate.isOrchestrationPath('_dev/reports/signals/foo.json'));
});

check('_dev/reports/analysis/bar.json -> orchestration', () => {
  assert.ok(gate.isOrchestrationPath('_dev/reports/analysis/bar.json'));
});

check('_dev/handoffs/handoff.md -> orchestration', () => {
  assert.ok(gate.isOrchestrationPath('_dev/handoffs/handoff.md'));
});

check('Mythos-memories/memory/MEMORY.md -> orchestration', () => {
  assert.ok(gate.isOrchestrationPath('Mythos-memories/memory/MEMORY.md'));
});

check('canonical memory classification is root-bound and case-sensitive', () => {
  const projectRoot = path.join(path.sep, 'tmp', 'mythos-project');
  assert.ok(gate.isOrchestrationPath('Mythos-memories/memory/MEMORY.md', projectRoot, path));
  assert.ok(gate.isOrchestrationPath(path.join(projectRoot, 'Mythos-memories', 'memory', 'MEMORY.md'), projectRoot, path));
  assert.ok(!gate.isOrchestrationPath('mythos-memories/memory/MEMORY.md', projectRoot, path));
  assert.ok(!gate.isOrchestrationPath('clients/example/Mythos-memories/memory/MEMORY.md', projectRoot, path));
});

check('canonical memory classification rejects symlink components', () => {
  const sb = makeSandbox();
  const memoryRoot = path.join(sb.root, 'Mythos-memories');
  fs.mkdirSync(memoryRoot, { recursive: true });
  fs.mkdirSync(path.join(sb.root, 'tracked'), { recursive: true });
  fs.symlinkSync(path.join(sb.root, 'tracked'), path.join(memoryRoot, 'escape'), 'dir');
  assert.strictEqual(
    gate.isCanonicalMemoryPath('Mythos-memories/escape/output.md', sb.root, path, fs),
    false
  );
});

check('canonical memory classification rejects a symlinked memory root', () => {
  const sb = makeSandbox();
  fs.mkdirSync(path.join(sb.root, 'tracked'), { recursive: true });
  fs.symlinkSync(path.join(sb.root, 'tracked'), path.join(sb.root, 'Mythos-memories'), 'dir');
  assert.strictEqual(
    gate.isCanonicalMemoryPath('Mythos-memories/output.md', sb.root, path, fs),
    false
  );
});

check('canonical memory classification rejects a symlinked target file', () => {
  const sb = makeSandbox();
  const memoryRoot = path.join(sb.root, 'Mythos-memories');
  const trackedFile = path.join(sb.root, 'tracked.md');
  fs.mkdirSync(memoryRoot, { recursive: true });
  fs.writeFileSync(trackedFile, 'tracked');
  fs.symlinkSync(trackedFile, path.join(memoryRoot, 'output.md'), 'file');
  assert.strictEqual(
    gate.isCanonicalMemoryPath('Mythos-memories/output.md', sb.root, path, fs),
    false
  );
});

check('src/feature.ts -> NOT orchestration', () => {
  assert.ok(!gate.isOrchestrationPath('src/feature.ts'));
});

check('tools/kernel/hooks/foo.cjs -> NOT orchestration', () => {
  assert.ok(!gate.isOrchestrationPath('tools/kernel/hooks/foo.cjs'));
});

check('next-session.md in a path -> orchestration', () => {
  assert.ok(gate.isOrchestrationPath('_dev/state/next-session.md'));
});

check('synthesis.md artifact -> orchestration', () => {
  assert.ok(gate.isOrchestrationPath('_dev/reports/analysis/convene-runs/20260618T225101Z-foo/synthesis.md'));
});

// -- Final report --------------------------------------------------------------
process.stdout.write('\n' + '-'.repeat(60) + '\n');
process.stdout.write(`Results: ${pass} passed, ${fail} failed\n`);
if (fail > 0) {
  process.exit(1);
} else {
  process.stdout.write('All tests passed.\n');
  process.exit(0);
}
