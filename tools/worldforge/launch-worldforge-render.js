#!/usr/bin/env node
/**
 * launch-worldforge-render.js — fail-closed glue that stages a render run:
 * preflight -> approved import -> renderer launch command.
 *
 * The chain is strictly fail-closed. Each stage must succeed before the next
 * runs:
 *   1. preflight-worldforge-import.js
 *        (re-runs the exact-hash approval checker). No approval -> no launch.
 *        If your deployment ships local renderer source under
 *        renderer-source/, add --require-renderer-source below to also assert
 *        those files exist before launch.
 *   2. import-approved-world-spec.js  (lands the approved bytes at
 *        <ProjectDir>/world-spec.json, only with --apply-import).
 *   3. Print the exact renderer launch command for the attended operator run.
 *
 * SAFE BY DEFAULT. With no flags this tool WRITES NOTHING and LAUNCHES NOTHING:
 * it runs preflight, runs the import stage in dry-run, and prints the launch
 * command it WOULD stage. The attended, operator-sanctioned run adds:
 *   --apply-import   land the approved bytes at <ProjectDir>/world-spec.json
 *   --launch         actually exec the renderer (defaults OFF; prints only otherwise)
 *
 * The default --exe/--project/--map values below are placeholders — a
 * deployment MUST supply its own via flags (or edit the defaults for a fixed
 * local setup). This tool never dictates the operator's machine paths.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PREFLIGHT = path.join(__dirname, 'preflight-worldforge-import.js');
const IMPORT_WRITER = path.join(__dirname, 'import-approved-world-spec.js');
const DEFAULT_APPROVALS = path.join(REPO_ROOT, 'context/world-spec-approvals.json');
const DEFAULT_KILL_SWITCH = path.join(REPO_ROOT, 'state/worldforge-import/disabled');

// Printed defaults only — placeholders. Override with --exe/--project/--map.
const DEFAULT_EXE = '<path-to-your-renderer-executable>';
const DEFAULT_UPROJECT = '<path-to-your-project-file>';
const DEFAULT_MAP = '/Game/Maps/Sandbox';

function usage() {
  console.error([
    'Usage: node launch-worldforge-render.js --spec <world-spec.json> --project-dir <dir> [options]',
    '',
    'Options:',
    '  --apply-import         Land approved bytes (default: import runs dry-run)',
    '  --launch               Actually exec the renderer (default: print command only)',
    '  --approvals <path>     Exact-hash approval manifest',
    '  --receipt-dir <dir>    Where the import child writes receipts (apply only)',
    '  --kill-switch <path>   Refuse while this file exists',
    '  --exe <path>           Renderer executable (for the printed launch command)',
    '  --project <path>       Project file path (for the printed launch command)',
    '  --map <name>           Map to open (for the printed launch command)',
    '  --shot <WxH>           Screenshot resolution (default 1920x1080)',
  ].join('\n'));
  process.exit(2);
}

function parseArgs(argv) {
  const out = {
    specPath: null,
    projectDir: null,
    applyImport: false,
    launch: false,
    approvalsPath: DEFAULT_APPROVALS,
    receiptDir: null,
    killSwitch: DEFAULT_KILL_SWITCH,
    exe: DEFAULT_EXE,
    uproject: DEFAULT_UPROJECT,
    map: DEFAULT_MAP,
    shot: '1920x1080',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--spec' && argv[i + 1]) out.specPath = argv[++i];
    else if (arg === '--project-dir' && argv[i + 1]) out.projectDir = argv[++i];
    else if (arg === '--apply-import') out.applyImport = true;
    else if (arg === '--launch') out.launch = true;
    else if (arg === '--approvals' && argv[i + 1]) out.approvalsPath = argv[++i];
    else if (arg === '--receipt-dir' && argv[i + 1]) out.receiptDir = argv[++i];
    else if (arg === '--kill-switch' && argv[i + 1]) out.killSwitch = argv[++i];
    else if (arg === '--exe' && argv[i + 1]) out.exe = argv[++i];
    else if (arg === '--project' && argv[i + 1]) out.uproject = argv[++i];
    else if (arg === '--map' && argv[i + 1]) out.map = argv[++i];
    else if (arg === '--shot' && argv[i + 1]) out.shot = argv[++i];
    else usage();
  }
  if (!out.specPath || !out.projectDir) usage();
  return out;
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return { parse_error: true, raw: raw || '' };
  }
}

function launchCommand(args) {
  // Engine-native evidence capture: open the map and take a screenshot.
  const parts = [
    quote(args.exe),
    quote(args.uproject),
    args.map,
    '-game',
    '-windowed',
    '-resx=1920',
    '-resy=1080',
    '-nosplash',
    '-log',
    `-ExecCmds=${quote(`HighResShot ${args.shot}`)}`,
  ];
  return parts.join(' ');
}

function quote(s) {
  return /\s/.test(s) ? `"${s}"` : s;
}

function run(argv) {
  const args = parseArgs(argv);
  const specPath = path.resolve(args.specPath);
  const projectDir = path.resolve(args.projectDir);

  const result = {
    schema: 'worldforge-launch-stage/1.0',
    timestamp: new Date().toISOString(),
    tool: 'launch-worldforge-render.js',
    apply_import: args.applyImport,
    launch: args.launch,
    receipt_dir: args.receiptDir ? path.resolve(args.receiptDir) : null,
    stages: {},
    launch_command: null,
    launched: false,
  };

  // Stage 0: kill-switch.
  if (fs.existsSync(path.resolve(args.killSwitch))) {
    result.stages.kill_switch_clear = false;
    result.reason = 'kill_switch_engaged';
    return { code: 1, result };
  }
  result.stages.kill_switch_clear = true;

  // Stage 1: preflight (fail-closed exact-hash approval check).
  const preflight = spawnSync(process.execPath, [
    PREFLIGHT,
    '--spec', specPath,
    '--approvals', path.resolve(args.approvalsPath),
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  const preflightOut = tryParseJson(preflight.stdout);
  result.stages.preflight = { status: preflight.status, import_allowed: preflightOut.import_allowed, reason: preflightOut.reason };
  if (preflight.status !== 0 || preflightOut.import_allowed !== true) {
    result.reason = `preflight_failed:${preflightOut.reason || 'unknown'}`;
    return { code: 1, result };
  }

  // Stage 2: import writer (dry-run unless --apply-import).
  const importArgs = [
    IMPORT_WRITER,
    '--spec', specPath,
    '--project-dir', projectDir,
    '--approvals', path.resolve(args.approvalsPath),
    '--kill-switch', path.resolve(args.killSwitch),
  ];
  // Forward the caller's receipt directory exactly when supplied so other
  // lanes do not contaminate this run's default receipt location. Omitted ->
  // the import child keeps its own default. Dry-runs write no receipts
  // regardless.
  if (args.receiptDir) importArgs.push('--receipt-dir', path.resolve(args.receiptDir));
  if (args.applyImport) importArgs.push('--apply');
  const importRun = spawnSync(process.execPath, importArgs, { cwd: REPO_ROOT, encoding: 'utf8' });
  const importOut = tryParseJson(importRun.stdout);
  result.stages.import = {
    status: importRun.status,
    mode: importOut.mode,
    imported: importOut.imported,
    reason: importOut.reason,
    target_path: importOut.target_path,
    sha256: importOut.sha256,
    receipt_path: importOut.receipt_path || null,
  };
  if (importRun.status !== 0) {
    result.reason = `import_failed:${importOut.reason || 'unknown'}`;
    return { code: 1, result };
  }

  // Stage 3: launch command (print/stage; exec only with --launch).
  result.launch_command = launchCommand(args);
  if (args.launch) {
    if (!args.applyImport) {
      result.reason = 'refused_launch_without_apply_import';
      return { code: 1, result };
    }
    const child = spawnSync(args.exe, [
      args.uproject, args.map, '-game', '-windowed', '-resx=1920', '-resy=1080',
      '-nosplash', '-log', `-ExecCmds=HighResShot ${args.shot}`,
    ], { cwd: projectDir, stdio: 'inherit' });
    result.launched = true;
    result.launch_exit = child.status;
    result.reason = 'launched';
    return { code: child.status === 0 ? 0 : 1, result };
  }

  result.reason = args.applyImport ? 'imported_launch_command_staged' : 'dry_run_launch_command_staged';
  return { code: 0, result };
}

function main() {
  const { code, result } = run(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
  if (result.launch_command) {
    console.error('\n[launch-worldforge-render] Staged renderer launch command (attended run only):');
    console.error(result.launch_command);
  }
  process.exit(code);
}

if (require.main === module) {
  main();
}

module.exports = { run, launchCommand };
