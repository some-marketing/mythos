#!/usr/bin/env node
'use strict';

/**
 * contextual-inject-lint.cjs — credential/PII gate for contextual-inject.cjs.
 *
 * Reads stdin (the dry-run output of contextual-inject.cjs) and fails exit-1
 * on ANY of the nine sentinel patterns defined in the task plan S4.
 *
 * Plan: _dev/reports/analysis/task-plans/auto-injection-hook-for-contextual-mind-tier0__plan.json
 *
 * CRITICAL: the findings JSON file MUST NEVER write the matched credential
 * bytes. Pattern label and redacted excerpt only.
 *
 * Usage:
 *   node tools/memory/contextual-inject.cjs --dry-run | node tools/memory/contextual-inject-lint.cjs
 *
 * Exit 0 = clean. Exit 1 = sentinel hit (do NOT proceed to S5 wiring).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FINDINGS_DIR = path.join(PROJECT_ROOT, '_dev/reports/analysis');

const PRIVATE_CREDENTIAL_PATTERNS = (process.env.MYTHOS_PRIVATE_CREDENTIAL_MARKERS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
  .map((marker, index) => ({
    label: `private-credential-marker-${index + 1}`,
    re: new RegExp(`${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*(?:password|auth|token|bypass)`, 'i'),
  }));

// Portable generic patterns plus optional local-only client markers.
const REGEX_PATTERNS = [
  { label: 'op://',                       re: /op:\/\// },
  { label: '1password.com/vaults/',       re: /1password\.com\/vaults\// },
  { label: 'claude-temp-page',            re: /claude-temp-page/ },
  { label: 'app-password',                re: /\bapp-password\b/i },
  { label: 'expressionengine credential markers', re: /expressionengine.*(?:password|auth|token)/i },
  { label: 'e164 phone shape',            re: /\+1\d{10}/ },
  { label: 'generic email shape',         re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  ...PRIVATE_CREDENTIAL_PATTERNS,
];

// Exact-string PII memory basenames (substring match on the line).
const PII_BASENAMES = [
  'credentials.md',
  'account-identifiers.md',
  'private-context.md',
  ...(process.env.MYTHOS_PRIVATE_CONTEXT_MARKERS || '').split(','),
].map(value => value.trim()).filter(Boolean);

function redact(matched) {
  // Never echo credential bytes. Record length + pattern fingerprint.
  const len = matched.length;
  const fp = crypto.createHash('sha256').update(matched).digest('hex').slice(0, 8);
  return `<REDACTED ${len} chars, fp=${fp}>`;
}

function readStdin() {
  return new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
    // If no stdin attached, resolve empty after a tick.
    if (process.stdin.isTTY) resolve('');
  });
}

function lint(text) {
  const lines = text.split('\n');
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    for (const p of REGEX_PATTERNS) {
      const m = line.match(p.re);
      if (m) {
        matches.push({
          pattern_label: p.label,
          line_number: lineNo,
          redacted_excerpt: redact(m[0])
        });
      }
    }

    for (const basename of PII_BASENAMES) {
      const idx = line.indexOf(basename);
      if (idx !== -1) {
        matches.push({
          pattern_label: `PII basename: ${basename}`,
          line_number: lineNo,
          redacted_excerpt: redact(basename)
        });
      }
    }
  }
  return matches;
}

function isoStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main() {
  const text = await readStdin();
  const stdinBuf = Buffer.from(text, 'utf8');
  const stdinSha = crypto.createHash('sha256').update(stdinBuf).digest('hex');
  const lineCount = text.split('\n').length;

  const matches = lint(text);

  const findings = {
    matches,
    stdin_sha256: stdinSha,
    stdin_line_count: lineCount,
    lint_run_at_iso: new Date().toISOString()
  };

  try {
    if (!fs.existsSync(FINDINGS_DIR)) fs.mkdirSync(FINDINGS_DIR, { recursive: true });
    const fp = path.join(FINDINGS_DIR, `contextual-inject-lint__${isoStamp()}.json`);
    fs.writeFileSync(fp, JSON.stringify(findings, null, 2) + '\n');
    process.stderr.write(`contextual-inject-lint: findings → ${path.relative(PROJECT_ROOT, fp)}\n`);
  } catch (e) {
    process.stderr.write(`contextual-inject-lint: findings-write failed: ${e.message}\n`);
  }

  if (matches.length > 0) {
    process.stderr.write(`contextual-inject-lint: ${matches.length} sentinel hit(s) — HALT.\n`);
    for (const m of matches) {
      process.stderr.write(`  line ${m.line_number}: ${m.pattern_label}\n`);
    }
    process.exit(1);
  }
  process.stderr.write('contextual-inject-lint: clean.\n');
  process.exit(0);
}

main();
