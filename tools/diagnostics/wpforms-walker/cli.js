#!/usr/bin/env node
'use strict';

// wpforms-walker CLI — one-shot locator_map.json generator.
//
// Walks a multi-page WPForms form once via Playwright, snapshots each page's
// interactive elements, and emits a DRAFT locator_map.json conformant to the
// frameworks/wordpress/qa schema (locator_maps/wpforms_apply.default.json).
//
// Operator is expected to hand-edit the draft for correctness before
// committing it as a QA testcase locator_map.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { generateLocatorMap } = require('./generate-locator-map');

function parseArgs(argv) {
  const out = { config: null, headless: true, outDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config' || a === '-c') out.config = argv[++i];
    else if (a === '--headed') out.headless = false;
    else if (a === '--out') out.outDir = argv[++i];
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else if (!out.config) out.config = a;
  }
  return out;
}

function printHelp() {
  process.stdout.write([
    'wpforms-walker — generate a draft locator_map.json by walking a multi-page WPForm.',
    '',
    'Usage:',
    '  node tools/diagnostics/wpforms-walker/cli.js -c <name|path>',
    '',
    'Flags:',
    '  --headed         Show the browser',
    '  --out <dir>      Output dir (default: _dev/reports/wpforms-walker)',
    '',
    'Config (JSON) keys:',
    '  url, formId, maxPages, answers, answersByPage, choiceFor',
    '',
    'Output: a draft locator_map.json conformant to wordpress/qa schema.',
    'Hand-edit before committing under frameworks/wordpress/qa/testcases/<id>/locator_map.json',
    '',
  ].join('\n'));
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.config) { printHelp(); process.exit(2); }

  const configPath = fs.existsSync(args.config)
    ? args.config
    : path.join(__dirname, 'configs', args.config.endsWith('.json') ? args.config : args.config + '.json');
  if (!fs.existsSync(configPath)) { console.error('Config not found:', args.config); process.exit(2); }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const browser = await chromium.launch({ headless: args.headless });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto(config.url, { waitUntil: 'networkidle', timeout: 60000 });
  const result = await generateLocatorMap(page, config);
  await browser.close();

  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const outDir = args.outDir || path.join(repoRoot, '_dev', 'reports', 'wpforms-walker');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = (config.id || path.basename(configPath, '.json')).replace(/[^a-zA-Z0-9_-]/g, '-');
  const locatorPath = path.join(outDir, `${stamp}__${slug}__locator_map.draft.json`);
  const logPath = path.join(outDir, `${stamp}__${slug}__walk-log.json`);
  fs.writeFileSync(locatorPath, JSON.stringify(result.locatorMap, null, 2));
  fs.writeFileSync(logPath, JSON.stringify(result.walkLog, null, 2));
  console.log(locatorPath);
  console.error('walk-log:', logPath);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
