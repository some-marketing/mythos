#!/usr/bin/env node
'use strict';

/**
 * pre-write-convene-required.cjs — governance-write gate.
 *
 * Protected governance paths require a live path-scoped ConveneReceipt/1.0.
 * Governance-adjacent keywords are advisory only: reports ABOUT governance must
 * not be blocked merely for using words like "kernel" or "convene".
 *
 * Receipts are minted outside this hot hook by tools/verify/convene-unlock.cjs
 * after a human-controlled 1Password approval. This hook never calls `op`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const RECEIPTS_DIR = process.env.MYTHOS_CONVENE_RECEIPTS_DIR
  || path.join(os.tmpdir(), 'smos-convene-receipts');

const PROTECTED_PATHS = [
  /^instructions\/canonical\//,
  /^tools\/council\//,
  /^tools\/convene\//,
  /^tools\/verify\/hooks\/.*convene/,
  /^\.claude\/settings\.json$/
];

const ADVISORY_KEYWORDS = /\b(kernel|convene|council|distinct intelligence|acceptance-grade|enforcement|lobe)\b/i;

function normalizeRelPath(filePath, root = ROOT) {
  if (!filePath) return '';
  const abs = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(root, filePath);
  return path.relative(root, abs).replace(/\\/g, '/');
}

function readToolInput(env = process.env) {
  const raw = env.CLAUDE_TOOL_INPUT;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pathMatchesAuthorized(authorizedPath, relPath) {
  const authorized = String(authorizedPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!authorized || !rel) return false;
  if (authorized === rel) return true;
  return authorized.endsWith('/') && rel.startsWith(authorized);
}

function receiptCoversPath(receipt, relPath, nowMs = Date.now()) {
  if (!receipt || receipt.schema !== 'ConveneReceipt/1.0') return false;
  if (receipt.verdict !== 'approved') return false;
  if (receipt.operator_ratified !== true) return false;
  const expires = Date.parse(receipt.expires || '');
  if (!Number.isFinite(expires) || expires <= nowMs) return false;
  const authorized = Array.isArray(receipt.authorized_paths) ? receipt.authorized_paths : [];
  return authorized.some((p) => pathMatchesAuthorized(p, relPath));
}

function liveReceiptCovers(relPath, receiptsDir = RECEIPTS_DIR, nowMs = Date.now()) {
  try {
    if (!fs.existsSync(receiptsDir)) return false;
    for (const name of fs.readdirSync(receiptsDir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const receipt = JSON.parse(fs.readFileSync(path.join(receiptsDir, name), 'utf8'));
        if (receiptCoversPath(receipt, relPath, nowMs)) return true;
      } catch {
        // Ignore malformed receipts; a bad receipt must not unlock governance writes.
      }
    }
  } catch {
    return false;
  }
  return false;
}

function evaluate(input, opts = {}) {
  const root = opts.root || ROOT;
  const receiptsDir = opts.receiptsDir || RECEIPTS_DIR;
  const nowMs = opts.nowMs || Date.now();
  const filePath = input && input.file_path;
  if (!filePath) return { allow: true };

  const relPath = normalizeRelPath(filePath, root);
  const content = input.new_string || input.content || '';
  const isProtectedPath = PROTECTED_PATHS.some((re) => re.test(relPath));
  const hasAdvisoryKeyword = ADVISORY_KEYWORDS.test(`${relPath}\n${content}`);

  if (isProtectedPath) {
    if (liveReceiptCovers(relPath, receiptsDir, nowMs)) return { allow: true };
    return {
      allow: false,
      message: [
        `BLOCKED: governance write to ${relPath} requires a live ConveneReceipt/1.0 covering this path.`,
        'Run /convene on the proposed change, then mint a 1Password-backed unlock receipt with tools/verify/convene-unlock.cjs.'
      ].join(' ')
    };
  }

  if (hasAdvisoryKeyword) {
    return {
      allow: true,
      notice: 'NOTICE: governance-adjacent content. If this write CHANGES kernel/governance behavior, route through /convene and a path-scoped receipt first.'
    };
  }

  return { allow: true };
}

function main() {
  const input = readToolInput();
  if (!input) return;
  const result = evaluate(input);
  if (result.notice) process.stdout.write(result.notice);
  if (!result.allow) {
    process.stderr.write(result.message + '\n');
    process.exit(2);
  }
}

module.exports = {
  ADVISORY_KEYWORDS,
  PROTECTED_PATHS,
  RECEIPTS_DIR,
  evaluate,
  liveReceiptCovers,
  normalizeRelPath,
  pathMatchesAuthorized,
  receiptCoversPath
};

if (require.main === module) {
  main();
}
