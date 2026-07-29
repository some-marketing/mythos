#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  formatContextBudgetSummary,
  observeContextBudget
} = require('./context-budget.cjs');

function readPayload() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readValue(argv, index) {
  const next = argv[index + 1];
  return next && !next.startsWith('--') ? next : '';
}

function parseArgs(argv) {
  const out = {
    sessionId: '',
    source: 'observe-only',
    role: 'actor',
    root: process.cwd(),
    json: false,
    measured: {},
    proxy: {},
    bridge: {},
    parentScope: '',
    childScope: '',
    runId: ''
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = readValue(argv, i);
    if (arg === '--session-id') {
      out.sessionId = next;
      i += 1;
    } else if (arg === '--source') {
      out.source = next || out.source;
      i += 1;
    } else if (arg === '--role') {
      out.role = next || out.role;
      i += 1;
    } else if (arg === '--root') {
      out.root = next || out.root;
      i += 1;
    } else if (arg === '--used-percent') {
      out.measured.usedPercent = next;
      i += 1;
    } else if (arg === '--remaining-percent') {
      out.measured.remainingPercent = next;
      i += 1;
    } else if (arg === '--used-tokens') {
      out.measured.usedTokens = next;
      i += 1;
    } else if (arg === '--remaining-tokens') {
      out.measured.remainingTokens = next;
      i += 1;
    } else if (arg === '--total-tokens') {
      out.measured.totalTokens = next;
      i += 1;
    } else if (arg === '--session-duration-hours') {
      out.proxy.sessionDurationHours = next;
      i += 1;
    } else if (arg === '--dirty-file-count') {
      out.proxy.dirtyFileCount = next;
      i += 1;
    } else if (arg === '--meaningful-workstreams') {
      out.proxy.meaningfulWorkstreamsTouched = next;
      i += 1;
    } else if (arg === '--live-signals') {
      out.proxy.liveSignalsCreated = next;
      i += 1;
    } else if (arg === '--substantial-implementation-review') {
      out.proxy.substantialImplementationAndReviewLoop = true;
    } else if (arg === '--dirty-source-canonical-runtime') {
      out.proxy.dirtySourceAndCanonicalRuntime = true;
    } else if (arg === '--context-exhausted') {
      out.proxy.contextExhausted = true;
    } else if (arg === '--operator-cross-session-request') {
      out.proxy.explicitOperatorCrossSessionRequest = true;
    } else if (arg === '--bridge-timeout') {
      out.bridge.timeout = true;
    } else if (arg === '--bridge-malformed-output') {
      out.bridge.malformedOutput = true;
    } else if (arg === '--bridge-context-exhausted') {
      out.bridge.contextExhausted = true;
    } else if (arg === '--parent-scope') {
      out.parentScope = next;
      i += 1;
    } else if (arg === '--child-scope') {
      out.childScope = next;
      i += 1;
    } else if (arg === '--run-id') {
      out.runId = next;
      i += 1;
    } else if (arg === '--no-git-dirty-count') {
      out.includeGitDirtyCount = false;
    } else if (arg === '--json') {
      out.json = true;
    }
  }

  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = readPayload();
  const projectRoot = path.resolve(args.root);
  const result = observeContextBudget(projectRoot, {
    sessionId: args.sessionId || payload.session_id || payload.sessionId || undefined,
    source: args.source,
    role: args.role,
    measured: args.measured,
    proxy: args.proxy,
    bridge: args.bridge,
    parentScope: args.parentScope,
    childScope: args.childScope,
    runId: args.runId,
    includeGitDirtyCount: args.includeGitDirtyCount
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, paths: result.paths, report: result.report }, null, 2)}\n`);
  } else {
    process.stdout.write(formatContextBudgetSummary(result));
  }
}

if (require.main === module) main();

module.exports = { main, parseArgs, readPayload };
