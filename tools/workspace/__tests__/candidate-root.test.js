'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { resolveCanonicalRoot } = require('../../lib/canonical-root.cjs');
const { inspectBundle, inspectOutputDir, loadOutputContract } = require('../lib/output-contract');
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

test('imported candidates authorize report outputs and declare consumed artifacts', (t) => {
  const repositoryRoot = resolveCanonicalRoot({ mode: 'hard' });
  const emptyOutputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-candidate-output-'));
  t.after(() => fs.rmSync(emptyOutputRoot, { recursive: true, force: true }));
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
    const manifestPath = path.join(proposedRoot, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.ok(manifest.execution_modes.includes('RUN_ONLY'));
    assert.ok(manifest.output_contract_v2);
    assert.ok(manifest.output_contract_v2.directories.every((entry) => entry.required));
    assert.ok(manifest.output_contract_v2.artifacts.every((entry) => entry.required && entry.path_pattern));
    assert.deepEqual(
      manifest.output_contract_v2.artifacts.map((entry) => entry.path_pattern),
      manifest.output_contract.artifacts
    );
    const loaded = loadOutputContract(manifestPath);
    assert.equal(loaded.compatibility, false);
    const missingArtifacts = inspectOutputDir(emptyOutputRoot, loaded.contract)
      .filter((finding) => finding.code === 'ARTIFACT_MISSING');
    assert.equal(missingArtifacts.length, manifest.output_contract_v2.artifacts.length);
    assert.ok(missingArtifacts.every((finding) => finding.severity === 'blocker'));
    for (const artifact of candidate.requiredArtifacts) {
      assert.ok(manifest.output_contract.artifacts.includes(artifact));
    }
    for (const prompt of candidate.producerPrompts) {
      const content = fs.readFileSync(path.join(proposedRoot, 'prompts', prompt), 'utf8');
      assert.match(content, /## Mode\n\nRUN_ONLY/);
    }
  }
});

test('imported candidate review gates require distinct minds and complete intake', () => {
  const repositoryRoot = resolveCanonicalRoot({ mode: 'hard' });
  const productRoot = path.join(
    repositoryRoot,
    'framework_candidates',
    'product-management__product-intake',
    'proposed_framework'
  );
  const productManifest = JSON.parse(fs.readFileSync(path.join(productRoot, 'manifest.json'), 'utf8'));
  assert.ok(productManifest.input_contract.optional.some((entry) => entry.name === 'risk_level'));

  const reviewPrompts = [
    path.join(productRoot, 'prompts', '04_READINESS_REVIEW.md'),
    path.join(
      repositoryRoot,
      'framework_candidates',
      'project-management__delta-specification',
      'proposed_framework',
      'prompts',
      '05_INDEPENDENT_REVIEW.md'
    )
  ];
  for (const promptPath of reviewPrompts) {
    const content = fs.readFileSync(promptPath, 'utf8');
    assert.match(content, /actor id, harness id, and model-provider family/);
    assert.match(content, /same-provider subagent is not a distinct reviewing mind/);
    assert.match(content, /missing provenance forces `FAIL`/);
  }
});

test('imported candidate review schemas reject provenance-free PASS verdicts', (t) => {
  const repositoryRoot = resolveCanonicalRoot({ mode: 'hard' });
  const candidates = [
    {
      root: 'product-management__product-intake',
      bundle: 'product-intake-output',
      reviewFile: 'readiness-review.json'
    },
    {
      root: 'project-management__delta-specification',
      bundle: 'delta-specification-output',
      reviewFile: 'review.json'
    }
  ];

  for (const candidate of candidates) {
    const proposedRoot = path.join(repositoryRoot, 'framework_candidates', candidate.root, 'proposed_framework');
    const manifest = JSON.parse(fs.readFileSync(path.join(proposedRoot, 'manifest.json'), 'utf8'));
    const bundleType = manifest.output_contract_v2.bundle_types
      .find((entry) => entry.type_id === candidate.bundle);
    const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-candidate-review-'));
    t.after(() => fs.rmSync(bundleRoot, { recursive: true, force: true }));

    for (const file of bundleType.required_files) {
      const content = file === candidate.reviewFile
        ? JSON.stringify({ verdict: 'PASS', findings: [], falsifier: 'none' })
        : file.endsWith('.json') ? '{}\n' : '\n';
      fs.writeFileSync(path.join(bundleRoot, file), content);
    }

    const findings = inspectBundle(bundleRoot, bundleType, proposedRoot);
    assert.ok(findings.some((finding) => finding.code === 'BUNDLE_SCHEMA_FAIL'));
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
