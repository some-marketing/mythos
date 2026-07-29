#!/usr/bin/env node
'use strict';

// Live-read probe (plan step 3, moxie-crm-integration). Makes ONE read-only
// GET against a list endpoint and reports a SANITIZED shape: envelope keys,
// item count, inferred field schema (names + types), and pagination hints.
// Field VALUES are never printed to stdout — client/invoice data is private
// surface. Pass --save <path> to write the raw response body to a local file
// (for build reference; keep such files out of git).
//
// Usage (through the credential resolver):
//   tools/mcp/crm/run-with-op.sh node tools/mcp/crm/probe.js clients
//   tools/mcp/crm/run-with-op.sh node tools/mcp/crm/probe.js invoices \
//     --per-page 2 --save /tmp/invoices-raw.json
//
// Options:
//   <endpoint>        Path under the workspace base URL. Default: clients.
//   --page <n>        Page number to request. Default: 1.
//   --per-page <n>    Page size to request. Default: 3 (probe stays tiny).
//   --no-paging       Omit page/per_page query params entirely.
//   --save <path>     Write raw response JSON to this path (0600).

const fs = require('fs');
const { loadCrmConfig } = require('./config');
const { createMoxieClient } = require('./client');

function parseArgs(argv) {
  const args = { endpoint: 'clients', page: 1, perPage: 3, paging: true, save: null, extraQuery: {} };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--q') { const [k, ...v] = String(rest[++i]).split('='); args.extraQuery[k] = v.join('='); }
    else if (a === '--page') args.page = Number(rest[++i]);
    else if (a === '--per-page') args.perPage = Number(rest[++i]);
    else if (a === '--no-paging') args.paging = false;
    else if (a === '--save') args.save = rest[++i];
    else if (!a.startsWith('--')) args.endpoint = a.replace(/^\//, '');
  }
  return args;
}

// Recursively infer a value's shape without echoing its content.
function inferShape(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array(empty)';
    return { [`array(${value.length})`]: inferShape(value[0], depth + 1) };
  }
  const type = typeof value;
  if (type === 'object') {
    if (depth > 4) return 'object(...)';
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = inferShape(v, depth + 1);
    return out;
  }
  if (type === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'string(date-like)';
    return `string(len ${value.length})`;
  }
  return type;
}

async function main() {
  const args = parseArgs(process.argv);
  const config = loadCrmConfig();
  if (config.dryRun) {
    console.error('[probe] CRM_DRY_RUN=true — refusing to fake a live probe. Invoke via run-with-op.sh.');
    process.exit(1);
  }
  const client = createMoxieClient(config.moxie);
  const query = { ...(args.paging ? { page: args.page, per_page: args.perPage } : {}), ...args.extraQuery };

  const started = Date.now();
  const body = await client.get(args.endpoint, query);
  const elapsed = Date.now() - started;

  const report = {
    endpoint: args.endpoint,
    query,
    elapsed_ms: elapsed,
    envelope: Array.isArray(body) ? `bare-array(${body.length})` : Object.keys(body || {}),
    item_count: Array.isArray(body) ? body.length : (Array.isArray(body && body.data) ? body.data.length : null),
    shape: inferShape(body)
  };
  console.log(JSON.stringify(report, null, 2));

  if (args.save) {
    fs.writeFileSync(args.save, JSON.stringify(body, null, 2), { mode: 0o600 });
    console.error(`[probe] raw response saved: ${args.save}`);
  }
}

main().catch((error) => {
  const status = error && error.response && error.response.status;
  console.error(`[probe] FAILED${status ? ` (HTTP ${status})` : ''}: ${error.message}`);
  process.exit(1);
});
