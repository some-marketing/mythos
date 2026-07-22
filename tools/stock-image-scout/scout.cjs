#!/usr/bin/env node
'use strict';

/**
 * scout.cjs — Stock Image Scout orchestrator CLI.
 *
 * Exposes a credit-conserving scouting workflow with NO download or licensing code paths.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const { registerProvider, getProvider, checkSession, search } = require('./lib/provider-contract.cjs');
const sessionHelper = require('./lib/auth/session.cjs');
const config = require('./config.json');

// Register providers
registerProvider('depositphotos', require('./lib/adapters/depositphotos.cjs'));
registerProvider('unsplash', require('./lib/adapters/unsplash.cjs'));
registerProvider('shutterstock', require('./lib/adapters/shutterstock.cjs'));
registerProvider('adobe-stock', require('./lib/adapters/adobe-stock.cjs'));

// Parse arguments
const args = process.argv.slice(2);
const params = {
  keyword: '',
  provider: config.default_provider || 'depositphotos',
  orientation: 'horizontal',
  pages: 1,
  offline: false,
  login: false,
  output: ''
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--keyword' || arg === '-k') {
    params.keyword = args[++i];
  } else if (arg === '--provider' || arg === '-p') {
    params.provider = args[++i];
  } else if (arg === '--orientation' || arg === '-o') {
    params.orientation = args[++i];
  } else if (arg === '--pages' || arg === '-n') {
    params.pages = parseInt(args[++i], 10) || 1;
  } else if (arg === '--offline') {
    params.offline = true;
  } else if (arg === '--login') {
    params.login = true;
  } else if (arg === '--output' || arg === '-f') {
    params.output = args[++i];
  } else if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  }
}

function printHelp() {
  console.log(`
Stock Image Scout CLI

Usage:
  node scout.cjs --keyword <keyword> [options]
  node scout.cjs --login --provider depositphotos

Options:
  -k, --keyword       Keyword(s) to search for (can be comma-separated)
  -p, --provider      Provider name: depositphotos, unsplash, shutterstock, adobe-stock (default: depositphotos)
  -o, --orientation   Image orientation: horizontal, vertical, square (default: horizontal)
  -n, --pages         Number of pages to search (default: 1)
  --offline           Run in offline mode using local HTML fixtures (does not require live browser/creds)
  --login             Open headed browser window to manually log in and save session
  -f, --output        Output file to write JSON results to (otherwise output to stdout)
  -h, --help          Show help
`);
}

async function run() {
  const providerName = params.provider;
  const adapter = getProvider(providerName);
  if (!adapter) {
    console.error(`Error: Provider "${providerName}" is not registered.`);
    process.exit(1);
  }

  // Handle Login command
  if (params.login) {
    if (providerName !== 'depositphotos') {
      console.error(`Error: --login is only supported for browser-driven providers (like depositphotos).`);
      process.exit(1);
    }
    try {
      const checkSessionFn = require('./lib/adapters/depositphotos.cjs').checkSession;
      await sessionHelper.performManualLogin(
        { chromium },
        'depositphotos',
        'https://depositphotos.com/login.html',
        checkSessionFn
      );
      process.exit(0);
    } catch (err) {
      console.error(`Manual login failed: ${err.message}`);
      process.exit(1);
    }
  }

  if (!params.keyword) {
    console.error(`Error: --keyword is required.`);
    printHelp();
    process.exit(1);
  }

  const keywords = params.keyword.split(',').map(k => k.trim()).filter(Boolean);
  let results = [];

  if (params.offline) {
    // OFFLINE MODE
    if (providerName === 'depositphotos') {
      const fixturePath = path.resolve(__dirname, '__fixtures__/depositphotos-search.html');
      if (!fs.existsSync(fixturePath)) {
        console.error(`Error: Fixture file not found at ${fixturePath}`);
        process.exit(1);
      }
      const html = fs.readFileSync(fixturePath, 'utf8');
      
      for (const kw of keywords) {
        const kwResults = await search('depositphotos', html, {
          keyword: kw,
          orientation: params.orientation,
          offset: 0
        });
        results.push(...kwResults);
      }
    } else if (providerName === 'unsplash') {
      for (const kw of keywords) {
        const kwResults = await search('unsplash', null, {
          keyword: kw,
          orientation: params.orientation,
          offset: 1
        });
        results.push(...kwResults);
      }
    } else {
      console.error(`Offline search is not supported for provider: ${providerName}`);
      process.exit(1);
    }
  } else {
    // LIVE MODE
    if (providerName === 'depositphotos') {
      const sessionPath = await sessionHelper.loadSession('depositphotos');
      if (!sessionPath) {
        console.error(`Error: No saved authenticated session found for ${providerName}.`);
        console.error(`Please run "node scout.cjs --login --provider ${providerName}" first.`);
        process.exit(1);
      }

      console.warn(`Launching headless browser using storageState: ${sessionPath}`);
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ storageState: sessionPath });
      const page = await context.newPage();

      try {
        await page.goto('https://depositphotos.com/', { waitUntil: 'domcontentloaded' });
        const sessionStatus = await checkSession('depositphotos', page);
        if (!sessionStatus.logged_in) {
          console.error(`Error: Session expired or invalid. Please re-run login command.`);
          await browser.close();
          process.exit(1);
        }

        for (const kw of keywords) {
          for (let pageNum = 0; pageNum < params.pages; pageNum++) {
            const offset = pageNum * 100;
            const kwResults = await search('depositphotos', page, {
              keyword: kw,
              orientation: params.orientation,
              offset
            });
            results.push(...kwResults);
          }
        }
      } finally {
        await browser.close();
      }
    } else if (providerName === 'unsplash') {
      const hasKey = process.env.UNSPLASH_ACCESS_KEY;
      if (!hasKey) {
        console.warn(`WARNING: UNSPLASH_ACCESS_KEY environment variable is not set. Using mock results.`);
      }
      for (const kw of keywords) {
        for (let pageNum = 1; pageNum <= params.pages; pageNum++) {
          const kwResults = await search('unsplash', null, {
            keyword: kw,
            orientation: params.orientation,
            offset: pageNum
          });
          results.push(...kwResults);
        }
      }
    } else {
      try {
        for (const kw of keywords) {
          await search(providerName, null, { keyword: kw });
        }
      } catch (err) {
        console.error(`Error running search: ${err.message}`);
        process.exit(1);
      }
    }
  }

  const uniqueResults = [];
  const seenIds = new Set();
  for (const item of results) {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      uniqueResults.push(item);
    }
  }

  const outputData = JSON.stringify(uniqueResults, null, 2);

  if (params.output) {
    const outPath = path.resolve(params.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, outputData, 'utf8');
    console.log(`Successfully wrote ${uniqueResults.length} candidates to ${params.output}`);
  } else {
    console.log(outputData);
  }
}

run().catch(err => {
  console.error(`Fatal error: ${err.stack}`);
  process.exit(1);
});
