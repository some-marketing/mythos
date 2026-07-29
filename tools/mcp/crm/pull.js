#!/usr/bin/env node
'use strict';

// Read-lane runner (plan step 4, moxie-crm-integration). Pulls every confirmed
// read endpoint via the provider and writes the raw JSON to a local, GITIGNORED
// data dir (default clients/YOUR_AGENCY/finance/raw/, which .gitignore covers as real
// financial data). GET-only — this lane has no write path.
//
// Field VALUES of the pulled records are NEVER printed to stdout (client data is
// private surface); only endpoint labels and row counts are logged. The raw
// files it writes contain real data and must stay in the gitignored dir.
//
// Usage (through the credential resolver, live mode):
//   tools/mcp/crm/run-with-op.sh node tools/mcp/crm/pull.js
//   tools/mcp/crm/run-with-op.sh node tools/mcp/crm/pull.js --out /some/dir
//
// Dry-run preview (no network, no api key needed): prints the planned request
// URLs and exits without writing. Base URL is required even in dry-run (the
// client builds the URL before short-circuiting), so supply MOXIE_BASE_URL:
//   CRM_DRY_RUN=true MOXIE_BASE_URL='https://podNN.withmoxie.dev/api/public/' \
//     node tools/mcp/crm/pull.js
//
// Note: the invoices endpoint (action/payableInvoices/search) exposes only
// currently-OUTSTANDING invoices, not history — it is written as
// `payable-invoices.json`, deliberately not `invoices.json`, so it is never
// mistaken for the full invoice register. Invoice history + payments come from
// the browser lane; see billing/schema.js.

const fs = require('fs');
const path = require('node:path');
const { loadCrmConfig } = require('./config');
const { createMoxieClient } = require('./client');
const { createMoxieProvider } = require('./providers/moxie');

// label → { method, file }. `method` is the provider method to call.
const ENDPOINTS = [
  { label: 'clients', method: 'listClients', file: 'clients.json' },
  { label: 'contacts', method: 'listContacts', file: 'contacts.json' },
  { label: 'projects', method: 'listProjects', file: 'projects.json' },
  { label: 'users', method: 'listUsers', file: 'users.json' },
  { label: 'payable-invoices', method: 'listInvoices', file: 'payable-invoices.json' }
];

// Calls each provider read method. Returns { label: result }, where result is
// either an array of rows (live mode) or a dry_run descriptor (dry-run mode).
// Pure w.r.t. the injected provider — testable with a fake provider offline.
async function pullAll(provider, endpoints = ENDPOINTS) {
  const out = {};
  for (const ep of endpoints) {
    out[ep.label] = await provider[ep.method]();
  }
  return out;
}

// Redacts the per-workspace base URL (origin + /api/public/ path) from a dry-run
// descriptor URL so it never reaches stdout/logs — only the action-relative path
// and query survive. The API key is never part of the URL to begin with.
function redactUrl(fullUrl, baseUrl) {
  if (!fullUrl) return '[redacted]';
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (base && fullUrl.startsWith(base)) {
    return `[MOXIE_BASE_URL]${fullUrl.slice(base.length)}`;
  }
  // Fallback (base not configured / mismatched): strip the origin (the host is
  // the sensitive part) and any /api/public/ prefix, keep the action path+query.
  try {
    const u = new URL(fullUrl);
    const rel = `${u.pathname}${u.search}`.replace(/^\/api\/public\//, '/');
    return `[MOXIE_BASE_URL]${rel}`;
  } catch {
    return '[redacted]';
  }
}

function parseArgs(argv) {
  const args = { out: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--out') args.out = rest[++i];
  }
  return args;
}

function defaultOutDir() {
  // tools/mcp/crm/pull.js → repo root is three levels up.
  return path.resolve(__dirname, '..', '..', '..', 'clients', 'YOUR_AGENCY', 'finance', 'raw');
}

async function main() {
  const args = parseArgs(process.argv);
  const config = loadCrmConfig();
  // config.dryRun is the top-level gate; client.js reads `dryRun` off its own
  // config object, so thread it in — otherwise a dry-run pull would still try
  // to go live through the provider.
  const client = createMoxieClient({ ...config.moxie, dryRun: config.dryRun });
  const provider = createMoxieProvider(client);

  const results = await pullAll(provider);

  if (config.dryRun) {
    console.error('[pull] CRM_DRY_RUN=true — no live read, nothing written. Planned requests (base URL redacted):');
    for (const ep of ENDPOINTS) {
      const r = results[ep.label];
      const shown = r && r.dry_run ? redactUrl(r.url, config.moxie.baseUrl) : '(unknown)';
      console.log(`  ${ep.label.padEnd(18)} GET ${shown}`);
    }
    console.error('[pull] Re-run via run-with-op.sh (live credentials) to write raw data.');
    return;
  }

  const outDir = args.out || defaultOutDir();
  fs.mkdirSync(outDir, { recursive: true });

  for (const ep of ENDPOINTS) {
    const rows = results[ep.label];
    const count = Array.isArray(rows) ? rows.length : 0;
    const dest = path.join(outDir, ep.file);
    fs.writeFileSync(dest, JSON.stringify(rows, null, 2), { mode: 0o600 });
    console.log(`  ${ep.label.padEnd(18)} ${String(count).padStart(4)} rows  → ${dest}`);
  }
  console.error(`[pull] wrote ${ENDPOINTS.length} files to ${outDir} (gitignored). Values not logged.`);
}

if (require.main === module) {
  main().catch((error) => {
    const status = error && error.response && error.response.status;
    console.error(`[pull] FAILED${status ? ` (HTTP ${status})` : ''}: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { pullAll, ENDPOINTS, defaultOutDir, redactUrl };
