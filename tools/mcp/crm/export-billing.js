#!/usr/bin/env node
'use strict';

// Bookkeeping export CLI (plan step 4, moxie-crm-integration). Reads the raw
// pulled data + an optional harvested billing dataset from a local, GITIGNORED
// data dir and writes accountant-ready CSVs to a GITIGNORED export dir. All
// transforms live in ./billing/export.js (pure, tested offline); this shell
// only does filesystem I/O.
//
// Inputs (default dir: clients/YOUR_AGENCY/finance/raw/):
//   projects.json, clients.json   raw pull output (bare arrays) — CONTRACTED lane.
//   billing.json                  Billing interchange dataset (invoices +
//                                 payments) harvested from the Moxie web app —
//                                 TRANSACTIONAL lane. See billing/schema.js.
//                                 Absent → the transactional CSVs are header-only.
//
// Outputs (default dir: clients/YOUR_AGENCY/finance/export/):
//   invoice-register.csv          issued invoices        (transactional)
//   payments.csv                  received payments      (transactional)
//   monthly-summary.csv           per-month invoiced/collected (transactional)
//   engagements.csv               active project fee terms    (contracted)
//   recurring-monthly-summary.csv MRR by currency             (contracted)
//
// Record VALUES are never printed to stdout — only row counts. Outputs contain
// real financial data and must stay in the gitignored dir.
//
// Usage:
//   node tools/mcp/crm/export-billing.js
//   node tools/mcp/crm/export-billing.js --raw <dir> --out <dir> --billing <file>

const fs = require('fs');
const path = require('node:path');

const {
  toCsv,
  INVOICE_COLUMNS, PAYMENT_COLUMNS, MONTHLY_COLUMNS,
  ENGAGEMENT_COLUMNS, RECURRING_COLUMNS,
  buildInvoiceRegister, buildPayments, buildMonthlySummary,
  buildEngagements, buildRecurringMonthlySummary
} = require('./billing/export');
const { coerceDataset } = require('./billing/schema');

function repoRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

function parseArgs(argv) {
  const args = { raw: null, out: null, billing: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--raw') args.raw = rest[++i];
    else if (rest[i] === '--out') args.out = rest[++i];
    else if (rest[i] === '--billing') args.billing = rest[++i];
  }
  return args;
}

// Reads a JSON file that should hold a list; tolerates both a bare array (how
// pull.js writes real data) and a { data: [...] } wrapper. Missing file → [].
function readJsonArray(file) {
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.data)) return parsed.data;
  return [];
}

function readDataset(file) {
  if (!file || !fs.existsSync(file)) return coerceDataset(null);
  return coerceDataset(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function main() {
  const args = parseArgs(process.argv);
  const rawDir = args.raw || path.join(repoRoot(), 'clients', 'YOUR_AGENCY', 'finance', 'raw');
  const outDir = args.out || path.join(repoRoot(), 'clients', 'YOUR_AGENCY', 'finance', 'export');
  const billingFile = args.billing || path.join(rawDir, 'billing.json');

  const projects = readJsonArray(path.join(rawDir, 'projects.json'));
  const clients = readJsonArray(path.join(rawDir, 'clients.json'));
  const dataset = readDataset(billingFile);

  const outputs = [
    { file: 'invoice-register.csv', rows: buildInvoiceRegister(dataset), columns: INVOICE_COLUMNS, lane: 'transactional' },
    { file: 'payments.csv', rows: buildPayments(dataset), columns: PAYMENT_COLUMNS, lane: 'transactional' },
    { file: 'monthly-summary.csv', rows: buildMonthlySummary(dataset), columns: MONTHLY_COLUMNS, lane: 'transactional' },
    { file: 'engagements.csv', rows: buildEngagements(projects, clients), columns: ENGAGEMENT_COLUMNS, lane: 'contracted' },
    { file: 'recurring-monthly-summary.csv', rows: buildRecurringMonthlySummary(projects, clients), columns: RECURRING_COLUMNS, lane: 'contracted' }
  ];

  fs.mkdirSync(outDir, { recursive: true });
  for (const o of outputs) {
    fs.writeFileSync(path.join(outDir, o.file), toCsv(o.rows, o.columns), { mode: 0o600 });
    console.log(`  ${o.lane.padEnd(13)} ${o.file.padEnd(30)} ${String(o.rows.length).padStart(4)} rows`);
  }

  if (dataset.invoices.length === 0 && dataset.payments.length === 0) {
    console.error('[export] transactional lane is empty — no billing.json harvest present.');
    console.error('[export] issued invoices + payments come from the Moxie web app (browser lane); see billing/schema.js.');
  }
  console.error(`[export] wrote ${outputs.length} CSVs to ${outDir} (gitignored). Values not logged.`);
}

if (require.main === module) {
  main();
}

module.exports = { readJsonArray, readDataset };
