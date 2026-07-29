'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../../../');
const SCRIPT = path.join(ROOT, 'tools/signals/follow-signal.js');

// Helper to create a dummy project root for testing
function setupTestProject(id) {
  const testRoot = path.join(ROOT, '_dev/tmp/test-follow-signal-cli-' + id);
  if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
  fs.mkdirSync(testRoot, { recursive: true });
  fs.mkdirSync(path.join(testRoot, '_dev/reports/signals'), { recursive: true });
  fs.mkdirSync(path.join(testRoot, '_dev/reports/analysis/task-plans'), { recursive: true });
  return testRoot;
}

test('follow-signal CLI: writes decision artifacts', (t) => {
  const projectRoot = setupTestProject('artifacts');
  const signal = {
    schema: 'HandoffSignal/1.0',
    signal_type: 'ready-for-review',
    lifecycle_state: 'live',
    source: 'test',
    scope: 'test-scope',
    timestamp: new Date().toISOString(),
    recommended_next_actor: 'claude',
    recommended_next_command: '/test-command',
    next_step_detail: ['Step 1'],
    artifacts: [],
    decision_context_artifacts: [],
    blocked_by: []
  };
  fs.writeFileSync(path.join(projectRoot, '_dev/reports/signals/test.json'), JSON.stringify(signal));

  const result = spawnSync('node', [SCRIPT, 'test-scope', '--project-root', projectRoot], { 
    encoding: 'utf8',
    cwd: ROOT
  });
  
  if (result.status !== 0) {
    console.error('STDOUT:', result.stdout);
    console.error('STDERR:', result.stderr);
  }
  
  assert.strictEqual(result.status, 0);
  const analysisDir = path.join(projectRoot, '_dev/reports/analysis');
  const files = fs.readdirSync(analysisDir);
  assert.ok(files.some(f => f.startsWith('follow-signal__') && f.endsWith('.json')));
  assert.ok(files.some(f => f.startsWith('follow-signal__') && f.endsWith('.md')));
});

test('follow-signal CLI: returns non-zero for blocked', (t) => {
  const projectRoot = setupTestProject('blocked');
  // No signal exists
  const result = spawnSync('node', [SCRIPT, 'missing-scope', '--project-root', projectRoot], { 
    encoding: 'utf8',
    cwd: ROOT
  });
  assert.strictEqual(result.status, 2);
});

test('follow-signal CLI: executes command when --execute is passed', (t) => {
  const projectRoot = setupTestProject('execute');
  
  // Create a dummy package.json with a test script
  const pkg = {
    name: 'test-project',
    scripts: {
      'test-command': 'echo "HELLO WORLD"'
    }
  };
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify(pkg));

  const signal = {
    schema: 'HandoffSignal/1.0',
    signal_type: 'ready-for-review',
    lifecycle_state: 'live',
    source: 'test',
    scope: 'test-scope',
    timestamp: new Date().toISOString(),
    recommended_next_actor: 'claude',
    recommended_next_command: '/test-command',
    next_step_detail: ['Step 1'],
    artifacts: [],
    decision_context_artifacts: [],
    blocked_by: []
  };
  fs.writeFileSync(path.join(projectRoot, '_dev/reports/signals/test.json'), JSON.stringify(signal));

  const result = spawnSync('node', [SCRIPT, 'test-scope', '--execute', '--project-root', projectRoot], { 
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, PATH: process.env.PATH }
  });
  
  if (result.status !== 0) {
    console.error('STDOUT:', result.stdout);
    console.error('STDERR:', result.stderr);
  }

  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /Executing: npm run test-command/);
  assert.match(result.stdout, /HELLO WORLD/);
});
