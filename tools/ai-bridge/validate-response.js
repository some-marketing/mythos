#!/usr/bin/env node

/**
 * validate-response.js
 *
 * 8-point mechanical validation of Gemini response JSON.
 * No LLM needed — pure string/regex checks.
 *
 * Usage:
 *   node tools/ai-bridge/validate-response.js \
 *     --response gemini-response.json \
 *     --output validation.json \
 *     [--evidence-dir _handoffs/001/] \
 *     [--strict]
 *
 * Exit codes:
 *   0 — all error-severity checks passed (warnings allowed unless --strict)
 *   1 — one or more error-severity checks failed
 */

const fs = require('fs');
const path = require('path');
const { parseResponse } = require('./lib/response-parser');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const opts = {
    response: null,
    evidenceDir: null,
    output: null,
    strict: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--response':
        opts.response = args[++i];
        break;
      case '--evidence-dir':
        opts.evidenceDir = args[++i];
        break;
      case '--output':
        opts.output = args[++i];
        break;
      case '--strict':
        opts.strict = true;
        break;
      case '--help':
      case '-h':
        console.log(`Usage: node validate-response.js --response <path> --output <path> [options]

Validate a Gemini response against the inline-style output rules.

Required:
  --response <path>       Path to Gemini response JSON (from gemini-browser.js)
  --output <path>         Where to write validation results JSON

Options:
  --evidence-dir <path>   Path to evidence dir (for content comparison)
  --strict                Fail on warnings too (default: only fail on errors)
  --help, -h              Show this help

Checks:
  1. has_html          Response contains HTML (error)
  2. has_code_blocks   Response has code blocks (error)
  3. inline_styles     HTML contains style="" (error)
  4. no_style_blocks   No <style> blocks (error)
  5. no_scripts        No <script>, onclick, etc. (error)
  6. no_external_classes  No class="" on non-root elements (warning)
  7. content_preserved >50% word overlap with original (warning)
  8. reasonable_size   Response < 10x original size (warning)
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
// Validation checks
// ---------------------------------------------------------------------------

/**
 * Extract text content from HTML by stripping all tags.
 */
function extractTextContent(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute word-level overlap ratio between two strings.
 * Returns a value between 0 and 1.
 */
function wordOverlap(textA, textB) {
  const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > 2));

  if (wordsA.size === 0) return 1; // nothing to preserve

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }

  return overlap / wordsA.size;
}

function runChecks(responseData, evidenceDir) {
  const checks = [];

  // Parse response if it's raw JSON from gemini-browser.js
  let parsed;
  if (typeof responseData.response_text === 'string') {
    // Already parsed by gemini-browser.js
    parsed = {
      raw_text: responseData.response_text,
      code_blocks: responseData.code_blocks || [],
      has_html: responseData.has_html || false
    };
  } else if (typeof responseData === 'string') {
    parsed = parseResponse(responseData);
  } else {
    parsed = { raw_text: '', code_blocks: [], has_html: false };
  }

  const firstHtmlBlock = parsed.code_blocks.find(b =>
    b.language === 'html' || b.content.includes('style=') || b.content.includes('</')
  );
  const html = firstHtmlBlock ? firstHtmlBlock.content : '';

  // 1. has_html
  checks.push({
    id: 'has_html',
    status: parsed.has_html ? 'pass' : 'fail',
    severity: 'error',
    message: parsed.has_html ? 'HTML content found' : 'No HTML content detected in response'
  });

  // 2. has_code_blocks
  checks.push({
    id: 'has_code_blocks',
    status: parsed.code_blocks.length > 0 ? 'pass' : 'fail',
    severity: 'error',
    message: parsed.code_blocks.length > 0
      ? `Found ${parsed.code_blocks.length} code block(s)`
      : 'No code blocks found in response'
  });

  // 3. inline_styles
  const hasInlineStyles = html.includes('style="');
  checks.push({
    id: 'inline_styles',
    status: hasInlineStyles ? 'pass' : 'fail',
    severity: 'error',
    message: hasInlineStyles
      ? 'Inline style="" attributes found'
      : 'No inline style="" attributes found'
  });

  // 4. no_style_blocks
  const styleBlockPattern = /<style[\s>]/i;
  const hasStyleBlocks = styleBlockPattern.test(html);
  checks.push({
    id: 'no_style_blocks',
    status: hasStyleBlocks ? 'fail' : 'pass',
    severity: 'error',
    message: hasStyleBlocks
      ? 'Found <style> block — output must use inline styles only'
      : 'No <style> blocks found'
  });

  // 5. no_scripts
  const scriptPatterns = [
    /<script[\s>]/i,
    /\bonclick\s*=/i,
    /\bonerror\s*=/i,
    /\bonload\s*=/i,
    /javascript:/i
  ];
  const scriptMatches = scriptPatterns
    .filter(p => p.test(html))
    .map(p => p.source.replace(/\\b/g, ''));
  const hasScripts = scriptMatches.length > 0;
  checks.push({
    id: 'no_scripts',
    status: hasScripts ? 'fail' : 'pass',
    severity: 'error',
    message: hasScripts
      ? `Found script/event patterns: ${scriptMatches.join(', ')}`
      : 'No scripts or event handlers found'
  });

  // 6. no_external_classes
  // Check for class="" on non-root elements
  let classStatus = 'pass';
  let classMessage = 'No external class references found';

  // Load prompt-meta.json to check for allowed root classes
  let allowedRootClasses = null;
  if (evidenceDir) {
    const metaPath = path.join(path.resolve(evidenceDir), 'prompt-meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (meta.target_classes) {
          allowedRootClasses = meta.target_classes;
        }
        if (meta.target_id) {
          // Also allow class on the root element identified by target_id
          allowedRootClasses = allowedRootClasses || '__root_has_id__';
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  const classMatches = [...html.matchAll(/class="([^"]*)"/g)];
  if (classMatches.length > 0) {
    if (allowedRootClasses) {
      // First class="" is assumed to be the root — skip it
      const nonRootClasses = classMatches.slice(1);
      if (nonRootClasses.length > 0) {
        classStatus = 'warn';
        const found = nonRootClasses.map(m => m[1]).slice(0, 3);
        classMessage = `Found class="${found[0]}" on non-root element(s)`;
      }
    } else {
      classStatus = 'warn';
      const found = classMatches.map(m => m[1]).slice(0, 3);
      classMessage = `Found class="${found[0]}" — expected inline styles only`;
    }
  }
  checks.push({
    id: 'no_external_classes',
    status: classStatus,
    severity: 'warning',
    message: classMessage
  });

  // Read original element HTML once for checks 7 and 8
  let originalHtml = null;
  if (evidenceDir) {
    const elementHtmlPath = path.join(path.resolve(evidenceDir), 'evidence', 'element.html');
    if (fs.existsSync(elementHtmlPath)) {
      originalHtml = fs.readFileSync(elementHtmlPath, 'utf8');
    }
  }

  // 7. content_preserved
  let contentStatus = 'pass';
  let contentMessage = 'Content preservation check skipped (no evidence)';

  if (originalHtml !== null) {
    const originalText = extractTextContent(originalHtml);
    const responseText = extractTextContent(html);

    if (originalText.length > 0) {
      const overlap = wordOverlap(originalText, responseText);
      const pct = Math.round(overlap * 100);
      if (overlap >= 0.5) {
        contentStatus = 'pass';
        contentMessage = `Content preserved (${pct}% word overlap)`;
      } else {
        contentStatus = 'warn';
        contentMessage = `Low content overlap (${pct}%) — original text may be missing`;
      }
    } else {
      contentMessage = 'Original element has no text content — skipping check';
    }
  }
  checks.push({
    id: 'content_preserved',
    status: contentStatus,
    severity: 'warning',
    message: contentMessage
  });

  // 8. reasonable_size
  let sizeStatus = 'pass';
  let sizeMessage = 'Size check skipped (no evidence)';

  if (originalHtml !== null && originalHtml.length > 0) {
    const ratio = html.length / originalHtml.length;
    if (ratio <= 10) {
      sizeStatus = 'pass';
      sizeMessage = `Response size OK (${html.length} chars, ${ratio.toFixed(1)}x original)`;
    } else {
      sizeStatus = 'warn';
      sizeMessage = `Response is ${ratio.toFixed(1)}x original size (${html.length} vs ${originalHtml.length} chars)`;
    }
  }
  checks.push({
    id: 'reasonable_size',
    status: sizeStatus,
    severity: 'warning',
    message: sizeMessage
  });

  return checks;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.response) die('--response is required');
  if (!opts.output) die('--output is required');
  if (!fs.existsSync(opts.response)) die(`Response file not found: ${opts.response}`);

  const responseStr = fs.readFileSync(opts.response, 'utf8');
  let responseData;
  try {
    responseData = JSON.parse(responseStr);
  } catch {
    die(`Invalid JSON in response file: ${opts.response}`);
  }

  console.log(`Validating: ${opts.response}`);
  if (opts.evidenceDir) console.log(`Evidence:   ${opts.evidenceDir}`);
  console.log('');

  const checks = runChecks(responseData, opts.evidenceDir);

  const errorCount = checks.filter(c => c.status === 'fail' && c.severity === 'error').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;
  const passed = opts.strict
    ? (errorCount === 0 && warnCount === 0)
    : (errorCount === 0);

  // Print results
  for (const check of checks) {
    const icon = check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`  [${icon}] ${check.id}: ${check.message}`);
  }

  console.log('');
  console.log(`Result: ${passed ? 'PASSED' : 'FAILED'} (${errorCount} errors, ${warnCount} warnings)`);

  // Write output
  const outputPath = path.resolve(opts.output);
  const result = {
    timestamp: new Date().toISOString(),
    response_file: path.resolve(opts.response),
    passed,
    error_count: errorCount,
    warning_count: warnCount,
    checks: checks.map(({ id, status, message }) => ({ id, status, message }))
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(`Written: ${outputPath}`);

  process.exit(passed ? 0 : 1);
}

main();
