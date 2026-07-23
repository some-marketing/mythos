#!/usr/bin/env node
'use strict';

const http = require('http');
const { spawn } = require('child_process');

function parseArgs(argv) {
  const args = {
    nodes: 'orwell,rupert',
    uri: '',
    host: 'macbook-pro',
    port: 8765,
    serve: false,
    root: process.cwd(),
    timeoutMs: 20000
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--nodes') args.nodes = argv[++i] || args.nodes;
    else if (arg === '--uri') args.uri = argv[++i] || '';
    else if (arg === '--host') args.host = argv[++i] || args.host;
    else if (arg === '--port') args.port = Number(argv[++i] || args.port);
    else if (arg === '--root') args.root = argv[++i] || args.root;
    else if (arg === '--serve') args.serve = true;
    else if (arg === '--timeout-ms') args.timeoutMs = Number(argv[++i] || args.timeoutMs);
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.uri) {
    args.uri = `http://${args.host}:${args.port}/_dev/outputs/mirrors/composite-truth-mirror-1.png`;
  }

  return args;
}

function help() {
  console.log(`
Broadcast a mirror image URI to fleet worker display tools.

Usage:
  node tools/fleet/broadcast-mirror.js [options]

Options:
  --nodes <csv>       Node hostnames/worker IDs to target. Default: orwell,rupert
  --uri <url>         URI to open on each node. Default: http://<host>:<port>/_dev/outputs/mirrors/composite-truth-mirror-1.png
  --host <name>       Host used for the default URI. Default: macbook-pro
  --port <port>       Temporary static server port when --serve is used. Default: 8765
  --root <path>       Directory to serve when --serve is used. Default: cwd
  --serve             Start a temporary python http.server before dispatching.
  --timeout-ms <ms>   Per-node request timeout. Default: 20000
  --help              Show this help.

Examples:
  node tools/fleet/broadcast-mirror.js --serve
  node tools/fleet/broadcast-mirror.js --nodes orwell --uri file:///C:/Users/taylo/Pictures/composite-truth-mirror.png
`.trim());
}

function startServer(root, port) {
  const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '0.0.0.0'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(child), 1000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== null && code !== 0) reject(new Error(`temporary server exited with code ${code}`));
    });
  });
}

function postJson(url, body, timeoutMs) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* keep text */ }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json,
          text: json ? undefined : data
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, error: 'timeout' });
    });
    req.on('error', error => resolve({ ok: false, status: 0, error: error.message }));
    req.write(payload);
    req.end();
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    help();
    return;
  }

  const nodes = args.nodes.split(',').map(node => node.trim()).filter(Boolean);
  if (nodes.length === 0) throw new Error('At least one node is required.');

  let server = null;
  if (args.serve) {
    server = await startServer(args.root, args.port);
  }

  const timestamp = new Date().toISOString();
  const results = [];
  try {
    for (const node of nodes) {
      const task = {
        task_id: `mirror_broadcast_${node}_${Date.now()}`,
        task_type: 'tool_call',
        model: 'tool:display',
        prompt: args.uri,
        metadata: {
          tool_name: 'display',
          args: { uri: args.uri }
        },
        timeout_seconds: Math.ceil(args.timeoutMs / 1000)
      };
      const response = await postJson(`http://${node}:8001/api/tasks`, task, args.timeoutMs);
      results.push({ node, worker_url: `http://${node}:8001`, task_id: task.task_id, uri: args.uri, response });
    }
  } finally {
    if (server) server.kill('SIGINT');
  }

  console.log(JSON.stringify({ timestamp, uri: args.uri, results }, null, 2));

  const failed = results.some(result => {
    const taskStatus = result.response && result.response.json && result.response.json.status;
    return !result.response.ok || taskStatus !== 'completed';
  });
  process.exit(failed ? 1 : 0);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
