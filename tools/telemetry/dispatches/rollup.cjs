#!/usr/bin/env node
'use strict';

/**
 * rollup.cjs — Aggregates subagent telemetry events.
 * 
 * Usage: node rollup.cjs [--scope <workstream>] [--since <ISO|N hours>]
 */

const fs = require('fs');
const path = require('path');
const { calculateStats } = require('./lib/percentile-stats.cjs');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const LOG_FILE = path.join(PROJECT_ROOT, '_dev/reports/telemetry/dispatches.jsonl');

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    scope: null,
    since: null
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scope') result.scope = args[++i];
    if (args[i] === '--since') result.since = args[++i];
  }
  return result;
}

function main() {
  if (!fs.existsSync(LOG_FILE)) {
    console.log('No telemetry log found.');
    return;
  }

  const { scope, since } = parseArgs();
  const sinceMs = since ? (isNaN(since) ? new Date(since).getTime() : Date.now() - (parseFloat(since) * 60 * 60 * 1000)) : 0;

  const raw = fs.readFileSync(LOG_FILE, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  
  const byType = {};

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      
      // Filters
      if (scope && entry.scope_identity !== scope) continue;
      if (sinceMs && new Date(entry.timestamp).getTime() < sinceMs) continue;

      const type = entry.subagent_type || 'unknown';
      if (!byType[type]) byType[type] = { durations: [], tokens: [], count: 0 };
      
      if (entry.duration_ms !== null) byType[type].durations.push(entry.duration_ms);
      if (entry.total_tokens !== null) byType[type].tokens.push(entry.total_tokens);
      byType[type].count++;
    } catch (_) {}
  }

  // Header
  console.log('\nSubagent Handoff Telemetry Rollup');
  console.log('================================\n');
  console.log('Type'.padEnd(20) + 'Count'.padStart(8) + 'p50 Dur'.padStart(12) + 'p95 Dur'.padStart(12) + 'p50 Tok'.padStart(12) + 'p95 Tok'.padStart(12));
  console.log('-'.repeat(80));

  for (const [type, data] of Object.entries(byType)) {
    const durStats = calculateStats(data.durations);
    const tokStats = calculateStats(data.tokens);
    
    console.log(
      type.padEnd(20) + 
      String(data.count).padStart(8) + 
      String(durStats.p50).padStart(12) + 
      String(durStats.p95).padStart(12) + 
      String(tokStats.p50).padStart(12) + 
      String(tokStats.p95).padStart(12)
    );
  }
  console.log('\n');
}

if (require.main === module) {
  main();
}
