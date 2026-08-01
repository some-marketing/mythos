#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { sha256 } = require('./lib.cjs');
const { inventory, reviewedExclusions } = require('./generate-reconciliation-ledger.cjs');

const VALID = new Set([
  'export-identical',
  'export-adapted',
  'target-owned',
  'merge-upstream',
  'private-prohibited',
  'remove-or-quarantine',
]);

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('BLOCKED: reconciliation ledger path is required');
  process.exit(2);
}
const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = Array.isArray(ledger.rows) ? ledger.rows : [];
const exhaustive = ledger.schema === 'MythosThreeWayReconciliation/4.0';
const offenders = rows.filter(row => (
  !VALID.has(row.disposition)
  || !row.row_id
  || (!row.path && !row.path_sha256)
  || (row.disposition === 'export-adapted' && (
    !row.adaptation_class
    || !ledger.behavior_evidence_catalog?.[row.behavior_equivalence_evidence]?.length
  ))
  || (exhaustive && row.disposition !== 'export-identical'
    && !ledger.behavior_evidence_catalog?.[row.behavior_equivalence_evidence]?.length)
  || (row.disposition === 'target-owned' && !row.overlay_authority)
  || (['private-prohibited', 'remove-or-quarantine'].includes(row.disposition) && row.target_current_sha256)
  || (exhaustive && ['private-prohibited', 'remove-or-quarantine'].includes(row.disposition)
    && row.source_export_sha256)
  || (exhaustive && ['private-prohibited', 'remove-or-quarantine'].includes(row.disposition)
    && (row.path || !row.path_sha256))
  || (row.wiring_family && ['private-prohibited', 'remove-or-quarantine'].includes(row.disposition)
    && (
      !row.portable_substitute_path
      || !row.portable_substitute_sha256
      || !row.portable_substitute_id
      || !row.portable_behavior
      || (row.portable_behavior === 'not_applicable' && !row.not_applicable_reason)
    ))
));
const semanticProblems = ['commands', 'skills', 'agents', 'hooks', 'mcp', 'launchd'].filter(family => {
  const evidence = ledger.semantic_mapping?.[family];
  return !evidence
    || !Number.isInteger(evidence.source_nodes)
    || evidence.source_nodes < 1
    || evidence.unresolved !== 0
    || evidence.mapped + evidence.substituted_or_quarantined !== evidence.source_nodes;
});
const coverageProblems = [];
if (ledger.coverage) {
  const keys = rows.map(row => row.coverage_key);
  const unique = new Set(keys);
  if (keys.some(key => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))) {
    coverageProblems.push('invalid or missing row coverage_key');
  }
  if (unique.size !== keys.length) coverageProblems.push('duplicate coverage_key');
  const sorted = [...unique].sort();
  if (ledger.coverage.files !== sorted.length) coverageProblems.push('coverage file count does not match rows');
  if (ledger.coverage.path_keys_sha256 !== sha256(sorted.join('\n'))) {
    coverageProblems.push('coverage path-key digest does not match rows');
  }
}
if (exhaustive) {
  const rootOptions = {
    source_export: option('source-export-root'),
    target_base: option('target-base-root'),
    target_current: option('target-current-root'),
  };
  if (Object.values(rootOptions).some(root => !root)) {
    coverageProblems.push('v4 exhaustive verification requires all three authoritative inventory roots');
  } else {
    try {
      const exclusions = reviewedExclusions(ledger.artifact_exclusions).map(item => item.path);
      const authoritative = Object.fromEntries(Object.entries(rootOptions).map(([surface, root]) => [
        surface,
        inventory(root, exclusions),
      ]));
      const expectedByKey = new Map();
      for (const [surface, value] of Object.entries(authoritative)) {
        const recorded = ledger.inventories?.[surface];
        if (JSON.stringify(recorded) !== JSON.stringify(value.summary)) {
          coverageProblems.push(`${surface} inventory summary does not match authoritative root`);
        }
        for (const entry of value.files) {
          const key = sha256(entry.path);
          if (!expectedByKey.has(key)) expectedByKey.set(key, { path: entry.path });
          expectedByKey.get(key)[surface] = entry;
        }
      }
      const actualByKey = new Map(rows.map(row => [row.coverage_key, row]));
      const expectedKeys = [...expectedByKey.keys()].sort();
      const actualKeys = [...actualByKey.keys()].sort();
      if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
        coverageProblems.push('row path-key set does not match authoritative inventories');
      }
      if (ledger.coverage.files !== expectedKeys.length
          || ledger.coverage.path_keys_sha256 !== sha256(expectedKeys.join('\n'))) {
        coverageProblems.push('coverage summary does not match authoritative inventories');
      }
      const fields = {
        source_export: ['source_export_sha256', 'source_export_mode'],
        target_base: ['target_base_sha256', 'target_base_mode'],
        target_current: ['target_current_sha256', 'target_current_mode'],
      };
      for (const [key, expected] of expectedByKey) {
        const row = actualByKey.get(key);
        if (!row) continue;
        if ((row.path && sha256(row.path) !== key) || (row.path_sha256 && row.path_sha256 !== key)) {
          coverageProblems.push(`row path binding does not match coverage_key: ${key}`);
        }
        if (row.row_id !== sha256(`${key}\0${row.disposition}`)) {
          coverageProblems.push(`row_id does not bind coverage key and disposition: ${key}`);
        }
        const sourceCurrentIdentical = expected.source_export && expected.target_current
          && expected.source_export.sha256 === expected.target_current.sha256
          && expected.source_export.mode === expected.target_current.mode;
        if (row.disposition === 'export-identical' && !sourceCurrentIdentical) {
          coverageProblems.push(`export-identical does not match authoritative bytes and mode: ${key}`);
        }
        if (!sourceCurrentIdentical
            && !ledger.behavior_evidence_catalog?.[row.behavior_equivalence_evidence]?.length) {
          coverageProblems.push(`changed row lacks catalogued behavior evidence: ${key}`);
        }
        for (const [surface, [shaField, modeField]] of Object.entries(fields)) {
          const entry = expected[surface];
          if ((entry && (row[shaField] !== entry.sha256 || row[modeField] !== entry.mode))
              || (!entry && (row[shaField] !== undefined || row[modeField] !== undefined))) {
            coverageProblems.push(`row ${surface} binding does not match authoritative inventory: ${key}`);
          }
        }
      }
    } catch (error) {
      coverageProblems.push(error.message);
    }
  }
}
if (!rows.length || offenders.length || semanticProblems.length || coverageProblems.length || ledger.unresolved_rows !== 0) {
  console.error(`BLOCKED: rows=${rows.length} offenders=${offenders.length} unresolved=${ledger.unresolved_rows}`);
  if (semanticProblems.length) console.error(`BLOCKED: incomplete semantic mappings: ${semanticProblems.join(', ')}`);
  if (coverageProblems.length) console.error(`BLOCKED: incomplete ledger coverage: ${coverageProblems.join('; ')}`);
  process.exit(1);
}
if (process.argv.includes('--require-operator') && ledger.operator_ratification !== 'approved') {
  console.error('BLOCKED: operator ratification is pending');
  process.exit(1);
}
console.log(`OK: ${rows.length} rows have resolved portable-parity dispositions.`);
