#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { attach, snapshotContainer, parseContainerUrl, emitMcpPayloads } = require('./auditor');

function parseArgs(argv) {
  const out = { url: null, cdp: null, storageState: null, headless: true, out: null, triggerDetail: [], emitMcp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') out.url = argv[++i];
    else if (a === '--cdp') out.cdp = argv[++i];
    else if (a === '--storage-state') out.storageState = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--headed') out.headless = false;
    else if (a === '--trigger-detail') out.triggerDetail.push(argv[++i]);
    else if (a === '--emit-mcp-payloads') out.emitMcp = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }
  return out;
}

function printHelp() {
  process.stdout.write([
    'gtm-container-auditor — capture structured snapshot of a GTM container',
    '',
    'Usage:',
    '  # Mode 1: attach to operator\'s existing Chrome via CDP',
    '  node tools/diagnostics/gtm-container-auditor/cli.js --url <gtm-url> --cdp http://localhost:9222',
    '',
    '  # Mode 2: use recorded storage state (last resort)',
    '  node tools/diagnostics/gtm-container-auditor/cli.js --url <gtm-url> --storage-state <path>',
    '',
    '  # Mode 3: emit JS payloads for claude-in-chrome MCP eval (no Playwright)',
    '  node tools/diagnostics/gtm-container-auditor/cli.js --url <gtm-url> --emit-mcp-payloads',
    '',
    'Common flags:',
    '  --trigger-detail "<row-prefix>"   inspect a specific trigger\'s detail page (repeatable)',
    '  --out <dir>                       output dir (default: _dev/reports/gtm-audits)',
    '  --headed                          headed browser (storage-state mode)',
    '',
  ].join('\n'));
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) { printHelp(); process.exit(2); }
  const ids = parseContainerUrl(args.url);

  if (args.emitMcp) {
    const steps = emitMcpPayloads(ids, { triggerDetailRowPrefixes: args.triggerDetail });
    process.stdout.write(JSON.stringify({ ids, steps }, null, 2));
    return;
  }

  const session = await attach({ cdp: args.cdp, storageState: args.storageState, url: args.url, headless: args.headless });
  try {
    const snap = await snapshotContainer(session.page, ids, { triggerDetailRowPrefixes: args.triggerDetail });
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const outDir = args.out || path.join(repoRoot, '_dev', 'reports', 'gtm-audits');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outFile = path.join(outDir, `${stamp}__gtm-${ids.container}-ws${ids.workspace}.json`);
    fs.writeFileSync(outFile, JSON.stringify(snap, null, 2));
    console.log(outFile);
  } finally {
    if (session.detach) await session.detach();
  }
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
