#!/usr/bin/env node
/**
 * tools/fleet/orwell-submind.js
 *
 * Stateless dispatch tool for Orwell (Windows, RTX 5070 Ti, Ollama).
 * Opens an ephemeral SSH local port-forward, dispatches inference, tears it down.
 *
 * Council contract (convene 20260612T174512Z):
 *   - SSH port-forward only — Ollama is never exposed to the network surface
 *   - Hard timeout (default 120s), no orphan tunnels on exit/signal
 *   - Bounded context: refuses payloads >64 KB unless --force
 *   - No writes on Orwell — strictly inference-only
 *   - Multi-provider shape: host/port/user/model defaults from fleet-hosts.json
 *   - Structured JSON return for every exit path
 *
 * USAGE
 * -----
 *   node orwell-submind.js health [--host <name>]
 *   node orwell-submind.js list   [--host <name>]
 *   node orwell-submind.js dispatch --task-file <path> [options]
 *
 * DISPATCH OPTIONS
 *   --host <name>          Fleet host key (default: orwell)
 *   --model <id>           Model to use (default: from fleet-hosts.json)
 *   --task-file <path>     Required. Plain-text file containing the prompt.
 *   --context <file>       Additional context file(s); repeat for multiple.
 *   --timeout-ms <n>       Hard wall-clock timeout in ms (default: 120000)
 *   --out <json-path>      Write result JSON to this path (else stdout)
 *   --temperature <n>      Sampling temperature (default: 0.1)
 *   --num-ctx <n>          Context window tokens (default: 8192)
 *   --force                Skip the 64 KB payload guard
 *
 * OUTPUT SCHEMA (JSON)
 *   {
 *     model, prompt_hash, started_at, duration_ms,
 *     response, eval_count, prompt_eval_count, tokens_per_sec,
 *     verdict: "ok" | "timeout" | "error",
 *     error?
 *   }
 *
 * REQUIREMENTS
 *   Node >= 18 (built-in fetch). No npm deps beyond Node stdlib.
 *   SSH key at ~/.ssh/id_ed25519 (keyless, IdentityAgent bypassed).
 */

'use strict';

const { spawn, spawnSync } = require('child_process');
const { createHash }       = require('crypto');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { resolve, join }    = require('path');
const os                   = require('os');
const net                  = require('net');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO_ROOT       = resolve(__dirname, '../..');
const HOSTS_FILE      = join(__dirname, 'fleet-hosts.json');
const PAYLOAD_LIMIT   = 64 * 1024; // 64 KB
const TUNNEL_READY_MS = 8000;      // max wait for SSH tunnel to be routable
const TUNNEL_POLL_MS  = 200;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function loadHostConfig(hostKey) {
  if (!existsSync(HOSTS_FILE)) {
    throw new Error(`fleet-hosts.json not found at ${HOSTS_FILE}`);
  }
  const cfg = JSON.parse(readFileSync(HOSTS_FILE, 'utf8'));
  const host = cfg.hosts[hostKey];
  if (!host) {
    throw new Error(`Host "${hostKey}" not found in fleet-hosts.json. Available: ${Object.keys(cfg.hosts).join(', ')}`);
  }
  const provider = cfg.providers[host.provider];
  if (!provider) {
    throw new Error(`Provider "${host.provider}" not found in fleet-hosts.json`);
  }
  return { host, provider, allHosts: cfg.hosts };
}

function resolveIdentity(rawPath) {
  return rawPath.replace(/^~/, os.homedir());
}

/** Find a free local TCP port. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** Poll until TCP port is connectable or deadline passes. */
function waitForPort(port, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      const sock = new net.Socket();
      sock.setTimeout(300);
      sock.connect(port, '127.0.0.1', () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() < deadline) {
          setTimeout(attempt, TUNNEL_POLL_MS);
        } else {
          resolve(false);
        }
      });
      sock.on('timeout', () => {
        sock.destroy();
        if (Date.now() < deadline) {
          setTimeout(attempt, TUNNEL_POLL_MS);
        } else {
          resolve(false);
        }
      });
    }
    attempt();
  });
}

function sha256(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex').slice(0, 16);
}

function parseArgs(argv) {
  const args = { context: [], _rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model')       { args.model       = argv[++i]; continue; }
    if (a === '--task-file')   { args.taskFile     = argv[++i]; continue; }
    if (a === '--context')     { args.context.push(argv[++i]); continue; }
    if (a === '--timeout-ms')  { args.timeoutMs    = parseInt(argv[++i], 10); continue; }
    if (a === '--out')         { args.out          = argv[++i]; continue; }
    if (a === '--temperature') { args.temperature  = parseFloat(argv[++i]); continue; }
    if (a === '--num-ctx')     { args.numCtx       = parseInt(argv[++i], 10); continue; }
    if (a === '--host')        { args.host         = argv[++i]; continue; }
    if (a === '--force')       { args.force        = true; continue; }
    args._rest.push(a);
  }
  return args;
}

// ---------------------------------------------------------------------------
// Tunnel lifecycle
// ---------------------------------------------------------------------------

/**
 * Open an SSH local port-forward.
 * Returns { process, localPort, teardown }.
 * teardown() kills the tunnel gracefully.
 */
async function openTunnel(hostCfg) {
  const localPort  = await getFreePort();
  const remoteHost = hostCfg.provider_config.host;
  const remotePort = hostCfg.provider_config.port;
  const sshUser    = hostCfg.ssh_user;
  const sshHost    = hostCfg.ssh_host;
  const identity   = resolveIdentity(hostCfg.ssh_identity);

  const sshArgs = [
    '-o', 'BatchMode=yes',
    '-o', 'IdentityAgent=none',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=4',
    '-N',
    '-L', `${localPort}:${remoteHost}:${remotePort}`,
    '-i', identity,
    `${sshUser}@${sshHost}`,
  ];

  const tunnel = spawn('ssh', sshArgs, {
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: false,
  });

  // Capture stderr for diagnostics but don't surface noise by default
  let tunnelStderr = '';
  tunnel.stderr.on('data', (d) => { tunnelStderr += d.toString(); });

  tunnel.on('error', (err) => {
    // Caught via waitForPort timeout — no throw here
    tunnelStderr += `\nspawn error: ${err.message}`;
  });

  // Wait for the local port to be connectable
  const ready = await waitForPort(localPort, TUNNEL_READY_MS);
  if (!ready) {
    tunnel.kill('SIGTERM');
    throw new Error(`SSH tunnel to ${sshHost} failed to become ready within ${TUNNEL_READY_MS}ms.\nSSH stderr: ${tunnelStderr.trim()}`);
  }

  const teardown = () => {
    try { tunnel.kill('SIGTERM'); } catch (_) {}
  };

  return { process: tunnel, localPort, teardown };
}

// ---------------------------------------------------------------------------
// Ollama API helpers
// ---------------------------------------------------------------------------

function baseUrl(localPort) {
  return `http://127.0.0.1:${localPort}`;
}

async function ollamaVersion(localPort, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl(localPort)}/api/version`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function ollamaTags(localPort, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl(localPort)}/api/tags`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function ollamaGenerate(localPort, payload, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl(localPort)}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function cmdHealth(args) {
  const hostKey = args.host || 'orwell';
  const { host } = loadHostConfig(hostKey);
  let tunnel;
  try {
    tunnel = await openTunnel(host);
    const ver = await ollamaVersion(tunnel.localPort);
    const out = {
      verdict: 'ok',
      host: hostKey,
      ssh_host: host.ssh_host,
      ollama_version: ver.version,
      local_port: tunnel.localPort,
    };
    console.log(JSON.stringify(out, null, 2));
  } finally {
    if (tunnel) tunnel.teardown();
  }
}

async function cmdList(args) {
  const hostKey = args.host || 'orwell';
  const { host } = loadHostConfig(hostKey);
  let tunnel;
  try {
    tunnel = await openTunnel(host);
    const tags = await ollamaTags(tunnel.localPort);
    const models = (tags.models || []).map(m => ({
      name: m.name,
      size_gb: m.size ? (m.size / 1e9).toFixed(2) : null,
      modified_at: m.modified_at || null,
    }));
    const out = { verdict: 'ok', host: hostKey, models };
    console.log(JSON.stringify(out, null, 2));
  } finally {
    if (tunnel) tunnel.teardown();
  }
}

async function cmdDispatch(args) {
  const hostKey    = args.host        || 'orwell';
  const timeoutMs  = args.timeoutMs   || 120000;
  const temperature = args.temperature != null ? args.temperature : 0.1;
  const numCtx     = args.numCtx      || 8192;

  const { host } = loadHostConfig(hostKey);
  const model = args.model || host.default_model;

  // --- Build prompt ---
  if (!args.taskFile) {
    throw new Error('--task-file is required for dispatch');
  }
  const taskPath = resolve(args.taskFile);
  if (!existsSync(taskPath)) {
    throw new Error(`Task file not found: ${taskPath}`);
  }

  let prompt = readFileSync(taskPath, 'utf8').trim();

  if (args.context && args.context.length > 0) {
    const ctxParts = args.context.map((f) => {
      const p = resolve(f);
      if (!existsSync(p)) throw new Error(`Context file not found: ${p}`);
      return `\n--- context: ${f} ---\n${readFileSync(p, 'utf8').trim()}`;
    });
    prompt = ctxParts.join('\n') + '\n\n--- task ---\n' + prompt;
  }

  // --- Payload size guard ---
  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  if (promptBytes > PAYLOAD_LIMIT && !args.force) {
    throw new Error(
      `Payload too large: ${(promptBytes / 1024).toFixed(1)} KB > 64 KB limit. ` +
      `Pass --force to override.`
    );
  }

  const promptHash = sha256(prompt);
  const startedAt  = new Date().toISOString();
  const startMs    = Date.now();

  // --- Open tunnel + dispatch ---
  let tunnel;
  let result;
  try {
    tunnel = await openTunnel(host);

    const payload = {
      model,
      prompt,
      stream: false,
      options: { temperature, num_ctx: numCtx },
    };

    let ollResp;
    let verdict = 'ok';
    let errorMsg;

    try {
      ollResp = await ollamaGenerate(tunnel.localPort, payload, timeoutMs);
    } catch (err) {
      verdict  = err.name === 'AbortError' ? 'timeout' : 'error';
      errorMsg = err.message;
    }

    const durationMs    = Date.now() - startMs;
    const evalCount     = ollResp?.eval_count     ?? null;
    const promptEvalCnt = ollResp?.prompt_eval_count ?? null;
    // tokens/sec from Ollama's own ns timing if available, else wall-clock
    const evalDurationNs = ollResp?.eval_duration ?? null;
    const tokensPerSec   = evalCount && evalDurationNs
      ? parseFloat((evalCount / (evalDurationNs / 1e9)).toFixed(2))
      : evalCount
        ? parseFloat((evalCount / (durationMs / 1000)).toFixed(2))
        : null;

    result = {
      model,
      host: hostKey,
      prompt_hash: promptHash,
      started_at:  startedAt,
      duration_ms: durationMs,
      response:    ollResp?.response ?? null,
      eval_count:        evalCount,
      prompt_eval_count: promptEvalCnt,
      tokens_per_sec:    tokensPerSec,
      verdict,
      ...(errorMsg ? { error: errorMsg } : {}),
    };

  } finally {
    if (tunnel) tunnel.teardown();
  }

  // --- Output ---
  const resultJson = JSON.stringify(result, null, 2);
  if (args.out) {
    writeFileSync(resolve(args.out), resultJson, 'utf8');
    process.stderr.write(`[orwell-submind] result written to ${args.out}\n`);
  } else {
    console.log(resultJson);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Signal handling — no orphan tunnels
// ---------------------------------------------------------------------------
// (Tunnels are child processes; spawn() with detached:false means they die
//  automatically when the Node process exits. But we also handle SIGINT/SIGTERM
//  explicitly to flush any open tunnel reference. Individual commands store
//  their teardown in the finally blocks above.)

process.on('SIGINT',  () => { process.exit(130); });
process.on('SIGTERM', () => { process.exit(143); });

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const [,, subcommand, ...rest] = process.argv;
  const args = parseArgs(rest);

  const commands = { health: cmdHealth, list: cmdList, dispatch: cmdDispatch };

  if (!subcommand || !commands[subcommand]) {
    const usage = `Usage: node orwell-submind.js <health|list|dispatch> [options]

Subcommands:
  health    Verify SSH tunnel + Ollama version
  list      List cached models on the fleet host
  dispatch  Run inference and return structured JSON

Dispatch options:
  --host <name>          Fleet host key (default: orwell)
  --model <id>           Model ID (default: from fleet-hosts.json)
  --task-file <path>     Required prompt file
  --context <file>       Additional context file(s); repeatable
  --timeout-ms <n>       Hard timeout in ms (default: 120000)
  --out <json-path>      Write result JSON to path (else stdout)
  --temperature <n>      Temperature (default: 0.1)
  --num-ctx <n>          Context window (default: 8192)
  --force                Skip 64 KB payload guard
`;
    process.stderr.write(usage);
    process.exit(1);
  }

  try {
    await commands[subcommand](args);
  } catch (err) {
    const errOut = { verdict: 'error', error: err.message };
    console.error(JSON.stringify(errOut, null, 2));
    process.exit(1);
  }
}

main();
