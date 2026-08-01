#!/usr/bin/env node

/**
 * perplexity-browser.js
 *
 * Send a research prompt to Perplexity via browser automation
 * and extract the response. Supports Pro Search mode.
 *
 * Uses a saved storage state from perplexity-auth.js for authentication.
 *
 * Usage:
 *   node tools/ai-bridge/perplexity-browser.js \
 *     --prompt <path-to-prompt.md> \
 *     --output <path-to-response.json> \
 *     [--mode pro|standard] \
 *     [--storage <path>] \
 *     [--timeout <ms>]
 *
 * Exit codes:
 *   0 — success, response written to output file
 *   1 — error (session expired, timeout, etc.)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_STORAGE_PATH = path.join(
  os.homedir(), '.Mythos', 'browser_profiles', 'perplexity', 'storage_state.json'
);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const opts = {
    prompt: null,
    output: null,
    mode: 'pro',   // 'pro' or 'standard'
    storagePath: DEFAULT_STORAGE_PATH,
    timeout: 300000, // 5 minutes — Pro Search can take a while
    debugDir: null
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--prompt':
        opts.prompt = args[++i];
        break;
      case '--output':
        opts.output = args[++i];
        break;
      case '--mode':
        opts.mode = args[++i];
        break;
      case '--storage':
        opts.storagePath = args[++i];
        break;
      case '--timeout':
        opts.timeout = parseInt(args[++i], 10);
        break;
      case '--debug-dir':
        opts.debugDir = args[++i];
        break;
      case '--help':
      case '-h':
        console.log(`Usage: node perplexity-browser.js --prompt <file> --output <file> [options]

Send a research prompt to Perplexity via browser and extract the response.

Prerequisites:
  Run 'node tools/ai-bridge/perplexity-auth.js' once to save your session.

Required:
  --prompt <path>          Path to the prompt text file
  --output <path>          Path to write the response JSON

Options:
  --mode <pro|standard>    Search mode (default: pro)
  --storage <path>         Path to storage_state.json
  --timeout <ms>           Response timeout in ms (default: 300000 = 5 min)
  --debug-dir <path>       Directory for debug screenshots
  --help, -h               Show this help
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
// Debug helpers
// ---------------------------------------------------------------------------

async function debugScreenshot(page, debugDir, name) {
  if (!debugDir) return null;
  fs.mkdirSync(debugDir, { recursive: true });
  const screenshotPath = path.join(debugDir, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
  console.log(`  [debug] Screenshot: ${screenshotPath}`);
  return screenshotPath;
}

// ---------------------------------------------------------------------------
// Browser interaction helpers
// ---------------------------------------------------------------------------

/**
 * Find the Perplexity chat input (textarea).
 */
async function findChatInput(page) {
  const selectors = [
    'textarea[placeholder*="Ask" i]',
    'textarea[placeholder*="search" i]',
    'textarea[placeholder*="question" i]',
    'textarea',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]'
  ];

  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { timeout: 5000, state: 'visible' });
      if (el) return el;
    } catch {
      // Try next
    }
  }

  return null;
}

/**
 * Try to select Pro Search mode if available.
 * Returns true if mode was confirmed/set, false if uncertain.
 */
async function selectSearchMode(page, mode) {
  if (mode === 'standard') {
    console.log('Using standard search mode (default)');
    return true;
  }

  // Look for Pro Search toggle/selector
  // Perplexity UI changes frequently — try multiple strategies
  const strategies = [
    // Strategy 1: Look for a mode selector/toggle near the input
    async () => {
      const proBtn = await page.$('button:has-text("Pro"), [aria-label*="Pro" i], [data-testid*="pro" i]')
        .catch(() => null);
      if (proBtn) {
        // Check if already active
        const isActive = await proBtn.evaluate(el => {
          return el.classList.contains('active') ||
                 el.getAttribute('aria-pressed') === 'true' ||
                 el.getAttribute('data-state') === 'active' ||
                 window.getComputedStyle(el).backgroundColor !== 'transparent';
        }).catch(() => false);

        if (!isActive) {
          await proBtn.click();
          await page.waitForTimeout(500);
          console.log('Clicked Pro Search toggle');
        } else {
          console.log('Pro Search already active');
        }
        return true;
      }
      return false;
    },

    // Strategy 2: Look for a dropdown/select near the search bar
    async () => {
      const dropdown = await page.$('[class*="model-select" i], [class*="search-mode" i], select[name*="mode" i]')
        .catch(() => null);
      if (dropdown) {
        await dropdown.click();
        await page.waitForTimeout(500);
        const proOption = await page.$('[role="option"]:has-text("Pro"), [role="menuitem"]:has-text("Pro")')
          .catch(() => null);
        if (proOption) {
          await proOption.click();
          console.log('Selected Pro from dropdown');
          return true;
        }
        await page.keyboard.press('Escape');
      }
      return false;
    },

    // Strategy 3: Check if Pro is indicated anywhere on page (may be default for Pro accounts)
    async () => {
      const proIndicator = await page.$('[class*="pro" i]:not(button), [data-tier="pro"]')
        .catch(() => null);
      if (proIndicator) {
        console.log('Pro tier detected (may be default mode)');
        return true;
      }
      return false;
    }
  ];

  for (const strategy of strategies) {
    const result = await strategy();
    if (result) return true;
  }

  console.log('WARNING: Could not confirm Pro Search mode. Proceeding with default.');
  return false;
}

/**
 * Enter the prompt text and submit.
 */
async function sendPrompt(page, chatInput, promptText) {
  await chatInput.click();
  await page.waitForTimeout(300);

  // For textarea elements, use fill() which is most reliable
  const tagName = await chatInput.evaluate(el => el.tagName.toLowerCase());

  if (tagName === 'textarea') {
    await chatInput.fill(promptText);
  } else {
    // Contenteditable fallback
    const inserted = await page.evaluate((text) => {
      const el = document.activeElement;
      if (el && el.getAttribute('contenteditable') === 'true') {
        el.textContent = '';
        document.execCommand('insertText', false, text);
        return true;
      }
      return false;
    }, promptText);

    if (!inserted) {
      await chatInput.fill(promptText).catch(async () => {
        await page.keyboard.type(promptText, { delay: 1 });
      });
    }
  }

  console.log(`Prompt entered (${promptText.length} chars)`);
  await page.waitForTimeout(500);

  // Submit: try button first, then Enter/Ctrl+Enter
  const sendBtnSelectors = [
    'button[aria-label*="Submit" i]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="Search" i]',
    'button[type="submit"]',
    'button svg[class*="arrow" i]',  // Arrow icon button
    'button[class*="submit" i]'
  ];

  let sent = false;
  for (const sel of sendBtnSelectors) {
    const btn = await page.$(sel).catch(() => null);
    if (btn) {
      const isVisible = await btn.isVisible().catch(() => false);
      const isEnabled = await btn.isEnabled().catch(() => true);
      if (isVisible && isEnabled) {
        await btn.click();
        sent = true;
        console.log(`Clicked submit button (${sel})`);
        break;
      }
    }
  }

  if (!sent) {
    // Perplexity typically uses Enter to submit (not Ctrl+Enter)
    await page.keyboard.press('Enter');
    console.log('Pressed Enter to submit');
  }
}

/**
 * Wait for Perplexity's response to finish and return the raw text.
 * Watches for streaming indicators and content stability.
 */
async function waitForResponse(page, timeout, debugDir) {
  console.log('Waiting for Perplexity response...');

  const startTime = Date.now();
  let lastText = '';
  let stableCount = 0;
  const STABLE_THRESHOLD = 6;  // 6 polls × 1s = 6s stability (Pro Search can pause between steps)
  const POLL_INTERVAL = 1000;
  let responseDetected = false;

  while (Date.now() - startTime < timeout) {
    await page.waitForTimeout(POLL_INTERVAL);

    // Extract response text from the page
    const responseText = await page.evaluate(() => {
      // Perplexity response containers — try multiple selectors
      const selectors = [
        // Answer section
        '[class*="answer" i]',
        '[class*="response" i]',
        '[class*="result" i] [class*="prose" i]',
        // Markdown rendered content
        '.prose',
        '[class*="markdown" i]',
        // Message-like containers
        '[data-testid*="answer" i]',
        '[data-testid*="response" i]',
        // Generic — last resort
        'article',
        'main [class*="content" i]'
      ];

      for (const sel of selectors) {
        const {CLIENT_CODE} = document.querySelectorAll(sel);
        if ({CLIENT_CODE}.length > 0) {
          // Get the last matching element (most recent response)
          const last = {CLIENT_CODE}[{CLIENT_CODE}.length - 1];
          const text = last.textContent || '';
          if (text.length > 100) return text; // Only count substantial content
        }
      }
      return '';
    }).catch(() => '');

    if (responseText.length > 100 && !responseDetected) {
      responseDetected = true;
      console.log('  Response detected, monitoring for completion...');
    }

    if (responseText.length > 0 && responseText === lastText) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    lastText = responseText;

    // Check if still processing
    const isProcessing = await page.evaluate(() => {
      // Look for streaming/loading indicators
      const indicators = [
        '[class*="loading" i]',
        '[class*="streaming" i]',
        '[class*="generating" i]',
        '[class*="thinking" i]',
        'button[aria-label*="Stop" i]',
        '[class*="spinner" i]',
        '[class*="pulse" i]',
        // Perplexity shows "Searching..." or "Reading..." indicators
        '[class*="searching" i]',
        '[class*="reading" i]'
      ];

      for (const sel of indicators) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return true; // visible
      }
      return false;
    }).catch(() => false);

    if (stableCount >= STABLE_THRESHOLD && !isProcessing && lastText.length > 100) {
      console.log(`Response complete (${lastText.length} chars, stable for ${STABLE_THRESHOLD}s)`);
      return lastText;
    }

    // Progress indicator every 10s
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    if (elapsed % 10 === 0 && elapsed > 0) {
      console.log(`  ...waiting (${elapsed}s, ${lastText.length} chars, processing: ${isProcessing})`);
      if (debugDir && elapsed % 30 === 0) {
        await debugScreenshot(page, debugDir, `progress_${elapsed}s`);
      }
    }
  }

  if (lastText.length > 100) {
    console.warn(`WARNING: Timeout (${timeout}ms). Returning partial response (${lastText.length} chars).`);
    return lastText;
  }

  throw new Error(`Timeout: no substantial response within ${timeout}ms`);
}

/**
 * Extract the formatted response with markdown structure preserved.
 */
async function extractFormattedResponse(page) {
  return page.evaluate(() => {
    // Find the response/answer container
    const selectors = [
      '[class*="answer" i]',
      '[class*="response" i]',
      '.prose',
      '[class*="markdown" i]',
      'article'
    ];

    let container = null;
    for (const sel of selectors) {
      const {CLIENT_CODE} = document.querySelectorAll(sel);
      if ({CLIENT_CODE}.length > 0) {
        const last = {CLIENT_CODE}[{CLIENT_CODE}.length - 1];
        if ((last.textContent || '').length > 100) {
          container = last;
          break;
        }
      }
    }

    if (!container) return null;

    // Walk the DOM to reconstruct markdown-like text
    const parts = [];

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent);
        return;
      }

      const tag = node.tagName;

      // Headings
      if (/^H[1-6]$/.test(tag)) {
        const level = parseInt(tag[1]);
        parts.push('\n' + '#'.repeat(level) + ' ');
        for (const child of node.childNodes) walk(child);
        parts.push('\n');
        return;
      }

      // Code blocks
      if (tag === 'PRE') {
        const code = node.querySelector('code') || node;
        const lang = (code.className || '').replace(/language-/g, '').replace(/hljs\s*/g, '').trim();
        parts.push(`\n\`\`\`${lang}\n${code.textContent}\n\`\`\`\n`);
        return;
      }

      // Inline code
      if (tag === 'CODE' && node.parentElement?.tagName !== 'PRE') {
        parts.push(`\`${node.textContent}\``);
        return;
      }

      // Lists
      if (tag === 'LI') {
        const parent = node.parentElement;
        if (parent?.tagName === 'OL') {
          const idx = Array.from(parent.children).indexOf(node) + 1;
          parts.push(`\n${idx}. `);
        } else {
          parts.push('\n- ');
        }
        for (const child of node.childNodes) walk(child);
        return;
      }

      // Links
      if (tag === 'A') {
        const href = node.getAttribute('href') || '';
        parts.push(`[${node.textContent}](${href})`);
        return;
      }

      // Bold
      if (tag === 'STRONG' || tag === 'B') {
        parts.push('**');
        for (const child of node.childNodes) walk(child);
        parts.push('**');
        return;
      }

      // Italic
      if (tag === 'EM' || tag === 'I') {
        parts.push('*');
        for (const child of node.childNodes) walk(child);
        parts.push('*');
        return;
      }

      // Paragraphs and divs
      if (tag === 'P') parts.push('\n\n');
      if (tag === 'BR') parts.push('\n');

      for (const child of node.childNodes) walk(child);

      if (tag === 'DIV') parts.push('\n');
    }

    walk(container);
    return parts.join('').trim();
  }).catch(() => null);
}

/**
 * Extract source citations from the page.
 */
async function extractCitations(page) {
  return page.evaluate(() => {
    const citations = [];
    // Perplexity shows sources as numbered references
    const sourceSelectors = [
      '[class*="citation" i] a',
      '[class*="source" i] a',
      '[class*="reference" i] a',
      'a[data-testid*="source" i]',
      'a[data-testid*="citation" i]'
    ];

    const seen = new Set();
    for (const sel of sourceSelectors) {
      const links = document.querySelectorAll(sel);
      for (const link of links) {
        const href = link.getAttribute('href');
        const text = link.textContent?.trim();
        if (href && !seen.has(href)) {
          seen.add(href);
          citations.push({ url: href, title: text || '' });
        }
      }
    }

    return citations;
  }).catch(() => []);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.prompt) die('--prompt is required');
  if (!opts.output) die('--output is required');
  if (!fs.existsSync(opts.prompt)) die(`Prompt file not found: ${opts.prompt}`);

  const promptText = fs.readFileSync(opts.prompt, 'utf8').trim();
  if (!promptText) die('Prompt file is empty');

  if (!fs.existsSync(opts.storagePath)) {
    die(
      `No saved session found at: ${opts.storagePath}\n\n` +
      'Run this first to log in and save your session:\n\n' +
      '  node tools/ai-bridge/perplexity-auth.js\n'
    );
  }

  // Default debug dir to alongside output
  const debugDir = opts.debugDir || path.join(path.dirname(path.resolve(opts.output)), 'debug');

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

  console.log(`Prompt: ${opts.prompt} (${promptText.length} chars)`);
  console.log(`Mode: ${opts.mode}`);
  console.log(`Output: ${opts.output}`);
  console.log(`Timeout: ${opts.timeout}ms`);
  console.log('');

  let browser, context;
  try {
    console.log('Launching browser...');
    browser = await chromium.launch({
      headless: false,
      channel: 'chrome',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check'
      ]
    });

    context = await browser.newContext({
      storageState: opts.storagePath,
      viewport: { width: 1280, height: 900 }
    });

    const page = await context.newPage();

    // Navigate to Perplexity
    console.log('Navigating to Perplexity...');
    await page.goto('https://www.perplexity.ai/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(3000);

    // Check auth
    const url = page.url();
    if (url.includes('login') || url.includes('signin')) {
      await debugScreenshot(page, debugDir, 'auth_redirect');
      die(
        'Session expired — redirected to login.\n' +
        'Re-run: node tools/ai-bridge/perplexity-auth.js'
      );
    }

    await debugScreenshot(page, debugDir, '01_loaded');

    // Find chat input
    console.log('Looking for chat input...');
    const chatInput = await findChatInput(page);
    if (!chatInput) {
      await debugScreenshot(page, debugDir, 'no_input_found');
      die(
        'Could not find chat input on Perplexity.\n' +
        `Check debug screenshot in: ${debugDir}`
      );
    }
    console.log('Chat input found');

    // Select search mode
    await selectSearchMode(page, opts.mode);
    await debugScreenshot(page, debugDir, '02_mode_selected');

    // Send prompt
    console.log('Sending prompt...');
    await sendPrompt(page, chatInput, promptText);
    await debugScreenshot(page, debugDir, '03_prompt_sent');

    // Wait for response
    const rawText = await waitForResponse(page, opts.timeout, debugDir);
    const formattedText = await extractFormattedResponse(page);
    const citations = await extractCitations(page);
    const responseText = formattedText || rawText;

    await debugScreenshot(page, debugDir, '04_response_complete');

    // Capture the conversation URL
    const conversationUrl = page.url();

    // Build output
    const output = {
      mode: 'browser',
      search_mode: opts.mode,
      timestamp: new Date().toISOString(),
      prompt_file: path.resolve(opts.prompt),
      conversation_url: conversationUrl,
      response_text: responseText,
      response_length: responseText.length,
      citations: citations,
      citation_count: citations.length,
      raw_text_length: rawText.length
    };

    // Write output
    fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
    fs.writeFileSync(opts.output, JSON.stringify(output, null, 2) + '\n');

    console.log(`\nResponse written to: ${opts.output}`);
    console.log(`  Text length: ${output.response_length} chars`);
    console.log(`  Citations: ${output.citation_count}`);
    console.log(`  Conversation: ${conversationUrl}`);

    // Also write a plain markdown version alongside the JSON
    const mdPath = opts.output.replace(/\.json$/, '.md');
    if (mdPath !== opts.output) {
      const mdContent = [
        `# Perplexity ${opts.mode === 'pro' ? 'Pro Search' : 'Standard'} Results`,
        '',
        `> Prompt: ${path.basename(opts.prompt)}`,
        `> Date: ${output.timestamp}`,
        `> URL: ${conversationUrl}`,
        '',
        '---',
        '',
        responseText,
        '',
        '---',
        '',
        '## Sources',
        '',
        ...citations.map((c, i) => `${i + 1}. [${c.title || c.url}](${c.url})`),
        ''
      ].join('\n');
      fs.writeFileSync(mdPath, mdContent);
      console.log(`  Markdown: ${mdPath}`);
    }

  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch(err => {
  die(err.message);
});
