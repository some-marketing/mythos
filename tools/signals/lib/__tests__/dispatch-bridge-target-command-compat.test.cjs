'use strict';

/**
 * Hermetic tests for tools/signals/lib/target-command-policy.cjs.
 *
 * Each case constructs a small fixture project root under os.tmpdir() with
 * minimal AGENTS.md / .claude/commands/ contents, then asserts the validator
 * decision shape and registry_source resolution.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  validateTargetCommandCompat
} = require('../target-command-policy.cjs');

function makeFixtureRoot(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcp-fixture-'));
  if (opts.agentsMd !== undefined) {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), opts.agentsMd, 'utf8');
  }
  if (Array.isArray(opts.claudeCommands)) {
    const cdir = path.join(dir, '.claude', 'commands');
    fs.mkdirSync(cdir, { recursive: true });
    for (const name of opts.claudeCommands) {
      fs.writeFileSync(path.join(cdir, `${name}.md`), `stub for ${name}\n`, 'utf8');
    }
  }
  if (Array.isArray(opts.opencodeCommands)) {
    const odir = path.join(dir, '.opencode', 'commands');
    fs.mkdirSync(odir, { recursive: true });
    for (const name of opts.opencodeCommands) {
      fs.writeFileSync(path.join(odir, `${name}.md`), `stub for ${name}\n`, 'utf8');
    }
  }
  return dir;
}

const STD_AGENTS = [
  '# AGENTS',
  '- Implemented managed commands: /debrief-run, /dispatch-bridge, /next-session, /normalize-signals, /orchestrate, /orchestrate-loop, /owl, /repair-plan, /review-task-plan, /run-plan, /synthesize-debrief, /systemize-behavior'
].join('\n');

test('a) target=codex command=/convene ALLOWED when registered (origin-aware convene)', () => {
  const root = makeFixtureRoot({
    agentsMd: STD_AGENTS + '\n- Implemented managed commands: /convene\n'
  });
  const r = validateTargetCommandCompat({
    target: 'codex', command: '/convene', projectRoot: root
  });
  assert.equal(r.allowed, true, r.reason);
  assert.ok(r.registry_source);
});

test('b) target=codex command=/orchestrate-loop ALLOWED (in AGENTS.md managed list)', () => {
  const root = makeFixtureRoot({ agentsMd: STD_AGENTS });
  const r = validateTargetCommandCompat({
    target: 'codex', command: '/orchestrate-loop', projectRoot: root
  });
  assert.equal(r.allowed, true, r.reason);
  assert.match(r.registry_source, /AGENTS\.md$/);
});

test('b2) target=codex command=/owl ALLOWED (human shorthand alias)', () => {
  const root = makeFixtureRoot({ agentsMd: STD_AGENTS });
  const r = validateTargetCommandCompat({
    target: 'codex', command: '/owl', projectRoot: root
  });
  assert.equal(r.allowed, true, r.reason);
  assert.match(r.registry_source, /AGENTS\.md$/);
});

test('b3) target=codewhale command=/orchestrate-loop ALLOWED (AGENTS.md managed list, same registry as codex)', () => {
  const root = makeFixtureRoot({ agentsMd: STD_AGENTS });
  const r = validateTargetCommandCompat({
    target: 'codewhale', command: '/orchestrate-loop', projectRoot: root
  });
  assert.equal(r.allowed, true, r.reason);
  assert.match(r.registry_source, /AGENTS\.md$/);
});

test('b4) target=codewhale command=/not-a-real-command REJECTED (not in AGENTS.md managed list)', () => {
  const root = makeFixtureRoot({ agentsMd: STD_AGENTS });
  const r = validateTargetCommandCompat({
    target: 'codewhale', command: '/not-a-real-command', projectRoot: root
  });
  assert.equal(r.allowed, false, r.reason);
  assert.match(r.registry_source, /AGENTS\.md$/);
});

test('b5) target=codewhale command omitted REJECTED (managed-command actor, freeform shape refused)', () => {
  const root = makeFixtureRoot({ agentsMd: STD_AGENTS });
  const r = validateTargetCommandCompat({
    target: 'codewhale', projectRoot: root
  });
  assert.equal(r.allowed, false, r.reason);
});

test('c) target=claude command=/convene ALLOWED when .claude/commands/convene.md exists', () => {
  const root = makeFixtureRoot({
    claudeCommands: ['convene', 'orchestrate-loop']
  });
  const r = validateTargetCommandCompat({
    target: 'claude', command: '/convene', projectRoot: root
  });
  assert.equal(r.allowed, true, r.reason);
});

test('c2) target=claude command=/orchestrate-loop ALLOWED when .claude/commands/orchestrate-loop.md exists', () => {
  const root = makeFixtureRoot({
    claudeCommands: ['orchestrate-loop', 'review-task-plan']
  });
  const r = validateTargetCommandCompat({
    target: 'claude', command: '/orchestrate-loop', projectRoot: root
  });
  assert.equal(r.allowed, true, r.reason);
  assert.match(r.registry_source, /\.claude\/commands$/);
});

test('d) target=gemini command omitted ALLOWED (freeform-prompt-target end-to-end shipped via bridge-gemini-runner)', () => {
  const root = makeFixtureRoot({});
  const r = validateTargetCommandCompat({
    target: 'gemini', projectRoot: root
  });
  assert.equal(r.allowed, true, r.reason || 'omitted command should be allowed for freeform target');
  assert.match(r.registry_source, /FREEFORM_PROMPT_TARGETS/);
});

test("d') target=gemini command=\"freeform\" ALLOWED (explicit freeform marker)", () => {
  const root = makeFixtureRoot({});
  const r = validateTargetCommandCompat({
    target: 'gemini', command: 'freeform', projectRoot: root
  });
  assert.equal(r.allowed, true, r.reason);
  assert.match(r.registry_source, /FREEFORM_PROMPT_TARGETS/);
});

test("d'') target=gemini command=/anything REJECTED with freeform-prompt-target reason", () => {
  const root = makeFixtureRoot({});
  const r = validateTargetCommandCompat({
    target: 'gemini', command: '/review-source-material', projectRoot: root
  });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /freeform-prompt-target/);
  assert.match(r.reason, /REJECTED/);
});

test('e) target=openrouter command=/anything REJECTED', () => {
  const root = makeFixtureRoot({});
  const r = validateTargetCommandCompat({
    target: 'openrouter', command: '/orchestrate-loop', projectRoot: root
  });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /freeform-prompt-target/);
});

test('f) target=codex command=/nonexistent-command REJECTED with managed-list reason', () => {
  const root = makeFixtureRoot({ agentsMd: STD_AGENTS });
  const r = validateTargetCommandCompat({
    target: 'codex', command: '/no-such-thing', projectRoot: root
  });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /Implemented managed commands|managed list/i);
});

test('g) registry_source field always populated and refers to a real on-disk path (codex)', () => {
  const root = makeFixtureRoot({ agentsMd: STD_AGENTS });
  const r = validateTargetCommandCompat({
    target: 'codex', command: '/orchestrate-loop', projectRoot: root
  });
  assert.equal(r.allowed, true);
  assert.ok(r.registry_source && r.registry_source.length > 0);
  assert.ok(fs.existsSync(r.registry_source), `registry_source should be on-disk: ${r.registry_source}`);
});

test('h) managed-command actor with command="freeform" REJECTED', () => {
  const root = makeFixtureRoot({ agentsMd: STD_AGENTS, claudeCommands: ['orchestrate-loop'] });
  const rClaude = validateTargetCommandCompat({
    target: 'claude', command: 'freeform', projectRoot: root
  });
  assert.equal(rClaude.allowed, false);
  assert.match(rClaude.reason, /managed-command actor/);

  const rCodex = validateTargetCommandCompat({
    target: 'codex', command: 'freeform', projectRoot: root
  });
  assert.equal(rCodex.allowed, false);
  assert.match(rCodex.reason, /managed-command actor/);
});

test('i) target=opencode falls back to .claude/commands/ when .opencode/commands/ missing', () => {
  const root = makeFixtureRoot({ claudeCommands: ['orchestrate-loop'] });
  const r = validateTargetCommandCompat({
    target: 'opencode', command: '/orchestrate-loop', projectRoot: root
  });
  assert.equal(r.allowed, true, r.reason);
});

test('j) unknown target REJECTED with registered-list reason', () => {
  const root = makeFixtureRoot({});
  const r = validateTargetCommandCompat({
    target: 'mistral', command: '/orchestrate-loop', projectRoot: root
  });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /not registered/);
});

test('k) syntactically invalid command for managed-command actor REJECTED', () => {
  const root = makeFixtureRoot({ agentsMd: STD_AGENTS });
  const r = validateTargetCommandCompat({
    target: 'codex', command: 'not-a-slash-command', projectRoot: root
  });
  assert.equal(r.allowed, false);
});

test('l) target=openrouter-z-ai/glm-5.2 command=freeform ALLOWED (dynamic model target)', () => {
  const root = makeFixtureRoot({});
  const r = validateTargetCommandCompat({
    target: 'openrouter-z-ai/glm-5.2', command: 'freeform', projectRoot: root
  });
  assert.equal(r.allowed, true, r.reason);
  assert.match(r.registry_source, /FREEFORM_PROMPT_TARGETS/);
});

// CLI-level integration tests (Codex iter1 lessons-learned: policy-unit alone
// was insufficient; the lower runner enforces additional rules. These tests
// invoke tools/signals/dispatch-bridge.js as a subprocess to assert that the
// runner-policy contract is internally consistent.)
const { spawnSync } = require('child_process');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function runDispatchBridgeCli(args) {
  return spawnSync('node', ['tools/signals/dispatch-bridge.js', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
}

test('CLI: target=codex command=/convene exits zero and writes origin-aware signal', () => {
  const before = fs.existsSync(path.join(REPO_ROOT, '_dev/reports/signals'))
    ? fs.readdirSync(path.join(REPO_ROOT, '_dev/reports/signals'))
    : [];
  const out = runDispatchBridgeCli(['--target', 'codex', '--command', '/convene', '--task', 'cli-smoke', '--scope', 'cli-smoke-codex-convene']);
  assert.equal(out.status, 0, `expected exit 0; stderr: ${out.stderr}`);
  const after = fs.existsSync(path.join(REPO_ROOT, '_dev/reports/signals'))
    ? fs.readdirSync(path.join(REPO_ROOT, '_dev/reports/signals'))
    : [];
  const newSignals = after.filter((n) => n.includes('cli-smoke-codex-convene'));
  assert.equal(newSignals.length, 1, `one signal should be written; found: ${newSignals.join(', ')}`);
  const prompt = fs.readFileSync(path.join(REPO_ROOT, '_dev/reports/analysis/dispatch-bridge-prompt__cli-smoke-codex-convene.md'), 'utf8');
  assert.match(prompt, /--origin codex/);
});

test('CLI: target=claude command=/convene exits zero and writes origin-aware signal', () => {
  const out = runDispatchBridgeCli(['--target', 'claude', '--command', '/convene', '--task', 'cli-smoke', '--scope', 'cli-smoke-claude-convene']);
  assert.equal(out.status, 0, `expected exit 0; stderr: ${out.stderr}`);
  const prompt = fs.readFileSync(path.join(REPO_ROOT, '_dev/reports/analysis/dispatch-bridge-prompt__cli-smoke-claude-convene.md'), 'utf8');
  assert.match(prompt, /--origin claude/);
});

test('CLI: target=gemini command=freeform exits 0 and writes a signal', () => {
  const out = runDispatchBridgeCli(['--target', 'gemini', '--command', 'freeform', '--task', 'cli-smoke for gemini freeform path', '--scope', 'cli-smoke-gemini-freeform']);
  assert.equal(out.status, 0, `expected exit 0, got ${out.status}; stderr: ${out.stderr}`);
});

test('CLI: target=gemini with omitted --command exits 0 and writes a signal', () => {
  const out = runDispatchBridgeCli(['--target', 'gemini', '--task', 'cli-smoke for gemini omitted-command path', '--scope', 'cli-smoke-gemini-omitted']);
  assert.equal(out.status, 0, `expected exit 0, got ${out.status}; stderr: ${out.stderr}`);
});

test('CLI: target=openrouter-z-ai/glm-5.2 correctly dispatches and preserves model', () => {
  // 1. Create the dispatch-bridge signal (without running it immediately)
  const out = runDispatchBridgeCli(['--target', 'openrouter-z-ai/glm-5.2', '--command', 'freeform', '--task', 'cli-smoke for dynamic openrouter model', '--scope', 'cli-smoke-openrouter-dynamic']);
  assert.equal(out.status, 0, `expected exit 0; stderr: ${out.stderr}`);

  // 2. Locate the generated signal file
  const signalDir = path.join(REPO_ROOT, '_dev/reports/signals');
  const files = fs.readdirSync(signalDir);
  const signalFile = files.find((f) => f.includes('cli-smoke-openrouter-dynamic') && f.endsWith('.json'));
  assert.ok(signalFile, 'Signal file should be generated');

  // 3. Run the openrouter bridge directly in dry-run mode to verify the model argument is preserved and resolved
  const runCmd = spawnSync('node', ['tools/signals/run-openrouter-bridge.js', '--file', signalFile, '--model', 'z-ai/glm-5.2', '--dry-run'], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  assert.equal(runCmd.status, 0, `expected run-openrouter-bridge to exit 0; stderr: ${runCmd.stderr}`);
  assert.match(runCmd.stdout || '', /Model:\s+z-ai\/glm-5.2/);
});
