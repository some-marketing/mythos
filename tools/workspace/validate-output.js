#!/usr/bin/env node
'use strict';

const path = require('path');
const { parseArgs } = require('./lib/args');
const { exists, isDir, readJson } = require('./lib/fs');
const { getSmosRoot, die, writeJson } = require('./lib/workspace');
const {
  loadOutputContract,
  inspectOutputs,
  inspectBundle,
  computeOutputReadiness,
  validateOutputBoundary
} = require('./lib/output-contract');

function help() {
  console.log(`
Validate framework output structure against its output contract.

This is a STRUCTURAL validator only (Tier 1). It checks:
  - File and directory existence
  - JSON schema conformance
  - Naming pattern matches
  - Cross-reference integrity (referenced paths exist)
  - Count consistency between manifests and artifacts

It does NOT assess:
  - Content quality or accuracy
  - Business correctness
  - Reasoning completeness
  - Whether outputs are substantive vs superficial

Semantic quality review requires LLM-driven assessment (Tier 2).
See .claude/agents/output-reviewer.md for semantic review expectations.

Usage:
  node tools/workspace/validate-output.js --framework <service/name> --output <output-root> [--report-path <path>]
  node tools/workspace/validate-output.js --framework <service/name> --bundle <bundle-path> [--report-path <path>]
`.trim());
}

const args = parseArgs(process.argv);
if (args.help || args.h) {
  help();
  process.exit(0);
}

const frameworkArg = args.framework;
const outputArg = args.output;
const bundleArg = args.bundle;
const reportPath = args.report_path;
const stageReceiptPath = args.stage_receipt;

if (!frameworkArg) die('Missing --framework <service/name>');
if (!outputArg && !bundleArg) die('Missing --output <output-root> or --bundle <bundle-path>');

const smosRoot = getSmosRoot();
const frameworkRoot = path.join(smosRoot, 'frameworks', ...frameworkArg.split('/'));
const manifestPath = path.join(frameworkRoot, 'manifest.json');

if (!exists(manifestPath)) die(`Framework manifest not found: ${manifestPath}`);

const { contract, compatibility, findings: contractFindings } = loadOutputContract(manifestPath);
const allFindings = [...contractFindings];
let boundaryVerdict = null;

if (bundleArg) {
  const bundleRoot = path.resolve(bundleArg);
  if (!exists(bundleRoot) || !isDir(bundleRoot)) die(`Bundle path not found: ${bundleRoot}`);

  // Find matching bundle_type
  const bundleTypes = contract.bundle_types || [];
  if (bundleTypes.length === 0) {
    console.warn('WARN: No bundle_types defined in output contract. Running basic directory check.');
  }

  for (const bundleType of bundleTypes) {
    const bundleFindings = inspectBundle(bundleRoot, bundleType, frameworkRoot);
    allFindings.push(...bundleFindings);
  }

  // If no bundle types defined, at least check if it's a non-empty directory
  if (bundleTypes.length === 0) {
    allFindings.push({
      severity: 'info',
      code: 'NO_BUNDLE_TYPES',
      message: 'No bundle_types defined; structural validation skipped.',
      path: bundleRoot
    });
  }
} else {
  const outputRoot = path.resolve(outputArg);
  if (!exists(outputRoot) || !isDir(outputRoot)) die(`Output root not found: ${outputRoot}`);

  const outputFindings = inspectOutputs(outputRoot, contract, frameworkRoot);
  allFindings.push(...outputFindings);
  const stageReceipt = stageReceiptPath ? readJson(path.resolve(stageReceiptPath)) : null;
  boundaryVerdict = validateOutputBoundary(outputRoot, contract, stageReceipt);
  allFindings.push(...boundaryVerdict.findings);
}

const readiness = computeOutputReadiness(allFindings);

// Print findings grouped by severity
const severityOrder = ['blocker', 'warning', 'info'];
for (const sev of severityOrder) {
  const items = allFindings.filter((f) => f.severity === sev);
  if (items.length === 0) continue;
  console.log(`\n${sev.toUpperCase()} (${items.length}):`);
  for (const item of items) {
    console.log(`  [${item.code}] ${item.message}`);
    if (item.path) console.log(`    path: ${item.path}`);
  }
}

console.log(`\n--- Output Readiness (Structural Only) ---`);
console.log(`Ready: ${readiness.ready}`);
console.log(`Blockers: ${readiness.blockerCount}`);
console.log(`Warnings: ${readiness.warningCount}`);
console.log(`Note: This validates structure only. Content quality requires LLM-driven semantic review.`);

// Write report if requested
if (reportPath) {
  const report = {
    ready: readiness.ready,
    blocker_count: readiness.blockerCount,
    warning_count: readiness.warningCount,
    compatibility_mode: compatibility,
    findings: allFindings,
    boundary_verdict: boundaryVerdict,
    validated_at: new Date().toISOString()
  };
  writeJson(path.resolve(reportPath), report);
  console.log(`\nReport written to: ${reportPath}`);
}

process.exit(readiness.ready ? 0 : 1);
