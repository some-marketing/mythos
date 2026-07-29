#!/usr/bin/env node

/**
 * visual-format-review.js
 *
 * Gemini Flash visual-formatting review for rendered documents / artifacts.
 * Returns a structured JSON assessment from the perspective of a named audience.
 *
 * Usage:
 *   node tools/ai-bridge/visual-format-review.js \
 *     --images a.png,b.png \
 *     --audience "a non-technical small-business owner" \
 *     [--context "This is a rendered plan document..."] \
 *     [--model gemini-3-flash-preview] \
 *     [--output review.json]
 *
 * Output schema:
 * {
 *   "reviewability_score_0_to_10": <number>,
 *   "one_line_verdict": "<string>",
 *   "works_well": ["<string>", ...],
 *   "hurts_readability": [{ "issue": "...", "why_it_matters_to_this_audience": "...", "severity": "low|medium|high" }],
 *   "concrete_formatting_fixes": [{ "fix": "...", "rationale": "...", "effort": "low|medium|high" }]
 * }
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { loadApiKey, encodeImage, callGeminiAPI } = require('./adapters/gemini-api');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    images:   [],
    audience: null,
    context:  null,
    model:    'gemini-3-flash-preview',
    output:   null,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--images':   opts.images   = argv[++i].split(',').map(s => s.trim()).filter(Boolean); break;
      case '--audience': opts.audience = argv[++i]; break;
      case '--context':  opts.context  = argv[++i]; break;
      case '--model':    opts.model    = argv[++i]; break;
      case '--output':   opts.output   = argv[++i]; break;
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(audience, context) {
  const artifactDesc = context
    ? `Artifact context: ${context}`
    : 'Artifact context: not specified.';

  return `You are acting as ${audience}.

${artifactDesc}

Your task: review the provided screenshot(s) for VISUAL FORMATTING and READABILITY ONLY. Do NOT assess whether the content is strategically correct or factually accurate — focus entirely on how easy it is for someone like you to read, scan, and understand the layout at a glance.

Return STRICT JSON only — no markdown fences, no commentary outside the JSON object:

{
  "reviewability_score_0_to_10": <integer 0–10, where 10 = perfectly readable for this audience>,
  "one_line_verdict": "<one sentence summary of the overall formatting impression>",
  "works_well": ["<thing that aids readability>", ...],
  "hurts_readability": [
    {
      "issue": "<what the formatting problem is>",
      "why_it_matters_to_this_audience": "<why this specific audience would struggle with it>",
      "severity": "low" | "medium" | "high"
    }
  ],
  "concrete_formatting_fixes": [
    {
      "fix": "<specific actionable change>",
      "rationale": "<why this fix helps>",
      "effort": "low" | "medium" | "high"
    }
  ]
}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.images.length) { console.error('ERROR: --images is required'); process.exit(1); }
  if (!opts.audience)      { console.error('ERROR: --audience is required'); process.exit(1); }

  const apiKey = loadApiKey();
  if (!apiKey) { console.error('ERROR: GEMINI_API_KEY not found in env or ~/.Mythos/.env'); process.exit(1); }

  for (const img of opts.images) {
    const abs = path.resolve(img);
    if (!fs.existsSync(abs)) { console.error(`ERROR: Image not found: ${abs}`); process.exit(1); }
  }

  const promptText = buildPrompt(opts.audience, opts.context);
  const parts = [
    ...opts.images.map(img => encodeImage(path.resolve(img))),
    { text: promptText },
  ];

  const apiResponse = await callGeminiAPI(apiKey, opts.model, parts, {
    maxTokens: 4096,
    responseModalities: [],
    aspectRatio: null,
    imageSize: null,
  });

  const candidate = apiResponse.candidates?.[0];
  const rawText = (candidate?.content?.parts || [])
    .map(p => (typeof p.text === 'string' ? p.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();

  // Strip any accidental markdown fences
  const jsonText = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (e) {
    console.error('ERROR: Gemini response was not valid JSON:\n' + rawText);
    process.exit(1);
  }

  const out = JSON.stringify(result, null, 2);
  process.stdout.write(out + '\n');

  if (opts.output) {
    fs.writeFileSync(path.resolve(opts.output), out, 'utf8');
    console.error(`Wrote: ${path.resolve(opts.output)}`);
  }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
