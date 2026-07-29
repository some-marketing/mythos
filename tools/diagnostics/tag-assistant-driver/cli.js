#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const driver = require('./driver');

function parseArgs(argv) {
  const out = { cdp: null, storageState: null, url: null, outDir: null, headless: true, debugDom: false, event: null, config: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cdp') out.cdp = argv[++i];
    else if (a === '--storage-state') out.storageState = argv[++i];
    else if (a === '--url') out.url = argv[++i];
    else if (a === '--config' || a === '-c') out.config = argv[++i];
    else if (a === '--out') out.outDir = argv[++i];
    else if (a === '--headed') out.headless = false;
    else if (a === '--debug-dom') out.debugDom = true;
    else if (a === '--event') out.event = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }

  // Resolve config for url-from-env pattern
  if (out.config) {
    const configPath = fs.existsSync(out.config)
      ? out.config
      : path.join(__dirname, 'configs', out.config.endsWith('.json') ? out.config : out.config + '.json');
    if (!fs.existsSync(configPath)) { console.error('Config not found:', out.config); process.exit(2); }
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!out.url && cfg.urlEnv && process.env[cfg.urlEnv]) out.url = process.env[cfg.urlEnv];
    out.configFile = configPath;
    out.configData = cfg;
  }
  return out;
}

function printHelp() {
  process.stdout.write([
    'tag-assistant-driver — Playwright-driven reader for tagassistant.google.com',
    '',
    'Usage:',
    '  node tools/diagnostics/tag-assistant-driver/cli.js --cdp ws://localhost:9222/devtools/browser/<id>',
    '  node tools/diagnostics/tag-assistant-driver/cli.js --storage-state path/to/auth.json',
    '',
    'Flags:',
    '  --cdp <endpoint>           Attach to running Chrome (must be launched with --remote-debugging-port=9222)',
    '  --storage-state <path>     Path to Playwright storageState JSON (Google auth)',
    '  --url <tagassistant-url>   Specific Tag Assistant URL to navigate to (defaults to https://tagassistant.google.com/)',
    '  -c, --config <name|path>   Load preset (configs/<name>.json) — URL can come from urlEnv',
    '  --event <idx>              Only inspect this event index (default: all)',
    '  --out <dir>                Output dir (default: _dev/reports/tag-assistant)',
    '  --headed                   Show browser (storage-state mode only)',
    '  --debug-dom                Also dump the live page HTML next to the report',
    '',
    'After Tag Assistant is paired and the page-under-test has fired some events,',
    'this tool captures: container info, event list, and per-event { dataLayer, tagsFired }.',
    '',
  ].join('\n'));
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.cdp && !args.storageState) { printHelp(); process.exit(2); }

  const { browser, page, mode } = await driver.attachOrLaunch(args);
  try {
    const snap = await driver.snapshot(page, { eventIndexes: args.event != null ? [args.event] : null });
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const outDir = args.outDir || path.join(repoRoot, '_dev', 'reports', 'tag-assistant');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outFile = path.join(outDir, `${stamp}__tag-assistant-${mode}.json`);
    fs.writeFileSync(outFile, JSON.stringify(snap, null, 2));
    if (args.debugDom) {
      const htmlPath = outFile.replace(/\.json$/, '.html');
      await driver.dumpHtmlSample(page, htmlPath);
      console.error('HTML dump:', htmlPath);
    }
    console.log(outFile);
  } finally {
    if (mode === 'cdp') await browser.close().catch(() => {});
    else await browser.close();
  }
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
