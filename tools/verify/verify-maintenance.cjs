#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
  addCheck,
  createSignal,
  printJsonOutput,
  printSummary,
  writeSignal
} = require('./lib/signal.cjs');

const projectRoot = path.resolve(__dirname, '../..');
const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
const signal = createSignal('verify-maintenance', 'closeout-maintenance');

function latestMaintenanceReportJson() {
  if (!fs.existsSync(analysisDir)) return null;
  const files = fs.readdirSync(analysisDir)
    .filter((name) => /^closeout-maintenance__.+\.json$/.test(name))
    .sort((a, b) => {
      const aTime = fs.statSync(path.join(analysisDir, a)).mtimeMs;
      const bTime = fs.statSync(path.join(analysisDir, b)).mtimeMs;
      return bTime - aTime;
    });
  if (files.length === 0) return null;
  return path.join(analysisDir, files[0]);
}

function safeParse(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

const reportPath = latestMaintenanceReportJson();
addCheck(signal, {
  id: 'maintenance.report_exists',
  category: 'maintenance',
  severity: 'warning',
  message: 'A closeout maintenance report exists',
  test: () => Boolean(reportPath),
  detail: reportPath ? path.relative(projectRoot, reportPath) : 'No closeout-maintenance__*.json report found',
  fix_hint: reportPath ? undefined : 'Run node tools/maintenance/closeout-maintenance.js --execute'
});

const report = reportPath ? safeParse(reportPath) : null;
addCheck(signal, {
  id: 'maintenance.report_schema',
  category: 'maintenance',
  severity: 'warning',
  message: 'Latest closeout maintenance report has the expected schema',
  test: () => Boolean(report && report.schema === 'CloseoutMaintenance/1.0'),
  detail: report ? `schema=${report.schema || 'missing'}` : 'Could not parse maintenance report',
  fix_hint: report ? undefined : 'Regenerate the latest maintenance report'
});

if (report) {
  addCheck(signal, {
    id: 'maintenance.clearance',
    category: 'maintenance',
    severity: 'warning',
    message: 'Latest maintenance report is not blocked by unresolved auto-fixable conditions',
    test: () => {
      const unresolved = Array.isArray(report.unresolved_conditions) ? report.unresolved_conditions : [];
      return unresolved.filter((condition) => condition.auto_fixable).length === 0;
    },
    detail: `clearance=${report.clearance}; unresolved=${Array.isArray(report.unresolved_conditions) ? report.unresolved_conditions.length : 0}`,
    fix_hint: 'Run node tools/maintenance/closeout-maintenance.js --execute and resolve remaining maintenance signals'
  });
}

const outputPath = path.join(projectRoot, '_dev', 'reports', 'signals', 'verify-maintenance.signal.json');
if (!printJsonOutput(signal)) {
  writeSignal(signal, outputPath);
  printSummary(signal);
  console.log(`\nSignal: ${outputPath}`);
}

process.exit(signal.gate_decision.proceed ? 0 : 1);
