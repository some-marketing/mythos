#!/usr/bin/env node

/**
 * gemini-browser.js
 *
 * Send a text prompt (+ optional images) to Gemini via browser automation
 * and read back the response.
 *
 * Uses a saved storage state from gemini-auth.js for authentication.
 * Chrome can stay open during use — no profile conflicts.
 *
 * Usage:
 *   node tools/ai-bridge/gemini-browser.js \
 *     --prompt <path-to-prompt.md> \
 *     --output <path-to-response.json> \
 *     [--images <path1,path2,...>] \
 *     [--storage <path>] \
 *     [--timeout <ms>]
 *
 * Exit codes:
 *   0 — success, response written to output file
 *   1 — error (session expired, upload failed, timeout, etc.)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseResponse } = require('./lib/response-parser');

const DEFAULT_STORAGE_PATH = path.join(
  os.homedir(), '.Mythos', 'browser_profiles', 'gemini', 'storage_state.json'
);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const opts = {
    prompt: null,
    images: [],
    output: null,
    storagePath: DEFAULT_STORAGE_PATH,
    timeout: 90000
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--prompt':
        opts.prompt = args[++i];
        break;
      case '--images':
        opts.images = args[++i].split(',').map(p => p.trim()).filter(Boolean);
        break;
      case '--output':
        opts.output = args[++i];
        break;
      case '--storage':
        opts.storagePath = args[++i];
        break;
      case '--timeout':
        opts.timeout = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        console.log(`Usage: node gemini-browser.js --prompt <file> --output <file> [options]

Send a prompt (+ images) to Gemini via browser and read the response.

Prerequisites:
  Run 'npm run ai:gemini:auth' once to save your Google session.

Required:
  --prompt <path>          Path to the prompt text file
  --output <path>          Path to write the response JSON

Options:
  --images <p1,p2,...>     Comma-separated image paths to upload
  --storage <path>         Path to storage_state.json (default: ~/.Mythos/...)
  --timeout <ms>           Response timeout in ms (default: 90000)
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
// Browser interaction helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the chat input to be ready and return its handle.
 */
async function findChatInput(page) {
  const selectors = [
    'div[contenteditable="true"][aria-label*="prompt" i]',
    'div[contenteditable="true"][aria-label*="enter" i]',
    'div[contenteditable="true"][role="textbox"]',
    'div.ql-editor[contenteditable="true"]',
    'rich-textarea div[contenteditable="true"]',
    'div[contenteditable="true"]',
    'textarea'
  ];

  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { timeout: 5000 });
      if (el) return el;
    } catch {
      // Try next
    }
  }

  return null;
}

/**
 * Upload images via Gemini's file upload UI.
 */
async function uploadImages(page, imagePaths) {
  if (imagePaths.length === 0) return;

  // Validate all image files exist
  const absImagePaths = imagePaths.map(p => {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) throw new Error(`Image not found: ${abs}`);
    return abs;
  });

  // Strategy 1: Look for an existing hidden file input (most reliable, no UI clicks)
  let fileInput = await page.$('input[type="file"]').catch(() => null);

  if (fileInput) {
    console.log('Found existing file input — uploading directly');
    await fileInput.setInputFiles(absImagePaths);
    console.log(`Uploaded ${absImagePaths.length} image(s)`);
    await page.waitForTimeout(2000);
    return;
  }

  // Strategy 2: Click attachment button, then navigate the menu overlay
  const uploadBtnSelectors = [
    'button[aria-label*="upload" i]',
    'button[aria-label*="image" i]',
    'button[aria-label*="attach" i]',
    'button[aria-label*="Add" i]',
    '[data-tooltip*="upload" i]',
    '[data-tooltip*="image" i]'
  ];

  for (const sel of uploadBtnSelectors) {
    const btn = await page.$(sel).catch(() => null);
    if (!btn) continue;

    await btn.click();
    await page.waitForTimeout(1000);

    // Check if a file input appeared
    fileInput = await page.$('input[type="file"]').catch(() => null);
    if (fileInput) break;

    // An overlay menu may have appeared — look for the "Upload file" / "Upload from computer" option
    const uploadMenuSelectors = [
      'button[aria-label*="Upload file" i]',
      'button[aria-label*="Upload from computer" i]',
      '[data-test-id="uploader-local-button"]',
      'button[aria-label*="computer" i]',
      '[role="menuitem"]:has-text("Upload")',
      'button:has-text("Upload file")',
      'button:has-text("Upload from computer")'
    ];

    for (const menuSel of uploadMenuSelectors) {
      const menuBtn = await page.$(menuSel).catch(() => null);
      if (menuBtn) {
        console.log(`Clicking menu option: ${menuSel}`);
        await menuBtn.click();
        await page.waitForTimeout(1000);
        fileInput = await page.$('input[type="file"]').catch(() => null);
        if (fileInput) break;
      }
    }
    if (fileInput) break;

    // Dismiss overlay if nothing worked (press Escape) before trying next selector
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // Strategy 3: Force-find hidden file inputs in the DOM (Gemini may hide them)
  if (!fileInput) {
    fileInput = await page.evaluateHandle(() => {
      const inputs = document.querySelectorAll('input[type="file"]');
      for (const inp of inputs) return inp;
      return null;
    });
    const isNull = await fileInput.evaluate(el => el === null).catch(() => true);
    if (isNull) fileInput = null;
  }

  if (!fileInput) {
    // Take debug screenshot before failing
    const debugPath = path.resolve(path.dirname(imagePaths[0]), '..', 'debug_upload_fail.png');
    await page.screenshot({ path: debugPath }).catch(() => {});
    throw new Error(
      'Could not find file upload element on Gemini.\n' +
      'The Gemini UI may have changed. Try uploading manually.\n' +
      `Debug screenshot: ${debugPath}`
    );
  }

  await fileInput.setInputFiles(absImagePaths);
  console.log(`Uploaded ${absImagePaths.length} image(s)`);

  // Wait for upload to process
  await page.waitForTimeout(2000);
}

/**
 * Enter the prompt text and submit.
 * For large prompts (>50K chars), uses clipboard paste to avoid
 * insertText truncation in contenteditable divs.
 */
async function sendPrompt(page, chatInput, promptText) {
  await chatInput.click();
  await page.waitForTimeout(300);

  const CLIPBOARD_THRESHOLD = 50000;

  if (promptText.length > CLIPBOARD_THRESHOLD) {
    // Large prompt: use clipboard paste (mimics human Ctrl+V)
    console.log(`Large prompt (${promptText.length} chars) — using clipboard paste`);
    await page.evaluate(async (text) => {
      const el = document.activeElement;
      if (el && el.getAttribute('contenteditable') === 'true') {
        el.textContent = '';
      }
      await navigator.clipboard.writeText(text);
    }, promptText);
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+KeyV`);
    await page.waitForTimeout(1000);

    // Verify paste succeeded by checking input length
    const pastedLength = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.textContent.length : 0;
    });
    console.log(`Clipboard paste verified: ${pastedLength} chars in input`);
    if (pastedLength < promptText.length * 0.9) {
      console.warn(`WARNING: Paste may be truncated (expected ~${promptText.length}, got ${pastedLength})`);
    }
  } else {
    // Normal prompt: use execCommand insertText for contenteditable divs
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
        await page.keyboard.type(promptText, { delay: 2 });
      });
    }
  }

  console.log(`Prompt entered (${promptText.length} chars)`);
  await page.waitForTimeout(500);

  // Find and click the send button
  const sendBtnSelectors = [
    'button[aria-label*="Send" i]',
    'button[aria-label*="Submit" i]',
    'button.send-button',
    'button[data-tooltip*="Send" i]'
  ];

  let sent = false;
  for (const sel of sendBtnSelectors) {
    const btn = await page.$(sel).catch(() => null);
    if (btn) {
      const isEnabled = await btn.isEnabled().catch(() => true);
      if (isEnabled) {
        await btn.click();
        sent = true;
        console.log('Clicked send button');
        break;
      }
    }
  }

  if (!sent) {
    await page.keyboard.press('Enter');
    console.log('Pressed Enter to submit');
  }
}

/**
 * Wait for Gemini's response to finish streaming and extract the text.
 */
async function waitForResponse(page, timeout) {
  console.log('Waiting for Gemini response...');

  const startTime = Date.now();
  let lastText = '';
  let stableCount = 0;
  const STABLE_THRESHOLD = 4; // 4 polls × 500ms = 2s stability
  const POLL_INTERVAL = 500;

  while (Date.now() - startTime < timeout) {
    await page.waitForTimeout(POLL_INTERVAL);

    const responseText = await page.evaluate(() => {
      const containers = document.querySelectorAll(
        'message-content, .message-content, [data-message-author-role="model"], .model-response-text, .response-container'
      );
      if (containers.length > 0) {
        return containers[containers.length - 1].textContent || '';
      }
      return '';
    }).catch(() => '');

    if (responseText.length > 0 && responseText === lastText) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    lastText = responseText;

    // Check if still streaming
    const isStreaming = await page.evaluate(() => {
      const stops = document.querySelectorAll(
        'button[aria-label*="Stop" i], button[aria-label*="stop" i], .stop-button'
      );
      return stops.length > 0;
    }).catch(() => false);

    if (stableCount >= STABLE_THRESHOLD && !isStreaming && lastText.length > 0) {
      console.log(`Response complete (${lastText.length} chars)`);
      return lastText;
    }

    // Progress indicator every 5s
    if ((Date.now() - startTime) % 5000 < POLL_INTERVAL) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`  ...waiting (${elapsed}s, ${lastText.length} chars so far)`);
    }
  }

  if (lastText.length > 0) {
    console.warn(`WARNING: Timeout (${timeout}ms). Returning partial response.`);
    return lastText;
  }

  throw new Error(`Timeout: no response within ${timeout}ms`);
}

/**
 * Extract formatted response preserving code blocks.
 */
async function extractFormattedResponse(page) {
  return page.evaluate(() => {
    const containers = document.querySelectorAll(
      'message-content, .message-content, [data-message-author-role="model"]'
    );
    if (containers.length === 0) return null;

    const last = containers[containers.length - 1];
    const parts = [];

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent);
        return;
      }

      if (node.tagName === 'PRE' || node.tagName === 'CODE-BLOCK') {
        const code = node.querySelector('code') || node;
        const lang = (code.className || '').replace(/language-/g, '').replace(/hljs\s*/g, '').trim();
        parts.push(`\n\`\`\`${lang}\n${code.textContent}\n\`\`\`\n`);
        return;
      }

      if (node.tagName === 'P') parts.push('\n');

      for (const child of node.childNodes) {
        walk(child);
      }

      if (node.tagName === 'P' || node.tagName === 'DIV') parts.push('\n');
    }

    walk(last);
    return parts.join('');
  }).catch(() => null);
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

  for (const img of opts.images) {
    if (!fs.existsSync(img)) die(`Image not found: ${img}`);
  }

  // Check for saved session
  if (!fs.existsSync(opts.storagePath)) {
    die(
      `No saved session found at: ${opts.storagePath}\n\n` +
      'Run this first to log in and save your session:\n\n' +
      '  npm run ai:gemini:auth\n'
    );
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

  console.log(`Prompt: ${opts.prompt} (${promptText.length} chars)`);
  console.log(`Images: ${opts.images.length > 0 ? opts.images.join(', ') : 'none'}`);
  console.log(`Output: ${opts.output}`);
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

    // Navigate to Gemini
    console.log('Navigating to Gemini...');
    await page.goto('https://gemini.google.com/app', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(3000);

    // Check auth
    const url = page.url();
    if (url.includes('accounts.google.com') || url.includes('signin')) {
      die(
        'Session expired — redirected to login.\n' +
        'Log into Google in Chrome (Profile 13), then retry.'
      );
    }

    // Find chat input
    console.log('Looking for chat input...');
    const chatInput = await findChatInput(page);
    if (!chatInput) {
      const debugPath = path.resolve(path.dirname(opts.output), 'debug_gemini_ui.png');
      await page.screenshot({ path: debugPath }).catch(() => {});
      die(
        'Could not find chat input. Gemini UI may have changed.\n' +
        `Debug screenshot: ${debugPath}`
      );
    }
    console.log('Chat input found');

    // Upload images
    if (opts.images.length > 0) {
      console.log('Uploading images...');
      await uploadImages(page, opts.images);
    }

    // Send prompt
    console.log('Sending prompt...');
    await sendPrompt(page, chatInput, promptText);

    // Wait for response
    const rawText = await waitForResponse(page, opts.timeout);
    const formattedText = await extractFormattedResponse(page);
    const responseText = formattedText || rawText;

    // Parse
    const parsed = parseResponse(responseText);
    const conversationUrl = page.url();

    // Build output
    const output = {
      mode: 'browser',
      timestamp: new Date().toISOString(),
      prompt_file: path.resolve(opts.prompt),
      images: opts.images.map(p => path.resolve(p)),
      conversation_url: conversationUrl,
      response_text: parsed.raw_text,
      code_blocks: parsed.code_blocks,
      has_html: parsed.has_html,
      response_length: parsed.raw_text.length
    };

    // Write output
    fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
    fs.writeFileSync(opts.output, JSON.stringify(output, null, 2) + '\n');

    console.log(`\nResponse written to: ${opts.output}`);
    console.log(`  Text length: ${output.response_length} chars`);
    console.log(`  Code blocks: ${output.code_blocks.length}`);
    console.log(`  Has HTML: ${output.has_html}`);
    console.log(`  Conversation: ${conversationUrl}`);

  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch(err => {
  die(err.message);
});
