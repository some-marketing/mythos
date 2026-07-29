#!/usr/bin/env node
'use strict';

/**
 * Tests for manifest-schema-sweep.cjs
 * Stdlib only. Self-tallying check() runner.
 *
 * Covers:
 *  - clean synthetic tree: all findings ok, exit 0
 *  - bad manifest (missing keys) and broken manifest (invalid JSON) -> fail
 *  - bad command YAML (tab indentation) -> fail
 *  - broken workspace JSON (.mcp.json) -> fail; exit 1 via spawn with --root
 *  - checkYamlWellFormed unit cases
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TOOL = path.resolve(__dirname, '..', 'manifest-schema-sweep.cjs');
const { sweep, checkYamlWellFormed, REQUIRED_MANIFEST_KEYS } = require('../manifest-schema-sweep.cjs');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (err) { fail++; console.error(`FAIL  ${name}`); console.error(err.stack || err.message); }
}

function mk(root, rel, body) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

function goodManifest(overrides = {}) {
  const base = {
    service_category: 'wordpress',
    framework_name: 'qa',
    version: '1.0.0',
    prompt_count: 0,
    execution_modes: []
  };
  return JSON.stringify({ ...base, ...overrides });
}

function cleanFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'msweep-'));
  mk(root, 'frameworks/wordpress/qa/manifest.json', goodManifest());
  mk(root, 'instructions/canonical/commands/route.yaml', 'command: route\nsteps:\n  - one\n  - two\n');
  mk(root, '.mcp.json', JSON.stringify({ mcpServers: {} }));
  mk(root, 'package.json', JSON.stringify({ name: 'x' }));
  return root;
}

// ── clean tree ──────────────────────────────────────────────────────────────
check('clean fixture: all ok, no failures', () => {
  const root = cleanFixture();
  try {
    const findings = sweep(root);
    assert.ok(findings.length >= 4);
    assert.strictEqual(findings.filter((f) => f.status === 'fail').length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ── bad manifest ─────────────────────────────────────────────────────────────
check('manifest missing required keys -> fail', () => {
  const root = cleanFixture();
  try {
    mk(root, 'frameworks/paid-media/adcreative/manifest.json', JSON.stringify({ framework_name: 'adcreative' }));
    const findings = sweep(root);
    const bad = findings.find((f) => f.file.includes('adcreative'));
    assert.strictEqual(bad.status, 'fail');
    assert.ok(/missing required keys/.test(bad.detail));
    for (const k of REQUIRED_MANIFEST_KEYS) {
      if (k !== 'framework_name') assert.ok(bad.detail.includes(k), `should name missing key ${k}`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

check('manifest invalid JSON -> fail', () => {
  const root = cleanFixture();
  try {
    mk(root, 'frameworks/x/broken/manifest.json', '{ not valid json ');
    const findings = sweep(root);
    const bad = findings.find((f) => f.file.includes('broken'));
    assert.strictEqual(bad.status, 'fail');
    assert.ok(/invalid JSON/.test(bad.detail));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ── bad YAML ─────────────────────────────────────────────────────────────────
check('command YAML with tab indentation -> fail', () => {
  const root = cleanFixture();
  try {
    mk(root, 'instructions/canonical/commands/tabbed.yaml', 'command: x\nsteps:\n\t- bad\n');
    const findings = sweep(root);
    const bad = findings.find((f) => f.file.includes('tabbed'));
    assert.strictEqual(bad.status, 'fail');
    assert.ok(/tab/.test(bad.detail));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ── broken workspace JSON + exit code via spawn ──────────────────────────────
check('broken .mcp.json -> fail and tool exits 1', () => {
  const root = cleanFixture();
  try {
    fs.writeFileSync(path.join(root, '.mcp.json'), '{ broken ');
    const findings = sweep(root);
    const bad = findings.find((f) => f.file === '.mcp.json');
    assert.strictEqual(bad.status, 'fail');

    const r = spawnSync('node', [TOOL, '--root', root, '--json'], { encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(r.status, 1, 'a parse failure must exit 1');
    const out = JSON.parse(r.stdout);
    assert.ok(out.failures >= 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

check('clean fixture exits 0 via spawn', () => {
  const root = cleanFixture();
  try {
    const r = spawnSync('node', [TOOL, '--root', root], { encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(/No drift detected/.test(r.stdout));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ── YAML well-formedness unit cases ──────────────────────────────────────────
check('checkYamlWellFormed accepts a normal mapping', () => {
  assert.strictEqual(checkYamlWellFormed('a: 1\nb:\n  - x\n').ok, true);
});
check('checkYamlWellFormed rejects tab indentation', () => {
  assert.strictEqual(checkYamlWellFormed('a: 1\n\t- x\n').ok, false);
});
check('checkYamlWellFormed does not false-positive on apostrophes in scalars', () => {
  assert.strictEqual(checkYamlWellFormed("description: Author the client's brief\n").ok, true);
});
check('checkYamlWellFormed rejects an empty file', () => {
  assert.strictEqual(checkYamlWellFormed('\n\n').ok, false);
});

console.log(`\nmanifest-schema-sweep: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
