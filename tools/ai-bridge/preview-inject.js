#!/usr/bin/env node

/**
 * preview-inject.js
 *
 * Inject modified HTML into a live page element and capture before/after
 * screenshots using Playwright.
 *
 * Usage:
 *   node tools/ai-bridge/preview-inject.js \
 *     --url "https://example.com" \
 *     --selector ".hero-section" \
 *     --html path/to/new.html \
 *     --output-dir _handoffs/preview/
 *
 * Exit codes:
 *   0 — success, before/after screenshots written
 *   1 — error (element not found, page timeout, etc.)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_STORAGE_PATH = path.join(
  os.homedir(), '.Mythos', 'browser_profiles', 'gemini', 'storage_state.json'
);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const opts = {
    url: null,
    selector: null,
    html: null,
    outputDir: null,
    viewport: 1440,
    storagePath: null,
    wait: 2000
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--url':
        opts.url = args[++i];
        break;
      case '--selector':
        opts.selector = args[++i];
        break;
      case '--html':
        opts.html = args[++i];
        break;
      case '--output-dir':
        opts.outputDir = args[++i];
        break;
      case '--viewport':
        opts.viewport = parseInt(args[++i], 10);
        break;
      case '--storage':
        opts.storagePath = args[++i];
        break;
      case '--wait':
        opts.wait = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        console.log(`Usage: node preview-inject.js --url <url> --selector <css> --html <file> --output-dir <path> [options]

Inject modified HTML into a live page element and capture before/after screenshots.

Required:
  --url <url>            Page URL to navigate to
  --selector <css>       CSS selector for the target element
  --html <file>          Path to HTML file containing replacement markup
  --output-dir <path>    Where to write screenshot files

Options:
  --viewport <width>     Viewport width in px (default: 1440)
  --storage <path>       Playwright storage state for auth
  --wait <ms>            Extra ms to wait after page load (default: 2000)
  --help, -h             Show this help

Output files:
  before.png             Element screenshot before injection
  before-fullpage.png    Full-page screenshot before injection
  after.png              Element screenshot after injection
  after-fullpage.png     Full-page screenshot after injection
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Try to locate the injected element. First attempts the original selector;
 * if that fails, falls back to finding by root tag + id from the injected HTML.
 */
async function findInjectedElement(page, selector, injectedHtml) {
  // Try original selector first
  let el = await page.$(selector);
  if (el) return el;

  // Parse root tag and id from injected HTML for fallback
  const tagMatch = injectedHtml.match(/^[\s]*<(\w+)/);
  const idMatch = injectedHtml.match(/^[\s]*<\w+[^>]*\bid=["']([^"']+)["']/);

  if (idMatch) {
    el = await page.$(`#${idMatch[1]}`);
    if (el) {
      console.log(`  (found after element via fallback: #${idMatch[1]})`);
      return el;
    }
  }

  if (tagMatch && idMatch) {
    el = await page.$(`${tagMatch[1]}#${idMatch[1]}`);
    if (el) {
      console.log(`  (found after element via fallback: ${tagMatch[1]}#${idMatch[1]})`);
      return el;
    }
  }

  if (tagMatch) {
    // Last resort — find by tag name alone (only useful if it's unique enough)
    const classMatch = injectedHtml.match(/^[\s]*<\w+[^>]*\bclass=["']([^"']+)["']/);
    if (classMatch) {
      const firstClass = classMatch[1].split(/\s+/)[0];
      el = await page.$(`${tagMatch[1]}.${firstClass}`);
      if (el) {
        console.log(`  (found after element via fallback: ${tagMatch[1]}.${firstClass})`);
        return el;
      }
    }
  }

  return null;
}

/**
 * Get bounding box dimensions for an element handle.
 */
async function getDimensions(elementHandle) {
  const box = await elementHandle.boundingBox();
  if (!box) return { width: 0, height: 0 };
  return { width: Math.round(box.width), height: Math.round(box.height) };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.url) die('--url is required');
  if (!opts.selector) die('--selector is required');
  if (!opts.html) die('--html is required');
  if (!opts.outputDir) die('--output-dir is required');

  // Validate HTML file exists
  const htmlPath = path.resolve(opts.html);
  if (!fs.existsSync(htmlPath)) {
    die(`HTML file not found: ${htmlPath}`);
  }
  const newHtml = fs.readFileSync(htmlPath, 'utf8');
  if (!newHtml.trim()) {
    die(`HTML file is empty: ${htmlPath}`);
  }

  // Resolve storage state
  let storagePath = opts.storagePath;
  if (!storagePath && fs.existsSync(DEFAULT_STORAGE_PATH)) {
    storagePath = DEFAULT_STORAGE_PATH;
  }

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

  const outputDir = path.resolve(opts.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`URL:      ${opts.url}`);
  console.log(`Selector: ${opts.selector}`);
  console.log(`HTML:     ${htmlPath}`);
  console.log(`Output:   ${outputDir}`);
  console.log(`Viewport: ${opts.viewport}x900`);
  console.log('');

  let browser, context;
  try {
    console.log('Launching browser...');
    const launchOpts = {
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check'
      ]
    };

    browser = await chromium.launch(launchOpts);

    const contextOpts = {
      viewport: { width: opts.viewport, height: 900 }
    };
    if (storagePath && fs.existsSync(storagePath)) {
      contextOpts.storageState = storagePath;
      console.log(`Using storage state: ${storagePath}`);
    }

    context = await browser.newContext(contextOpts);
    const page = await context.newPage();

    // Navigate
    console.log('Navigating...');
    await page.goto(opts.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(opts.wait);

    // --- BEFORE ---

    console.log(`Looking for: ${opts.selector}`);
    const beforeElement = await page.$(opts.selector);
    if (!beforeElement) {
      const debugPath = path.join(outputDir, 'debug_not_found.png');
      await page.screenshot({ path: debugPath }).catch(() => {});
      die(`Element not found: ${opts.selector}\nDebug screenshot: ${debugPath}`);
    }
    console.log('Element found');

    const beforeDims = await getDimensions(beforeElement);

    // Before element screenshot
    const beforePath = path.join(outputDir, 'before.png');
    await beforeElement.screenshot({ path: beforePath });
    console.log('  -> before.png');

    // Before fullpage screenshot
    const beforeFullPath = path.join(outputDir, 'before-fullpage.png');
    await page.screenshot({ path: beforeFullPath, fullPage: true });
    console.log('  -> before-fullpage.png');

    // --- INJECT ---

    console.log('\nInjecting HTML...');
    await page.evaluate(({ selector, html }) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error('Element disappeared before injection');
      el.outerHTML = html;
    }, { selector: opts.selector, html: newHtml });

    // Wait for reflow
    await page.waitForTimeout(500);
    console.log('HTML injected, waiting for reflow...');

    // --- AFTER ---

    const afterElement = await findInjectedElement(page, opts.selector, newHtml);
    if (!afterElement) {
      // Still capture fullpage even if element not found
      const afterFullPath = path.join(outputDir, 'after-fullpage.png');
      await page.screenshot({ path: afterFullPath, fullPage: true });
      console.log('  -> after-fullpage.png (element not re-found)');
      die(
        `Could not locate element after injection.\n` +
        `Original selector "${opts.selector}" no longer matches.\n` +
        `Fullpage after screenshot saved to: ${afterFullPath}`
      );
    }
    console.log('After element located');

    const afterDims = await getDimensions(afterElement);

    // After element screenshot
    const afterPath = path.join(outputDir, 'after.png');
    await afterElement.screenshot({ path: afterPath });
    console.log('  -> after.png');

    // After fullpage screenshot
    const afterFullPath = path.join(outputDir, 'after-fullpage.png');
    await page.screenshot({ path: afterFullPath, fullPage: true });
    console.log('  -> after-fullpage.png');

    // --- SUMMARY ---

    console.log('\n--- Summary ---');
    console.log(`Before: ${beforePath}`);
    console.log(`  Dimensions: ${beforeDims.width}x${beforeDims.height}`);
    console.log(`Before fullpage: ${beforeFullPath}`);
    console.log(`After:  ${afterPath}`);
    console.log(`  Dimensions: ${afterDims.width}x${afterDims.height}`);
    console.log(`After fullpage:  ${afterFullPath}`);
    console.log('\nPreview injection complete.');

  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch(err => {
  die(err.message);
});
