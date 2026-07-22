#!/usr/bin/env node

/**
 * Perplexity research CLI — a small, self-contained wrapper over the
 * Perplexity Chat Completions API for use as a research leg in frameworks.
 *
 * Reads the API key from the PERPLEXITY_API_KEY environment variable only
 * (never from argv, never hardcoded). Get a key at https://www.perplexity.ai
 * (Settings -> API) and put it in your .env as PERPLEXITY_API_KEY=...
 *
 * Usage:
 *   node tools/perplexity/cli.js "your research question"
 *   echo "your question" | node tools/perplexity/cli.js
 *   npm run research:perplexity -- "your research question"
 *
 * Options:
 *   --model <name>   Perplexity model (default: sonar-pro).
 *                    sonar | sonar-pro | sonar-reasoning-pro | sonar-deep-research
 *   --json           Print the full structured payload (answer + citations)
 *                    as JSON instead of plain text.
 *   --output <path>  Also write the full JSON payload to this file.
 *   --help, -h       Show this help.
 *
 * Exit codes:
 *   0  success
 *   1  usage error (no query)
 *   2  PERPLEXITY_API_KEY not set
 *   3  API call failed (network, auth, or non-2xx response)
 */

const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.perplexity.ai/chat/completions';

function parseArgs(argv) {
  const opts = { model: 'sonar-pro' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') opts.model = argv[++i];
    else if (a === '--json') opts.json = true;
    else if (a === '--output') opts.output = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
    else rest.push(a);
  }
  opts.query = rest.join(' ').trim();
  return opts;
}

function usage() {
  console.log(`Perplexity research CLI

Usage:
  node tools/perplexity/cli.js "your research question"
  echo "your question" | node tools/perplexity/cli.js
  npm run research:perplexity -- "your research question"

Options:
  --model <name>   sonar | sonar-pro (default) | sonar-reasoning-pro | sonar-deep-research
  --json           Print full payload (answer + citations) as JSON
  --output <path>  Write full JSON payload to a file
  --help, -h       Show this help

Requires PERPLEXITY_API_KEY in the environment (or .env). Get one at
https://www.perplexity.ai (Settings -> API).`);
}

function readStdin() {
  try {
    if (process.stdin.isTTY) return '';
    return fs.readFileSync(0, 'utf8').trim();
  } catch (_e) {
    return '';
  }
}

// Minimal .env loader (no dependency): populates process.env from a .env file
// at the repo root if PERPLEXITY_API_KEY is not already set. Does not override
// values already present in the environment.
function loadDotEnv() {
  if (process.env.PERPLEXITY_API_KEY) return;
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '..', '.env'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (_e) {
      continue;
    }
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
    if (process.env.PERPLEXITY_API_KEY) return;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    usage();
    process.exit(0);
  }

  if (!opts.query) opts.query = readStdin();
  if (!opts.query) {
    console.error('[perplexity] No query provided. Pass a question as an argument or via stdin.');
    usage();
    process.exit(1);
  }

  loadDotEnv();
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    console.error('[perplexity] PERPLEXITY_API_KEY is not set.');
    console.error('[perplexity] Add it to your .env (PERPLEXITY_API_KEY=...) or export it.');
    console.error('[perplexity] Get a key at https://www.perplexity.ai (Settings -> API).');
    process.exit(2);
  }

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: 'user', content: opts.query }],
      }),
    });
  } catch (err) {
    console.error(`[perplexity] Network error calling the API: ${err.message}`);
    process.exit(3);
  }

  const bodyText = await res.text();
  if (!res.ok) {
    console.error(`[perplexity] API returned HTTP ${res.status}.`);
    // Surface the API's own error message (e.g. 401 invalid key) without
    // leaking the request headers.
    console.error(bodyText.slice(0, 2000));
    process.exit(3);
  }

  let data;
  try {
    data = JSON.parse(bodyText);
  } catch (_e) {
    console.error('[perplexity] API response was not valid JSON.');
    console.error(bodyText.slice(0, 2000));
    process.exit(3);
  }

  const answer =
    (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
    '';
  const citations = data.citations || data.search_results || [];

  const payload = {
    ok: true,
    model: opts.model,
    query: opts.query,
    answer,
    citations,
    raw: data,
  };

  if (opts.output) {
    try {
      fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
      fs.writeFileSync(opts.output, JSON.stringify(payload, null, 2));
    } catch (err) {
      console.error(`[perplexity] Failed to write output file: ${err.message}`);
      process.exit(3);
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(answer);
    if (citations.length) {
      console.log('\nSources:');
      citations.forEach((c, i) => {
        const url = typeof c === 'string' ? c : c.url || c.link || JSON.stringify(c);
        console.log(`  [${i + 1}] ${url}`);
      });
    }
  }
}

main();
