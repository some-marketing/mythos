#!/usr/bin/env node

/**
 * creative-text-verify.js
 *
 * Gemini Flash cross-check for creative image text and expected facts.
 * Operator directive 2026-06-23: required BEFORE flagging any visual defect
 * in static-image or video-frame creative review.
 *
 * Usage (CLI):
 *   node tools/ai-bridge/creative-text-verify.js \
 *     --images path/to/image.png[,path2.png] \
 *     [--expect "dealer=Belliveau Motors Ford;est=1932"] \
 *     [--claim "The headline reads 'Clearout Event'"] \
 *     --output verdict.json
 *
 * --images    Comma-separated image paths (required; 1 or more)
 * --expect    Semicolon-separated key=value facts to verify (optional)
 *             Example: "dealer=Belliveau Motors Ford;est=1932"
 * --claim     Free-text claim to confirm or deny (optional)
 * --output    Path for structured verdict JSON (required)
 *
 * Output schema (verdict.json):
 * {
 *   "tool": "creative-text-verify",
 *   "model": "gemini-2.5-flash",
 *   "timestamp": "<ISO>",
 *   "images": ["<abs-path>", ...],
 *   "expected_facts": { "dealer": "Belliveau Motors Ford", ... },
 *   "claim": "<free-text claim or null>",
 *   "results": [
 *     {
 *       "image": "<abs-path>",
 *       "transcribed_text": "<all text Gemini read from the image>",
 *       "facts_checked": [
 *         { "key": "dealer", "expected": "...", "found": "...", "match": true|false }
 *       ],
 *       "claim_result": { "claim": "...", "verdict": "confirmed|denied|unclear", "evidence": "..." } | null,
 *       "genuine_discrepancies": ["<only things Gemini is confident are wrong>"],
 *       "notes": "<anything else Gemini surfaced>"
 *     }
 *   ],
 *   "summary": "PASS|FAIL|DISAGREE",
 *   "summary_detail": "<one-line human-readable outcome>"
 * }
 *
 * Summary values:
 *   PASS     — all expected facts matched, claim confirmed (if given), no genuine discrepancies
 *   FAIL     — one or more expected facts mismatched or claim denied; Gemini is confident
 *   DISAGREE — Gemini read something different but is uncertain; surface both reads, don't assert
 *
 * Require() interface:
 *   const { verifyCreativeText } = require('./creative-text-verify');
 *   const verdict = await verifyCreativeText({ images, expect, claim, output });
 *
 * Depends on: tools/ai-bridge/adapters/gemini-api.js (reuses loadApiKey, encodeImage, callGeminiAPI)
 * Memory rule: feedback_visual-error-claims-need-gemini-flash-verify
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { loadApiKey, encodeImage, callGeminiAPI } = require('./adapters/gemini-api');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function parseExpect(expectStr) {
  if (!expectStr) return {};
  const facts = {};
  for (const pair of expectStr.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 1) continue;
    const key   = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) facts[key] = value;
  }
  return facts;
}

function parseArgs(args) {
  const opts = {
    images: [],
    expect: null,
    claim:  null,
    output: null
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--images': opts.images = args[++i].split(',').map(p => p.trim()).filter(Boolean); break;
      case '--expect': opts.expect = args[++i]; break;
      case '--claim':  opts.claim  = args[++i]; break;
      case '--output': opts.output = args[++i]; break;
      case '--help': case '-h':
        console.log(`Usage: node creative-text-verify.js --images <paths> [--expect "k=v;k=v"] [--claim "..."] --output <verdict.json>`);
        process.exit(0);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Build prompt for a single image
// ---------------------------------------------------------------------------

function buildPromptText(imagePath, expectedFacts, claim) {
  const lines = [
    'You are a meticulous creative-QA reviewer. Inspect the image provided and:',
    '',
    '1. TRANSCRIBE all visible text exactly as it appears (preserve case, punctuation, spacing).',
    '2. For each expected fact below, state whether it appears in the image, what you actually see, and whether it matches.',
    '3. If a claim to verify is provided, state whether you can confirm it, deny it, or are uncertain.',
    '4. List ONLY genuine discrepancies — things you are confident are wrong. Do NOT flag items you are unsure about as errors.',
    '5. Note anything else visually relevant (spelling variants, truncated text, unclear elements).',
    '',
    'IMPORTANT: If you are uncertain about any text, say so explicitly. Never assert a discrepancy you are not confident about.',
    '',
    `Image: ${path.basename(imagePath)}`,
    ''
  ];

  const factEntries = Object.entries(expectedFacts);
  if (factEntries.length > 0) {
    lines.push('Expected facts to verify:');
    for (const [k, v] of factEntries) {
      lines.push(`  ${k}: "${v}"`);
    }
    lines.push('');
  }

  if (claim) {
    lines.push(`Claim to verify: ${claim}`);
    lines.push('');
  }

  lines.push('Respond in this exact JSON format (no markdown fences):');
  lines.push('{');
  lines.push('  "transcribed_text": "<all text you can read>",');
  lines.push('  "facts_checked": [');
  lines.push('    { "key": "<k>", "expected": "<v>", "found": "<what you actually see>", "match": true|false }');
  lines.push('  ],');
  if (claim) {
    lines.push('  "claim_result": { "claim": "<the claim>", "verdict": "confirmed|denied|unclear", "evidence": "<what you see that supports this>" },');
  } else {
    lines.push('  "claim_result": null,');
  }
  lines.push('  "genuine_discrepancies": ["<only confident errors>"],');
  lines.push('  "notes": "<anything else relevant>"');
  lines.push('}');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Parse Gemini text response into structured result
// ---------------------------------------------------------------------------

function parseGeminiResult(responseText, imagePath, expectedFacts, claim) {
  // Strip markdown fences if present
  let text = responseText.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Fallback: return raw text as notes, mark all facts as unclear
    const facts = Object.entries(expectedFacts).map(([k, v]) => ({
      key: k, expected: v, found: 'parse-error', match: false
    }));
    return {
      image: path.resolve(imagePath),
      transcribed_text: text,
      facts_checked: facts,
      claim_result: claim ? { claim, verdict: 'unclear', evidence: 'could not parse Gemini response' } : null,
      genuine_discrepancies: [],
      notes: 'WARNING: Gemini response was not valid JSON; raw text returned'
    };
  }

  return {
    image: path.resolve(imagePath),
    transcribed_text:       parsed.transcribed_text        || '',
    facts_checked:          parsed.facts_checked           || [],
    claim_result:           parsed.claim_result            || null,
    genuine_discrepancies:  parsed.genuine_discrepancies   || [],
    notes:                  parsed.notes                   || ''
  };
}

// ---------------------------------------------------------------------------
// Derive summary from results
// ---------------------------------------------------------------------------

function deriveSummary(results) {
  const failedFacts = results.flatMap(r =>
    r.facts_checked.filter(f => f.match === false)
  );
  const deniedClaims = results.filter(r =>
    r.claim_result && r.claim_result.verdict === 'denied'
  );
  const unclearClaims = results.filter(r =>
    r.claim_result && r.claim_result.verdict === 'unclear'
  );
  const genuineErrors = results.flatMap(r => r.genuine_discrepancies).filter(Boolean);

  if (failedFacts.length > 0 || deniedClaims.length > 0 || genuineErrors.length > 0) {
    return {
      summary: 'FAIL',
      summary_detail: [
        failedFacts.length  ? `${failedFacts.length} expected fact(s) did not match` : null,
        deniedClaims.length ? `claim denied by Gemini` : null,
        genuineErrors.length? `${genuineErrors.length} genuine discrepanc(y|ies) found` : null
      ].filter(Boolean).join('; ')
    };
  }

  if (unclearClaims.length > 0) {
    return {
      summary: 'DISAGREE',
      summary_detail: 'Gemini could not confirm the claim with confidence — surface both reads, do not assert a defect'
    };
  }

  return {
    summary: 'PASS',
    summary_detail: 'All expected facts matched; no genuine discrepancies found'
  };
}

// ---------------------------------------------------------------------------
// Core function (require()-able)
// ---------------------------------------------------------------------------

/**
 * Verify creative image text against expected facts and an optional claim.
 *
 * @param {object} opts
 * @param {string[]} opts.images         Absolute or relative image paths (1+)
 * @param {object}  [opts.expect]        Key/value facts to verify (parsed already)
 * @param {string}  [opts.claim]         Free-text claim to confirm/deny
 * @param {string}  opts.output          Path for verdict.json
 * @returns {Promise<object>}            Verdict object (also written to opts.output)
 */
async function verifyCreativeText({ images, expect: expectedFacts = {}, claim = null, output }) {
  if (!images || images.length === 0) throw new Error('--images is required');
  if (!output) throw new Error('--output is required');

  const apiKey = loadApiKey();
  if (!apiKey) throw new Error('GEMINI_API_KEY not found. Set it in environment or ~/.Mythos/.env');

  const model = 'gemini-3-flash-preview';
  const results = [];

  for (const imgPath of images) {
    const absPath = path.resolve(imgPath);
    if (!fs.existsSync(absPath)) throw new Error(`Image not found: ${absPath}`);

    console.log(`Verifying: ${absPath}`);

    const promptText = buildPromptText(absPath, expectedFacts, claim);

    // Write prompt to a temp file (gemini-api.js expects a file path)
    const tmpPrompt = path.join(os.tmpdir(), `creative-text-verify-${Date.now()}.txt`);
    fs.writeFileSync(tmpPrompt, promptText, 'utf8');

    const imagePart   = encodeImage(absPath);
    const promptPart  = { text: promptText };
    const parts       = [imagePart, promptPart];

    const apiResponse = await callGeminiAPI(apiKey, model, parts, {
      maxTokens: 4096,
      responseModalities: [],
      aspectRatio: null,
      imageSize: null
    });

    // Clean up temp prompt file
    try { fs.unlinkSync(tmpPrompt); } catch {}

    const candidate     = apiResponse.candidates?.[0];
    const candidateParts = candidate?.content?.parts || [];
    const responseText  = candidateParts
      .map(p => (typeof p.text === 'string' ? p.text : ''))
      .filter(Boolean)
      .join('\n');

    const result = parseGeminiResult(responseText, absPath, expectedFacts, claim);
    results.push(result);

    const { summary } = deriveSummary([result]);
    console.log(`  -> ${summary}: ${result.transcribed_text.slice(0, 80).replace(/\n/g, ' ')}...`);
  }

  const { summary, summary_detail } = deriveSummary(results);

  const verdict = {
    tool:             'creative-text-verify',
    model,
    timestamp:        new Date().toISOString(),
    images:           images.map(p => path.resolve(p)),
    expected_facts:   expectedFacts,
    claim:            claim || null,
    results,
    summary,
    summary_detail
  };

  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(verdict, null, 2) + '\n');

  console.log(`\nVerdict: ${summary} — ${summary_detail}`);
  console.log(`Written: ${path.resolve(output)}`);

  return verdict;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const opts         = parseArgs(process.argv.slice(2));
  const expectedFacts = parseExpect(opts.expect);

  if (opts.images.length === 0) die('--images is required (comma-separated image paths)');
  if (!opts.output)             die('--output is required');

  await verifyCreativeText({
    images:  opts.images,
    expect:  expectedFacts,
    claim:   opts.claim || null,
    output:  opts.output
  });
}

if (require.main === module) {
  main().catch(err => die(err.message));
}

module.exports = { verifyCreativeText, buildPromptText, parseExpect, deriveSummary };
