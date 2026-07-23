#!/usr/bin/env node

/**
 * perplexity-auth.js
 *
 * One-time interactive login to Perplexity. Opens a browser window,
 * waits for you to log in, then saves the session to a storage state
 * file for reuse by perplexity-browser.js.
 *
 * Usage:
 *   node tools/ai-bridge/perplexity-auth.js [--output <path>]
 *
 * Default storage location: ~/.Mythos/browser_profiles/perplexity/storage_state.json
 *
 * The saved session can be reused until Perplexity expires it.
 * Re-run this command to refresh an expired session.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_STORAGE_DIR = path.join(os.homedir(), '.Mythos', 'browser_profiles', 'perplexity');
const DEFAULT_STORAGE_PATH = path.join(DEFAULT_STORAGE_DIR, 'storage_state.json');

function parseArgs(args) {
  const opts = { output: DEFAULT_STORAGE_PATH };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      opts.output = args[++i];
    }
    if (args[i] === '--help' || args[i] === '-h') {
      console.log(`Usage: node perplexity-auth.js [--output <path>]

One-time login to Perplexity. Opens a browser — log in manually,
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

  console.log('=== Perplexity Auth Setup ===\n');
  console.log('A browser window will open. Please:');
  console.log('  1. Log into your Perplexity account');
  console.log('  2. Confirm you see the Perplexity search interface');
  console.log('  3. The script will detect login automatically\n');
  console.log(`Session will be saved to: ${opts.output}\n`);

  fs.mkdirSync(path.dirname(opts.output), { recursive: true });

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

  console.log('Opening Perplexity...');
  await page.goto('https://www.perplexity.ai/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  console.log('\nWaiting for you to log in...');
  console.log('(Watching for authenticated Perplexity page)\n');

  const startTime = Date.now();
  const TIMEOUT = 5 * 60 * 1000;

  while (Date.now() - startTime < TIMEOUT) {
    await page.waitForTimeout(2000);

    // Check for authenticated state: look for the chat input and absence of login prompts
    const isAuthenticated = await page.evaluate(() => {
      // Look for indicators of logged-in state. Note: querySelectorAll only
      // accepts valid CSS — Playwright-only pseudo-classes like :has-text()
      // throw a SyntaxError here, so any text matching must be done in JS.
      const textarea = document.querySelector('textarea, [contenteditable="true"]');
      const hasInput = !!textarea;

      const signInRe = /sign\s*in|log\s*in/i;
      const candidateLinks = document.querySelectorAll('a[href*="login"], a[href*="signin"], button, a');
      const hasSignIn = Array.from(candidateLinks).some(
        (el) => el.offsetParent !== null && signInRe.test(el.textContent || '')
      );

      // Check for Pro badge or account menu as positive signals
      const proIndicators = document.querySelectorAll('[class*="pro" i], [class*="premium" i], [aria-label*="account" i], [aria-label*="profile" i]');

      return hasInput && (!hasSignIn || proIndicators.length > 0);
    }).catch(() => false);

    if (isAuthenticated) {
      console.log('Authenticated! Perplexity interface detected.');
      break;
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

  // Give a moment for all cookies to settle
  await page.waitForTimeout(2000);

  console.log('\nSaving session...');
  const storageState = await context.storageState();
  fs.writeFileSync(opts.output, JSON.stringify(storageState, null, 2) + '\n');

  const cookieCount = storageState.cookies?.length || 0;
  const originCount = storageState.origins?.length || 0;

  console.log(`\nSession saved to: ${opts.output}`);
  console.log(`  Cookies: ${cookieCount}`);
  console.log(`  Origins: ${originCount}`);
  console.log('\nYou can now close the browser window.');

  await browser.close();
}

main().catch(err => {
  die(err.message);
});
