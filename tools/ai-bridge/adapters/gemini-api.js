#!/usr/bin/env node

/**
 * gemini-api.js
 *
 * Send a prompt (+ optional images) to Gemini via the REST API.
 * Handles large prompts that browser paste can't handle.
 *
 * Usage:
 *   node tools/ai-bridge/adapters/gemini-api.js \
 *     --prompt <path-to-prompt.md> \
 *     --output <path-to-response.json> \
 *     [--images <path1,path2,...>] \
  *     [--model <model-id>] \
 *     [--max-tokens <n>] \
 *     [--response-modalities <TEXT,IMAGE>] \
 *     [--aspect-ratio <ratio>] \
 *     [--image-size <1K|2K|4K>]
 *
 * Credentials:
 *   GEMINI_API_KEY, resolved through the shared BYO-credential resolver
 *   (tools/lib/resolve-credential.cjs) via this tool's creds.config.json —
 *   env var, then macOS Keychain, then 1Password, then an env file
 *   (.env.local/.env at the repo root, or ~/.mythos/.env). See SETUP.md.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { parseResponse } = require('../lib/response-parser');
const { resolveCredentialsFromFile } = require('../../lib/resolve-credential.cjs');

// ---------------------------------------------------------------------------
// Load API key via the shared credential resolver
// ---------------------------------------------------------------------------

function loadApiKey() {
  try {
    const creds = resolveCredentialsFromFile(path.join(__dirname, '..', 'creds.config.json'));
    return creds.GEMINI_API_KEY || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const opts = {
    prompt: null,
    images: [],
    output: null,
    model: 'gemini-2.5-flash',
    maxTokens: 65536,
    responseModalities: [],
    aspectRatio: null,
    imageSize: null
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--prompt': opts.prompt = args[++i]; break;
      case '--images': opts.images = args[++i].split(',').map(p => p.trim()).filter(Boolean); break;
      case '--output': opts.output = args[++i]; break;
      case '--model': opts.model = args[++i]; break;
      case '--max-tokens': opts.maxTokens = parseInt(args[++i], 10); break;
      case '--response-modalities':
        opts.responseModalities = args[++i].split(',').map(v => v.trim()).filter(Boolean);
        break;
      case '--aspect-ratio':
        opts.aspectRatio = args[++i];
        break;
      case '--image-size':
        opts.imageSize = args[++i];
        break;
      case '--help': case '-h':
        console.log(`Usage: node gemini-api.js --prompt <file> --output <file> [options]

Send a prompt (+ images) to Gemini via REST API.

Required:
  --prompt <path>          Path to the prompt text file
  --output <path>          Path to write the response JSON

Options:
  --images <p1,p2,...>     Comma-separated image paths to upload
  --model <id>             Model ID (default: gemini-2.5-flash)
  --max-tokens <n>         Max output tokens (default: 65536)
  --response-modalities    Comma-separated response modalities (e.g. TEXT,IMAGE)
  --aspect-ratio <ratio>   Image aspect ratio for image-capable models (e.g. 16:9)
  --image-size <size>      Image size for image-capable models (e.g. 1K, 2K, 4K)

Credentials:
  GEMINI_API_KEY resolved via tools/lib/resolve-credential.cjs (env,
  macOS Keychain, 1Password, or .env.local/.env/~/.mythos/.env). See SETUP.md.
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
// Image encoding
// ---------------------------------------------------------------------------

function encodeImage(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`Image not found: ${abs}`);

  const data = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const mimeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif'
  };
  const mime = mimeMap[ext] || 'image/png';

  return {
    inline_data: {
      mime_type: mime,
      data: data.toString('base64')
    }
  };
}

function outputFileStem(outputPath) {
  const resolved = path.resolve(outputPath);
  return {
    dir: path.dirname(resolved),
    stem: path.basename(resolved, path.extname(resolved))
  };
}

function extensionForMimeType(mimeType) {
  switch (String(mimeType || '').toLowerCase()) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'image/png':
    default:
      return '.png';
  }
}

function saveInlineDataParts(parts, outputPath) {
  const saved = [];
  const { dir, stem } = outputFileStem(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  let imageIndex = 0;
  for (const part of parts || []) {
    const blob = part.inlineData || part.inline_data || null;
    if (!blob || !blob.data) continue;

    imageIndex += 1;
    const mimeType = blob.mimeType || blob.mime_type || 'image/png';
    const ext = extensionForMimeType(mimeType);
    const filename = `${stem}__image${String(imageIndex).padStart(2, '0')}${ext}`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, Buffer.from(blob.data, 'base64'));
    saved.push({
      path: filePath,
      mime_type: mimeType
    });
  }

  return saved;
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

function callGeminiAPI(apiKey, model, parts, opts) {
  return new Promise((resolve, reject) => {
    const generationConfig = {
      maxOutputTokens: opts.maxTokens,
      temperature: 0.7
    };

    if (Array.isArray(opts.responseModalities) && opts.responseModalities.length > 0) {
      generationConfig.responseModalities = opts.responseModalities;
    }

    if (opts.aspectRatio || opts.imageSize) {
      generationConfig.imageConfig = {};
      if (opts.aspectRatio) generationConfig.imageConfig.aspectRatio = opts.aspectRatio;
      if (opts.imageSize) generationConfig.imageConfig.imageSize = opts.imageSize;
    }

    const body = JSON.stringify({
      contents: [{ parts }],
      generationConfig
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${model}:generateContent`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-goog-api-key': apiKey
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`API returned ${res.statusCode}: ${data.substring(0, 500)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.prompt) die('--prompt is required');
  if (!opts.output) die('--output is required');
  if (!fs.existsSync(opts.prompt)) die(`Prompt file not found: ${opts.prompt}`);

  const apiKey = loadApiKey();
  if (!apiKey) die('GEMINI_API_KEY not resolvable. See tools/ai-bridge/SETUP.md — set it in your environment, seed it in macOS Keychain, store it in 1Password, or add it to .env.local/.env/~/.mythos/.env.');

  const promptText = fs.readFileSync(opts.prompt, 'utf8').trim();
  if (!promptText) die('Prompt file is empty');

  console.log(`Prompt: ${opts.prompt} (${promptText.length} chars)`);
  console.log(`Images: ${opts.images.length > 0 ? opts.images.join(', ') : 'none'}`);
  console.log(`Model:  ${opts.model}`);
  console.log(`Output: ${opts.output}`);
  if (opts.responseModalities.length > 0) {
    console.log(`Modalities: ${opts.responseModalities.join(', ')}`);
  }
  if (opts.aspectRatio || opts.imageSize) {
    console.log(`Image config: ${[
      opts.aspectRatio ? `aspectRatio=${opts.aspectRatio}` : null,
      opts.imageSize ? `imageSize=${opts.imageSize}` : null
    ].filter(Boolean).join(', ')}`);
  }
  console.log('');

  // Build parts array
  const parts = [];

  // Add images first
  for (const img of opts.images) {
    console.log(`Encoding image: ${img}`);
    parts.push(encodeImage(img));
  }

  // Add text prompt
  parts.push({ text: promptText });

  // Call API
  console.log('Calling Gemini API...');
  const startTime = Date.now();
  const apiResponse = await callGeminiAPI(apiKey, opts.model, parts, opts);
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`Response received in ${elapsed}s`);

  const candidate = apiResponse.candidates?.[0];
  if (!candidate) die('No candidates in response');

  const candidateParts = candidate.content?.parts || [];
  const responseText = candidateParts
    .map(part => (typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
  const generatedImages = saveInlineDataParts(candidateParts, opts.output);
  if (!responseText && generatedImages.length === 0) {
    die('Candidate contained neither text nor inline image data');
  }

  // Parse for code blocks
  const parsed = parseResponse(responseText);

  // Build output
  const output = {
    mode: 'api',
    timestamp: new Date().toISOString(),
    prompt_file: path.resolve(opts.prompt),
    images: opts.images.map(p => path.resolve(p)),
    model: opts.model,
    response_text: parsed.raw_text,
    code_blocks: parsed.code_blocks,
    has_html: parsed.has_html,
    response_length: parsed.raw_text.length,
    generated_images: generatedImages.map(image => ({
      path: image.path,
      mime_type: image.mime_type
    })),
    finish_reason: candidate.finishReason,
    usage: apiResponse.usageMetadata || null
  };

  // Write output
  fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
  fs.writeFileSync(opts.output, JSON.stringify(output, null, 2) + '\n');

  console.log(`\nResponse written to: ${opts.output}`);
  console.log(`  Text length: ${output.response_length} chars`);
  console.log(`  Code blocks: ${output.code_blocks.length}`);
  console.log(`  Generated images: ${output.generated_images.length}`);
  console.log(`  Has HTML: ${output.has_html}`);
  console.log(`  Finish reason: ${output.finish_reason}`);
  for (const image of output.generated_images) {
    console.log(`  Image: ${image.path}`);
  }
  if (output.usage) {
    console.log(`  Tokens: ${output.usage.promptTokenCount} in, ${output.usage.candidatesTokenCount} out`);
  }
}

if (require.main === module) {
  main().catch(err => {
    die(err.message);
  });
}

module.exports = {
  callGeminiAPI,
  encodeImage,
  extensionForMimeType,
  loadApiKey,
  outputFileStem,
  parseArgs,
  saveInlineDataParts
};
