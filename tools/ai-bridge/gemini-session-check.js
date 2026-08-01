#!/usr/bin/env node

/**
 * gemini-session-check.js
 *
 * Verify the saved Gemini session is still active.
 *
 * Usage:
 *   node tools/ai-bridge/gemini-session-check.js [--storage <path>]
 *
 * If no session exists, directs you to run gemini-auth.js first.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_STORAGE_PATH = path.join(
  os.homedir(), '.Mythos', 'browser_profiles', 'gemini', 'storage_state.json'
);

function parseArgs(args) {
  const opts = { storagePath: DEFAULT_STORAGE_PATH };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--storage' && args[i + 1]) {
      opts.storagePath = args[++i];
    }
    if (args[i] === '--help' || args[i] === '-h') {
      console.log(`Usage: node gemini-session-check.js [--storage <path>]

Checks if the saved Gemini session is still active.

Options:
  --storage <path>  Path to storage_state.json (default: ${DEFAULT_STORAGE_PATH})
  --help, -h        Show this help

If no session exists, run: npm run ai:gemini:auth
`);
      process.exit(0);
    }
  }
  return opts;
}

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Check if storage state file exists
  if (!fs.existsSync(opts.storagePath)) {
    die(
      `No saved session found at: ${opts.storagePath}\n\n` +
      'Run this to log in and save your session:\n\n' +
      '  npm run ai:gemini:auth\n'
    );
  }

  const storageState = JSON.parse(fs.readFileSync(opts.storagePath, 'utf8'));
  const cookieCount = storageState.cookies?.length || 0;
  console.log(`Session file: ${opts.storagePath}`);
  console.log(`Cookies: ${cookieCount}`);

  // Load Playwright
  let chromium;
  try {
    chromium = require('playwright').chromium;
  } catch {
    try {
      chromium = require('playwright-core').chromium;
    } catch {
      die('Playwright is not installed.\nInstall: npm install --save-dev playwright');
    }
  }

  // Launch browser with saved session
  console.log('\nLaunching browser with saved session...');
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run']
  });

  const context = await browser.newContext({
    storageState: opts.storagePath,
    viewport: { width: 1280, height: 800 }
  });

  let page;
  try {
    page = await context.newPage();

    console.log('Navigating to gemini.google.com...');
    await page.goto('https://gemini.google.com/app', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(3000);

    const url = page.url();
    console.log(`Final URL: ${url}`);

    const isAuthenticated =
      url.includes('gemini.google.com/app') ||
      url.includes('gemini.google.com/chat');

    // Check for sign-in button
    const signInBtn = await page.$('button:has-text("Sign in")').catch(() => null);
    const hasChatInput = await page.$('div[contenteditable="true"]').catch(() => null);

    if (isAuthenticated && !signInBtn && hasChatInput) {
      const result = {
        status: 'active',
        storagePath: opts.storagePath,
        url,
        hasChatInput: true
      };

      console.log('\n✓ Gemini session is ACTIVE');
      console.log('✓ Chat input detected — ready for interaction');
      console.log(`\n${JSON.stringify(result, null, 2)}`);
    } else if (signInBtn) {
      console.log('\n✗ Session EXPIRED — Sign in button visible');
      console.log('Action: Re-run `npm run ai:gemini:auth` to refresh.');

      const result = { status: 'expired', storagePath: opts.storagePath, url };
      console.log(`\n${JSON.stringify(result, null, 2)}`);
      process.exitCode = 1;
    } else {
      console.log('\n? Session status UNKNOWN');
      const result = { status: 'unknown', storagePath: opts.storagePath, url };
      console.log(`\n${JSON.stringify(result, null, 2)}`);
      process.exitCode = 1;
    }
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch(err => {
  die(err.message);
});
