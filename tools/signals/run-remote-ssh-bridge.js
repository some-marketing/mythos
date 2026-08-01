#!/usr/bin/env node
'use strict';

/**
 * run-remote-ssh-bridge.js
 *
 * Signal-aware runner for the remote-ssh bridge target.
 * SSHs into a configured remote host, runs the inference prompt there
 * (via Ollama REST API through an SSH tunnel, or direct shell command),
 * captures the response, and writes a completion signal locally.
 *
 * Phase 1:
 *   - Freeform prompts only
 *   - Ollama via SSH tunnel (localhost:local_port -> remote_host:11434)
 *   - Shell fallback for non-Ollama engines
 *
 * Phase 2 (future):
 *   - Remote managed-command validation
 *   - Command surface sync from remote host
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync, spawn } = require('child_process');
const { parseArgs } = require('../workspace/lib/args');
const { selectActorTargetSignal } = require('./lib/actor-auto');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const REMOTE_HOSTS_PATH = path.join(PROJECT_ROOT, '_dev', 'config', 'remote-hosts.json');
const OLLAMA_LOCAL_PORT_BASE = 21300; // Ephemeral range start for tunnel binding

function help() {
  console.log(`
Run remote SSH inference for the latest live remote-ssh-targeted coordination signal.

Usage:
  node tools/signals/run-remote-ssh-bridge.js --host <host-alias> [options]

Required:
  --host <alias>  Host alias from _dev/config/remote-hosts.json

Options:
  --file <name>   Consume a specific live signal file from _dev/reports/signals/
  --model <name>  Override the default model for this host
  --dry-run       Print the command without executing
  --json          Print machine-readable output
  --help          Show this help
`.trim());
}

function loadRemoteHosts() {
  if (!fs.existsSync(REMOTE_HOSTS_PATH)) {
    throw new Error(`Remote hosts config not found: ${REMOTE_HOSTS_PATH}`);
  }
  const raw = fs.readFileSync(REMOTE_HOSTS_PATH, 'utf8');
  return JSON.parse(raw);
}

function resolveHostConfig(hostAlias) {
  const config = loadRemoteHosts();
  const hostConfig = config.hosts && config.hosts[hostAlias];
  if (!hostConfig) {
    const known = Object.keys(config.hosts || {}).join(', ') || '(none)';
    throw new Error(`Unknown host alias "${hostAlias}". Known hosts: ${known}`);
  }
  return hostConfig;
}

function resolveSshKeyPath(keyPath) {
  if (!keyPath) return '';
  if (path.isAbsolute(keyPath)) return keyPath;
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, keyPath.replace(/^~\//, '').replace(/^~\\/, ''));
}

function buildSshArgs(hostConfig, remoteCommand = '') {
  const args = [];
  const keyPath = resolveSshKeyPath(hostConfig.ssh_key_path);
  if (keyPath && fs.existsSync(keyPath)) {
    args.push('-i', keyPath);
  }
  args.push('-o', 'BatchMode=yes');
  args.push('-o', 'ConnectTimeout=10');
  args.push('-o', 'StrictHostKeyChecking=accept-new');

  const userHost = `${hostConfig.user}@${hostConfig.host}`;
  if (remoteCommand) {
    args.push(userHost, remoteCommand);
  } else {
    args.push(userHost);
  }
  return args;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function startSshTunnel(hostConfig, localPort, remotePort = 11434) {
  return new Promise((resolve, reject) => {
    const sshArgs = [
      '-N', '-L', `${localPort}:localhost:${remotePort}`,
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3'
    ];
    const keyPath = resolveSshKeyPath(hostConfig.ssh_key_path);
    if (keyPath && fs.existsSync(keyPath)) {
      sshArgs.push('-i', keyPath);
    }
    sshArgs.push(`${hostConfig.user}@${hostConfig.host}`);

    const proc = spawn('ssh', sshArgs, { stdio: 'ignore' });
    let settled = false;

    // Give the tunnel a moment to establish
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(proc);
    }, 1500);

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    proc.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`SSH tunnel exited immediately with code ${code}`));
    });
  });
}

function stopSshTunnel(proc) {
  if (proc && typeof proc.kill === 'function') {
    try { proc.kill('SIGTERM'); } catch (_) {}
  }
}

async function ollamaGenerateViaTunnel(localPort, model, prompt, opts = {}) {
  const body = JSON.stringify({
    model,
    prompt,
    stream: false,
    options: {
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.7,
      num_predict: opts.maxTokens || 4096
    }
  });

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: localPort,
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 120000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.response) {
            resolve(parsed.response);
          } else if (parsed.error) {
            reject(new Error(`Ollama error: ${parsed.error}`));
          } else {
            reject(new Error(`Unexpected Ollama response: ${data.slice(0, 200)}`));
          }
        } catch {
          reject(new Error(`Invalid JSON from Ollama: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Ollama request timed out'));
    });
    req.write(body);
    req.end();
  });
}

function runRemoteShell(hostConfig, command) {
  const shell = hostConfig.shell || 'bash';
  let remoteCommand;
  if (shell === 'powershell') {
    remoteCommand = `powershell -NoProfile -Command "${command.replace(/"/g, '\\"')}"`;
  } else if (shell === 'cmd') {
    remoteCommand = `cmd /c "${command.replace(/"/g, '\\"')}"`;
  } else {
    remoteCommand = command;
  }

  const sshArgs = buildSshArgs(hostConfig, remoteCommand);
  const result = spawnSync('ssh', sshArgs, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120000
  });

  return {
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    exitCode: result.status,
    signal: result.signal
  };
}

async function runInference(hostConfig, prompt, modelOverride = '') {
  const engine = hostConfig.inference_engine || 'shell';
  const model = modelOverride || hostConfig.default_model || '';

  if (engine === 'ollama') {
    if (!model) {
      throw new Error('No model specified for Ollama inference engine.');
    }
    const localPort = await findFreePort();
    let tunnelProc;
    try {
      tunnelProc = await startSshTunnel(hostConfig, localPort, 11434);
      const response = await ollamaGenerateViaTunnel(localPort, model, prompt);
      return { engine, model, response, via: 'ollama-ssh-tunnel' };
    } finally {
      stopSshTunnel(tunnelProc);
    }
  }

  if (engine === 'shell') {
    // Phase 1 fallback: just echo the prompt through ssh for simple testing
    // TODO: support arbitrary shell-based inference commands (llama.cpp, etc.)
    const result = runRemoteShell(hostConfig, `echo "REMOTE_SHELL_FALLBACK: ${prompt.replace(/"/g, '\\"')}"`);
    if (result.exitCode !== 0) {
      throw new Error(`Remote shell failed (exit=${result.exitCode}): ${result.stderr}`);
    }
    return { engine, model, response: result.stdout, via: 'remote-shell' };
  }

  throw new Error(`Inference engine "${engine}" not yet supported by remote-ssh bridge runner.`);
}

function writeCompletionSignal(projectRoot, originalSignal, responseText, hostAlias, model) {
  const { createHandoffSignal, validateHandoffSignal } = require('../verify/lib/signal.cjs');
  const { getSignalIdentity } = require('./lib/signal-identity');

  const scope = originalSignal.signal_scope || originalSignal.workflow_scope || 'remote-ssh-completion';
  const completionSignal = createHandoffSignal('remote-ssh', scope, 'bridge-completed', {
    artifacts: [],
    recommended_next_actor: 'operator',
    recommended_next_command: '/follow-signal',
    next_prompt_stub: `Remote inference on ${hostAlias} completed.`,
    next_step_detail: [
      `Host: ${hostAlias}`,
      `Model: ${model || '(none)'}`,
      `Response length: ${responseText.length} chars`,
      'Review the remote inference response below and decide next steps.'
    ],
    signal_scope: scope,
    parent_signal_id: originalSignal.signal_id || '',
    dispatch_runner: 'signals:run:remote-ssh'
  });

  completionSignal.remote_inference = {
    host_alias: hostAlias,
    model: model || '',
    response: responseText,
    response_summary: responseText.slice(0, 500) + (responseText.length > 500 ? '...' : '')
  };

  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  fs.mkdirSync(signalDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.[0-9]{3}Z$/, 'Z');
  const signalFile = `remote-ssh-completion__${stamp}__${scope}.signal.json`;
  const signalPath = path.join(signalDir, signalFile);

  const validation = validateHandoffSignal(completionSignal, { projectRoot });
  if (!validation.valid) {
    throw new Error(`Completion signal validation failed: ${validation.errors.join('; ')}`);
  }

  fs.writeFileSync(signalPath, JSON.stringify(completionSignal, null, 2) + '\n', 'utf8');
  return path.relative(projectRoot, signalPath);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    process.exit(0);
  }

  const hostAlias = args.host || args.host_alias || '';
  if (!hostAlias) {
    console.error('ERROR: --host <alias> is required.');
    help();
    process.exit(1);
  }

  let hostConfig;
  try {
    hostConfig = resolveHostConfig(hostAlias);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }

  const signalInfo = selectActorTargetSignal(PROJECT_ROOT, 'remote-ssh', args.file || '');
  if (!signalInfo) {
    console.error('No live remote-ssh-targeted coordination signal found.');
    process.exit(1);
  }

  const signalPath = signalInfo.filePath;
  const signal = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
  const promptText = signal.next_prompt_stub || signal.task_summary || '';

  if (!promptText) {
    console.error('Signal has no prompt stub or task summary.');
    process.exit(1);
  }

  const modelOverride = args.model || '';

  if (args.dry_run) {
    console.log(JSON.stringify({
      dry_run: true,
      host_alias: hostAlias,
      host_config: {
        host: hostConfig.host,
        user: hostConfig.user,
        platform: hostConfig.platform,
        shell: hostConfig.shell,
        inference_engine: hostConfig.inference_engine,
        default_model: hostConfig.default_model
      },
      signal: signalInfo,
      model_override: modelOverride,
      prompt_preview: promptText.slice(0, 200)
    }, null, 2));
    process.exit(0);
  }

  let inferenceResult;
  try {
    inferenceResult = await runInference(hostConfig, promptText, modelOverride);
  } catch (err) {
    console.error(`Remote inference failed: ${err.message}`);
    process.exit(1);
  }

  let completionSignalPath;
  try {
    completionSignalPath = writeCompletionSignal(
      PROJECT_ROOT,
      signal,
      inferenceResult.response,
      hostAlias,
      inferenceResult.model
    );
  } catch (err) {
    console.error(`Completion signal write failed: ${err.message}`);
    process.exit(1);
  }

  const output = {
    success: true,
    host_alias: hostAlias,
    engine: inferenceResult.engine,
    model: inferenceResult.model,
    via: inferenceResult.via,
    response_length: inferenceResult.response.length,
    response_preview: inferenceResult.response.slice(0, 300),
    completion_signal_path: completionSignalPath,
    consumed_signal: path.relative(PROJECT_ROOT, signalPath)
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Remote inference completed on ${hostAlias}`);
    console.log(`  Engine: ${inferenceResult.engine}`);
    console.log(`  Model:  ${inferenceResult.model || '(none)'}`);
    console.log(`  Via:    ${inferenceResult.via}`);
    console.log(`  Response: ${inferenceResult.response.length} chars`);
    console.log(`  Completion signal: ${completionSignalPath}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`Unhandled error: ${err.message}`);
  process.exit(1);
});
