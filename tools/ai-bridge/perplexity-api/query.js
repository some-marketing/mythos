#!/usr/bin/env node

/**
 * query.js
 *
 * Reusable, secret-safe Perplexity research query tool.
 *
 * Reads PERPLEXITY_API_KEY from the environment (never from argv — supply it
 * via tools/ai-bridge/perplexity-api/run-with-op.sh, which resolves it from
 * 1Password and exports it only into this process's child env). Sends the
 * prompt to the Perplexity Chat Completions API via the `pplx` CLI
 * (@perplexity-cli/perplexity-cli, already a project devDependency — see
 * package.json `"perplexity": "bunx pplx"`), which is a thinner, more
 * robust surface than hand-rolling the HTTP call: it already handles model
 * selection, JSON output, and file output flags cleanly.
 *
 * Usage:
 *   PERPLEXITY_API_KEY=... node tools/ai-bridge/perplexity-api/query.js \
 *     --prompt path/to/prompt.md --output path/to/response.json [--model sonar-pro]
 *
 *   Or piped through the credential wrapper (recommended):
 *   tools/ai-bridge/perplexity-api/run-with-op.sh \
 *     node tools/ai-bridge/perplexity-api/query.js --prompt prompt.md --output out.json
 *
 * Options:
 *   --prompt <path>   Path to a file containing the prompt text. Required
 *                      (or use --prompt-text for inline, mainly for tests).
 *   --prompt-text <s> Inline prompt text (alternative to --prompt).
 *   --output <path>   Where to write the full JSON response. Optional —
 *                      if omitted, only stdout is used.
 *   --model <name>    Perplexity model. Default: sonar-pro.
 *                      (sonar, sonar-pro, sonar-reasoning-pro, sonar-deep-research)
 *   --offline-shape   Print the expected output shape and exit 0 without
 *                      calling the API. For offline testing of the CLI
 *                      surface without spending API credits.
 *
 * Exit codes:
 *   0  success
 *   1  usage error (missing prompt, etc.)
 *   2  PERPLEXITY_API_KEY not set in env
 *   3  pplx invocation failed (non-zero exit, API error, etc.)
 *
 * The API key is never written to argv, stdout, or any log — pplx reads it
 * directly from process.env.PERPLEXITY_API_KEY in its own child process.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const opts = { model: 'sonar-pro' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prompt') opts.prompt = argv[++i];
    else if (a === '--prompt-text') opts.promptText = argv[++i];
    else if (a === '--output') opts.output = argv[++i];
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--offline-shape') opts.offlineShape = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

function usage() {
  console.log(`Usage: node query.js --prompt <file> [--output <file>] [--model sonar-pro]

Reusable Perplexity research query. Requires PERPLEXITY_API_KEY in env —
resolve it via tools/ai-bridge/perplexity-api/run-with-op.sh.

Options:
  --prompt <path>     File containing the prompt text
  --prompt-text <s>   Inline prompt text (alternative to --prompt)
  --output <path>     Write full JSON response here (also prints answer to stdout)
  --model <name>      sonar | sonar-pro (default) | sonar-reasoning-pro | sonar-deep-research
  --offline-shape     Print expected output shape and exit, no API call
  --help, -h          Show this help
`);
}

const OFFLINE_SHAPE = {
  ok: true,
  model: 'sonar-pro',
  prompt_file: '<path>',
  answer: '<full text answer from Perplexity>',
  raw: { /* full pplx --json payload, shape depends on pplx version */ },
};

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    usage();
    process.exit(0);
  }

  if (opts.offlineShape) {
    console.log(JSON.stringify(OFFLINE_SHAPE, null, 2));
    process.exit(0);
  }

  let promptText = opts.promptText;
  if (!promptText && opts.prompt) {
    try {
      promptText = fs.readFileSync(opts.prompt, 'utf8');
    } catch (err) {
      console.error(`[query.js] Could not read prompt file '${opts.prompt}': ${err.message}`);
      process.exit(1);
    }
  }

  if (!promptText || !promptText.trim()) {
    console.error('[query.js] Missing prompt. Pass --prompt <file> or --prompt-text <string>.');
    usage();
    process.exit(1);
  }

  if (!process.env.PERPLEXITY_API_KEY) {
    console.error('[query.js] PERPLEXITY_API_KEY is not set in env.');
    console.error('[query.js] Run via tools/ai-bridge/perplexity-api/run-with-op.sh to resolve it from 1Password.');
    process.exit(2);
  }

  // Shell out to the project's pplx CLI dependency. --json gives us a
  // structured payload; --no-history avoids polluting the operator's local
  // pplx query history with programmatic calls.
  const args = ['pplx', '-m', opts.model, '--json', '--no-history', promptText];
  const result = spawnSync('bunx', args, {
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 32,
  });

  if (result.error) {
    console.error(`[query.js] Failed to invoke pplx: ${result.error.message}`);
    process.exit(3);
  }

  if (result.status !== 0) {
    console.error(`[query.js] pplx exited with status ${result.status}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(3);
  }

  let parsed;
  let answer = result.stdout.trim();
  try {
    parsed = JSON.parse(result.stdout);
    // pplx --json typically nests the answer text under a few possible keys;
    // fall back through them defensively since the CLI's JSON shape may vary
    // by version.
    answer = parsed.answer || parsed.response || parsed.content || parsed.text || answer;
  } catch (_e) {
    // Not JSON (older pplx versions, or a plain-text fallback) — treat
    // result.stdout itself as the answer.
    parsed = null;
  }

  const payload = {
    ok: true,
    model: opts.model,
    prompt_file: opts.prompt || null,
    answer,
    raw: parsed,
  };

  if (opts.output) {
    try {
      fs.mkdirSync(path.dirname(opts.output), { recursive: true });
      fs.writeFileSync(opts.output, JSON.stringify(payload, null, 2));
    } catch (err) {
      console.error(`[query.js] Failed to write output file: ${err.message}`);
      process.exit(3);
    }
  }

  console.log(answer);
}

main();
