'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runMythosCommand, HANDLERS } = require('../mythos-command-runner.cjs');

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function makeProject(commandIds) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-command-runner-'));
  for (const id of commandIds) {
    writeJson(path.join(root, 'instructions', 'canonical', 'commands', id + '.yaml'), { id });
  }
  return root;
}

describe('mythos-command-runner', () => {
  it('registers exactly the ported handlers', () => {
    assert.deepEqual(
      Object.keys(HANDLERS).sort(),
      ['concept-promote', 'debrief-run', 'review-task-plan', 'route'].sort()
    );
  });

  it('reports a clear stubbed-handler error for a canonical command with no handler', () => {
    const root = makeProject(['plan-task']);
    const result = runMythosCommand(root, '/plan-task "do the thing"');
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /canonical but has no deterministic executable handler in this runner yet/);
  });

  it('reports unknown command for a non-canonical id', () => {
    const root = makeProject([]);
    const result = runMythosCommand(root, '/not-a-real-command');
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Unknown command/);
  });

  it('routes /concept-promote through the ported handler (dry-run approval-required path)', () => {
    const root = makeProject(['concept-promote']);
    writeJson(path.join(root, '_dev', 'concepts', 'demo-concept', 'concept.md'), null);
    fs.writeFileSync(path.join(root, '_dev', 'concepts', 'demo-concept', 'concept.md'), '# Demo\n');
    writeJson(path.join(root, '_dev', 'concepts', 'demo-concept', 'status.json'), { slug: 'demo-concept', stage: 'draft' });

    const result = runMythosCommand(root, '/concept-promote demo-concept --to-policy');
    assert.equal(result.exitCode, 2);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 'approval_required');
  });

  it('routes /debrief-run through the ported handler and requires an explicit scope', () => {
    const root = makeProject(['debrief-run']);
    const result = runMythosCommand(root, '/debrief-run');
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /requires an explicit scope/);
  });

  it('routes /route through the ported handler as advisory-only', () => {
    const root = makeProject(['route', 'remember']);
    writeJson(path.join(root, 'instructions', 'canonical', 'command-aliases.yaml'), { schema: 'test', aliases: [] });
    const result = runMythosCommand(root, '/route remember this');
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.mode, 'advisory');
    assert.equal(payload.executed, false);
    assert.equal(payload.route.command, '/remember');
  });

  it('routes /review-task-plan through the ported handler for a missing plan', () => {
    const root = makeProject(['review-task-plan']);
    const result = runMythosCommand(root, '/review-task-plan does-not-exist');
    assert.equal(result.exitCode, 1);
  });
});
