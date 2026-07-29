#!/usr/bin/env node
'use strict';

const http = require('http');

const dart = require('./lib/dart-api');
const {
  DEFAULT_AGENT_NAME,
  handleLandingPadAgentEvent,
} = require('./lib/landing-pad-agent');

const DEFAULT_PORT = 8787;

function parseArgs(argv) {
  const args = {
    port: Number(process.env.MYTHOS_DART_AGENT_PORT || DEFAULT_PORT),
    secret: process.env.MYTHOS_DART_AGENT_SECRET || '',
    noComment: false,
    once: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port') {
      i += 1;
      args.port = Number(argv[i]);
    } else if (arg === '--secret') {
      i += 1;
      args.secret = argv[i] || '';
    } else if (arg === '--no-comment') {
      args.noComment = true;
    } else if (arg === '--once') {
      args.once = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.port) || args.port <= 0) {
    throw new Error('--port must be a positive number');
  }
  return args;
}

function help() {
  console.log(`
Run the Mythos Landing Pad Sorter webhook for Dart Custom Agents.

Usage:
  MYTHOS_DART_AGENT_SECRET=<secret> npm run dart:agent:webhook -- --port 8787

Options:
  --port <n>     Port to listen on (default: 8787)
  --secret <s>   Shared secret expected in X-Mythos-Agent-Secret
  --no-comment   Classify but do not post the dry-run comment
  --once         Exit after the first successful POST

Dart Custom Agent workflow:
  When: a task is assigned to your agent
  Then: send a POST request
  Body: {{data}}
  Header: Content-Type: application/json
  Header: X-Mythos-Agent-Secret: <secret>
`.trim());
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Request body was not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function createServer(options = {}) {
  const secret = options.secret || '';
  const requireSecret = Boolean(secret);
  let server;

  server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        writeJson(res, 200, {
          ok: true,
          agent: DEFAULT_AGENT_NAME,
          secret_required: requireSecret,
        });
        return;
      }

      if (req.method !== 'POST' || req.url !== '/dart/custom-agent/landing-pad-sorter') {
        writeJson(res, 404, { ok: false, error: 'Not found' });
        return;
      }

      if (requireSecret && req.headers['x-mythos-agent-secret'] !== secret) {
        writeJson(res, 401, { ok: false, error: 'Invalid agent secret' });
        return;
      }

      const payload = await readJson(req);
      const result = await handleLandingPadAgentEvent(payload, { dart }, {
        mode: 'dry-run',
        noComment: options.noComment,
      });
      writeJson(res, 200, {
        ok: true,
        task_id: result.task_id,
        classification: result.classification.classification,
        confidence: result.classification.confidence,
        target_board: result.classification.routing.target_board,
        commented: result.commented,
      });

      if (options.once) {
        setImmediate(() => server.close());
      }
    } catch (error) {
      writeJson(res, error.statusCode || 500, {
        ok: false,
        error: error.message,
      });
    }
  });

  return server;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    help();
    return;
  }
  const server = createServer(args);
  server.listen(args.port, '127.0.0.1', () => {
    console.log(`Mythos Landing Pad Sorter webhook listening on http://127.0.0.1:${args.port}/dart/custom-agent/landing-pad-sorter`);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  createServer,
};
