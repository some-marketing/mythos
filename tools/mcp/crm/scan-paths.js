#!/usr/bin/env node
'use strict';

// One-shot endpoint-path scanner for the live-read probe (plan step 3).
// Sends read-only GETs to candidate list-endpoint paths and prints ONLY the
// HTTP status per path — no response bodies, no values. Used to pin down
// Moxie's real path convention, which its help center does not publish.
//
// Usage: tools/mcp/crm/run-with-op.sh node tools/mcp/crm/scan-paths.js [path ...]

const { loadCrmConfig } = require('./config');
const { createMoxieClient } = require('./client');

const DEFAULT_CANDIDATES = [
  '', // base URL itself
  'clients',
  'clients/list',
  'clients/search',
  'client/list',
  'contacts',
  'contacts/search',
  'projects',
  'projects/search',
  'invoices',
  'invoices/list',
  'invoices/search-payable',
  'payable-invoices'
];

async function main() {
  const config = loadCrmConfig();
  if (config.dryRun) {
    console.error('[scan] CRM_DRY_RUN=true — invoke via run-with-op.sh.');
    process.exit(1);
  }
  const candidates = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_CANDIDATES;
  const client = createMoxieClient({ ...config.moxie, maxRetries: 0 });

  for (const path of candidates) {
    try {
      const body = await client.get(path, {});
      const kind = Array.isArray(body) ? `array(${body.length})` : typeof body;
      console.log(`200 ${path || '(base)'} -> ${kind}`);
    } catch (error) {
      const status = (error && error.response && error.response.status) || 'ERR';
      console.log(`${status} ${path || '(base)'}`);
    }
  }
}

main().catch((e) => { console.error('[scan] fatal:', e.message); process.exit(1); });
