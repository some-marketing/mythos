#!/usr/bin/env node

/**
 * evidence-gather.js
 *
 * Capture element evidence from a live site using Playwright.
 * Produces: element screenshot, fullpage screenshot, outerHTML,
 * computed styles, viewport info, and manifest.json.
 *
 * Usage:
 *   node tools/ai-bridge/evidence-gather.js \
 *     --url "https://example.com" \
 *     --selector "body" \
 *     --output-dir _handoffs/001/
 *
 * Exit codes:
 *   0 — success, all evidence files written
 *   1 — error (element not found, page timeout, etc.)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_STORAGE_PATH = path.join(
  os.homedir(), '.Mythos', 'browser_profiles', 'gemini', 'storage_state.json'
);

const STYLE_PROPERTIES = [
  // Layout
  'display', 'position', 'width', 'height', 'padding', 'margin',
  'overflow', 'z-index',
  // Flexbox
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
  'align-items', 'justify-content', 'gap',
  // Grid
  'grid-template-columns', 'grid-template-rows', 'grid-gap',
  // Typography
  'font-family', 'font-size', 'font-weight', 'line-height',
  'letter-spacing', 'text-transform', 'text-decoration', 'text-align',
  // Color & background
  'color', 'background',
  // Borders
  'border', 'border-style', 'border-color', 'border-width', 'border-radius',
  // Visual effects
  'box-shadow', 'opacity', 'backdrop-filter',
  // Transitions
  'transition', 'transition-duration', 'transition-timing-function',
  // Interaction
  'cursor'
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const opts = {
    url: null,
    selector: null,
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
        console.log(`Usage: node evidence-gather.js --url <url> --selector <css> --output-dir <path> [options]

Capture element evidence (screenshots, HTML, styles) from a live site.

Required:
  --url <url>            Page URL to navigate to
  --selector <css>       CSS selector for the target element
  --output-dir <path>    Where to write evidence files

Options:
  --viewport <width>     Viewport width in px (default: 1440)
  --storage <path>       Playwright storage state for auth
  --wait <ms>            Extra ms to wait after page load (default: 2000)
  --help, -h             Show this help

Output files:
  screenshots/element.png       Element screenshot
  screenshots/fullpage.png      Full-page screenshot
  evidence/element.html         Element outerHTML
  evidence/computed-styles.json Computed styles for element + children
  evidence/viewport.json        Capture metadata
  evidence/manifest.json        File manifest
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.url) die('--url is required');
  if (!opts.selector) die('--selector is required');
  if (!opts.outputDir) die('--output-dir is required');

  // Resolve storage state — use provided, fall back to default if it exists
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
  const screenshotsDir = path.join(outputDir, 'screenshots');
  const evidenceDir = path.join(outputDir, 'evidence');

  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });

  console.log(`URL:      ${opts.url}`);
  console.log(`Selector: ${opts.selector}`);
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

    // Locate element
    console.log(`Looking for: ${opts.selector}`);
    const element = await page.$(opts.selector);
    if (!element) {
      const debugPath = path.join(screenshotsDir, 'debug_not_found.png');
      await page.screenshot({ path: debugPath }).catch(() => {});
      die(`Element not found: ${opts.selector}\nDebug screenshot: ${debugPath}`);
    }
    console.log('Element found');

    // 1. Element screenshot
    const elementScreenshotPath = path.join(screenshotsDir, 'element.png');
    await element.screenshot({ path: elementScreenshotPath });
    console.log('  -> screenshots/element.png');

    // 2. Full-page screenshot
    const fullpageScreenshotPath = path.join(screenshotsDir, 'fullpage.png');
    await page.screenshot({ path: fullpageScreenshotPath, fullPage: true });
    console.log('  -> screenshots/fullpage.png');

    // 3. Element outerHTML
    const outerHTML = await element.evaluate(el => el.outerHTML);
    const elementHtmlPath = path.join(evidenceDir, 'element.html');
    fs.writeFileSync(elementHtmlPath, outerHTML, 'utf8');
    console.log(`  -> evidence/element.html (${outerHTML.length} chars)`);

    // 4. Computed styles for element + first few children
    const computedStyles = await element.evaluate((el, props) => {
      function getStyles(node) {
        const cs = window.getComputedStyle(node);
        const styles = {};
        for (const prop of props) {
          const val = cs.getPropertyValue(prop);
          if (val && val !== 'none' && val !== 'normal' && val !== '0px' && val !== 'auto') {
            styles[prop] = val;
          }
        }
        return styles;
      }

      const result = {
        root: {
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          classes: el.className ? el.className.split(/\s+/).filter(Boolean) : [],
          styles: getStyles(el)
        },
        children: []
      };

      const children = el.children;
      const limit = Math.min(children.length, 10);
      for (let i = 0; i < limit; i++) {
        const child = children[i];
        result.children.push({
          tag: child.tagName.toLowerCase(),
          id: child.id || null,
          classes: child.className ? child.className.split(/\s+/).filter(Boolean) : [],
          styles: getStyles(child)
        });
      }

      return result;
    }, STYLE_PROPERTIES);

    const computedStylesPath = path.join(evidenceDir, 'computed-styles.json');
    fs.writeFileSync(computedStylesPath, JSON.stringify(computedStyles, null, 2) + '\n', 'utf8');
    console.log('  -> evidence/computed-styles.json');

    // 5. Viewport info
    const viewportInfo = {
      width: opts.viewport,
      height: 900,
      url: opts.url,
      selector: opts.selector,
      timestamp: new Date().toISOString()
    };
    const viewportPath = path.join(evidenceDir, 'viewport.json');
    fs.writeFileSync(viewportPath, JSON.stringify(viewportInfo, null, 2) + '\n', 'utf8');
    console.log('  -> evidence/viewport.json');

    // 6. Manifest
    const manifest = {
      url: opts.url,
      selector: opts.selector,
      viewport: { width: opts.viewport, height: 900 },
      timestamp: new Date().toISOString(),
      files: {
        element_screenshot: 'screenshots/element.png',
        fullpage_screenshot: 'screenshots/fullpage.png',
        element_html: 'evidence/element.html',
        computed_styles: 'evidence/computed-styles.json'
      }
    };
    const manifestPath = path.join(evidenceDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log('  -> evidence/manifest.json');

    console.log('\nEvidence gathered successfully.');

  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch(err => {
  die(err.message);
});
