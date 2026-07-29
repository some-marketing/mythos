'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizedContentHash, sha256, stableJson } = require('../lib/normalized-content-hash.cjs');
const { resolveContainedPath } = require('../lib/evidence-binding.cjs');
const { reconcileGeneratedSurface } = require('../../maintenance/lib/generated-surface-reconciler.cjs');

test('equivalent JSON formatting shares normalized identity', () => {
  assert.equal(normalizedContentHash('{"b":2,"a":1}', { format: 'json' }).sha256, normalizedContentHash('{\n "a":1, "b":2\n}', { format: 'json' }).sha256);
});

test('opaque byte differences never claim semantic equivalence', () => {
  assert.notEqual(normalizedContentHash(Buffer.from('a')).sha256, normalizedContentHash(Buffer.from('A')).sha256);
});

test('cycles and non-JSON values are rejected without recursion', () => {
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => stableJson(cyclic), /cyclic_value_unsupported/);
  assert.equal(normalizedContentHash(cyclic, { format: 'json' }).state, 'unsupported');
});

test('undefined optional object fields are omitted deterministically', () => {
  assert.equal(stableJson({ a: 1, optional: undefined }), stableJson({ a: 1 }));
});

test('contained-path resolver rejects traversal and symlink escape before reads', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-reconcile-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-reconcile-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'escape.txt'));
  assert.equal(resolveContainedPath(root, '../outside').state, 'out_of_bounds');
  assert.equal(resolveContainedPath(root, 'escape.txt').state, 'out_of_bounds');
});

test('generated reconciler separates clean, source, generator, and output drift without writing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-generated-'));
  for (const [name, value] of [['source.json', '{}'], ['generator.js', 'code'], ['output.md', 'out']]) fs.writeFileSync(path.join(root, name), value);
  const binding = { source_sha256: sha256('{}'), generator_sha256: sha256('code'), output_sha256: sha256('out') };
  const input = { project_root: root, source_path: 'source.json', generator_path: 'generator.js', output_path: 'output.md', generation_binding: binding };
  assert.equal(reconcileGeneratedSurface(input).state, 'clean');
  fs.writeFileSync(path.join(root, 'output.md'), 'edited');
  assert.equal(reconcileGeneratedSurface(input).state, 'byte_drift');
  fs.writeFileSync(path.join(root, 'output.md'), 'out'); fs.writeFileSync(path.join(root, 'source.json'), '{"x":1}');
  assert.equal(reconcileGeneratedSurface(input).state, 'stale_input');
  fs.writeFileSync(path.join(root, 'source.json'), '{}'); fs.writeFileSync(path.join(root, 'generator.js'), 'new code');
  assert.equal(reconcileGeneratedSurface(input).state, 'generator_version_drift');
});

test('same bytes with different mtime remains clean and out-of-bounds stays unclassified', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-generated-mtime-'));
  for (const [name, value] of [['s', 's'], ['g', 'g'], ['o', 'o']]) fs.writeFileSync(path.join(root, name), value);
  const input = { project_root: root, source_path: 's', generator_path: 'g', output_path: 'o', generation_binding: { source_sha256: sha256('s'), generator_sha256: sha256('g'), output_sha256: sha256('o') } };
  fs.utimesSync(path.join(root, 'o'), new Date(1), new Date(2));
  assert.equal(reconcileGeneratedSurface(input).state, 'clean');
  assert.equal(reconcileGeneratedSurface({ ...input, output_path: '../escape' }).state, 'unclassified');
});
