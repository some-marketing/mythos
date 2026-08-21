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

test('recognizes repository candidates through a symlinked repository path', (t) => {
  const repositoryRoot = resolveCanonicalRoot({ mode: 'hard' });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-candidate-symlink-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const linkedRoot = path.join(tempRoot, 'linked-repository');
  fs.symlinkSync(repositoryRoot, linkedRoot, 'dir');
  const candidateRoot = path.join(
    linkedRoot,
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

test('imported candidates authorize report outputs and declare consumed artifacts', () => {
  const repositoryRoot = resolveCanonicalRoot({ mode: 'hard' });
  const candidateSpecs = [
    {
      root: 'product-management__product-intake',
      producerPrompts: [
        '01_SCOPE_AND_INTENT.md',
        '02_DISCOVERY_EVIDENCE.md',
        '03_PRODUCT_BRIEF_AND_PRFAQ.md'
      ],
      requiredArtifacts: [
        'outputs/product-intake/scope-and-intent.json',
        'outputs/product-intake/hypothesis-tests.json'
      ]
    },
    {
      root: 'project-management__delta-specification',
      producerPrompts: [
        '01_BASELINE_INVENTORY.md',
        '02_CHANGE_PROPOSAL.md',
        '03_DELTA_REQUIREMENTS.md',
        '04_DEPENDENCY_AND_ACCEPTANCE_MAP.md'
      ],
      requiredArtifacts: []
    }
  ];

  for (const candidate of candidateSpecs) {
    const proposedRoot = path.join(
      repositoryRoot,
      'framework_candidates',
      candidate.root,
      'proposed_framework'
    );
    const manifest = JSON.parse(fs.readFileSync(path.join(proposedRoot, 'manifest.json'), 'utf8'));
    assert.ok(manifest.execution_modes.includes('RUN_ONLY'));
    for (const artifact of candidate.requiredArtifacts) {
      assert.ok(manifest.output_contract.artifacts.includes(artifact));
    }
    for (const prompt of candidate.producerPrompts) {
      const content = fs.readFileSync(path.join(proposedRoot, 'prompts', prompt), 'utf8');
      assert.match(content, /## Mode\n\nRUN_ONLY/);
    }
  }
});

test('delta replay keeps current-state baseline separate from requested behavior', () => {
  const repositoryRoot = resolveCanonicalRoot({ mode: 'hard' });
  const inputsRoot = path.join(
    repositoryRoot,
    'framework_candidates',
    'project-management__delta-specification',
    'replay_cases',
    'neutral-retention-change',
    'inputs'
  );
  const baseline = fs.readFileSync(path.join(inputsRoot, 'baseline.md'), 'utf8');
  const intake = JSON.parse(fs.readFileSync(path.join(inputsRoot, 'intake.json'), 'utf8'));

  assert.doesNotMatch(baseline, /proposed change/i);
  assert.doesNotMatch(baseline, /\bOperators\b/);
  assert.match(intake.change_request, /hide expired bundles/);
  assert.match(intake.change_request, /remove the legacy fixed-duration assumption/);
});
