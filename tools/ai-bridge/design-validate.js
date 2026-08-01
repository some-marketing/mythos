#!/usr/bin/env node

/**
 * design-validate.js
 *
 * Automated visual validation: screenshots a local mockup HTML and a live
 * staging URL at matching CSS selectors, sends each pair to Gemini Flash
 * for comparison, and outputs a structured JSON report.
 *
 * Usage:
 *   node tools/ai-bridge/design-validate.js \
 *     --mockup <path-to-html>        \
 *     --live-url <url>               \
 *     --sections <selectors>         \
 *     --output <path>                \
 *     [--pass-threshold <level>]     \
 *     [--model <model-id>]           \
 *     [--viewport <WxH>]             \
 *     [--mobile-viewport <WxH>]
 *
 * Exit codes:
 *   0 — pass (all findings within threshold)
 *   1 — fail (findings above threshold)
 *   2 — error (bad args, missing files, API failure)
 *
 * Environment:
 *   GEMINI_API_KEY — required. Can also be in ~/.Mythos/.env
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const SCREENSHOT_DIR = '/tmp/design-validate';

// ---------------------------------------------------------------------------
// API key loading (mirrors adapters/gemini-api.js)
// ---------------------------------------------------------------------------

function loadApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;

  const envFile = path.join(os.homedir(), '.Mythos', '.env');
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^GEMINI_API_KEY=(.+)$/);
      if (match) return match[1].trim();
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const opts = {
    mockup: null,
    liveUrl: null,
    sections: [],
    mockupSections: null,  // optional: different selectors for mockup
    liveSections: null,    // optional: different selectors for live
    output: null,
    passThreshold: 'HIGH',
    model: 'gemini-2.5-flash',
    viewport: { width: 1200, height: 900 },
    mobileViewport: null
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--mockup':
        opts.mockup = args[++i];
        break;
      case '--live-url':
        opts.liveUrl = args[++i];
        break;
      case '--sections':
        opts.sections = args[++i].split(',').map(s => s.trim()).filter(Boolean);
        break;
      case '--mockup-sections':
        opts.mockupSections = args[++i].split(',').map(s => s.trim()).filter(Boolean);
        break;
      case '--live-sections':
        opts.liveSections = args[++i].split(',').map(s => s.trim()).filter(Boolean);
        break;
      case '--output':
        opts.output = args[++i];
        break;
      case '--pass-threshold':
        opts.passThreshold = args[++i].toUpperCase();
        break;
      case '--model':
        opts.model = args[++i];
        break;
      case '--viewport': {
        const [w, h] = args[++i].split('x').map(Number);
        opts.viewport = { width: w, height: h };
        break;
      }
      case '--mobile-viewport': {
        const [w, h] = args[++i].split('x').map(Number);
        opts.mobileViewport = { width: w, height: h };
        break;
      }
      case '--help':
      case '-h':
        console.log(`Usage: node design-validate.js --mockup <file> --live-url <url> --sections <sel1,sel2> --output <file>

Compare a local HTML mockup against a live staging page section-by-section
using Gemini vision. Outputs a structured JSON report.

Required:
  --mockup <path>              Local HTML mockup file
  --live-url <url>             Live staging page URL
  --sections <sel1,sel2,...>   Comma-separated CSS selectors
  --output <path>              Output JSON report path

Options:
  --pass-threshold <level>     CRITICAL or HIGH (default: HIGH)
  --model <id>                 Gemini model (default: gemini-2.5-flash)
  --viewport <WxH>            Desktop viewport (default: 1200x900)
  --mobile-viewport <WxH>     Optional mobile viewport (e.g., 390x844)

Environment:
  GEMINI_API_KEY               API key (or set in ~/.Mythos/.env)
`);
        process.exit(0);
    }
  }

  return opts;
}

function die(msg, code = 2) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Image encoding for Gemini API
// ---------------------------------------------------------------------------

function encodeImageBuffer(buffer) {
  return {
    inline_data: {
      mime_type: 'image/png',
      data: buffer.toString('base64')
    }
  };
}

// ---------------------------------------------------------------------------
// Gemini API call
// ---------------------------------------------------------------------------

function callGeminiAPI(apiKey, model, parts, maxTokens = 8192) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.2
      }
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const parsed = new URL(url);

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Gemini API returned ${res.statusCode}: ${data.substring(0, 500)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse Gemini response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Prompt template
// ---------------------------------------------------------------------------

const COMPARISON_PROMPT = `You are reviewing a CSS implementation against an approved design mockup.

IMAGE 1 (mockup): The approved design for this section (standalone HTML file).
IMAGE 2 (live): The same section as rendered on a live WordPress staging site inside a page builder template.

IMPORTANT CONTEXT:
- The mockup is a standalone HTML file. The live page is inside a WordPress page builder (Breakdance). Expect different container widths and surrounding chrome.
- Placeholder images in the mockup (grey boxes with text labels) will be replaced by real photographs on the live page. Do NOT flag this as an issue.
- Template-rendered headings (H1, H2) may have slightly different sizing because the page builder applies its own heading styles. Focus on whether the intent (bold, centered, navy color) matches, not exact pixel size.
- Compare DESIGN INTENT and STRUCTURAL LAYOUT, not pixel-perfect positioning.

Focus your comparison on:
1. Column arrangement: are side-by-side layouts preserved (not collapsed to stacked on desktop)?
2. Content order: does the visual flow match (intro, then columns, then body, then CTA)?
3. Typography: font weight, color, and relative sizing
4. Colors: button colors, text colors, accent colors
5. Responsive behavior: do columns stack correctly on mobile?

Report each difference as JSON:
[
  {
    "element": "what's affected",
    "mockup": "what the mockup shows",
    "live": "what the live page shows",
    "severity": "CRITICAL|HIGH|LOW"
  }
]

Severity guide:
- CRITICAL: Layout structure broken (columns stacked when they should be side-by-side, content missing, wrong content order)
- HIGH: Noticeable visual gap from design intent (wrong colors, missing styling, broken alignment)
- LOW: Minor polish (spacing tweaks, subtle font differences, border-radius variations)
- MATCH: Element matches the design intent well

If elements match well, include them with severity "MATCH".
Return ONLY the JSON array, no other text.`;

// ---------------------------------------------------------------------------
// Screenshot helpers
// ---------------------------------------------------------------------------

async function takeScreenshot(page, selector, label, index) {
  const filePath = path.join(SCREENSHOT_DIR, `${label}-${index}.png`);

  // Try the exact selector first
  const loc = page.locator(selector).first();
  const count = await loc.count();

  if (count > 0) {
    await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    const buffer = await loc.screenshot({ timeout: 10000 });
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  // Fail loudly when selector doesn't match — silent fallbacks cause false passes
  throw new Error(`Selector "${selector}" not found on page. Fix the selector or update the mockup.`);
}

// ---------------------------------------------------------------------------
// Parse Gemini response into findings array
// ---------------------------------------------------------------------------

function parseFindings(responseText) {
  // Strip markdown fences if present
  let cleaned = responseText.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    // Handle object wrappers like { findings: [...] }
    if (parsed && typeof parsed === 'object') {
      const arrayVal = parsed.findings || parsed.results || parsed.differences || parsed.data;
      if (Array.isArray(arrayVal)) return arrayVal;
    }
    return [parsed];
  } catch {
    // Try to find a JSON array in the text
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch {
        // Fall through
      }
    }
    console.warn('  Could not parse Gemini response as JSON, treating as raw text');
    return [{
      element: 'parse_error',
      mockup: 'N/A',
      live: responseText.substring(0, 200),
      severity: 'CRITICAL'
    }];
  }
}

// ---------------------------------------------------------------------------
// Determine pass/fail for a section based on threshold
// ---------------------------------------------------------------------------

function sectionPasses(findings, threshold) {
  for (const f of findings) {
    const sev = (f.severity || '').toUpperCase();
    if (sev === 'CRITICAL') return false;
    if (threshold === 'HIGH' && sev === 'HIGH') return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Run validation for one viewport
// ---------------------------------------------------------------------------

async function validateViewport(browser, mockupPath, liveUrl, sections, viewport, apiKey, model, passThreshold, viewportLabel) {
  console.log(`\n--- Viewport: ${viewport.width}x${viewport.height} (${viewportLabel}) ---`);

  const context = await browser.newContext({ viewport });
  const mockupPage = await context.newPage();
  const livePage = await context.newPage();

  // Navigate
  const mockupUrl = `file://${path.resolve(mockupPath)}`;
  console.log(`Loading mockup: ${mockupUrl}`);
  await mockupPage.goto(mockupUrl, { waitUntil: 'networkidle', timeout: 15000 });

  console.log(`Loading live: ${liveUrl}`);
  await livePage.goto(liveUrl, { waitUntil: 'networkidle', timeout: 30000 });

  const results = [];

  // Support split selectors: mockupSections/liveSections override sections per-side
  const mockupSelectors = sections._mockup || sections;
  const liveSelectors = sections._live || sections;
  const count = Math.max(mockupSelectors.length, liveSelectors.length);

  for (let i = 0; i < count; i++) {
    const mSel = mockupSelectors[i] || mockupSelectors[mockupSelectors.length - 1];
    const lSel = liveSelectors[i] || liveSelectors[liveSelectors.length - 1];
    const label = mSel === lSel ? mSel : `${mSel} → ${lSel}`;
    console.log(`\nSection ${i + 1}/${count}: ${label}`);

    // Screenshot both
    console.log('  Screenshotting mockup...');
    const mockupShot = await takeScreenshot(mockupPage, mSel, `${viewportLabel}-mockup`, i);
    console.log(`  -> ${mockupShot}`);

    console.log('  Screenshotting live...');
    const liveShot = await takeScreenshot(livePage, lSel, `${viewportLabel}-live`, i);
    console.log(`  -> ${liveShot}`);

    // Send to Gemini
    console.log('  Comparing via Gemini...');
    const mockupBuffer = fs.readFileSync(mockupShot);
    const liveBuffer = fs.readFileSync(liveShot);

    const parts = [
      encodeImageBuffer(mockupBuffer),
      encodeImageBuffer(liveBuffer),
      { text: COMPARISON_PROMPT }
    ];

    const apiResponse = await callGeminiAPI(apiKey, model, parts);
    const candidate = apiResponse.candidates?.[0];
    const responseText = candidate?.content?.parts?.map(p => p.text || '').join('') || '';

    const findings = parseFindings(responseText);
    const pass = sectionPasses(findings, passThreshold);

    console.log(`  Findings: ${findings.length}, Pass: ${pass}`);

    results.push({
      selector: label,
      mockup_selector: mSel,
      live_selector: lSel,
      mockup_screenshot: mockupShot,
      live_screenshot: liveShot,
      findings,
      pass
    });
  }

  await context.close();
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Validate required args
  if (!opts.mockup) die('--mockup is required');
  if (!opts.liveUrl) die('--live-url is required');
  if (opts.sections.length === 0 && !opts.mockupSections && !opts.liveSections) die('--sections is required (comma-separated CSS selectors). Use --mockup-sections and --live-sections for different selectors per side.');

  // Build sections object with optional per-side overrides
  if (opts.mockupSections || opts.liveSections) {
    opts.sections = opts.sections.length ? opts.sections : (opts.mockupSections || opts.liveSections);
    opts.sections._mockup = opts.mockupSections || opts.sections;
    opts.sections._live = opts.liveSections || opts.sections;
  }
  if (!opts.output) die('--output is required');

  const mockupAbs = path.resolve(opts.mockup);
  if (!fs.existsSync(mockupAbs)) die(`Mockup file not found: ${mockupAbs}`);

  const apiKey = loadApiKey();
  if (!apiKey) die('GEMINI_API_KEY not found. Set in environment or ~/.Mythos/.env');

  // Create screenshot dir
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log('design-validate');
  console.log(`  Mockup:    ${mockupAbs}`);
  console.log(`  Live URL:  ${opts.liveUrl}`);
  console.log(`  Sections:  ${opts.sections.join(', ')}`);
  console.log(`  Model:     ${opts.model}`);
  console.log(`  Viewport:  ${opts.viewport.width}x${opts.viewport.height}`);
  if (opts.mobileViewport) {
    console.log(`  Mobile:    ${opts.mobileViewport.width}x${opts.mobileViewport.height}`);
  }
  console.log(`  Threshold: ${opts.passThreshold}`);
  console.log(`  Output:    ${opts.output}`);

  // Launch browser
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });

  let allSections = [];

  try {
    // Desktop viewport
    const desktopResults = await validateViewport(
      browser, mockupAbs, opts.liveUrl, opts.sections,
      opts.viewport, apiKey, opts.model, opts.passThreshold, 'desktop'
    );
    allSections.push(...desktopResults);

    // Mobile viewport (if requested)
    if (opts.mobileViewport) {
      const mobileResults = await validateViewport(
        browser, mockupAbs, opts.liveUrl, opts.sections,
        opts.mobileViewport, apiKey, opts.model, opts.passThreshold, 'mobile'
      );
      allSections.push(...mobileResults);
    }
  } finally {
    await browser.close();
  }

  // Build summary
  let totalFindings = 0;
  let critical = 0;
  let high = 0;
  let low = 0;
  let matches = 0;

  for (const section of allSections) {
    for (const f of section.findings) {
      totalFindings++;
      const sev = (f.severity || '').toUpperCase();
      if (sev === 'CRITICAL') critical++;
      else if (sev === 'HIGH') high++;
      else if (sev === 'LOW') low++;
      else if (sev === 'MATCH') matches++;
    }
  }

  const overallPass = allSections.every(s => s.pass);

  const report = {
    timestamp: new Date().toISOString(),
    mockup: mockupAbs,
    live_url: opts.liveUrl,
    viewport: `${opts.viewport.width}x${opts.viewport.height}`,
    mobile_viewport: opts.mobileViewport
      ? `${opts.mobileViewport.width}x${opts.mobileViewport.height}`
      : null,
    sections: allSections,
    summary: {
      total_findings: totalFindings,
      critical,
      high,
      low,
      matches,
      pass: overallPass
    }
  };

  // Write report
  fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
  fs.writeFileSync(opts.output, JSON.stringify(report, null, 2) + '\n');

  console.log(`\n--- Summary ---`);
  console.log(`  Total findings: ${totalFindings}`);
  console.log(`  Critical: ${critical}, High: ${high}, Low: ${low}, Matches: ${matches}`);
  console.log(`  Overall: ${overallPass ? 'PASS' : 'FAIL'}`);
  console.log(`  Report: ${opts.output}`);

  process.exit(overallPass ? 0 : 1);
}

main().catch(err => {
  console.error(`ERROR: ${err.message}`);
  process.exit(2);
});
