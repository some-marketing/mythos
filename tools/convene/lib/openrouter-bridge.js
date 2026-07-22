#!/usr/bin/env node
'use strict';

/**
 * openrouter-bridge.js — Bridge convene.js prompts to OpenRouter API.
 *
 * Reads prompt from stdin, calls OpenRouter chat completions API,
 * prints assistant response to stdout.
 *
 * API Key Resolution (in priority order):
 *   1. 1Password — `op item get` (preferred, human-facing source of truth)
 *   2. Environment variable OPENROUTER_API_KEY (CI/non-interactive fallback)
 *   3. ~/.pi/agent/auth.json openrouter key (legacy fallback)
 *
 * Usage:
 *   echo "prompt text" | node openrouter-bridge.js --model <openrouter-model-id>
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const OPENROUTER_API_HOST = 'openrouter.ai';
const OPENROUTER_API_PATH = '/api/v1/chat/completions';

function resolveApiKey() {
  // 1Password — preferred source of truth.
  // Looks for an item titled "OpenRouter" (case-insensitive) in any vault.
  // Requires `op` CLI to be installed and signed in.
  try {
    const { execSync } = require('child_process');
    // Find OpenRouter item by title search
    const listResult = execSync(
      'op item list --format json 2>/dev/null',
      { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const items = JSON.parse(listResult);
    const openrouterItem = items.find(item =>
      item.title && (
        item.title.toLowerCase().includes('openrouter') ||
        item.title.toLowerCase().includes('open router')
      )
    );
    if (openrouterItem && openrouterItem.id) {
      // Get the credential fields from the item
      const getResult = execSync(
        `op item get ${openrouterItem.id} --format json 2>/dev/null`,
        { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'] }
      );
      const itemDetail = JSON.parse(getResult);
      if (itemDetail.fields) {
        const keyField = itemDetail.fields.find(f =>
          f.label && (f.label.toLowerCase().includes('key') ||
                      f.label.toLowerCase().includes('token') ||
                      f.label.toLowerCase().includes('credential'))
        );
        if (keyField && keyField.value) {
          return keyField.value;
        }
      }
      // Fallback: try sections.fields structure
      if (itemDetail.sections) {
        for (const section of itemDetail.sections) {
          if (section.fields) {
            const keyField = section.fields.find(f =>
              f.label && (f.label.toLowerCase().includes('key') ||
                          f.label.toLowerCase().includes('token'))
            );
            if (keyField && keyField.value) {
              return keyField.value;
            }
          }
        }
      }
    }
  } catch {
    // 1Password not available, not signed in, or item not found — fall through
  }

  // Env var — secondary fallback (for CI/non-interactive use only)
  if (process.env.OPENROUTER_API_KEY) {
    return process.env.OPENROUTER_API_KEY;
  }
  try {
    const authPath = path.join(require('os').homedir(), '.pi', 'agent', 'auth.json');
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    if (auth.openrouter && auth.openrouter.key) {
      return auth.openrouter.key;
    }
  } catch {
    // ignore
  }
  throw new Error('OpenRouter API key not found. Expected: 1Password item with "OpenRouter" or "Open Router" in title (preferred), or OPENROUTER_API_KEY env var, or ~/.pi/agent/auth.json');
}

function parseArgs(argv) {
  const args = { model: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--model') {
      args.model = argv[++i];
    }
  }
  return args;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

function callOpenRouter(apiKey, model, promptText) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Respond concisely and directly.' },
        { role: 'user', content: promptText }
      ],
      temperature: 0.7,
      max_tokens: 4096
    });

    const options = {
      hostname: OPENROUTER_API_HOST,
      path: OPENROUTER_API_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload),
        'HTTP-Referer': 'https://mythos.local',
        'X-Title': 'Mythos Convene'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`OpenRouter error: ${parsed.error.message || JSON.stringify(parsed.error)}`));
            return;
          }
          const content = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
          if (content) {
            resolve(content);
          } else {
            reject(new Error('No content in OpenRouter response: ' + data.slice(0, 500)));
          }
        } catch (err) {
          reject(new Error('Failed to parse OpenRouter response: ' + err.message + '\nRaw: ' + data.slice(0, 500)));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.model) {
    process.stderr.write('ERROR: --model is required\n');
    process.exit(2);
  }

  const apiKey = resolveApiKey();
  const promptText = await readStdin();

  if (!promptText.trim()) {
    process.stderr.write('ERROR: No prompt text from stdin\n');
    process.exit(2);
  }

  try {
    const response = await callOpenRouter(apiKey, args.model, promptText);
    process.stdout.write(response);
    process.stdout.write('\n');
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    process.exit(1);
  }
}

main();
