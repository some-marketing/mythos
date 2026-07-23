#!/usr/bin/env node
/**
 * approve-world-spec-hash.js — add an exact world-spec hash to the approval manifest.
 *
 * Default mode is dry-run. Mutation requires --apply plus --expected-sha256 so
 * the operator decision is bound to the exact bytes reviewed.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_APPROVALS = path.join(REPO_ROOT, 'context/world-spec-approvals.json');
const VALIDATOR = path.join(__dirname, 'validate-world-spec.js');

function usage() {
  console.error([
    'Usage: node approve-world-spec-hash.js --spec <world-spec.json> --expected-sha256 <hash> --basis <text> [options]',
    '',
    'Options:',
    '  --approvals <path>        Approval manifest path',
    '  --approved-by <name>      Approver label (default: operator)',
    '  --approved-at <iso>       Approval timestamp (default: current time)',
    '  --apply                   Write the approval entry; omitted = dry run',
  ].join('\n'));
  process.exit(2);
}

function parseArgs(argv) {
  const args = {
    approvals: DEFAULT_APPROVALS,
    approvedBy: 'operator',
    apply: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === '--spec' && val) { args.spec = val; i++; }
    else if (key === '--approvals' && val) { args.approvals = val; i++; }
    else if (key === '--expected-sha256' && val) { args.expectedSha256 = val.toLowerCase(); i++; }
    else if (key === '--basis' && val) { args.basis = val; i++; }
    else if (key === '--approved-by' && val) { args.approvedBy = val; i++; }
    else if (key === '--approved-at' && val) { args.approvedAt = val; i++; }
    else if (key === '--apply') { args.apply = true; }
    else usage();
  }
  if (!args.spec || !args.expectedSha256 || !args.basis) usage();
  if (!/^[a-f0-9]{64}$/.test(args.expectedSha256)) {
    throw new Error('--expected-sha256 must be a 64-character lowercase/hex SHA-256 hash');
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function validateSpec(specPath) {
  const result = spawnSync(process.execPath, [VALIDATOR, specPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout || '{}');
  } catch {
    parsed = { valid: false, errors: [{ path: '$', message: result.stdout || result.stderr || 'validator output was not JSON' }] };
  }
  if (result.status !== 0 || parsed.valid !== true) {
    throw new Error(`spec validation failed: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

function relativePath(filePath) {
  const resolved = path.resolve(filePath);
  const rel = path.relative(REPO_ROOT, resolved);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : resolved;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const specPath = path.resolve(args.spec);
  const approvalsPath = path.resolve(args.approvals);
  const actualSha256 = sha256(specPath);

  if (actualSha256 !== args.expectedSha256) {
    console.log(JSON.stringify({
      ok: false,
      applied: false,
      reason: 'expected_hash_mismatch',
      expected_sha256: args.expectedSha256,
      actual_sha256: actualSha256,
      spec_path: relativePath(specPath),
    }, null, 2));
    process.exit(1);
  }

  const validation = validateSpec(specPath);
  const spec = readJson(specPath);
  const approvals = readJson(approvalsPath);
  if (!Array.isArray(approvals.approved_specs)) approvals.approved_specs = [];

  const existing = approvals.approved_specs.find((entry) => (
    entry &&
    entry.schema === spec.schema &&
    entry.world_id === spec.meta?.world_id &&
    entry.sha256 === actualSha256
  ));

  const entry = {
    world_id: spec.meta?.world_id || null,
    name: spec.meta?.name || null,
    schema: spec.schema || null,
    sha256: actualSha256,
    approved: true,
    approved_by: args.approvedBy,
    approved_at: args.approvedAt || new Date().toISOString(),
    approval_basis: args.basis,
  };

  const output = {
    ok: true,
    applied: false,
    dry_run: !args.apply,
    reason: existing ? 'already_present_or_would_update' : 'would_add_exact_hash_approval',
    spec_path: relativePath(specPath),
    approvals_path: relativePath(approvalsPath),
    entry,
    validation,
  };

  if (args.apply) {
    if (existing) {
      Object.assign(existing, entry);
      output.reason = 'updated_existing_exact_hash_approval';
    } else {
      approvals.approved_specs.push(entry);
      output.reason = 'added_exact_hash_approval';
    }
    fs.writeFileSync(approvalsPath, `${JSON.stringify(approvals, null, 2)}\n`);
    output.applied = true;
    output.dry_run = false;
  }

  console.log(JSON.stringify(output, null, 2));
}

try {
  main();
} catch (err) {
  console.error(JSON.stringify({ ok: false, applied: false, error: err.message }, null, 2));
  process.exit(1);
}
