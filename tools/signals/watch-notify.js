#!/usr/bin/env node
'use strict';

const path = require('path');

const { parseArgs } = require('../workspace/lib/args');
const {
  appendJsonl,
  buildMainSnapshot,
  buildNotificationKey,
  buildWorkstreamSnapshot,
  formatNotificationLine,
  maybeMacNotify
} = require('./lib/notify-watch');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_INTERVAL_SECONDS = 120;
const DEFAULT_LOG_PATH = path.join(PROJECT_ROOT, '_dev', 'reports', 'signals', 'watch-notify.log.jsonl');

function help() {
  console.log(`
Watch the main pipeline loop and optional workstream loops, logging and optionally notifying on changes.

Usage:
  node tools/signals/watch-notify.js [options]

Options:
  --once                  Poll once and exit
  --interval-seconds <n>  Poll interval in seconds (default: ${DEFAULT_INTERVAL_SECONDS})
  --scopes <a,b,c>        Comma-separated workstream signal_scope values to monitor
  --log-file <path>       JSONL log path (default: _dev/reports/signals/watch-notify.log.jsonl)
  --macos-notify          Send a macOS notification when a watched state changes
  --json                  Print machine-readable snapshots for the current poll
  --help                  Show this help

Examples:
  node tools/signals/watch-notify.js --scopes simpleminions-routing-integration
  node tools/signals/watch-notify.js --macos-notify --scopes simpleminions-routing-integration
  node tools/signals/watch-notify.js --once --json
`.trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseScopes(rawScopes) {
  if (!rawScopes) return [];
  return String(rawScopes)
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function buildSnapshots(scopes) {
  const snapshots = [buildMainSnapshot(PROJECT_ROOT)];
  for (const scope of scopes) {
    snapshots.push(buildWorkstreamSnapshot(PROJECT_ROOT, scope));
  }
  return snapshots;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    process.exit(0);
  }

  const once = Boolean(args.once);
  const asJson = Boolean(args.json);
  const enableMacNotify = Boolean(args.macos_notify);
  const intervalSeconds = Number(args.interval_seconds || DEFAULT_INTERVAL_SECONDS);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    console.error('ERROR: --interval-seconds must be a positive number');
    process.exit(1);
  }

  const scopes = parseScopes(args.scopes);
  const logPath = args.log_file ? path.resolve(PROJECT_ROOT, String(args.log_file)) : DEFAULT_LOG_PATH;
  const seen = new Map();

  do {
    const snapshots = buildSnapshots(scopes);

    if (asJson) {
      console.log(JSON.stringify({
        polled_at: new Date().toISOString(),
        snapshots
      }, null, 2));
    } else {
      console.log(`[${new Date().toISOString()}] Notify Watch`);
    }

    for (const snapshot of snapshots) {
      const key = buildNotificationKey(snapshot);
      const prior = seen.get(snapshot.scope);
      const changed = key !== prior;
      seen.set(snapshot.scope, key);

      if (asJson) continue;

      const line = `${changed ? '[changed]' : '[unchanged]'} ${formatNotificationLine(snapshot)}`;
      console.log(line);

      if (!changed) continue;

      const payload = {
        timestamp: new Date().toISOString(),
        snapshot
      };
      appendJsonl(logPath, payload);

      try {
        maybeMacNotify(snapshot, enableMacNotify);
      } catch (err) {
        console.error(`WARN: failed to send macOS notification for ${snapshot.scope}: ${err.message}`);
      }
    }

    if (once) break;
    await sleep(intervalSeconds * 1000);
  } while (true);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
