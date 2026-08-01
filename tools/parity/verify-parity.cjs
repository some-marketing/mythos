#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { fileSha, matches, sha256, treeDigest, walk } = require('./lib.cjs');
const { PRIVATE_LOCAL_EXCLUSIONS } = require('./private-memory-policy.cjs');
const { scanForDenylist } = require('../export-public/export-public.cjs');

const TEXT_EXTENSIONS = new Set(['', '.cjs', '.command', '.css', '.html', '.js', '.json', '.md', '.mjs', '.plist', '.ps1', '.py', '.sh', '.ts', '.tsx', '.txt', '.yaml', '.yml']);
const REQUIRED_SECURITY_EVIDENCE_ARTIFACTS = Object.freeze(['parity/reconciliation-ledger.json']);

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function scriptOperands(command) {
  return String(command).split(/&&|;|\|\|/).flatMap(part => part.trim().split(/\s+/))
    .filter(token => /^[A-Za-z0-9_.][A-Za-z0-9_./*-]*\.(?:c?js|mjs|sh|ps1|py)$/.test(token));
}

function normalizedWords(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

function privateTokenHashes(value, baseline) {
  const hashes = new Set(baseline.prohibited_token_hashes || []);
  const words = normalizedWords(value);
  const caseHashes = new Set(baseline.prohibited_case_token_hashes || []);
  const caseWords = String(value).replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const hits = new Set();
  for (const word of caseWords) {
    const digest = sha256(word);
    if (caseHashes.has(digest)) hits.add(digest);
  }
  const max = baseline.prohibited_token_max_words || 1;
  for (let start = 0; start < words.length; start += 1) {
    for (let length = 1; length <= max && start + length <= words.length; length += 1) {
      const digest = sha256(words.slice(start, start + length).join(' '));
      if (hashes.has(digest)) hits.add(digest);
    }
  }
  return hits;
}

function gitTracked(root) {
  const result = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.split('\0').filter(Boolean).sort();
}

function isMemoryFamilyPath(relative) {
  return String(relative).split(/[\\/]/).some(segment => (
    /^(?:mythos-memories|sm_os-memories)$/i.test(segment)
  ));
}

function main() {
  const args = process.argv.slice(2);
  const root = path.resolve(option(args, '--root') || path.join(__dirname, '..', '..'));
  const baselinePath = path.resolve(option(args, '--baseline') || path.join(root, 'parity/baseline.json'));
  const baseline = readJson(baselinePath);
  const findings = [];
  const observedTokenAllowances = new Set();
  if (baseline.schema !== 'MythosParityBaseline/2.0') findings.push('unsupported baseline schema');
  if (!/^[a-f0-9]{64}$/.test(baseline.source?.private_denylist_sha256 || '')) {
    findings.push('missing authoritative private denylist binding');
  }
  const privateDenylistArg = option(args, '--private-denylist');
  const requirePrivateDenylist = args.includes('--require-private-denylist');
  let authoritativePrivateDenylist = null;
  if (!privateDenylistArg) {
    if (requirePrivateDenylist) findings.push('authoritative private denylist input is required');
  } else {
    const privateDenylistPath = path.resolve(privateDenylistArg);
    if (!fs.existsSync(privateDenylistPath) || !fs.statSync(privateDenylistPath).isFile()) {
      findings.push('authoritative private denylist input is missing');
    } else if (fileSha(privateDenylistPath) !== baseline.source?.private_denylist_sha256) {
      findings.push('authoritative private denylist binding mismatch');
    } else {
      authoritativePrivateDenylist = readJson(privateDenylistPath);
    }
  }
  if (JSON.stringify(baseline.security_evidence_artifacts) !== JSON.stringify(REQUIRED_SECURITY_EVIDENCE_ARTIFACTS)) {
    findings.push('security evidence artifact registry must contain only the canonical reconciliation ledger');
  }
  for (const pattern of PRIVATE_LOCAL_EXCLUSIONS) {
    if (!(baseline.runtime_exclusions || []).includes(pattern)) {
      findings.push(`missing required private-local runtime exclusion: ${pattern}`);
    }
  }

  const tokenUniverse = new Set([
    ...(baseline.prohibited_token_hashes || []),
    ...(baseline.prohibited_case_token_hashes || []),
  ]);
  const tokenAllowlist = baseline.prohibited_token_allowlist || {};
  for (const [digest, paths] of Object.entries(tokenAllowlist)) {
    if (!/^[a-f0-9]{64}$/.test(digest) || !tokenUniverse.has(digest)) {
      findings.push(`unknown prohibited token allowlist hash: ${digest}`);
    }
    if (!Array.isArray(paths) || paths.length === 0 || new Set(paths).size !== paths.length) {
      findings.push(`invalid prohibited token allowlist paths: ${digest}`);
    }
  }

  for (const relative of REQUIRED_SECURITY_EVIDENCE_ARTIFACTS) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      findings.push(`missing security evidence artifact: ${relative}`);
      continue;
    }
    const text = fs.readFileSync(absolute, 'utf8');
    if (privateTokenHashes(text, baseline).size) {
      findings.push(`prohibited private token in security evidence artifact: ${relative}`);
    }
    if (authoritativePrivateDenylist && scanForDenylist(text, authoritativePrivateDenylist, relative).length) {
      findings.push(`authoritative private denylist hit in security evidence artifact: ${relative}`);
    }
    for (const source of baseline.prohibited_content_regexes || []) {
      if (new RegExp(source).test(text)) {
        findings.push(`prohibited content ${source} in security evidence artifact: ${relative}`);
      }
    }
  }

  const expectedRows = new Map((baseline.target.expected_files || []).map(row => [row.path, row]));
  const expected = new Map([...expectedRows].map(([relative, row]) => [relative, row.sha256]));
  for (const [relative, digest] of expected) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) findings.push(`missing expected file: ${relative}`);
    else if (fileSha(absolute) !== digest) findings.push(`digest drift: ${relative}`);
    else if ((fs.statSync(absolute).mode & 0o777) !== expectedRows.get(relative).mode) findings.push(`mode drift: ${relative}`);
  }
  const actual = walk(root, relative => (
    relative === path.relative(root, baselinePath).split(path.sep).join('/')
    || matches(relative, baseline.runtime_exclusions || [])
  ));
  for (const relative of actual) if (!expected.has(relative)) findings.push(`unregistered extra: ${relative}`);
  const actualExpected = actual.filter(relative => expected.has(relative));
  if (treeDigest(root, actualExpected) !== baseline.target.expected_tree_sha256) findings.push('portable tree digest drift');

  const tracked = gitTracked(root);
  if (tracked) {
    for (const relative of tracked) {
      if (matches(relative, baseline.prohibited_paths || [])) findings.push(`prohibited tracked path: ${relative}`);
      if (isMemoryFamilyPath(relative)) findings.push(`prohibited tracked memory path: ${relative}`);
      if (matches(relative, PRIVATE_LOCAL_EXCLUSIONS)) findings.push(`prohibited tracked private-local path: ${relative}`);
    }
  }

  for (const relative of actual) {
    try {
      if (privateTokenHashes(relative, baseline).size) findings.push(`prohibited private token in path: ${relative}`);
      const extension = path.extname(relative).toLowerCase();
      const absolute = path.join(root, relative);
      if (!TEXT_EXTENSIONS.has(extension) || fs.statSync(absolute).size > 2 * 1024 * 1024) continue;
      const text = fs.readFileSync(absolute, 'utf8');
      const contentTokenHashes = privateTokenHashes(text, baseline);
      const unallowed = [];
      for (const digest of contentTokenHashes) {
        if ((tokenAllowlist[digest] || []).includes(relative)) {
          observedTokenAllowances.add(`${digest}\0${relative}`);
        } else {
          unallowed.push(digest);
        }
      }
      if (unallowed.length) findings.push(`prohibited private token in content: ${relative}`);
      for (const source of baseline.prohibited_content_regexes || []) {
        if ((baseline.prohibited_content_allowlist?.[source] || []).includes(relative)) continue;
        if (new RegExp(source).test(text)) findings.push(`prohibited content ${source}: ${relative}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  for (const [digest, paths] of Object.entries(tokenAllowlist)) {
    if (!Array.isArray(paths)) continue;
    for (const relative of paths) {
      if (!observedTokenAllowances.has(`${digest}\0${relative}`)) {
        findings.push(`stale prohibited token allowlist entry: ${digest} -> ${relative}`);
      }
    }
  }

  const packageJson = readJson(path.join(root, 'package.json'));
  const scripts = packageJson.scripts || {};
  if (Object.keys(scripts).length !== baseline.wiring.package_script_count) {
    findings.push('package script count drift');
  }
  for (const [name, command] of Object.entries(scripts)) {
    for (const operand of scriptOperands(command)) {
      if (operand.includes('*')) continue;
      if (!fs.existsSync(path.join(root, operand))) findings.push(`dead package script target ${name}: ${operand}`);
    }
  }

  const aliasPath = path.join(root, 'instructions/canonical/command-aliases.yaml');
  if (baseline.wiring.command_alias_registry_sha256 && fileSha(aliasPath) !== baseline.wiring.command_alias_registry_sha256) {
    findings.push('command alias registry drift');
  }
  const graphPath = path.join(root, baseline.wiring.graph_path || 'parity/wiring-graph.json');
  if (!fs.existsSync(graphPath)) {
    findings.push('missing typed wiring graph');
  } else {
    if (fileSha(graphPath) !== baseline.wiring.graph_sha256) findings.push('typed wiring graph drift');
    const graph = readJson(graphPath);
    const nodeIds = new Set();
    const edgeIds = new Set();
    for (const node of graph.nodes || []) {
      if (nodeIds.has(node.id)) findings.push(`duplicate wiring node: ${node.id}`);
      nodeIds.add(node.id);
      if (node.type === 'file') {
        const absolute = path.join(root, node.path);
        if (!fs.existsSync(absolute)) findings.push(`missing wiring file node: ${node.path}`);
        else {
          if (fileSha(absolute) !== node.sha256) findings.push(`wiring node digest drift: ${node.path}`);
          if ((fs.statSync(absolute).mode & 0o777) !== node.mode) findings.push(`wiring node mode drift: ${node.path}`);
        }
      } else if (node.type === 'directory' && !fs.existsSync(path.join(root, node.path))) {
        findings.push(`missing wiring directory node: ${node.path}`);
      }
    }
    for (const edge of graph.edges || []) {
      if (edgeIds.has(edge.id)) findings.push(`duplicate wiring edge: ${edge.id}`);
      edgeIds.add(edge.id);
      if (edge.required && !edge.target) findings.push(`unresolved wiring edge: ${edge.type} ${edge.from}`);
      else if (edge.target && !fs.existsSync(path.join(root, edge.target))) findings.push(`dead wiring edge: ${edge.type} ${edge.from} -> ${edge.target}`);
      if (!nodeIds.has(edge.from)) findings.push(`wiring edge has missing source node: ${edge.from}`);
      if (edge.to && !nodeIds.has(edge.to)) findings.push(`wiring edge has missing target node: ${edge.to}`);
    }
    if (graph.counts?.nodes !== baseline.wiring.graph_nodes || nodeIds.size !== baseline.wiring.graph_nodes) {
      findings.push('wiring graph node count drift');
    }
    if (graph.counts?.edges !== baseline.wiring.graph_edges || edgeIds.size !== baseline.wiring.graph_edges) {
      findings.push('wiring graph edge count drift');
    }
  }
  for (const unit of baseline.source.units || []) {
    const target = path.join(root, unit.target);
    if (!fs.existsSync(target)) findings.push(`missing mapped unit ${unit.id}: ${unit.target}`);
  }

  const sourceRootArg = option(args, '--source-root');
  if (sourceRootArg) {
    const sourceRoot = path.resolve(sourceRootArg);
    const head = spawnSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    const expectedExportCommit = baseline.source.export_commit || baseline.source.commit;
    if (head.status !== 0 || head.stdout.trim() !== expectedExportCommit) findings.push('source export commit drift');
    const ancestry = spawnSync('git', ['-C', sourceRoot, 'merge-base', '--is-ancestor', baseline.source.commit, expectedExportCommit]);
    if (ancestry.status !== 0) findings.push('pinned source commit is not an ancestor of source export commit');
    const map = path.join(sourceRoot, 'tools/export-public/config/mythos-export-map.json');
    const denylist = path.join(sourceRoot, 'tools/export-public/config/denylist-mythos.json');
    if (!fs.existsSync(map) || fileSha(map) !== baseline.source.export_map_sha256) findings.push('source export map drift');
    if (!fs.existsSync(denylist) || fileSha(denylist) !== baseline.source.denylist_sha256) findings.push('source denylist drift');
    const sourceMap = fs.existsSync(map) ? readJson(map) : { frameworks: {}, units: {} };
    for (const unit of baseline.source.units || []) {
      const source = path.join(sourceRoot, unit.source);
      if (!fs.existsSync(source)) findings.push(`removed source unit ${unit.id}: ${unit.source}`);
      else {
        const declaration = sourceMap.frameworks?.[unit.id] || sourceMap.units?.[unit.id];
        if (!declaration) {
          findings.push(`removed source unit declaration ${unit.id}`);
          continue;
        }
        const excludes = declaration.files?.exclude || [];
        const files = walk(source, relative => matches(relative, excludes));
        if (treeDigest(source, files) !== unit.source_digest) findings.push(`source unit digest drift ${unit.id}`);
      }
    }
  }

  const result = {
    schema: 'MythosParityVerification/1.0',
    ok: findings.length === 0,
    expected_files: expected.size,
    units: (baseline.source.units || []).length,
    findings,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.ok ? 0 : 1;
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 2;
}
