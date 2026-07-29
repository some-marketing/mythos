#!/usr/bin/env node

/**
 * gemini-auth.js
 *
 * One-time interactive login to Google/Gemini. Opens a browser window,
 * waits for you to log in, then saves the session to a storage state
 * file for reuse by gemini-browser.js.
 *
 * Usage:
 *   node tools/ai-bridge/gemini-auth.js [--output <path>]
 *
 * Default storage location: ~/.Mythos/browser_profiles/gemini/storage_state.json
 *
 * The saved session can be reused until Google expires it (typically weeks).
 * Re-run this command to refresh an expired session.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_STORAGE_DIR = path.join(os.homedir(), '.Mythos', 'browser_profiles', 'gemini');
const DEFAULT_STORAGE_PATH = path.join(DEFAULT_STORAGE_DIR, 'storage_state.json');

function parseArgs(args) {
  const opts = { output: DEFAULT_STORAGE_PATH };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      opts.output = args[++i];
    }
    if (args[i] === '--help' || args[i] === '-h') {
      console.log(`Usage: node gemini-auth.js [--output <path>]

One-time login to Google/Gemini. Opens a browser — log in manually,
then the session is saved for reuse.

Options:
  --output <path>  Where to save the session (default: ${DEFAULT_STORAGE_PATH})
  --help, -h       Show this help

Re-run this command any time the session expires.
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

  console.log('=== Gemini Auth Setup ===\n');
  console.log('A browser window will open. Please:');
  console.log('  1. Log into your Google account (get@example-agency.com)');
  console.log('  2. Navigate to gemini.google.com if not redirected');
  console.log('  3. Confirm you see the Gemini chat interface');
  console.log('  4. Come back here and press Enter\n');
  console.log(`Session will be saved to: ${opts.output}\n`);

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(opts.output), { recursive: true });

  // Launch a clean browser (no profile — fresh start)
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }
  });

  const page = await context.newPage();

  // Navigate to Gemini (will redirect to Google login if not authenticated)
  console.log('Opening Gemini...');
  await page.goto('https://gemini.google.com/app', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  // Wait for the user to log in
  console.log('\nWaiting for you to log in...');
  console.log('(Watching for authenticated Gemini page)\n');

  // Poll until we see the authenticated Gemini UI
  const startTime = Date.now();
  const TIMEOUT = 5 * 60 * 1000; // 5 minutes to log in

  while (Date.now() - startTime < TIMEOUT) {
    await page.waitForTimeout(2000);

    const url = page.url();
    const isAuthenticated =
      url.includes('gemini.google.com/app') ||
      url.includes('gemini.google.com/chat');

    if (isAuthenticated) {
      // Check for sign-in button (means NOT actually logged in)
      const signInBtn = await page.$('button:has-text("Sign in")').catch(() => null);
      if (!signInBtn) {
        // Check for chat input (means fully loaded and logged in)
        const chatInput = await page.$('div[contenteditable="true"]').catch(() => null);
        if (chatInput) {
          console.log('✓ Authenticated! Chat input detected.');
          break;
        }
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    if (elapsed % 10 === 0) {
      console.log(`  ...waiting for login (${elapsed}s)`);
    }
  }

  if (Date.now() - startTime >= TIMEOUT) {
    await browser.close();
    die('Timeout waiting for login (5 minutes). Try again.');
  }

  // Save the storage state
  console.log('\nSaving session...');
  const storageState = await context.storageState();
  fs.writeFileSync(opts.output, JSON.stringify(storageState, null, 2) + '\n');

  const cookieCount = storageState.cookies?.length || 0;
  const originCount = storageState.origins?.length || 0;

  console.log(`\n✓ Session saved to: ${opts.output}`);
  console.log(`  Cookies: ${cookieCount}`);
  console.log(`  Origins: ${originCount}`);
  console.log('\nYou can now close the browser window.');
  console.log('Run `npm run ai:gemini:session-check` to verify.');

  await browser.close();
}

main().catch(err => {
  die(err.message);
});
