#!/usr/bin/env node
'use strict';

// live-tab-instrument: emit the inject payload as a string (or write a bookmarklet).
// Use this when you can't drive the browser from headless Playwright — e.g., when
// the tab is already authenticated and you want to instrument it in place.
//
// Modes:
//   index.js              → prints the raw injectable JS to stdout
//   index.js --bookmarklet → wraps as javascript: URL
//   index.js --copy       → copies the JS to the macOS clipboard

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SRC = path.join(__dirname, 'inject.js');

function main() {
  const args = process.argv.slice(2);
  const payload = fs.readFileSync(SRC, 'utf8');

  if (args.includes('--bookmarklet')) {
    const compact = 'javascript:' + encodeURIComponent(payload);
    process.stdout.write(compact + '\n');
    return;
  }
  if (args.includes('--copy')) {
    try {
      execSync('pbcopy', { input: payload });
      console.error('Copied %d bytes of injectable JS to clipboard. Paste into the target tab\'s DevTools console.', payload.length);
      return;
    } catch (e) {
      console.error('pbcopy failed:', e.message);
      process.exit(1);
    }
  }
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write([
      'live-tab-instrument — emit injectable JS for live-tab dataLayer + beacon capture.',
      '',
      'Usage:',
      '  node tools/diagnostics/live-tab-instrument/index.js              # print payload to stdout',
      '  node tools/diagnostics/live-tab-instrument/index.js --copy       # copy to macOS clipboard',
      '  node tools/diagnostics/live-tab-instrument/index.js --bookmarklet # emit javascript:URL form',
      '',
      'After injection (paste into DevTools console of the tab):',
      '  - Perform the action (submit form, click conversion, etc.)',
      '  - Read state: window.__livProbe.dump()',
      '  - Quick summary: window.__livProbe.summary()',
      '  - Reset captures (keep hooks): window.__livProbe.reset()',
      '',
    ].join('\n'));
    return;
  }
  process.stdout.write(payload);
}

main();
