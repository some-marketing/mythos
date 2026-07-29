'use strict';

// Coverage fixture for the paste-target-prompt validator surfaces.
//
// Two cases exercise the existing validator wiring (no source edits in
// scope; this fixture is durable regression protection for the parent
// slice fbe6cee1):
//
//   Case A — bridge writer: drives writeBridgePrompt() (exported from
//     tools/signals/lib/codex-bridge.js) with extraction-prose body
//     targeting a paste-target path. writeBridgePrompt calls
//     process.exit(1) on validator refusal, so the assertion runs in a
//     spawned child Node process and inspects stderr + exit code.
//
//   Case B — Codex emulator hook relay: drives runCodexHook from
//     tools/codex/lib/hook-emulation.js with a synthetic post-write
//     event whose file_path matches isPromptTargetPath. Asserts that
//     the captured stdout names the validator (advisory output from
//     tools/verify/hooks/post-write-paste-target.cjs).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function uniqueSuffix() {
  return `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

// Use a path inside the repo that matches isPromptTargetPath INCLUDE_GLOBS.
// Avoid _dev/prompts/ per amendment guard. The pattern
// `_dev/reports/analysis/*-bridge-prompt__*.md` is in INCLUDE_GLOBS.
function makePasteTargetPath(label) {
  const name = `__coverage-fixture-${label}-${uniqueSuffix()}-bridge-prompt__test.md`;
  return path.join(REPO_ROOT, '_dev', 'reports', 'analysis', name);
}

function safeRm(p) {
  try {
    fs.rmSync(p, { force: true });
  } catch {
    // best-effort
  }
}

// ─── Case A — bridge writer rejects extraction-prose body ───────────────

test('writeBridgePrompt refuses to write extraction-prose body to paste-target path', () => {
  const tmpPath = makePasteTargetPath('case-a');
  const badContent = [
    'Copy the prompt below and paste it into the reviewer model.',
    '',
    '```',
    'reviewer body',
    '```',
    ''
  ].join('\n');

  // Run in a child Node process because writeBridgePrompt calls
  // process.exit(1) on validator refusal.
  const driverScript = `
    'use strict';
    const path = require(${JSON.stringify('path')});
    const { writeBridgePrompt } = require(${JSON.stringify(
      path.join(REPO_ROOT, 'tools', 'signals', 'lib', 'codex-bridge.js')
    )});
    writeBridgePrompt(${JSON.stringify(tmpPath)}, ${JSON.stringify(badContent)});
  `;

  let result;
  try {
    result = spawnSync(process.execPath, ['-e', driverScript], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    assert.notStrictEqual(
      result.status,
      0,
      `expected non-zero exit when writing prose-prefaced content to a paste-target path; stdout=${result.stdout} stderr=${result.stderr}`
    );

    const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
    assert.match(
      combined,
      /paste-target-prompt validator/i,
      'expected validator banner in writer output'
    );
    assert.match(
      combined,
      /REFUSING TO WRITE/,
      'expected explicit refusal in writer output'
    );
    assert.match(
      combined,
      /RULE-[1-4]/,
      'expected at least one rule_id (RULE-1..RULE-4) in writer output'
    );

    assert.strictEqual(
      fs.existsSync(tmpPath),
      false,
      'writeBridgePrompt must not create the file when validator refuses'
    );
  } finally {
    safeRm(tmpPath);
  }
});

// ─── Case B — Codex emulator post-write relay ──────────────────────────

test('runCodexHook post-write relay names paste-target validator on bad content', () => {
  const tmpPath = makePasteTargetPath('case-b');
  const badContent = [
    '# Rationale — why this prompt',
    '',
    'This file explains a prompt instead of being one.',
    ''
  ].join('\n');

  try {
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, badContent);

    const { runCodexHook } = require(path.join(
      REPO_ROOT,
      'tools',
      'codex',
      'lib',
      'hook-emulation.js'
    ));

    const result = runCodexHook({
      event: 'post-write',
      filePath: tmpPath,
      cwd: REPO_ROOT,
      projectRoot: REPO_ROOT
    });

    assert.ok(result, 'runCodexHook must return a result object');
    assert.strictEqual(
      typeof result.stdout,
      'string',
      'runCodexHook result.stdout must be a string'
    );

    assert.match(
      result.stdout,
      /paste-target-prompt validator/i,
      `expected paste-target-prompt validator advisory in stdout; got: ${result.stdout}`
    );
    assert.match(
      result.stdout,
      /RULE-[1-4]/,
      `expected a rule_id (RULE-1..RULE-4) in stdout; got: ${result.stdout}`
    );
  } finally {
    safeRm(tmpPath);
  }
});
