'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { resolveCanonicalRoot } = require('../../lib/canonical-root.cjs');
const { requireCandidateRoot } = require('../lib/workspace');

test('recognizes candidates staged at the repository framework_candidates root', () => {
  const repositoryRoot = resolveCanonicalRoot({ mode: 'hard' });
  const candidateRoot = path.join(
    repositoryRoot,
    'framework_candidates',
    'product-management__product-intake'
  );

  const result = requireCandidateRoot(candidateRoot);

  assert.equal(result.candidateRoot, candidateRoot);
  assert.equal(result.projectRoot, repositoryRoot);
  assert.equal(result.workspaceRoot, repositoryRoot);
  assert.equal(result.candidateScope, 'repository');
});

test('preserves project-scoped framework candidate resolution', (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-candidate-root-'));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));

  const projectRoot = path.join(workspaceRoot, 'projects', 'sample-project');
  const candidateRoot = path.join(projectRoot, 'framework_candidates', 'sample-candidate');
  fs.mkdirSync(candidateRoot, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'WORKSPACE_MANIFEST.json'), '{}\n');
  fs.writeFileSync(path.join(projectRoot, 'project.json'), '{}\n');
  fs.writeFileSync(path.join(candidateRoot, 'candidate.json'), '{}\n');

  const result = requireCandidateRoot(candidateRoot);

  assert.equal(result.candidateRoot, candidateRoot);
  assert.equal(result.projectRoot, projectRoot);
  assert.equal(result.workspaceRoot, workspaceRoot);
  assert.equal(result.candidateScope, 'project');
});
