#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..', '..');
const PRETOOL = path.join(ROOT, 'tools/kernel/hooks/dispatch-pretool.cjs');
const POSTTOOL = path.join(ROOT, 'tools/kernel/hooks/dispatch-posttool.cjs');

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (err) {
    fail += 1;
    console.error(`FAIL ${name}`);
    console.error(err.stack || err.message);
  }
}

function run(script, payload, extraEnv = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: ROOT,
    input: JSON.stringify(payload || {}),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: ROOT,
      CLAUDE_TOOL_NAME: payload.tool_name || '',
      CLAUDE_TOOL_INPUT: JSON.stringify(payload.tool_input || {}),
      ...extraEnv
    }
  });
}

check('dispatch-pretool emits dangerous command notice', () => {
  const res = run(PRETOOL, {
    session_id: 'dispatch-test-danger',
    tool_name: 'Bash',
    tool_input: { command: 'git push origin main --force' }
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Dangerous command detected/);
  assert.match(res.stdout, /git push --force/);
});

check('dispatch-pretool emits debrief reminder only once per session', () => {
  const sessionId = `dispatch-test-debrief-${Date.now()}`;
  const payload = {
    session_id: sessionId,
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m test' }
  };
  const first = run(PRETOOL, payload);
  const second = run(PRETOOL, payload);
  assert.equal(first.status, 0);
  assert.equal(second.status, 0);
  assert.match(first.stdout, /Have you debriefed this work/);
  assert.doesNotMatch(second.stdout, /Have you debriefed this work/);
});

check('dispatch-pretool propagates protected governance write block', () => {
  const receiptsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-receipts-empty-'));
  const res = run(PRETOOL, {
    session_id: 'dispatch-test-block',
    tool_name: 'Write',
    tool_input: { file_path: '.claude/settings.json', content: '{}' }
  }, {
    MYTHOS_CONVENE_RECEIPTS_DIR: receiptsDir
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /requires a live ConveneReceipt/);
  fs.rmSync(receiptsDir, { recursive: true, force: true });
});

check('dispatch-pretool allows protected governance write with matching receipt', () => {
  const receiptsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-receipts-live-'));
  fs.writeFileSync(path.join(receiptsDir, 'settings.json'), JSON.stringify({
    schema: 'ConveneReceipt/1.0',
    verdict: 'approved',
    authorized_paths: ['.claude/settings.json'],
    expires: new Date(Date.now() + 60_000).toISOString(),
    operator_ratified: true
  }));
  const res = run(PRETOOL, {
    session_id: 'dispatch-test-allow',
    tool_name: 'Write',
    tool_input: { file_path: '.claude/settings.json', content: '{}' }
  }, {
    MYTHOS_CONVENE_RECEIPTS_DIR: receiptsDir
  });
  assert.equal(res.status, 0);
  assert.doesNotMatch(res.stderr, /requires a live ConveneReceipt/);
  fs.rmSync(receiptsDir, { recursive: true, force: true });
});

check('dispatch-posttool Write payload exits cleanly after arc transition hook', () => {
  const sessionId = `dispatch-test-posttool-write-${Date.now()}`;
  const res = run(POSTTOOL, {
    session_id: sessionId,
    tool_name: 'Write',
    tool_input: {
      file_path: path.join(ROOT, '_dev', 'reports', 'analysis', 'dispatch-posttool-test.md')
    }
  }, {
    CLAUDE_SESSION_ID: sessionId
  });
  assert.equal(res.status, 0);
  assert.doesNotMatch(`${res.stdout}\n${res.stderr}`, /main is not a function/);
});

console.log(`\ndispatch compat: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
