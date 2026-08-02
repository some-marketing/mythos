#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { fileSha, matches, posix, sha256, walk } = require('./lib.cjs');
const { PRIVATE_LOCAL_EXCLUSIONS } = require('./private-memory-policy.cjs');

const SURFACES = ['source_export', 'target_base', 'target_current'];
const ARTIFACT_EXCLUSIONS = Object.freeze([
  {
    path: 'parity/baseline.json',
    reason: 'self-referential parity artifact excluded from reconciliation inventory digests',
  },
  {
    path: 'parity/reconciliation-ledger.json',
    reason: 'self-referential parity artifact excluded from reconciliation inventory digests',
  },
]);
const ARTIFACT_EXCLUSION_PATHS = new Set(ARTIFACT_EXCLUSIONS.map(item => item.path));
const AUTOMATIC_DISPOSITIONS = new Set(['export-identical']);
const VALID_DISPOSITIONS = new Set([
  'export-identical',
  'export-adapted',
  'target-owned',
  'merge-upstream',
  'private-prohibited',
  'remove-or-quarantine',
]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const name = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value`);
    args[name] = value;
    index += 1;
  }
  return args;
}

function mode(file) {
  return fs.statSync(file).mode & 0o777;
}

function inventory(root, exclusions) {
  const excluded = new Set(exclusions);
  const files = walk(root, relative => (
    relative === '.git'
    || relative.startsWith('.git/')
    || matches(relative, PRIVATE_LOCAL_EXCLUSIONS)
    || excluded.has(relative)
  )).map(relative => ({
    path: relative,
    sha256: fileSha(path.join(root, relative)),
    mode: mode(path.join(root, relative)),
  }));
  const records = files.map(file => `${file.path}\0${file.sha256}\0${file.mode}`);
  return {
    files,
    summary: {
      files: files.length,
      digest: sha256(records.join('\n')),
      path_keys_sha256: sha256(files.map(file => sha256(file.path)).join('\n')),
    },
  };
}

function reviewedExclusions(requested) {
  if (requested === undefined) return ARTIFACT_EXCLUSIONS.map(item => ({ ...item }));
  if (!Array.isArray(requested)) throw new Error('artifact_exclusions must be an array');
  for (const item of requested) {
    const excludedPath = typeof item === 'string' ? item : item?.path;
    if (!ARTIFACT_EXCLUSION_PATHS.has(excludedPath)) {
      throw new Error(`artifact exclusion is not in the reviewed allowlist: ${excludedPath}`);
    }
  }
  const requestedPaths = new Set(requested.map(item => typeof item === 'string' ? item : item.path));
  if (requestedPaths.size !== requested.length) throw new Error('duplicate artifact exclusion');
  return ARTIFACT_EXCLUSIONS.filter(item => requestedPaths.has(item.path)).map(item => ({ ...item }));
}

function normalizeDecisions(doc) {
  const rows = Array.isArray(doc.decisions) ? doc.decisions : [];
  const byPath = new Map();
  for (const decision of rows) {
    if (!decision || typeof decision.path !== 'string' || !decision.path) {
      throw new Error('every decision requires a non-empty path');
    }
    const normalized = posix(decision.path).replace(/^\.\//, '');
    if (normalized.startsWith('../') || path.isAbsolute(normalized)) {
      throw new Error(`decision path must be repository-relative: ${decision.path}`);
    }
    if (byPath.has(normalized)) throw new Error(`duplicate decision for path: ${normalized}`);
    byPath.set(normalized, { ...decision, path: normalized });
  }
  return byPath;
}

function makeRow(relative, entries, decision, behaviorEvidenceCatalog) {
  const coverageKey = sha256(relative);
  const source = entries.source_export;
  const current = entries.target_current;
  let disposition;
  let supplied = decision;

  if (!supplied && source && current && source.sha256 === current.sha256 && source.mode === current.mode) {
    disposition = 'export-identical';
    supplied = {};
  } else if (supplied) {
    disposition = supplied.disposition;
  } else {
    throw new Error(`uncovered path requires an explicit disposition: ${relative}`);
  }

  if (!VALID_DISPOSITIONS.has(disposition)) {
    throw new Error(`invalid disposition for ${relative}: ${disposition}`);
  }
  if (supplied.disposition && AUTOMATIC_DISPOSITIONS.has(supplied.disposition)
      && (!source || !current || source.sha256 !== current.sha256 || source.mode !== current.mode)) {
    throw new Error(`export-identical does not match bytes and mode: ${relative}`);
  }
  if (disposition !== 'export-identical') {
    const evidence = behaviorEvidenceCatalog[supplied.behavior_equivalence_evidence];
    if (!Array.isArray(evidence) || evidence.length === 0) {
      throw new Error(`${disposition} requires catalogued behavior evidence: ${relative}`);
    }
  }
  if (disposition === 'export-adapted') {
    if (!supplied.adaptation_class) throw new Error(`export-adapted requires adaptation_class: ${relative}`);
  }
  if (disposition === 'target-owned' && !supplied.overlay_authority) {
    throw new Error(`target-owned requires overlay_authority: ${relative}`);
  }
  if (['private-prohibited', 'remove-or-quarantine'].includes(disposition) && current) {
    throw new Error(`${disposition} cannot describe a target-current file: ${relative}`);
  }
  if (['private-prohibited', 'remove-or-quarantine'].includes(disposition) && source) {
    throw new Error(`${disposition} cannot mask a file present in source-export: ${relative}`);
  }

  const row = {
    row_id: sha256(`${coverageKey}\0${disposition}`),
    coverage_key: coverageKey,
    row_kind: source ? 'source-export' : 'target-only',
    ...((supplied.redact_path || ['private-prohibited', 'remove-or-quarantine'].includes(disposition))
      ? { path_sha256: coverageKey }
      : { path: relative }),
    ...(source ? { source_export_sha256: source.sha256, source_export_mode: source.mode } : {}),
    ...(entries.target_base ? { target_base_sha256: entries.target_base.sha256, target_base_mode: entries.target_base.mode } : {}),
    ...(current ? { target_current_sha256: current.sha256, target_current_mode: current.mode } : {}),
    disposition,
  };
  for (const [key, value] of Object.entries(supplied)) {
    if (!['path', 'disposition', 'redact_path'].includes(key)) row[key] = value;
  }
  return row;
}

function generateLedger({ sourceExportRoot, targetBaseRoot, targetCurrentRoot, decisions }) {
  const roots = {
    source_export: path.resolve(sourceExportRoot),
    target_base: path.resolve(targetBaseRoot),
    target_current: path.resolve(targetCurrentRoot),
  };
  for (const [surface, root] of Object.entries(roots)) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`${surface} root is not a directory: ${root}`);
    }
  }

  const artifactExclusions = reviewedExclusions(decisions.artifact_exclusions);
  const exclusions = artifactExclusions.map(item => item.path);
  const inventories = Object.fromEntries(SURFACES.map(surface => [surface, inventory(roots[surface], exclusions)]));
  const byPath = new Map();
  for (const surface of SURFACES) {
    for (const entry of inventories[surface].files) {
      if (!byPath.has(entry.path)) byPath.set(entry.path, {});
      byPath.get(entry.path)[surface] = entry;
    }
  }

  const decisionMap = normalizeDecisions(decisions);
  for (const decisionPath of decisionMap.keys()) {
    if (!byPath.has(decisionPath)) throw new Error(`decision does not match any inventoried file: ${decisionPath}`);
  }
  const behaviorEvidenceCatalog = decisions.behavior_evidence_catalog || {};
  const rows = [...byPath.keys()].sort().map(relative => (
    makeRow(relative, byPath.get(relative), decisionMap.get(relative), behaviorEvidenceCatalog)
  ));
  const coverageKeys = rows.map(row => row.coverage_key).sort();

  const passthrough = {};
  for (const key of [
    'source_commit', 'source_export_commit', 'target_base_commit', 'target_current_commit',
    'operator_ratification', 'semantic_mapping', 'behavior_evidence_catalog',
  ]) if (decisions[key] !== undefined) passthrough[key] = decisions[key];

  return {
    schema: 'MythosThreeWayReconciliation/4.0',
    ...passthrough,
    artifact_exclusions: artifactExclusions,
    inventories: Object.fromEntries(SURFACES.map(surface => [surface, inventories[surface].summary])),
    coverage: {
      files: coverageKeys.length,
      path_keys_sha256: sha256(coverageKeys.join('\n')),
    },
    unresolved_rows: 0,
    rows,
  };
}

function main(argv) {
  const args = parseArgs(argv);
  for (const required of ['source-export-root', 'target-base-root', 'target-current-root', 'decisions', 'output']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  const decisions = JSON.parse(fs.readFileSync(path.resolve(args.decisions), 'utf8'));
  const ledger = generateLedger({
    sourceExportRoot: args['source-export-root'],
    targetBaseRoot: args['target-base-root'],
    targetCurrentRoot: args['target-current-root'],
    decisions,
  });
  const output = path.resolve(args.output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`OK: generated ${ledger.rows.length} exhaustive reconciliation rows at ${output}`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`BLOCKED: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ARTIFACT_EXCLUSIONS,
  generateLedger,
  inventory,
  normalizeDecisions,
  parseArgs,
  reviewedExclusions,
};
