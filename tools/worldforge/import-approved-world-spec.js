#!/usr/bin/env node
/**
 * import-approved-world-spec.js — fail-closed writer that lands an
 * operator-approved world-spec at <ProjectDir>/world-spec.json.
 *
 * The whole point of this tool is that it CANNOT land bytes the operator has
 * not approved. It never re-implements the approval logic: it spawns the real
 * check-world-spec-approval.js against the EXACT spec bytes and refuses unless
 * that checker returns import_allowed === true. The bytes hashed by the checker
 * are the bytes this tool writes — byte-for-byte, via an atomic temp+rename —
 * so hashed == approved == written.
 *
 * Default mode is dry-run. Landing bytes requires --apply. A kill-switch file
 * (default state/worldforge-import/disabled) hard-refuses all imports when
 * present, dry-run or apply.
 *
 * This tool does NOT launch a game engine and does NOT write to any project
 * directory on its own initiative — it writes only where --project-dir points,
 * only with --apply, and only for an approved hash.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CHECKER = path.join(__dirname, 'check-world-spec-approval.js');
const DEFAULT_APPROVALS = path.join(REPO_ROOT, 'context/world-spec-approvals.json');
const DEFAULT_KILL_SWITCH = path.join(REPO_ROOT, 'state/worldforge-import/disabled');
const DEFAULT_RECEIPT_DIR = path.join(REPO_ROOT, 'reports/worldforge-import-evidence');

function usage() {
  console.error([
    'Usage: node import-approved-world-spec.js --spec <world-spec.json> --project-dir <dir> [options]',
    '',
    'Options:',
    '  --apply                    Land the approved bytes (default: dry-run, no write)',
    '  --approvals <path>         Exact-hash approval manifest (default: repo manifest)',
    '  --receipt-dir <dir>        Where import receipts are written',
    '  --kill-switch <path>       Refuse all imports while this file exists',
    '  --json                     Print only the JSON result',
  ].join('\n'));
  process.exit(2);
}

function parseArgs(argv) {
  const out = {
    specPath: null,
    projectDir: null,
    apply: false,
    approvalsPath: DEFAULT_APPROVALS,
    receiptDir: DEFAULT_RECEIPT_DIR,
    killSwitch: DEFAULT_KILL_SWITCH,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--spec' && argv[i + 1]) out.specPath = argv[++i];
    else if (arg === '--project-dir' && argv[i + 1]) out.projectDir = argv[++i];
    else if (arg === '--apply') out.apply = true;
    else if (arg === '--dry-run') out.apply = false;
    else if (arg === '--approvals' && argv[i + 1]) out.approvalsPath = argv[++i];
    else if (arg === '--receipt-dir' && argv[i + 1]) out.receiptDir = argv[++i];
    else if (arg === '--kill-switch' && argv[i + 1]) out.killSwitch = argv[++i];
    else if (arg === '--json') out.jsonOnly = true;
    else usage();
  }
  if (!out.specPath || !out.projectDir) usage();
  return out;
}

function relativeOrAbsolute(filePath) {
  const resolved = path.resolve(filePath);
  const rel = path.relative(REPO_ROOT, resolved);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : resolved;
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return { parse_error: true, raw: raw || '' };
  }
}

/**
 * Atomic write: write bytes to a unique temp file in the destination directory,
 * then rename over the target. Retries the rename on transient Windows-style
 * lock errors (EPERM/EACCES/EBUSY).
 */
function atomicWriteBytes(targetPath, buffer) {
  const dir = path.dirname(targetPath);
  const tmp = path.join(dir, `.world-spec.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, buffer);
  let lastError = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      fs.renameSync(tmp, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 8) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * attempt);
    }
  }
  try { fs.rmSync(tmp, { force: true }); } catch (_) { /* ignore */ }
  throw lastError || new Error('atomic rename failed');
}

function run(argv) {
  const args = parseArgs(argv);
  const specPath = path.resolve(args.specPath);
  const projectDir = path.resolve(args.projectDir);
  const approvalsPath = path.resolve(args.approvalsPath);
  const killSwitch = path.resolve(args.killSwitch);
  const targetPath = path.join(projectDir, 'world-spec.json');

  const result = {
    schema: 'worldforge-import-result/1.0',
    timestamp: new Date().toISOString(),
    tool: 'import-approved-world-spec.js',
    mode: args.apply ? 'apply' : 'dry-run',
    spec_path: relativeOrAbsolute(specPath),
    project_dir: relativeOrAbsolute(projectDir),
    target_path: relativeOrAbsolute(targetPath),
    approvals_path: relativeOrAbsolute(approvalsPath),
    kill_switch_path: relativeOrAbsolute(killSwitch),
    checks: {},
    imported: false,
  };

  // Fail-closed: kill-switch present -> refuse everything.
  if (fs.existsSync(killSwitch)) {
    result.checks.kill_switch_clear = false;
    result.reason = 'kill_switch_engaged';
    return { code: 1, result };
  }
  result.checks.kill_switch_clear = true;

  if (!fs.existsSync(specPath)) {
    result.checks.spec_exists = false;
    result.reason = 'missing_spec';
    return { code: 1, result };
  }
  result.checks.spec_exists = true;

  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    result.checks.project_dir_exists = false;
    result.reason = 'missing_project_dir';
    return { code: 1, result };
  }
  result.checks.project_dir_exists = true;

  // Read the EXACT bytes once; everything downstream uses this buffer.
  const specBytes = fs.readFileSync(specPath);
  const specSha = sha256Buffer(specBytes);
  result.sha256 = specSha;
  result.byte_length = specBytes.length;

  // Approval gate: spawn the REAL checker on the exact spec path. Do not
  // reimplement approval logic here.
  const approval = spawnSync(process.execPath, [
    CHECKER,
    specPath,
    '--approvals',
    approvalsPath,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  const approvalOutput = tryParseJson(approval.stdout);
  result.checks.approval = approvalOutput;
  const importAllowed = approval.status === 0 && approvalOutput.import_allowed === true;
  result.checks.import_allowed = importAllowed;

  // Byte-exact discipline: the checker hashed the file at specPath; confirm the
  // buffer we hold hashes to the same value and to the checker's reported hash.
  const checkerSha = approvalOutput.sha256 || null;
  const bytesMatchChecker = checkerSha === null ? true : checkerSha === specSha;
  result.checks.bytes_match_checker_hash = bytesMatchChecker;

  if (!importAllowed) {
    result.reason = approvalOutput.reason || 'approval_check_failed';
    return { code: 1, result };
  }
  if (!bytesMatchChecker) {
    result.reason = 'byte_exact_mismatch';
    return { code: 1, result };
  }

  if (!args.apply) {
    result.reason = 'approved_dry_run_no_write';
    result.would_write = { target_path: result.target_path, sha256: specSha, byte_length: specBytes.length };
    return { code: 0, result };
  }

  // Apply: atomic temp+rename of the identical bytes.
  try {
    atomicWriteBytes(targetPath, specBytes);
  } catch (error) {
    result.reason = 'atomic_write_failed';
    result.error = error.message;
    return { code: 1, result };
  }

  // Confirm the landed bytes are byte-identical to the approved bytes.
  const landedBytes = fs.readFileSync(targetPath);
  const landedSha = sha256Buffer(landedBytes);
  result.checks.landed_bytes_match = landedSha === specSha;
  if (landedSha !== specSha) {
    result.reason = 'landed_byte_mismatch';
    result.landed_sha256 = landedSha;
    return { code: 1, result };
  }

  // Emit an import receipt.
  const spec = tryParseJson(specBytes.toString('utf8'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('Z', 'Z');
  const receiptPath = path.join(args.receiptDir, `import-receipt__${stamp}.json`);
  const receipt = {
    schema: 'worldforge-import-receipt/1.0',
    timestamp: result.timestamp,
    landed_at: new Date().toISOString(),
    spec_path: result.spec_path,
    target_path: relativeOrAbsolute(targetPath),
    target_path_abs: targetPath,
    sha256: specSha,
    byte_length: specBytes.length,
    world_id: spec?.meta?.world_id || null,
    schema_of_spec: spec?.schema || null,
    seq: spec?.telemetry?.seq ?? null,
    bridge_ids: Array.isArray(spec?.bridge_presences)
      ? spec.bridge_presences.map((b) => b && b.bridge_id).filter(Boolean)
      : [],
    approval: approvalOutput.approval || null,
    applied: true,
  };
  fs.mkdirSync(args.receiptDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

  result.imported = true;
  result.reason = 'landed_approved_bytes';
  result.receipt_path = relativeOrAbsolute(receiptPath);
  result.receipt = receipt;
  return { code: 0, result };
}

function main() {
  const { code, result } = run(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(code);
}

if (require.main === module) {
  main();
}

module.exports = { run, atomicWriteBytes, sha256Buffer };
