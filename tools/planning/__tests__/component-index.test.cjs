'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildComponentIndex } = require('../component-index.cjs');

test('component index includes bounded system discovery surfaces', () => {
  const index = buildComponentIndex();
  const hasKind = (kind, predicate = () => true) =>
    index.nodes.some((node) => node.kind === kind && predicate(node));

  assert.equal(index.schema, 'ComponentIndex/1.0');
  assert.ok(hasKind('prompt', (node) => node.framework_id !== 'system'));
  assert.ok(hasKind('system_tool', (node) => node.path.startsWith('tools/')));
  assert.ok(hasKind('system_command', (node) => node.name === 'new-project'));
  assert.ok(hasKind('system_skill', (node) => node.path.endsWith('/SKILL.md')));
  assert.ok(hasKind('reusable_code', (node) => node.path.startsWith('tools/')));
  assert.ok(hasKind('task_plan', (node) =>
    node.name === 'system-smos-functionality-gaps-from-cc-transcript'));

  for (const node of index.nodes.filter((n) => n.framework_id === 'system')) {
    assert.equal(node.lineage.authority, 'retrieval_context_only');
  }
});

test('component index output is deterministic for unchanged sources', () => {
  assert.deepEqual(buildComponentIndex(), buildComponentIndex());
});
