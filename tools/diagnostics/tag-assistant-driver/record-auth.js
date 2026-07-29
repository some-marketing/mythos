#!/usr/bin/env node
'use strict';

// record-auth.js — one-time interactive recording of a Google login for
// tagassistant.google.com. Wraps the QA framework's storage-state pattern.
//
// Operator runs once. A headed Chromium window opens at tagassistant.google.com.
// Operator signs in with the Google account that has access to the target GTM
// container(s). Operator confirms in the terminal. Storage state is written to
// a path OUTSIDE the repo (default ~/.Mythos/auth/tagassistant.storage.json).
//
// After this, the tag-assistant-driver can attach headlessly via --storage-state.

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');

function parseArgs(argv) {
  const out = { out: null, url: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out.out = argv[++i];
    else if (a === '--url') out.url = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  process.stdout.write([
    'record-auth — record a Google login storage state for tagassistant.google.com',
    '',
    'Usage:',
    '  node tools/diagnostics/tag-assistant-driver/record-auth.js [--out <path>] [--url <tag-assistant-url>]',
    '',
    'Defaults:',
    '  --out   ~/.Mythos/auth/tagassistant.storage.json   (outside repo, gitignored target)',
    '  --url   https://tagassistant.google.com/',
    '',
    'Flow:',
    '  1. A headed Chromium window opens.',
    '  2. Sign in with the Google account that has GTM container access.',
    '  3. Wait until the Tag Assistant home (or your container view) loads.',
    '  4. Press Enter in this terminal to save and close.',
    '',
    'After recording, the storage state can be reused headlessly:',
    '  node tools/diagnostics/tag-assistant-driver/cli.js --storage-state <out-path> --config {CLIENT_CODE}',
    '',
    'Note: storage state contains active Google session cookies. Keep it outside the repo.',
    'Never commit. Re-record when it expires (Google rotates sessions periodically).',
  ].join('\n') + '\n');
}

function defaultOut() {
  return path.join(os.homedir(), '.Mythos', 'auth', 'tagassistant.storage.json');
}

async function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }

  const outPath = args.out || defaultOut();
  const startUrl = args.url || 'https://tagassistant.google.com/';

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  console.error('\nLaunching headed Chromium → ' + startUrl);
  console.error('Out: ' + outPath);
  console.error('\nIn the browser:');
  console.error('  1. Sign in with the Google account that has GTM container access.');
  console.error('  2. Wait until tagassistant.google.com is loaded and authenticated.');
  console.error('  3. Return here and press Enter to save.\n');

  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(startUrl);

  await waitForEnter('Press Enter when signed in and ready to save... ');

  await ctx.storageState({ path: outPath });
  await browser.close();

  // Restrictive permissions: only the user can read the auth file.
  try { fs.chmodSync(outPath, 0o600); } catch (_) {}

  console.error('\nSaved storage state to: ' + outPath);
  console.error('Now you can run:');
  console.error('  node tools/diagnostics/tag-assistant-driver/cli.js --storage-state ' + outPath + ' --config {CLIENT_CODE}');
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
