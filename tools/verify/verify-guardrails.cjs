#!/usr/bin/env node
/**
 * verify-guardrails.cjs — Validate guardrails file has required sections.
 *
 * Usage: node tools/verify/verify-guardrails.cjs [path-to-guardrails.md]
 *   Default: .claude/guardrails.md
 *
 * Validates: section presence (case-insensitive heading search).
 *
 * Exit code 0 = PASS/WARN, 1 = FAIL
 */

const fs = require('fs');
const path = require('path');
const { createSignal, addCheck, writeSignal, printSummary, printJsonOutput } = require('./lib/signal.cjs');
const checks = require('./lib/checks.cjs');

const projectRoot = path.resolve(__dirname, '../..');
const guardrailsArg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const guardrailsPath = guardrailsArg
  ? path.resolve(guardrailsArg)
  : path.join(projectRoot, '.claude/guardrails.md');

const signal = createSignal('verify-guardrails', `guardrails:${path.relative(projectRoot, guardrailsPath)}`);

// ─── File existence ──────────────────────────────────────────────────────

addCheck(signal, checks.fileExists(guardrailsPath, {
  id: 'guardrails.exists',
  message: `Guardrails file exists: ${path.relative(projectRoot, guardrailsPath)}`
}));

// ─── Required sections (critical) ────────────────────────────────────────

const criticalSections = [
  { search: 'execution mode', id: 'execution_modes', label: 'Execution Modes' },
  { search: 'observational reporting', id: 'observational_reporting', label: 'Observational Reporting' }
];

for (const section of criticalSections) {
  addCheck(signal, checks.fileContains(guardrailsPath, section.search, {
    id: `guardrails.section.${section.id}`,
    category: 'sections',
    severity: 'critical',
    message: `Has ${section.label} section`,
    caseInsensitive: true
  }));
}

// ─── Recommended sections (warning) ──────────────────────────────────────

const recommendedSections = [
  { search: 'forbidden labels', id: 'forbidden_labels', label: 'Forbidden Labels' },
  { search: 'required labels', id: 'required_labels', label: 'Required Labels' },
  { search: 'evidence standards', id: 'evidence_standards', label: 'Evidence Standards' },
  { search: 'file modification', id: 'file_modification', label: 'File Modification Rules' },
  { search: 'data safety', id: 'data_safety', label: 'Data Safety' },
  { search: 'mode checklist', id: 'mode_checklists', label: 'Mode Checklists' }
];

for (const section of recommendedSections) {
  addCheck(signal, checks.fileContains(guardrailsPath, section.search, {
    id: `guardrails.section.${section.id}`,
    category: 'sections',
    severity: 'warning',
    message: `Has ${section.label} section`,
    caseInsensitive: true
  }));
}

// ─── Content quality checks ──────────────────────────────────────────────

// Check that forbidden labels section actually lists forbidden terms
addCheck(signal, checks.fileContains(guardrailsPath, 'Root Cause', {
  id: 'guardrails.forbidden_terms_listed',
  category: 'content',
  severity: 'warning',
  message: 'Forbidden labels section lists specific banned terms (e.g., Root Cause)',
  caseInsensitive: false  // The term itself should appear as an example of what NOT to use
}));

// Check that required labels section lists required terms
addCheck(signal, checks.fileContains(guardrailsPath, 'Observation:', {
  id: 'guardrails.required_terms_listed',
  category: 'content',
  severity: 'warning',
  message: 'Required labels section lists specific required terms (e.g., Observation:)'
}));

// ─── Output ──────────────────────────────────────────────────────────────

if (!printJsonOutput(signal)) {
  const scratchDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const outputPath = path.join(scratchDir, 'verify-guardrails.signal.json');
  writeSignal(signal, outputPath);
  printSummary(signal);
  console.log(`\nSignal: ${outputPath}`);
}

process.exit(signal.gate_decision.proceed ? 0 : 1);
