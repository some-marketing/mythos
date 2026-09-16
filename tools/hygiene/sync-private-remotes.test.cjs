'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'sync-private-remotes.sh');

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function hasRef(repo, ref) {
  return spawnSync('git', ['-C', repo, 'show-ref', '--verify', '--quiet', ref]).status === 0;
}

test('sync-private-remotes excludes origin and remotes outside the local allowlist', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-sync-remotes-'));
  const origin = path.join(root, 'origin.git');
  const backup = path.join(root, 'backup.git');
  const unlisted = path.join(root, 'unlisted.git');
  for (const bare of [origin, backup, unlisted]) execFileSync('git', ['init', '--bare', bare], { stdio: 'ignore' });
  const scriptPath = path.join(root, 'tools', 'hygiene', 'sync-private-remotes.sh');
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.copyFileSync(SCRIPT, scriptPath);
  fs.chmodSync(scriptPath, 0o755);

  git(root, ['init']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['checkout', '-b', 'codex/sync-test']);
  fs.writeFileSync(path.join(root, 'payload.txt'), 'fixture\n');
  git(root, ['add', 'payload.txt']);
  git(root, ['commit', '-m', 'fixture']);
  git(root, ['remote', 'add', 'origin', origin]);
  git(root, ['remote', 'add', 'backup', backup]);
  git(root, ['remote', 'add', 'unlisted', unlisted]);

  const output = execFileSync('bash', [path.join(root, 'tools', 'hygiene', 'sync-private-remotes.sh')], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      MYTHOS_REDUNDANCY_REMOTES: 'origin,backup',
      MYTHOS_LOCAL_ONLY_PATHS: ''
    }
  });

  assert.match(output, /origin.*not an eligible redundancy target, skipping/);
  assert.match(output, /backup.*pushed codex\/sync-test/);
  assert.equal(hasRef(origin, 'refs/heads/codex/sync-test'), false);
  assert.equal(hasRef(backup, 'refs/heads/codex/sync-test'), true);
  assert.equal(hasRef(unlisted, 'refs/heads/codex/sync-test'), false);
});
