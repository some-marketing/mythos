#!/usr/bin/env node
'use strict';

/**
 * preflight-unattended.cjs — the machine-checkable PREFLIGHT CONTRACT for a
 * long unattended run.
 *
 * The governing requirement is NOT "make no `op` calls". It is: once a long run
 * starts, it must finish WITHOUT the operator present. `op` is perfectly fine
 * so long as it can never stop to ask a human. This script checks exactly that,
 * across every class of human-blocking event:
 *
 *   AUTH    — can every credential a run needs be resolved with no 1Password
 *             desktop dialog and no macOS Keychain "allow / always allow" ACL
 *             prompt? (Each Keychain read is run with a hard timeout, so an ACL
 *             dialog surfaces as WOULD-PROMPT instead of hanging the check.)
 *   HANG    — is a 1Password service-account token present, so that any `op`
 *             call downstream is non-interactive rather than an unbounded wait?
 *   GATES   — the legitimate gates (governance perimeter, custody, remote
 *             mutation) SHOULD stop a run; they are not checked for absence,
 *             only that they fail fast and loudly. See the audit report.
 *
 * EXIT CODES (so a runner can gate on this):
 *   0  PASS  — every required credential resolves non-interactively.
 *   1  FAIL  — at least one required credential is missing, or would prompt.
 *   2  ERROR — the check itself could not run.
 *
 * SAFETY INVARIANT: values are never printed. Only names, byte lengths, the
 * resolving tier, and elapsed milliseconds appear in the output.
 *
 * Usage:
 *   node tools/boot/preflight-unattended.cjs            # required set
 *   node tools/boot/preflight-unattended.cjs --all      # + optional lanes
 *   node tools/boot/preflight-unattended.cjs --json
 */

const { execFileSync } = require('child_process');
const path = require('path');

const RESOLVER = path.join(__dirname, '..', 'credentials', 'resolve-secret.cjs');
const { resolveServiceAccountToken } = require(RESOLVER);

// A read that blocks this long is a Keychain ACL dialog, not slowness.
const ACL_TIMEOUT_MS = 5000;

/**
 * Credentials the hot unattended lanes need. `required: true` means a long run
 * cannot be trusted to complete without it.
 */
const CREDENTIALS = [
  { name: 'OPENROUTER_API_KEY', lane: 'convene / signals bridge', required: true },
  { name: 'GEMINI_API_KEY', lane: 'ai-bridge gemini adapter', required: true },
  { name: 'PERPLEXITY_API_KEY', lane: 'ai-bridge research', required: true },
  { name: 'DISCORD_BOT_TOKEN', lane: 'discord bridge / voice', required: false },
  { name: 'ELEVENLABS_API_KEY', lane: 'voice synthesis', required: false },
  { name: 'DART_TOKEN', lane: 'dart-integration', required: false },
  { name: 'LANGFUSE_PUBLIC_KEY', lane: 'telemetry export', required: false },
  { name: 'LANGFUSE_SECRET_KEY', lane: 'telemetry export', required: false },
  { name: 'GOOGLE_ADS_DEVELOPER_TOKEN', lane: 'google-ads mcp', required: false },
  { name: 'GOOGLE_ADS_REFRESH_TOKEN', lane: 'google-ads mcp', required: false },
  { name: 'SHEETS_CLIENT_ID', lane: 'sheets mcp', required: false },
  { name: 'SHEETS_CLIENT_SECRET', lane: 'sheets mcp', required: false },
  { name: 'SHEETS_REFRESH_TOKEN', lane: 'sheets mcp', required: false },
];

/**
 * Probe one credential the way an unattended run would: env first, then a
 * bounded Keychain read. Returns a status without ever exposing the value.
 */
function probe(name) {
  if (String(process.env[name] || '').trim()) {
    return { status: 'OK', tier: 'env', ms: 0, len: process.env[name].trim().length };
  }
  const t0 = Date.now();
  try {
    const out = String(
      execFileSync('security', ['find-generic-password', '-a', 'mythos', '-s', name, '-w'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: ACL_TIMEOUT_MS,
      })
    ).trim();
    const ms = Date.now() - t0;
    if (!out) return { status: 'MISSING', tier: null, ms };
    return { status: 'OK', tier: 'keychain', ms, len: out.length };
  } catch (e) {
    const ms = Date.now() - t0;
    // A timeout here means the Keychain raised an allow/always-allow dialog.
    if (e.killed || e.signal === 'SIGTERM' || ms >= ACL_TIMEOUT_MS - 100) {
      return { status: 'WOULD_PROMPT', tier: null, ms };
    }
    return { status: 'MISSING', tier: null, ms };
  }
}

function main() {
  const json = process.argv.includes('--json');
  const all = process.argv.includes('--all');
  const results = [];
  let failures = 0;
  let prompts = 0;

  // --- HANG class: is `op` guaranteed non-interactive? ---
  const sa = resolveServiceAccountToken();
  const opHeadless = Boolean(sa);

  for (const cred of CREDENTIALS) {
    if (!cred.required && !all) {
      // Still probe, but only required failures gate the run.
    }
    const r = probe(cred.name);
    results.push({ ...cred, ...r });
    if (r.status === 'WOULD_PROMPT') prompts++;
    if (cred.required && r.status !== 'OK') failures++;
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          pass: failures === 0 && prompts === 0,
          op_headless: opHeadless,
          op_token_service: sa ? sa.service : null,
          failures,
          would_prompt: prompts,
          results,
        },
        null,
        2
      )
    );
  } else {
    console.log('=== unattended-run preflight ===\n');
    console.log(
      'op non-interactive: ' +
        (opHeadless
          ? `YES (service-account token from Keychain ${sa.service}/${sa.account})`
          : 'NO — `op` would fall back to a desktop dialog and stall the run')
    );
    console.log('');
    const pad = (s, n) => String(s).padEnd(n);
    console.log(pad('STATUS', 14) + pad('TIER', 10) + pad('CREDENTIAL', 30) + 'LANE');
    for (const r of results) {
      console.log(
        pad(r.status + (r.required ? '' : '*'), 14) +
          pad(r.tier || '-', 10) +
          pad(r.name, 30) +
          r.lane
      );
    }
    console.log('\n* = optional lane; does not gate the run.');
    console.log(
      `\nrequired failures: ${failures}   would-prompt: ${prompts}   ` +
        (failures === 0 && prompts === 0 ? 'PREFLIGHT PASS' : 'PREFLIGHT FAIL')
    );
    if (failures || prompts) {
      console.log(
        '\nRemedy: bash tools/boot/port-keys-to-keychain.sh   (ports from 1Password/legacy Keychain)\n' +
          '        bash tools/boot/keychain-store.sh <NAME> mythos   (store one by hand, no shell history)'
      );
    }
  }

  if (!opHeadless && failures === 0) {
    // Not fatal on its own — every required credential resolved locally — but
    // any lane that still reaches for `op` could block.
    process.exitCode = 0;
  }
  process.exit(failures === 0 && prompts === 0 ? 0 : 1);
}

try {
  main();
} catch (e) {
  process.stderr.write('[preflight] check could not run: ' + e.message + '\n');
  process.exit(2);
}
