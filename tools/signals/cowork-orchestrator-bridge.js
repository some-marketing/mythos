#!/usr/bin/env node
'use strict';

/**
 * Cowork orchestrator → desktop Claude Code → codex bridge (cowork-side).
 *
 * Companion design doc: `_dev/cowork-sessions/dispatch-bridge-cowork-variant.md`.
 *
 * Two surfaces:
 *   - Library: `submitRequest`, `pollVerdict`, `synthesizeBypassVerdict`,
 *     `DEFAULTS`. Cowork sessions or other JS surfaces import these directly.
 *   - CLI: `node tools/signals/cowork-orchestrator-bridge.js submit ...`
 *     so a Cowork shell can call it without a Node import.
 *
 * Trust boundary: this file ONLY writes request packets. It never invokes
 * the consumer, claude headless, or codex. Consumption is done by
 * `tools/signals/desktop-cowork-consumer.sh`, which only runs on the user's
 * real desktop via launchd.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const COWORK_OUT_DIR = path.join(PROJECT_ROOT, '_dev', 'reports', 'signals', 'cowork-out');
const COWORK_IN_DIR = path.join(PROJECT_ROOT, '_dev', 'reports', 'signals', 'cowork-in');
const COWORK_ARCHIVE_DIR = path.join(PROJECT_ROOT, '_dev', 'reports', 'signals', 'cowork-archive');

const REQUEST_SCHEMA = 'CoworkOrchestratorRequest/1.0';
const VERDICT_SCHEMA = 'CoworkOrchestratorVerdict/1.0';

const DEFAULTS = Object.freeze({
  timeoutMs: 600000,                 // 10 min — codex round-trip can be slow
  pollIntervalMs: 1000,              // 1s polls is plenty for a file-watch IPC
  // Literal always-bridge: every output (consequential AND routine) bridges by
  // default. Routine bypass is opt-in only — pass `dryRunOnRoutineMessages: true`
  // to submitRequest, set env SMOS_COWORK_BRIDGE_BYPASS=1, or pass
  // --allow-routine-bypass on the CLI.
  dryRunOnRoutineMessages: false,
  defaultTargetActor: 'codex',
  defaultRunNow: true
});

function envFlag(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === '0' || raw.toLowerCase() === 'false' || raw === '') return false;
  return true;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isoStamp(date = new Date()) {
  // 20260501T214530.123Z — sortable, matches existing dispatch-bridge stamp shape
  // (kept the dot-separated millis for easier human reading on the cowork side).
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, 'Z');
}

function nonceHex(n = 16) {
  return crypto.randomBytes(n).toString('hex').slice(0, n);
}

function sanitizeRequestId(value) {
  const s = String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || `cowork-${nonceHex(8)}`;
}

function rel(absPath) {
  return path.relative(PROJECT_ROOT, absPath).replace(/\\/g, '/');
}

function isRoutine(input) {
  // Heuristic: if the caller flagged routine, honour it. Otherwise we look at
  // a small set of *explicit* conversational signatures.
  //
  // NOTE: This classifier is no longer consulted by the default code path.
  // After the always-bridge flip, `submitRequest` only invokes `isRoutine`
  // when the caller explicitly opted into routine bypass via
  // `dryRunOnRoutineMessages: true`, env `SMOS_COWORK_BRIDGE_BYPASS=1`, or
  // CLI `--allow-routine-bypass`. The function is preserved as part of the
  // public surface for callers who consciously trade verification for
  // latency on greetings/pings.
  //
  // The library remains deliberately permissive — when in doubt, classify as
  // CONSEQUENTIAL and bridge. Short tokens like "merged", "done", "closed",
  // "noted" can be load-bearing task-closure signals, so we do NOT use a
  // length-based catch-all.
  if (input && typeof input.routine === 'boolean') return input.routine;
  const text = String((input && input.task_summary) || '').trim().toLowerCase();
  if (!text) return false;
  // Match only explicit greetings, acknowledgments, and connection pings.
  // Anything that could plausibly mean "I closed a thing" or "I shipped"
  // is left out so it bridges by default.
  const hits = [
    /^(hi|hey|hello|yo|sup|hiya|howdy)\b[.!?\s]*$/,
    /^(thanks|thank you|thx|ty|cheers)\b[.!?\s]*$/,
    /^(how's it going|how are you|how's it)\??$/,
    /^(are you there|you there|hello\?)\??$/,
    /^(ping|test|testing)\??$/
  ];
  return hits.some((re) => re.test(text));
}

function synthesizeBypassVerdict(request, reason) {
  return {
    schema: VERDICT_SCHEMA,
    request_id: request.request_id,
    nonce: request.nonce,
    consumed_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    consumer: 'cowork-orchestrator-bridge:bypass',
    host: 'cowork-sandbox',
    status: 'bypassed_routine',
    exit_code: 0,
    dispatch: null,
    verdict: {
      summary: reason || 'routine message — bypassed per dryRunOnRoutineMessages',
      verdict_body_path: ''
    },
    stderr_tail: '',
    request_packet_path: ''
  };
}

function buildRequestPacket(input, options) {
  const stamp = isoStamp();
  const nonce = nonceHex(16);
  const requestId = sanitizeRequestId(input.request_id || input.requestId || `req-${nonce.slice(0, 8)}`);
  const filename = `${stamp}__${nonce}__${requestId}.cowork-request.json`;
  const absPath = path.join(COWORK_OUT_DIR, filename);
  const verdictFilename = `${stamp}__${nonce}__${requestId}.cowork-verdict.json`;
  const verdictPath = path.join(COWORK_IN_DIR, verdictFilename);

  const packet = {
    schema: REQUEST_SCHEMA,
    request_id: requestId,
    nonce,
    submitted_at: new Date().toISOString(),
    submitted_from: 'cowork',
    scope_tag: String(input.scope_tag || input.scope || requestId).trim(),
    task_summary: String(input.task_summary || input.task || '').trim(),
    target_command: String(input.target_command || input.command || '').trim(),
    target_actor: String(input.target_actor || options.defaultTargetActor || 'codex').trim().toLowerCase(),
    context_files: Array.isArray(input.context_files)
      ? input.context_files.slice()
      : (typeof input.context_files === 'string'
        ? input.context_files.split(',').map((s) => s.trim()).filter(Boolean)
        : []),
    prompt_body: input.prompt_body ? String(input.prompt_body) : '',
    options: {
      run_now: input.run_now !== undefined ? Boolean(input.run_now) : Boolean(options.defaultRunNow),
      dry_run: Boolean(input.dry_run),
      timeout_ms: Number.isFinite(Number(input.timeout_ms))
        ? Number(input.timeout_ms)
        : options.timeoutMs,
      scope_hint: input.scope_hint ? String(input.scope_hint) : ''
    },
    return_channel: {
      type: 'file',
      path: rel(verdictPath)
    }
  };

  if (!packet.task_summary) {
    throw new Error('cowork-orchestrator-bridge: task_summary is required');
  }
  // For non-freeform targets we want a slash command. For freeform targets
  // (gemini, openrouter) the desktop consumer will rewrite to "freeform"
  // before handing it to dispatch-bridge.js, so we just normalize empty.
  if (packet.target_command && !packet.target_command.startsWith('/') &&
      packet.target_command.toLowerCase() !== 'freeform') {
    throw new Error(`cowork-orchestrator-bridge: target_command must start with '/' or be 'freeform', got "${packet.target_command}"`);
  }

  return { packet, absPath, verdictPath, verdictFilename };
}

function writePacket(packet, absPath) {
  ensureDir(path.dirname(absPath));
  ensureDir(COWORK_IN_DIR);
  ensureDir(COWORK_ARCHIVE_DIR);
  // Atomic-ish write: tmp then rename. Don't unlink the tmp on rename — sandbox-safe.
  const tmpPath = `${absPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(packet, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, absPath);
}

async function pollVerdict(verdictPath, opts = {}) {
  const intervalMs = Number(opts.pollIntervalMs || DEFAULTS.pollIntervalMs);
  const timeoutMs = Number(opts.timeoutMs || DEFAULTS.timeoutMs);
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (fs.existsSync(verdictPath)) {
      try {
        const text = fs.readFileSync(verdictPath, 'utf8');
        const parsed = JSON.parse(text);
        if (parsed && parsed.schema === VERDICT_SCHEMA) {
          return parsed;
        }
      } catch (_) { /* still being written; keep polling */ }
    }
    if (Date.now() - start >= timeoutMs) {
      return {
        schema: VERDICT_SCHEMA,
        status: 'timeout',
        completed_at: new Date().toISOString(),
        consumer: 'cowork-orchestrator-bridge:poller',
        host: 'cowork-sandbox',
        verdict: {
          summary: `Timed out after ${timeoutMs}ms waiting for verdict at ${rel(verdictPath)}. ` +
                   'Likely cause: desktop consumer offline or codex still running. ' +
                   'Packet was NOT deleted; will resolve when consumer wakes.',
          verdict_body_path: ''
        }
      };
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}

async function submitRequest(input, opts = {}) {
  const options = Object.assign({}, DEFAULTS, opts);
  // Literal always-bridge default. Routine bypass only fires when the caller
  // (or env, or CLI) has explicitly opted into the latency tradeoff.
  // - opts.dryRunOnRoutineMessages defaults to false (DEFAULTS).
  // - env SMOS_COWORK_BRIDGE_BYPASS=1 → true; =0 / =false / unset → falls back to opts.
  // - The CLI surfaces this via --allow-routine-bypass, which sets the opt to true.
  const bypassAllowed = envFlag('SMOS_COWORK_BRIDGE_BYPASS', options.dryRunOnRoutineMessages);
  if (bypassAllowed && isRoutine(input)) {
    const stub = synthesizeBypassVerdict({
      request_id: sanitizeRequestId(input.request_id || `req-${nonceHex(8)}`),
      nonce: nonceHex(16)
    }, 'classified routine; bypass per explicit opt-in (dryRunOnRoutineMessages / SMOS_COWORK_BRIDGE_BYPASS / --allow-routine-bypass)');
    return { bypassed: true, verdict: stub, packet: null, packet_path: null, verdict_path: null };
  }

  const { packet, absPath, verdictPath } = buildRequestPacket(input, options);
  writePacket(packet, absPath);

  if (options.skipPoll) {
    return {
      bypassed: false,
      packet,
      packet_path: rel(absPath),
      verdict_path: rel(verdictPath),
      verdict: null
    };
  }

  const verdict = await pollVerdict(verdictPath, {
    timeoutMs: packet.options.timeout_ms || options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs
  });

  return {
    bypassed: false,
    packet,
    packet_path: rel(absPath),
    verdict_path: rel(verdictPath),
    verdict
  };
}

// ---- CLI ----

function parseCliArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        out[a.slice(2)] = argv[++i];
      } else {
        out[a.slice(2)] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function help() {
  console.log(`
cowork-orchestrator-bridge — write a packet for the desktop-cowork-consumer.

Usage:
  node tools/signals/cowork-orchestrator-bridge.js submit \\
       --task "<task summary>" \\
       --command "/some-slash-command" \\
       [--target codex|gemini|claude|opencode] \\
       [--context "path1,path2"] \\
       [--scope-tag <slug>] \\
       [--request-id <slug>] \\
       [--prompt-body-file <path>] \\
       [--routine] \\
       [--allow-routine-bypass] \\
       [--no-wait] \\
       [--timeout-ms 600000] \\
       [--json]

  node tools/signals/cowork-orchestrator-bridge.js poll \\
       --verdict-path <path> [--timeout-ms 600000]

Default behavior:
  Every submit bridges to the desktop consumer — both consequential AND
  routine messages. Routine bypass is opt-in only.

Env:
  SMOS_COWORK_BRIDGE_BYPASS=1 enables routine bypass (greetings, pings,
                              acknowledgments are short-circuited to a
                              synthesized "bypassed_routine" verdict instead
                              of hitting the desktop). Trades verification
                              for latency on conversational ticks.
  SMOS_COWORK_BRIDGE_BYPASS=0 (or unset) keeps the always-bridge default.

CLI flag --allow-routine-bypass has the same effect as SMOS_COWORK_BRIDGE_BYPASS=1
for that single submit.
`.trim());
}

async function cliMain(argv) {
  const args = parseCliArgs(argv.slice(2));
  const sub = args._[0];

  if (!sub || args.help) {
    help();
    process.exit(sub ? 0 : 1);
  }

  if (sub === 'submit') {
    const input = {
      task_summary: args.task,
      target_command: args.command,
      target_actor: args.target,
      context_files: typeof args.context === 'string'
        ? args.context.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
      scope_tag: args['scope-tag'],
      request_id: args['request-id'],
      timeout_ms: args['timeout-ms'] ? Number(args['timeout-ms']) : undefined,
      prompt_body: args['prompt-body-file']
        ? fs.readFileSync(path.resolve(args['prompt-body-file']), 'utf8')
        : ''
    };
    // Only set `routine` when --routine OR --no-routine was explicitly passed.
    // Setting `routine: false` unconditionally would cause isRoutine() to
    // short-circuit and skip the heuristic entirely — bug found in initial
    // round-trip testing.
    if (args.routine === true) input.routine = true;
    if (args['no-routine'] === true) input.routine = false;
    const result = await submitRequest(input, {
      skipPoll: Boolean(args['no-wait']),
      // --allow-routine-bypass opts this single submit into the routine-bypass
      // codepath. Without it, routine messages still bridge (always-bridge default).
      dryRunOnRoutineMessages: args['allow-routine-bypass'] === true
        ? true
        : DEFAULTS.dryRunOnRoutineMessages
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.bypassed) {
      console.log(`bypassed (routine): ${result.verdict.verdict.summary}`);
    } else if (args['no-wait']) {
      console.log(`packet: ${result.packet_path}`);
      console.log(`expected verdict: ${result.verdict_path}`);
    } else {
      console.log(`packet: ${result.packet_path}`);
      console.log(`verdict status: ${result.verdict ? result.verdict.status : '(none)'}`);
      if (result.verdict && result.verdict.verdict && result.verdict.verdict.summary) {
        console.log(`verdict summary: ${result.verdict.verdict.summary}`);
      }
    }
    return;
  }

  if (sub === 'poll') {
    if (!args['verdict-path']) {
      console.error('poll: --verdict-path is required');
      process.exit(1);
    }
    const absPath = path.isAbsolute(args['verdict-path'])
      ? args['verdict-path']
      : path.join(PROJECT_ROOT, args['verdict-path']);
    const verdict = await pollVerdict(absPath, {
      timeoutMs: args['timeout-ms'] ? Number(args['timeout-ms']) : DEFAULTS.timeoutMs
    });
    if (args.json) {
      console.log(JSON.stringify(verdict, null, 2));
    } else {
      console.log(`status: ${verdict.status}`);
      if (verdict.verdict && verdict.verdict.summary) {
        console.log(`summary: ${verdict.verdict.summary}`);
      }
    }
    return;
  }

  console.error(`unknown subcommand: ${sub}`);
  help();
  process.exit(1);
}

if (require.main === module) {
  cliMain(process.argv).catch((err) => {
    console.error(`ERROR: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULTS,
  REQUEST_SCHEMA,
  VERDICT_SCHEMA,
  COWORK_OUT_DIR,
  COWORK_IN_DIR,
  COWORK_ARCHIVE_DIR,
  PROJECT_ROOT,
  buildRequestPacket,
  writePacket,
  pollVerdict,
  submitRequest,
  isRoutine,
  synthesizeBypassVerdict,
  sanitizeRequestId,
  isoStamp,
  nonceHex
};
