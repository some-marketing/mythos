'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildContinuityIndex,
  writeContinuityIndex
} = require('../continuity-index.cjs');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'continuity-index-test-'));
}

function write(filePath, body) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, 'utf8');
}

test('buildContinuityIndex includes active and archived handoffs', () => {
  const root = tmpRoot();
  write(path.join(root, '_dev/reports/analysis/next-session-handoff.md'), [
    '# NEXT SESSION HANDOFF',
    '',
    '> Scope: system / active',
    '> Date: 2026-06-22',
    '',
    '## COMPLETED THIS SESSION',
    'Active work completed.',
    '',
    '## BLOCKED',
    'Nothing blocked.',
    '',
    '## READY TO EXECUTE',
    'Run the active command.',
    '',
    '## RECOMMENDED NEXT COMMAND',
    '```',
    '/whats-next',
    '```',
    ''
  ].join('\n'));
  write(path.join(root, '_dev/reports/analysis/next-session-archive/20260622T000000Z__handoff.md'), [
    '# NEXT SESSION HANDOFF',
    '',
    '> Scope: system / archived',
    '> Date: 2026-06-21',
    '',
    '## COMPLETED THIS SESSION',
    'Archived work completed.',
    '',
    '## RECOMMENDED NEXT COMMAND',
    '/resume-archived-work',
    ''
  ].join('\n'));

  const index = buildContinuityIndex(root);
  assert.equal(index.schema, 'NextSessionContinuityIndex/1.0');
  assert.equal(index.entry_count, 2);
  assert.equal(index.entries[0].kind, 'active');
  assert.equal(index.entries[0].recommended_next_command, '/whats-next');
  assert.equal(index.entries[1].kind, 'archived');
  assert.equal(index.entries[1].recommended_next_command, '/resume-archived-work');
});

test('buildContinuityIndex includes canonical client handoffs and archives', () => {
  const root = tmpRoot();
  write(path.join(root, '_dev/reports/analysis/next-session-handoff.md'), [
    '# NEXT SESSION HANDOFF',
    '',
    '## RECOMMENDED NEXT COMMAND',
    '/whats-next',
    ''
  ].join('\n'));
  write(path.join(root, 'clients/{CLIENT_CODE}/next-session-handoff.md'), [
    '# NEXT SESSION HANDOFF',
    '',
    '> Scope: client {CLIENT_CODE}',
    '',
    '## RECOMMENDED NEXT COMMAND',
    '```text',
    '/triage-client-board {CLIENT_CODE}',
    '```',
    ''
  ].join('\n'));
  write(path.join(root, 'clients/{CLIENT_CODE}/plans/archive/20260622T000000Z__handoff.md'), [
    '# NEXT SESSION HANDOFF',
    '',
    '## RECOMMENDED NEXT COMMAND',
    '`/project-status {CLIENT_CODE}`',
    ''
  ].join('\n'));

  const index = buildContinuityIndex(root);
  const clientActive = index.entries.find((entry) => entry.kind === 'active-client');
  const clientArchive = index.entries.find((entry) => entry.kind === 'archived-client');
  assert.equal(clientActive.client_code, '{CLIENT_CODE}');
  assert.equal(clientActive.recommended_next_command, '/triage-client-board {CLIENT_CODE}');
  assert.equal(clientArchive.recommended_next_command, '/project-status {CLIENT_CODE}');
});

test('archived handoffs sort chronologically across system and client scopes', () => {
  const root = tmpRoot();
  write(path.join(root, '_dev/reports/analysis/next-session-handoff.md'), [
    '# NEXT SESSION HANDOFF',
    '',
    '## RECOMMENDED NEXT COMMAND',
    '/whats-next',
    ''
  ].join('\n'));
  const oldSystemArchive = path.join(root, '_dev/reports/analysis/next-session-archive/20260601T000000Z__handoff.md');
  const newClientArchive = path.join(root, 'clients/{CLIENT_CODE}/plans/archive/20260622T000000Z__handoff.md');
  write(oldSystemArchive, [
    '# NEXT SESSION HANDOFF',
    '',
    '## RECOMMENDED NEXT COMMAND',
    '/old-system',
    ''
  ].join('\n'));
  write(newClientArchive, [
    '# NEXT SESSION HANDOFF',
    '',
    '## RECOMMENDED NEXT COMMAND',
    '/new-client',
    ''
  ].join('\n'));
  fs.utimesSync(oldSystemArchive, new Date('2026-06-01T00:00:00Z'), new Date('2026-06-01T00:00:00Z'));
  fs.utimesSync(newClientArchive, new Date('2026-06-22T00:00:00Z'), new Date('2026-06-22T00:00:00Z'));

  const index = buildContinuityIndex(root);
  const archived = index.entries.filter((entry) => entry.kind === 'archived' || entry.kind === 'archived-client');
  assert.equal(archived[0].kind, 'archived-client');
  assert.equal(archived[0].recommended_next_command, '/new-client');
  assert.equal(archived[1].kind, 'archived');
  assert.equal(archived[1].recommended_next_command, '/old-system');
});

test('buildContinuityIndex does not silently limit entries by default', () => {
  const root = tmpRoot();
  write(path.join(root, '_dev/reports/analysis/next-session-handoff.md'), [
    '# NEXT SESSION HANDOFF',
    '',
    '## RECOMMENDED NEXT COMMAND',
    '/whats-next',
    ''
  ].join('\n'));
  for (let i = 0; i < 55; i += 1) {
    write(path.join(root, `_dev/reports/analysis/next-session-archive/20260622T${String(i).padStart(6, '0')}Z__handoff.md`), [
      '# NEXT SESSION HANDOFF',
      '',
      '## RECOMMENDED NEXT COMMAND',
      `/archived-${i}`,
      ''
    ].join('\n'));
  }
  const index = buildContinuityIndex(root);
  assert.equal(index.entry_count, 56);
  assert.equal(index.omitted_count, 0);
});

test('writeContinuityIndex writes markdown and json outputs', () => {
  const root = tmpRoot();
  write(path.join(root, '_dev/reports/analysis/next-session-handoff.md'), [
    '# NEXT SESSION HANDOFF',
    '',
    '> Scope: system',
    '',
    '## RECOMMENDED NEXT COMMAND',
    '/whats-next',
    ''
  ].join('\n'));
  const result = writeContinuityIndex(root);
  assert.ok(fs.existsSync(path.join(root, result.paths.json)));
  assert.ok(fs.existsSync(path.join(root, result.paths.markdown)));
});
