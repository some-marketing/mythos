#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { fileSha, matches, sha256, treeDigest, walk } = require('./lib.cjs');
const { PRIVATE_LOCAL_EXCLUSIONS } = require('./private-memory-policy.cjs');

// Exact public self/fixture occurrences of denylist terms. These are hashes of
// the normalized terms, never the terms themselves. Keep this mapping narrow:
// adding a path or hash requires parity-amendment review, and verify-parity
// rejects unknown or stale entries.
const PROHIBITED_TOKEN_ALLOWLIST = Object.freeze({
  '14bdcd6fd64180af5e7791df91b6af8e9a3e7bc844997eb8c29252706df97ca5': [
    'tools/export-public/config/denylist-mythos.json',
    'tools/export-public/config/denylist.json',
  ],
  '984ab8e1ce4f7e4fb08a5d3e1ffa52a58afe6afcfba05b35efb4f76c58a60c29': [
    'tools/export-public/__tests__/export-public.test.cjs',
    'tools/export-public/config/denylist-mythos.json',
    'tools/export-public/config/denylist.json',
  ],
  'bf0d7e3735b349a5df2fcb340c11d59945450d2aeea305573c3ccdd0f630acfa': [
    'tools/export-public/__tests__/export-public.test.cjs',
    'tools/export-public/config/denylist-mythos.json',
    'tools/export-public/config/denylist.json',
  ],
  'd5078f1ab80e9c7dfb4b1b31b22ddf60ac4d15f9da999d963741bf7e9c4027e3': [
    'tools/export-public/config/denylist-mythos.json',
  ],
});

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizedToken(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout).trim());
  return result.stdout.trim();
}

function unitFiles(sourceRoot, unit) {
  const root = path.resolve(sourceRoot, unit.source);
  if (!fs.existsSync(root)) return [];
  const excludes = (unit.files && unit.files.exclude) || [];
  return walk(root, relative => matches(relative, excludes));
}

function main() {
  const args = process.argv.slice(2);
  const root = path.resolve(option(args, '--root') || path.join(__dirname, '..', '..'));
  const sourceRootArg = option(args, '--source-root');
  const sourceRoot = sourceRootArg ? path.resolve(sourceRootArg) : null;
  const output = path.resolve(option(args, '--output') || path.join(root, 'parity', 'baseline.json'));
  const sourceCommit = option(args, '--source-commit');
  const sourceExportCommit = option(args, '--source-export-commit') || sourceCommit;
  const targetBaseCommit = option(args, '--target-base-commit');
  const privateDenylistArg = option(args, '--private-denylist');
  if (!sourceRoot || !sourceCommit || !targetBaseCommit || !privateDenylistArg) {
    throw new Error('--source-root, --source-commit, --target-base-commit, and --private-denylist are required');
  }
  if (git(sourceRoot, ['rev-parse', 'HEAD']) !== sourceExportCommit) {
    throw new Error('source checkout does not match --source-export-commit');
  }
  if (git(sourceRoot, ['merge-base', '--is-ancestor', sourceCommit, sourceExportCommit]) !== '') {
    throw new Error('--source-commit is not an ancestor of --source-export-commit');
  }

  const mapPath = path.join(sourceRoot, 'tools/export-public/config/mythos-export-map.json');
  const denylistPath = path.join(sourceRoot, 'tools/export-public/config/denylist-mythos.json');
  const map = readJson(mapPath);
  const denylist = readJson(denylistPath);
  const privateDenylistPath = path.resolve(privateDenylistArg);
  const privateDenylist = readJson(privateDenylistPath);
  // Construct legacy compatibility spellings so the export sanitizer cannot
  // rewrite this policy into a different regular expression.
  const compatibilityTerms = new RegExp(
    '^(?:' + 'sm' + '[-_]' + 'os_?' + '|' + 'llm' + '[-_]' + 'os' + ')$',
    'i',
  );
  const denylists = [denylist, privateDenylist];
  const privateClientCodes = denylists.flatMap(item => item.client_codes || [])
    .filter(row => !compatibilityTerms.test(row.term));
  const employeeVault = String.fromCharCode(69, 109, 112, 108, 111, 121, 101, 101);
  const workInfoVault = String.fromCharCode(87, 111, 114, 107, 32, 73, 110, 102, 111);
  const privateTerms = [
    ...privateClientCodes.map(row => row.term),
    ...denylists.flatMap(item => item.domains || []).map(row => row.term),
    ...denylists.flatMap(item => item.identifiers || []).map(row => row.term),
    ...denylists.flatMap(item => item.forbidden || []).filter(row => row.term).map(row => row.term),
    `op://${employeeVault}/`,
    `op://${workInfoVault}/`,
    `--vault ${employeeVault}`,
    `--vault ${workInfoVault}`,
  ].map(normalizedToken).filter(Boolean);
  const caseSensitiveTerms = privateClientCodes
    .map(row => String(row.term).replace(/[^A-Za-z0-9]+/g, ' ').trim())
    .filter(term => term && normalizedToken(term).length === 3);
  const foldedTerms = privateTerms.filter(term => term.length > 3);
  const fixedHomeCheckout = '\\$\\{?HOME\\}?/Documents/GitHub/' + 'Mythos|~/Documents/GitHub/' + 'Mythos';
  const units = [
    ...Object.entries(map.frameworks || {}),
    ...Object.entries(map.units || {}),
  ].map(([id, unit]) => {
    const files = unitFiles(sourceRoot, unit);
    return {
      id,
      source: unit.source,
      target: unit.target,
      disposition: unit.mirror_contract ? 'export-adapted' : 'export-identical',
      source_file_count: files.length,
      source_digest: treeDigest(path.resolve(sourceRoot, unit.source), files),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const runtimeExclusions = [
    '.git/**',
    'node_modules/**',
    ...PRIVATE_LOCAL_EXCLUSIONS,
    '.env',
    '.env.*.local',
    '_dev/archive/**',
    '_dev/cache/**',
    '_dev/debug/**',
    '_dev/logs/**',
    '_dev/outputs/**',
    '_dev/reports/analysis/declared-trigger-lint__*.md',
    '_dev/reports/analysis/public-export/**',
    '_dev/reports/lifecycle/**',
    '_dev/reports/signals/**',
    '_dev/scratch/**',
    '_dev/state/**',
    '_dev/tmp/**',
    '_dev/traces/**',
    '_dev/transcripts/**',
    'parity/reconciliation-ledger.json',
  ];
  const baselineRelative = path.relative(root, output).split(path.sep).join('/');
  const expectedFiles = walk(root, relative => (
    relative === baselineRelative
    || matches(relative, runtimeExclusions)
  )).map(relative => {
    const absolute = path.join(root, relative);
    return {
      path: relative,
      sha256: fileSha(absolute),
      mode: fs.statSync(absolute).mode & 0o777,
    };
  });

  const packageJson = readJson(path.join(root, 'package.json'));
  const graphPath = path.join(root, 'parity/wiring-graph.json');
  if (!fs.existsSync(graphPath)) throw new Error('parity/wiring-graph.json must be generated before the baseline');
  const graph = readJson(graphPath);
  const aliases = fs.existsSync(path.join(root, 'instructions/canonical/command-aliases.yaml'))
    ? sha256(fs.readFileSync(path.join(root, 'instructions/canonical/command-aliases.yaml')))
    : null;
  const baseline = {
    schema: 'MythosParityBaseline/2.0',
    source: {
      commit: sourceCommit,
      export_commit: sourceExportCommit,
      export_map_sha256: fileSha(mapPath),
      denylist_sha256: fileSha(denylistPath),
      private_denylist_sha256: fileSha(privateDenylistPath),
      units,
    },
    target: {
      base_commit: targetBaseCommit,
      expected_tree_sha256: treeDigest(root, expectedFiles.map(row => row.path)),
      expected_files: expectedFiles,
      overlays: [
        {
          id: 'target-continuity-hook',
          authority: 'target-owned',
          paths: ['.githooks/README.md', '.githooks/pre-push'],
          reason: 'Mythos continuity protection predates the portable source export.',
        },
        {
          id: 'target-ci-and-ignore-policy',
          authority: 'target-owned',
          paths: ['.github/workflows/*.yml', '.gitignore'],
          reason: 'Repository enforcement and ignore policy are owned by the Mythos target.',
        },
        {
          id: 'target-dependency-lock',
          authority: 'target-owned',
          paths: ['package-lock.json'],
          reason: 'The target repository owns its reproducible dependency resolution lock.',
        },
      ],
    },
    wiring: {
      package_script_count: Object.keys(packageJson.scripts || {}).length,
      command_alias_registry_sha256: aliases,
      graph_path: 'parity/wiring-graph.json',
      graph_sha256: fileSha(graphPath),
      graph_nodes: graph.counts.nodes,
      graph_edges: graph.counts.edges,
    },
    runtime_exclusions: runtimeExclusions,
    prohibited_paths: [
      'clients/**',
      '.cache/**',
      'Mythos-memories/**',
      'Mythos-lineage-preservation-*/**',
      '_handoffs/**',
      '.claude/projects/**',
      '.claude/session-env/**',
      '.claude/todos/**',
      '.claude/transcripts/**',
    ],
    prohibited_content_regexes: [
      '/Users' + '/',
      '/Volumes' + '/[A-Za-z0-9._-]+',
      fixedHomeCheckout,
      'AKIA[0-9A-Z]{16}',
      '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----',
    ],
    prohibited_token_hashes: [...new Set(foldedTerms.map(sha256))].sort(),
    prohibited_case_token_hashes: [...new Set(caseSensitiveTerms.map(sha256))].sort(),
    prohibited_token_max_words: Math.max(1, ...foldedTerms.map(term => term.split(' ').length)),
    prohibited_token_allowlist: PROHIBITED_TOKEN_ALLOWLIST,
    security_evidence_artifacts: ['parity/reconciliation-ledger.json'],
    prohibited_content_allowlist: {
      'AKIA[0-9A-Z]{16}': [
        'tools/kernel/lib/__tests__/data-sensitivity-classifier.test.js'
      ],
      '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----': [
        'tools/kernel/lib/__tests__/data-sensitivity-classifier.test.js',
        'tools/signals/lib/__tests__/run-openrouter-bridge.test.js',
        'tools/signals/run-openrouter-bridge.js'
      ]
    },
    amendment_required_for_update: 'mythos-full-parity-port',
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(baseline, null, 2) + '\n');
  process.stdout.write(`WROTE ${path.relative(root, output)} (${expectedFiles.length} files, ${units.length} units)\n`);
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
