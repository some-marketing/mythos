#!/usr/bin/env node

/**
 * gemini-video-api.js
 *
 * Upload a video file via Gemini Files API and analyze it using gemini-2.5-pro.
 * Supports startOffset to begin analysis at a specific timestamp.
 *
 * Usage:
 *   node tools/ai-bridge/adapters/gemini-video-api.js \
 *     --video <path-to-video> \
 *     --prompt <path-to-prompt.md> \
 *     --output <path-to-response.md> \
 *     [--start-offset <duration-string>]
 *
 * Environment:
 *   GEMINI_API_KEY — required. Can also be in ~/.Mythos/.env
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

// ---------------------------------------------------------------------------
// Load API key
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
// HTTP request helper
// ---------------------------------------------------------------------------

function httpRequest(method, hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 500)}`));
          return;
        }
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Files API
// ---------------------------------------------------------------------------

async function uploadVideoFile(apiKey, videoPath) {
  console.log(`Uploading video: ${videoPath}`);

  const fileBuffer = fs.readFileSync(videoPath);
  const fileName = path.basename(videoPath);

  // Initialize resumable upload
  const initBody = JSON.stringify({
    file: {
      filename: fileName
    }
  });

  const initRes = await httpRequest(
    'POST',
    'generativelanguage.googleapis.com',
    `/upload/v1beta/files?key=${apiKey}`,
    { 'X-Goog-Upload-Protocol': 'resumable' },
    initBody
  );

  const uploadUrl = initRes.data.file?.uri || null;
  if (!uploadUrl) {
    throw new Error('No upload URL returned from Files API');
  }

  // Upload file content
  console.log(`Uploading to: ${uploadUrl.substring(0, 80)}...`);
  const uploadRes = await httpRequest(
    'POST',
    uploadUrl.split('/')[2],
    uploadUrl.split('.com')[1],
    { 'X-Goog-Upload-Protocol': 'resumable' },
    fileBuffer
  );

  const fileUri = uploadRes.data.file?.uri || null;
  if (!fileUri) {
    throw new Error('No file URI in upload response');
  }

  console.log(`Uploaded: ${fileUri}`);
  return fileUri;
}

// ---------------------------------------------------------------------------
// Generate content with video
// ---------------------------------------------------------------------------

async function analyzeVideo(apiKey, fileUri, prompt, startOffset) {
  console.log('Calling gemini-2.5-pro for video analysis...');

  const parts = [
    {
      file_data: {
        mime_type: 'video/x-matroska',
        file_uri: fileUri
      }
    }
  ];

  if (startOffset) {
    parts[0].file_data.video_metadata = {
      start_offset: startOffset
    };
  }

  parts.push({
    text: prompt
  });

  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      maxOutputTokens: 4096,
      temperature: 0.7
    }
  });

  const response = await httpRequest(
    'POST',
    'generativelanguage.googleapis.com',
    `/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
    {},
    body
  );

  const candidate = response.data.candidates?.[0];
  if (!candidate) {
    throw new Error('No candidates in response');
  }

  const candidateParts = candidate.content?.parts || [];
  const responseText = candidateParts
    .map(part => (typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');

  if (!responseText) {
    throw new Error('Candidate contained no text');
  }

  return responseText;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const opts = {
    video: null,
    prompt: null,
    output: null,
    startOffset: null
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--video': opts.video = args[++i]; break;
      case '--prompt': opts.prompt = args[++i]; break;
      case '--output': opts.output = args[++i]; break;
      case '--start-offset': opts.startOffset = args[++i]; break;
      case '--help': case '-h':
        console.log(`Usage: node gemini-video-api.js --video <file> --prompt <file> --output <file> [--start-offset <duration>]

Analyze a video file using Gemini 2.5 Pro via Files API.

Required:
  --video <path>           Path to the video file (MKV, MP4, etc.)
  --prompt <path>          Path to the prompt text file
  --output <path>          Path to write the response markdown

Options:
  --start-offset <duration>  Skip to this point in video (e.g. "52s", "1m30s")

Environment:
  GEMINI_API_KEY           API key (or set in ~/.Mythos/.env)
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

  if (!opts.video) die('--video is required');
  if (!opts.prompt) die('--prompt is required');
  if (!opts.output) die('--output is required');

  if (!fs.existsSync(opts.video)) die(`Video file not found: ${opts.video}`);
  if (!fs.existsSync(opts.prompt)) die(`Prompt file not found: ${opts.prompt}`);

  const apiKey = loadApiKey();
  if (!apiKey) die('GEMINI_API_KEY not found. Set it in environment or ~/.Mythos/.env');

  const promptText = fs.readFileSync(opts.prompt, 'utf8').trim();
  if (!promptText) die('Prompt file is empty');

  console.log(`Video:        ${opts.video}`);
  console.log(`Prompt:       ${opts.prompt} (${promptText.length} chars)`);
  console.log(`Start offset: ${opts.startOffset || 'none (from beginning)'}`);
  console.log(`Output:       ${opts.output}`);
  console.log('');

  try {
    // Upload video
    const fileUri = await uploadVideoFile(apiKey, opts.video);

    // Analyze video
    const response = await analyzeVideo(apiKey, fileUri, promptText, opts.startOffset);

    // Write output
    fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });

    const metadata = [
      '<!-- Video Analysis Metadata -->',
      `timestamp: ${new Date().toISOString()}`,
      `video: ${path.resolve(opts.video)}`,
      `model: gemini-2.5-pro`,
      `start-offset: ${opts.startOffset || 'none'}`,
      `file-uri: ${fileUri}`,
      ''
    ].join('\n');

    const content = `${metadata}\n${response}\n`;
    fs.writeFileSync(opts.output, content);

    console.log(`\nResponse written to: ${opts.output}`);
    console.log(`Response length: ${response.length} chars`);

  } catch (err) {
    die(err.message);
  }
}

if (require.main === module) {
  main().catch(err => {
    die(err.message);
  });
}

module.exports = {
  uploadVideoFile,
  analyzeVideo,
  loadApiKey
};
