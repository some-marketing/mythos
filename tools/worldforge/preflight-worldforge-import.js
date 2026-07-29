#!/usr/bin/env node
/**
 * preflight-worldforge-import.js — fail-closed import gate before renderer launch.
 *
 * This is the reusable launcher-side guard for world-spec smoke/import runs.
 * It verifies exact-hash human approval before any wrapper starts the renderer.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_APPROVALS = path.join(REPO_ROOT, 'context/world-spec-approvals.json');
const CHECKER = path.join(__dirname, 'check-world-spec-approval.js');
const RENDERER_HEADER = path.join(__dirname, 'renderer-source', 'WorldforgeGameMode.h');
const RENDERER_CPP = path.join(__dirname, 'renderer-source', 'WorldforgeGameMode.cpp');

function usage() {
  console.error([
    'Usage: node preflight-worldforge-import.js --spec <world-spec.json> [options]',
    '',
    'Options:',
    '  --approvals <approvals.json>   Exact-hash approval manifest',
    '  --evidence <path>              Write JSON preflight evidence',
    '  --require-renderer-source      Also require local renderer source files',
  ].join('\n'));
  process.exit(2);
}

function parseArgs(argv) {
  const out = {
    specPath: null,
    approvalsPath: DEFAULT_APPROVALS,
    evidencePath: null,
    requireRendererSource: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--spec' && argv[i + 1]) {
      out.specPath = argv[++i];
    } else if (arg === '--approvals' && argv[i + 1]) {
      out.approvalsPath = argv[++i];
    } else if (arg === '--evidence' && argv[i + 1]) {
      out.evidencePath = argv[++i];
    } else if (arg === '--require-renderer-source') {
      out.requireRendererSource = true;
    } else {
      usage();
    }
  }

  if (!out.specPath) usage();
  return out;
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return { parse_error: true, raw: raw || '' };
  }
}

function relativeOrAbsolute(filePath) {
  const resolved = path.resolve(filePath);
  const rel = path.relative(REPO_ROOT, resolved);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : resolved;
}

function writeEvidence(evidencePath, payload) {
  if (!evidencePath) return;
  const fullPath = path.resolve(evidencePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2) + '\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const specPath = path.resolve(args.specPath);
  const approvalsPath = path.resolve(args.approvalsPath);

  const result = {
    timestamp: new Date().toISOString(),
    gate: 'worldforge-import-preflight',
    spec_path: relativeOrAbsolute(specPath),
    approvals_path: relativeOrAbsolute(approvalsPath),
    checks: {},
    import_allowed: false,
  };

  if (!fs.existsSync(specPath)) {
    result.reason = 'missing_spec';
    result.checks.spec_exists = false;
    writeEvidence(args.evidencePath, result);
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  result.checks.spec_exists = true;

  if (!fs.existsSync(approvalsPath)) {
    result.reason = 'missing_approvals_manifest';
    result.checks.approvals_exists = false;
    writeEvidence(args.evidencePath, result);
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  result.checks.approvals_exists = true;

  if (args.requireRendererSource) {
    const headerExists = fs.existsSync(RENDERER_HEADER);
    const cppExists = fs.existsSync(RENDERER_CPP);
    result.checks.renderer_source = {
      header: headerExists,
      cpp: cppExists,
    };
    if (!headerExists || !cppExists) {
      result.reason = 'missing_renderer_source';
      writeEvidence(args.evidencePath, result);
      console.log(JSON.stringify(result, null, 2));
      process.exit(1);
    }
  }

  const approval = spawnSync(process.execPath, [
    CHECKER,
    specPath,
    '--approvals',
    approvalsPath,
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  const approvalOutput = tryParseJson(approval.stdout);
  result.checks.approval = approvalOutput;
  result.import_allowed = approval.status === 0 && approvalOutput.import_allowed === true;
  result.reason = result.import_allowed ? 'approved_for_import' : (approvalOutput.reason || 'approval_check_failed');

  writeEvidence(args.evidencePath, result);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.import_allowed ? 0 : 1);
}

main();
