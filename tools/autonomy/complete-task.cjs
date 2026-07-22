#!/usr/bin/env node
'use strict';

/**
 * complete-task.cjs — CLI completion gate for autonomy profiles.
 *
 * Usage:
 *   node tools/autonomy/complete-task.cjs --profile <id> --framework <id>
 *   node tools/autonomy/complete-task.cjs --changed-paths path1 path2
 *   node tools/autonomy/complete-task.cjs --stats
 *
 * Harness-agnostic: pure Node.js, no Claude Code or LLM dependency.
 * Exit code 0 = gate passes, 1 = gate blocked or error, 2 = usage error.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { printSummary } = require('../verify/lib/signal.cjs');
const { validate } = require('../verify/lib/schema.cjs');
const { loadProfile } = require('./lib/profile-loader.cjs');
const { matchProfiles } = require('./lib/profile-dispatcher.cjs');
const { appendEntry, printStats } = require('./lib/run-log.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// ─── Argument parsing ───────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { profile: null, framework: null, changedPaths: [], stats: false };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--profile' && argv[i + 1]) {
      args.profile = argv[++i];
    } else if (arg === '--framework' && argv[i + 1]) {
      args.framework = argv[++i];
    } else if (arg === '--changed-paths') {
      i++;
      while (i < argv.length && !argv[i].startsWith('--')) {
        args.changedPaths.push(argv[i++]);
      }
      continue;
    } else if (arg === '--stats') {
      args.stats = true;
    }
    i++;
  }
  return args;
}

// ─── Path resolution ────────────────────────────────────────────────────

/**
 * Extract distinct framework IDs from changed paths.
 * "frameworks/wordpress/qa/manifest.json" yields "wordpress/qa".
 */
function resolveFrameworkIdsFromPaths(changedPaths) {
  const ids = new Set();
  for (const p of changedPaths) {
    const match = p.match(/^frameworks\/([^/]+\/[^/]+)\//);
    if (match) ids.add(match[1]);
  }
  return [...ids];
}

/**
 * Resolve the expected signal output path from the profile's output_template.
 * Rejects paths that escape PROJECT_ROOT.
 */
function resolveOutputPath(profile, vars) {
  const template = profile.execution.completion_gate.output_template;
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp('\\$\\{' + key + '\\}', 'g'), value || '');
  }
  const resolved = path.resolve(PROJECT_ROOT, result);
  if (!resolved.startsWith(PROJECT_ROOT + path.sep) && resolved !== PROJECT_ROOT) {
    throw new Error(`Signal path escapes project root: ${resolved}`);
  }
  return resolved;
}

function substituteArgs(template, vars) {
  if (!template) return [];
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp('\\$\\{' + key + '\\}', 'g'), value || '');
  }
  return result.split(/\s+/).filter(Boolean);
}

// ─── Verifier execution ─────────────────────────────────────────────────

function runVerifier(profile, frameworkId) {
  const gate = profile.execution.completion_gate;
  const script = path.join(PROJECT_ROOT, gate.script);
  const args = substituteArgs(gate.args_template, { framework_id: frameworkId });
  const profileArgs = profile.profile_id ? ['--profile', profile.profile_id] : [];

  const startMs = Date.now();
  const result = spawnSync('node', [script, ...args, ...profileArgs], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60000
  });
  const duration = Date.now() - startMs;

  return {
    status: result.status,
    killSignal: result.signal || null,
    duration,
    startMs,
    stderr: (result.stderr || '').toString()
  };
}

// ─── Signal reading and validation ──────────────────────────────────────

/**
 * Read a signal file, rejecting missing or stale files.
 * A signal is stale if its mtime is older than the verifier start time.
 */
function readFreshSignal(signalPath, startMs) {
  if (!fs.existsSync(signalPath)) {
    throw new Error(`Signal file not found after verifier ran: ${signalPath}`);
  }
  const stat = fs.statSync(signalPath);
  if (stat.mtimeMs < startMs) {
    throw new Error(
      `Stale signal: ${path.basename(signalPath)} last modified ` +
      `${new Date(stat.mtimeMs).toISOString()} but verifier started ${new Date(startMs).toISOString()}`
    );
  }
  return JSON.parse(fs.readFileSync(signalPath, 'utf8'));
}

/**
 * Validate signal payload against the appropriate schema.
 * Uses tools/verify/lib/schema.cjs — a lightweight validator that enforces
 * required fields, type checks, enum values, and additionalProperties.
 * It does not enforce const, pattern, or format constraints.
 */
function validateSignal(signal) {
  const version = signal && signal.schema;
  let schemaFile;
  if (version === 'VerificationSignal/1.1') {
    schemaFile = path.join(PROJECT_ROOT, 'tools/verify/schemas/verification-signal-v1.1.schema.json');
  } else if (version === 'VerificationSignal/1.0') {
    schemaFile = path.join(PROJECT_ROOT, 'tools/verify/schemas/verification-signal-v1.0.schema.json');
  } else {
    throw new Error(`Unknown signal schema version: ${version || '(missing)'}`);
  }
  const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
  const errors = validate(signal, schema, { rootSchema: schema, path: '' });
  if (errors.length > 0) {
    const msgs = errors.slice(0, 5).map(e => `${e.path || '/'} ${e.message}`).join('; ');
    throw new Error(`Invalid signal (${version}): ${msgs}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  // --stats mode
  if (args.stats) {
    printStats();
    process.exit(0);
  }

  // Resolve profile
  let profile;
  if (args.profile) {
    try {
      profile = loadProfile(args.profile);
    } catch (e) {
      console.error(`Error loading profile: ${e.message}`);
      process.exit(2);
    }
  } else if (args.changedPaths.length > 0) {
    const matched = matchProfiles(args.changedPaths);
    if (matched.length === 0) {
      console.log('No matching profile for changed paths. Skipping completion gate.');
      process.exit(0);
    }
    if (matched.length > 1) {
      console.error(`Error: ${matched.length} profiles matched. Use --profile to select one:`);
      for (const m of matched) console.error(`  - ${m.profile_id}`);
      process.exit(2);
    }
    profile = matched[0];

    // Resolve framework_id from changed paths if needed
    const needsFramework = profile.execution.completion_gate.args_template &&
      profile.execution.completion_gate.args_template.includes('${framework_id}');
    if (needsFramework && !args.framework) {
      const frameworkIds = resolveFrameworkIdsFromPaths(args.changedPaths);
      if (frameworkIds.length === 0) {
        console.log('No framework ID found in changed paths. Skipping completion gate.');
        process.exit(0);
      }
      if (frameworkIds.length > 1) {
        console.error('Error: multiple frameworks found in changed paths. Use --framework to select one:');
        for (const fid of frameworkIds) console.error(`  - ${fid}`);
        process.exit(2);
      }
      args.framework = frameworkIds[0];
    }
  } else {
    console.error('Usage: complete-task.cjs --profile <id> --framework <id>');
    console.error('       complete-task.cjs --changed-paths <paths...>');
    console.error('       complete-task.cjs --stats');
    process.exit(2);
  }

  // Check required framework arg for explicit --profile usage
  const needsFramework = profile.execution.completion_gate.args_template &&
    profile.execution.completion_gate.args_template.includes('${framework_id}');
  if (needsFramework && !args.framework) {
    console.error(`Profile '${profile.profile_id}' requires --framework <id>`);
    process.exit(2);
  }

  // Resolve signal output path from profile
  const templateVars = {
    framework_id: args.framework || '',
    framework_id_safe: args.framework ? args.framework.replace(/\//g, '_') : ''
  };
  let signalPath;
  try {
    signalPath = resolveOutputPath(profile, templateVars);
  } catch (e) {
    console.error(`Error resolving signal path: ${e.message}`);
    process.exit(2);
  }

  console.log(`\nProfile: ${profile.profile_id}`);
  console.log(`Gate: ${profile.execution.completion_gate.script}`);
  if (args.framework) console.log(`Framework: ${args.framework}`);
  console.log('');

  // ── Run verifier ──────────────────────────────────────────────────
  const vr = runVerifier(profile, args.framework);

  // ── Check verifier exit status (strict order: before reading signal) ──
  if (vr.status === null) {
    console.error(`Error: verifier was killed (signal: ${vr.killSignal || 'unknown'}).`);
    process.exit(1);
  }
  if (vr.status > 1) {
    console.error(`Error: verifier exited with code ${vr.status} (not a gate result).`);
    if (vr.stderr) console.error(vr.stderr);
    process.exit(1);
  }

  // ── Read signal (reject missing or stale) ─────────────────────────
  let signal;
  try {
    signal = readFreshSignal(signalPath, vr.startMs);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    if (vr.stderr) console.error(vr.stderr);
    process.exit(1);
  }

  // ── Validate signal against schema ────────────────────────────────
  try {
    validateSignal(signal);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }

  // ── Print results ─────────────────────────────────────────────────
  if (Array.isArray(signal.next_actions) && signal.next_actions.length > 0) {
    console.log('\n  Advisory next actions:');
    for (const action of signal.next_actions) {
      const safeLabel = action.safe ? '[safe]' : '[requires LLM]';
      console.log(`    ${safeLabel} ${action.type}: ${action.reason || action.target || ''}`);
    }
  }

  printSummary(signal);

  // ── Log run ───────────────────────────────────────────────────────
  const runId = `run_${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`;
  try {
    appendEntry({
      timestamp: new Date().toISOString(),
      profile_id: profile.profile_id,
      run_id: runId,
      ...(args.framework ? { framework_id: args.framework } : {}),
      signal_path: path.relative(PROJECT_ROOT, signalPath),
      verdict: signal.verdict,
      attempt: 1,
      duration_ms: vr.duration,
      has_next_actions: Array.isArray(signal.next_actions) && signal.next_actions.length > 0,
      check_summary: {
        total: signal.summary.total,
        passed: signal.summary.passed,
        failed: signal.summary.failed,
        warned: signal.summary.warned
      }
    });
    console.log(`\nRun logged: ${runId}`);
  } catch (e) {
    console.error(`Warning: failed to log run: ${e.message}`);
  }

  process.exit(signal.gate_decision.proceed ? 0 : 1);
}

main();
