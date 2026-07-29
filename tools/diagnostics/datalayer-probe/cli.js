#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { runProbe } = require('./probe');

function parseArgs(argv) {
  const out = { config: null, headless: true, outDir: null, interceptSubmit: undefined, captureBeacons: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config' || a === '-c') out.config = argv[++i];
    else if (a === '--headed') out.headless = false;
    else if (a === '--out') out.outDir = argv[++i];
    else if (a === '--intercept-submit') out.interceptSubmit = true;
    else if (a === '--no-beacons') out.captureBeacons = false;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else if (!out.config) out.config = a;
  }
  return out;
}

function printHelp() {
  process.stdout.write([
    'datalayer-probe — Playwright probe for dataLayer.push calls and form field state.',
    '',
    'Usage:',
    '  node tools/diagnostics/datalayer-probe/cli.js --config <path>',
    '  node tools/diagnostics/datalayer-probe/cli.js -c <name>      # resolves to configs/<name>.json',
    '',
    'Flags:',
    '  --headed             Run browser headed (visible) instead of headless',
    '  --intercept-submit   Monkey-patch WPForms AJAX submit so the confirmation observer fires without producing a real lead',
    '  --no-beacons         Disable network beacon capture',
    '  --out <dir>          Write artifact under <dir> (default: _dev/reports/datalayer-probes)',
    '  -h, --help     Show this help',
    '',
  ].join('\n'));
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.config) { printHelp(); process.exit(2); }

  let configPath = args.config;
  if (!fs.existsSync(configPath)) {
    const named = path.join(__dirname, 'configs', args.config.endsWith('.json') ? args.config : args.config + '.json');
    if (fs.existsSync(named)) configPath = named;
    else { console.error('Config not found:', args.config); process.exit(2); }
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const artifact = await runProbe(config, {
    headless: args.headless,
    interceptSubmit: args.interceptSubmit,
    captureBeacons: args.captureBeacons,
  });

  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const outDir = args.outDir || path.join(repoRoot, '_dev', 'reports', 'datalayer-probes');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = (config.id || path.basename(configPath, '.json')).replace(/[^a-zA-Z0-9_-]/g, '-');
  const outFile = path.join(outDir, `${stamp}__${slug}.json`);
  fs.writeFileSync(outFile, JSON.stringify(artifact, null, 2));
  console.log(outFile);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
