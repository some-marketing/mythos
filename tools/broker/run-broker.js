#!/usr/bin/env node
'use strict';

/**
 * run-broker.js — end-to-end Tool Broker read-only analysis run (sovereign-core-
 * harness plan P2 acceptance a).
 *
 * Flow:  task  ->  Provider Adapter  ->  LiteLLM gateway  ->  model (OpenRouter)
 *              ->  proposals  ->  Tool Broker (phase-bounded enforcement)
 *              ->  durable analysis artifact + one CascadeSpan per action.
 *
 * A real cascade trace is seeded first (buildRootTraceEnv) so every emitted span
 * carries lineage that JOINS the shared cascade tree — the same lineage the
 * Claude-hook close path consumes.
 *
 * Modes:
 *   live  (default) — calls the running LiteLLM gateway. Requires the gateway up
 *                     and OPENROUTER_API_KEY provisioned. If either is missing the
 *                     run reports the live leg as operator-gated (no fake success).
 *   --stub <file>   — inject a recorded ModelResult fixture instead of a live call
 *                     (proves the whole path below the wire without spending).
 *
 * Usage:
 *   node tools/broker/run-broker.js --prompt "Summarize X" --read <repo/path>
 *   node tools/broker/run-broker.js --stub tools/broker/__tests__/fixtures/analysis-result.json
 *   node tools/broker/run-broker.js --phase 2 --stub <file>   # proposal phase
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

const { buildRootTraceEnv } = require('../telemetry/dispatches/lib/trace-context.cjs');
const { createProviderAdapter } = require('./lib/provider-adapter');
const { createToolBroker } = require('./lib/tool-broker');

function parseArgs(argv) {
  const opts = { phase: 1, model: 'analysis-small', json: false, scope: 'sovereign-core-harness' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--prompt') opts.prompt = argv[++i];
    else if (a === '--read') opts.read = argv[++i];
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--phase') opts.phase = parseInt(argv[++i], 10);
    else if (a === '--stub') opts.stub = argv[++i];
    else if (a === '--gateway') opts.gateway = argv[++i];
    else if (a === '--scope') opts.scope = argv[++i];
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

// A recorded-stub transport: returns a fixed ModelResult (mimicking what the
// openai-compatible adapter would return), so the whole path below the wire runs
// without a live call. This is the "recorded stub" the acceptance allows when the
// live leg is operator-gated.
function stubTransport(fixture) {
  return {
    async invoke() { return fixture; }
  };
}

function seedTrace(scope) {
  const env = buildRootTraceEnv({ scope, sessionId: `broker-run-${Date.now()}` });
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith('MYTHOS_') && v !== undefined && v !== null) process.env[k] = String(v);
  }
  return env;
}

function buildTaskPrompt(opts) {
  const parts = [];
  parts.push(opts.prompt || 'Perform a bounded read-only analysis of the referenced material and return your findings.');
  if (opts.read) {
    const resolved = path.resolve(PROJECT_ROOT, opts.read);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      const content = fs.readFileSync(resolved, 'utf8').slice(0, 12 * 1024);
      parts.push(`\n\n## Material: ${opts.read}\n\n\`\`\`\n${content}\n\`\`\``);
    }
  }
  return parts.join('');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write('usage: node tools/broker/run-broker.js [--prompt P] [--read PATH] [--model M] [--phase N] [--stub FILE] [--gateway URL] [--json]\n');
    return;
  }

  seedTrace(opts.scope);

  // ---- resolve transport: live gateway or recorded stub --------------------
  let transport = null;
  let mode = 'live';
  let liveGated = null;
  if (opts.stub) {
    const fixturePath = path.resolve(PROJECT_ROOT, opts.stub);
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    transport = stubTransport(fixture);
    mode = 'stub';
  } else {
    if (!process.env.OPENROUTER_API_KEY) {
      liveGated = 'OPENROUTER_API_KEY not provisioned locally';
    }
  }

  const adapter = createProviderAdapter({
    baseUrl: opts.gateway || process.env.MYTHOS_LITELLM_BASE || 'http://127.0.0.1:4010',
    modelFamily: 'gpt',
    transport: transport || undefined
  });

  const proposeResult = await adapter.propose({
    model: opts.model,
    system_prompt: opts.phase === 3
      ? [
          'You are a bounded-patch assistant brokered through the Tool Broker.',
          'You may propose one fs.write only when its exact content, path, sandbox cwd, test argv, timeout, and distinct review record are already supplied.',
          'You may not apply diffs, run shell commands, access the network, or write outside the reviewed path.'
        ].join(' ')
      : [
          'You are a read-only analysis assistant brokered through the Tool Broker.',
          'You may propose read-only actions (repo.read, signal.read, artifact.read) and emit analysis.',
          'You may NOT write files or run commands; such proposals will be denied by the broker.'
        ].join(' '),
    user_prompt: buildTaskPrompt(opts)
  });

  // ---- broker the proposals ------------------------------------------------
  const broker = createToolBroker({
    projectRoot: PROJECT_ROOT,
    phase: opts.phase,
    modelFamily: 'gpt'
  });
  const outcomes = broker.handleAll(proposeResult.proposals || []);

  // ---- durable closeout artifact ------------------------------------------
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const runsDir = path.join(PROJECT_ROOT, '_dev', 'reports', 'broker', 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const artifactPath = path.join(runsDir, `broker-run__${opts.scope}__${stamp}.md`);

  const lines = [
    `# Tool Broker read-only run`,
    ``,
    `- Mode: ${mode}${liveGated ? ` (LIVE LEG OPERATOR-GATED: ${liveGated})` : ''}`,
    `- Phase: ${opts.phase}`,
    `- Model: ${opts.model} (gateway: ${adapter.baseUrl})`,
    `- Request id: ${proposeResult.request_id}`,
    `- Model call status: ${proposeResult.status}`,
    `- Proposals: ${(proposeResult.proposals || []).length}`,
    ``,
    `## Analysis`,
    ``,
    broker.capturedAnalysis() || proposeResult.analysis_text || '(no analysis text returned)',
    ``,
    `## Brokered actions`,
    ``
  ];
  for (const o of outcomes) {
    lines.push(
      `- \`${o.span.action.proposed}\` -> **${o.verdict}** (layer ${o.span.action.classified_layer}, ` +
      `span ${o.span.span_id}, status ${o.span.status})` +
      (o.result && o.result.reason ? ` — ${o.result.reason}` : '') +
      (o.result && o.result.proposal_artifact ? ` — proposal: ${o.result.proposal_artifact}` : '')
    );
  }
  lines.push('');
  fs.writeFileSync(artifactPath, lines.join('\n') + '\n');

  const summary = {
    mode,
    live_gated: liveGated,
    phase: opts.phase,
    model: opts.model,
    request_id: proposeResult.request_id,
    model_call_status: proposeResult.status,
    artifact: path.relative(PROJECT_ROOT, artifactPath),
    outcomes: outcomes.map((o) => ({
      proposed: o.span.action.proposed,
      verdict: o.verdict,
      layer: o.span.action.classified_layer,
      status: o.span.status,
      span_id: o.span.span_id,
      trace_id: o.span.trace_id,
      span_valid: o.valid,
      closeout_artifact: o.result && o.result.closeout_artifact || null,
      signal_artifact: o.result && o.result.signal_artifact || null,
      test: o.result && o.result.test || null,
      rolled_back: o.result && o.result.rolled_back || false
    }))
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    process.stdout.write(
      `[broker-run] mode=${mode}${liveGated ? ` (live-gated: ${liveGated})` : ''} phase=${opts.phase} ` +
      `status=${proposeResult.status} proposals=${(proposeResult.proposals || []).length}\n` +
      `  artifact: ${summary.artifact}\n` +
      outcomes.map((o) => `  - ${o.span.action.proposed} -> ${o.verdict} (${o.span.status}) span=${o.span.span_id}`).join('\n') + '\n'
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`ERROR: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs, buildTaskPrompt };
