#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
  addCheck,
  createSignal,
  printJsonOutput,
  printSummary,
  writeSignal
} = require('./lib/signal.cjs');
const { detectInstalledActors } = require('../signals/lib/actor-registry');

const projectRoot = path.resolve(__dirname, '../..');
const signal = createSignal('verify-harnesses', 'harness-parity');

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function parseJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
  } catch {
    return null;
  }
}

const generatedManifest = parseJson('instructions/generated/manifest.json');
const outputs = Array.isArray(generatedManifest && generatedManifest.files)
  ? generatedManifest.files
  : [];
const outputTargets = new Set(outputs.map((output) => output.harness));

const checks = [
  ['harness.claude_root', 'CLAUDE.md exists', 'CLAUDE.md'],
  ['harness.codex_root', 'AGENTS.md exists', 'AGENTS.md'],
  ['harness.opencode_root', 'OPENCODE.md exists', 'OPENCODE.md'],
  ['harness.cursor_root', '.cursorrules exists', '.cursorrules'],
  ['harness.opencode_rules_dir', '.opencode/rules exists', '.opencode/rules']
];

for (const [id, message, relativePath] of checks) {
  addCheck(signal, {
    id,
    category: 'harnesses',
    severity: 'warning',
    message,
    test: () => exists(relativePath),
    detail: relativePath,
    fix_hint: `Create or regenerate ${relativePath}`
  });
}

for (const target of ['claude', 'codex', 'cursor', 'opencode']) {
  addCheck(signal, {
    id: `harness.manifest_${target}`,
    category: 'harnesses',
    severity: 'warning',
    message: `Generated manifest tracks ${target} output`,
    test: () => outputTargets.has(target),
    detail: outputTargets.has(target) ? `${target} present in instructions/generated/manifest.json` : `${target} missing from generated manifest`,
    fix_hint: `Regenerate instructions so ${target} output is tracked in instructions/generated/manifest.json`
  });
}

const runtimes = detectInstalledActors(['codex', 'claude', 'opencode', 'cursor']);
for (const actorId of ['codex', 'claude', 'opencode']) {
  addCheck(signal, {
    id: `harness.runtime_${actorId}`,
    category: 'runtime',
    severity: 'warning',
    message: `${actorId} runtime is installed on this machine`,
    test: () => Boolean(runtimes[actorId] && runtimes[actorId].installed),
    detail: runtimes[actorId] && runtimes[actorId].binary_path
      ? runtimes[actorId].binary_path
      : `${actorId} not found in PATH`,
    fix_hint: `Install ${actorId} or keep it out of the runtime bridge rotation`
  });
}

addCheck(signal, {
  id: 'harness.runtime_cursor_verification_only',
  category: 'runtime',
  severity: 'warning',
  message: 'Cursor is tracked as verification-only when no local CLI exists',
  test: () => Boolean(runtimes.cursor && runtimes.cursor.available === false),
  detail: runtimes.cursor && runtimes.cursor.installed
    ? runtimes.cursor.binary_path
    : 'cursor CLI not found; verification-only mode expected',
  fix_hint: 'If Cursor gets a stable CLI later, update the runtime registry'
});

const outputPath = path.join(projectRoot, '_dev', 'reports', 'signals', 'verify-harnesses.signal.json');
if (!printJsonOutput(signal)) {
  writeSignal(signal, outputPath);
  printSummary(signal);
  console.log(`\nSignal: ${outputPath}`);
}

process.exit(signal.gate_decision.proceed ? 0 : 1);
