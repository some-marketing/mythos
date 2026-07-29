#!/usr/bin/env node
'use strict';

/**
 * ee-edit.js — S6: CLI entrypoint for ExpressionEngine channel-entry field edits.
 *
 * Wires: S2 (credential resolver) → S3 (CP login + XID) → S4 (field update) → S5 (verify)
 *
 * Usage:
 *   node tools/expressionengine/ee-edit.js \
 *     --entry-id <N> \
 *     --channel-id <N> \
 *     --field-name <field_id_N> \
 *     --find <"exact text to replace"> \
 *     --replace <"new text"> \
 *     [--dry-run] \
 *     [--public-url <https://example.com/path/to/page>] \
 *     [--verbose]
 *
 * Env-var override (CI / test — skips 1Password):
 *   EE_URL       CP login URL (e.g. https://www.example.com/admin.php?/cp/login)
 *   EE_USERNAME  CP username
 *   EE_PASSWORD  CP password  ← NEVER logs this
 *
 * JSONL log: tools/expressionengine/ee-edit-log.jsonl
 *   Every run appends one line (dry or live). Password is NEVER included.
 *
 * CREDENTIAL RULE: The password is never written to stdout, stderr, any log,
 * or any file. It exists only in the process-memory object returned by
 * resolveEECreds(). This file must never be modified to log or print that field.
 *
 * No external npm dependencies.
 */

const { resolveEECreds, loginToCP, getEntryEditPage } = require('./lib/ee-auth');
const { applyEdit }  = require('./lib/ee-entry-edit');
const { verifyLive } = require('./lib/ee-verify');

// ─── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run')  { args.dryRun   = true;  continue; }
    if (a === '--verbose')  { args.verbose  = true;  continue; }
    if (a === '--debug-html') { args.debugHtml = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function usage() {
  return `
Usage:
  node tools/expressionengine/ee-edit.js \\
    --entry-id <N> \\
    --channel-id <N> \\
    --field-name <field_id_N> \\
    --find "<exact text to replace>" \\
    --replace "<new text>" \\
    [--dry-run] \\
    [--public-url <url>] \\
    [--verbose]

  Alternatively, to set a whole field value:
    --set-value "<full new value>"   (replaces --find + --replace)

  Env-var overrides (skip 1Password):
    EE_URL, EE_USERNAME, EE_PASSWORD

Examples (use placeholder IDs until S7 recon fills them in):
  # Dry-run Nadia bio edit (safe — no POST):
  node tools/expressionengine/ee-edit.js \\
    --entry-id ENTRY_ID_NADIA \\
    --channel-id CHANNEL_ID_TEAM \\
    --field-name FIELD_ID_TITLE \\
    --find "Audiologist (Antigonish & Guysborough)" \\
    --replace "Audiologist (Antigonish)" \\
    --dry-run \\
    --public-url https://www.example.com/about/ \\
    --verbose

  # Dry-run Kegan bio edit:
  node tools/expressionengine/ee-edit.js \\
    --entry-id ENTRY_ID_KEGAN \\
    --channel-id CHANNEL_ID_TEAM \\
    --field-name FIELD_ID_TITLE \\
    --find "Audiologist (Antigonish, Port Hawkesbury & Inverness)" \\
    --replace "Audiologist (Antigonish & Port Hawkesbury)" \\
    --dry-run \\
    --public-url https://www.example.com/about/ \\
    --verbose
`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || (!args.entryId && !args.listChannels)) {
    process.stdout.write(usage());
    process.exit(0);
  }

  // Required
  const entryId   = parseInt(args.entryId,   10);
  const channelId = parseInt(args.channelId, 10);
  const fieldName = args.fieldName;

  if (isNaN(entryId) || isNaN(channelId) || !fieldName) {
    process.stderr.write('Error: --entry-id, --channel-id, and --field-name are required.\n');
    process.stderr.write(usage());
    process.exit(1);
  }

  const find      = args.find      || null;
  const replace   = args.replace   !== undefined ? args.replace : null;
  const setValue  = args.setValue  || null;
  const dryRun    = args.dryRun    || false;
  const verbose   = args.verbose   || false;
  const publicUrl = args.publicUrl || null;

  if (!setValue && (find === null || replace === null)) {
    process.stderr.write('Error: supply either --find + --replace, or --set-value.\n');
    process.exit(1);
  }

  // ── S2: Resolve credentials (password stays in process memory only) ──────
  let creds;
  try {
    creds = resolveEECreds();
    // Do NOT log creds.password — even in verbose mode. This is intentional.
    if (verbose) process.stdout.write(`[auth] Credentials resolved (source: ${creds._source})\n`);
  } catch (err) {
    process.stderr.write(`[error] Credential resolution failed:\n${err.message}\n`);
    process.exit(1);
  }

  // ── S3: Login to CP + get session cookie ──────────────────────────────────
  let loginCtx;
  try {
    if (verbose) process.stdout.write('[auth] Logging in to EE CP…\n');
    loginCtx = await loginToCP(creds);
    if (verbose) process.stdout.write('[auth] Login successful — session cookie acquired.\n');
  } catch (err) {
    process.stderr.write(`[error] EE CP login failed:\n${err.message}\n`);
    process.exit(1);
  }
  // creds.password is no longer referenced after this point.
  // The object may persist in memory until GC; it is not actively zeroed.
  // It is never written to disk, stdout, stderr, or any log — that is the
  // actual guarantee. (JavaScript has no reliable zero-on-release primitive.)
  const { cookies, loginUrl } = loginCtx;

  // ── S3b: GET entry-edit page + extract XID ────────────────────────────────
  let editCtx;
  try {
    if (verbose) process.stdout.write(`[session] Fetching entry-edit page for entry ${entryId}…\n`);
    editCtx = await getEntryEditPage(loginUrl, cookies, entryId, channelId);
    if (verbose) process.stdout.write(`[session] XID extracted: ${editCtx.xid.slice(0, 8)}…\n`);
    if (args.debugHtml) {
      // Redact XID/session tokens from the HTML before writing.
      // Writes to a repo-local gitignored path (not /tmp) so the file
      // stays within the tool's working directory and is never committed.
      const debugDir  = require('path').join(__dirname, '..', '..', '_dev', 'debug');
      try { require('fs').mkdirSync(debugDir, { recursive: true }); } catch { /* ok if exists */ }
      const debugPath = require('path').join(debugDir, `ee-edit-debug-entry${entryId}.html`);
      // Redact hidden-input values whose names suggest tokens/session material
      const redactedHtml = editCtx.body
        .replace(
          /(<input[^>]*name=["'](XID|csrf_token|session_id)[^"']*["'][^>]*value=["'])[^"']+/gi,
          '$1[REDACTED]'
        )
        .replace(
          /(<input[^>]*value=["'])[^"']{20,}(["'][^>]*name=["'](XID|csrf_token|session_id))/gi,
          '$1[REDACTED]$2'
        );
      require('fs').writeFileSync(debugPath, redactedHtml, { encoding: 'utf8', mode: 0o600 });
      process.stdout.write(`[debug] Entry-edit HTML (tokens redacted) saved to ${debugPath}\n`);
      process.stdout.write('[debug] WARNING: debug file may still contain private CP content — do not commit.\n');
    }
  } catch (err) {
    process.stderr.write(`[error] Could not fetch entry-edit page:\n${err.message}\n`);
    process.exit(1);
  }

  // ── S4 pre-check: enforce live preconditions BEFORE any POST is attempted ──
  // --public-url is mandatory for live runs. This check happens BEFORE applyEdit()
  // so that the CP POST is never sent when the verify gate can't be satisfied.
  // Dry-run mode does not need a public URL — only live mode does.
  if (!dryRun && !publicUrl) {
    process.stderr.write(
      '[error] --public-url is required in live mode.\n' +
      '        Live verification is required before declaring the edit complete.\n' +
      '        Re-run with --public-url <https://...>, or use --dry-run to preview without writing.\n'
    );
    process.exit(1);
  }

  // ── S4: Apply edit (dry-run or live) ──────────────────────────────────────
  let editResult;
  try {
    editResult = await applyEdit({
      loginUrl,
      cookies,
      entryId,
      channelId,
      editPageHtml: editCtx.body,
      xid:          editCtx.xid,
      fieldName,
      find,
      replace,
      setValue,
      dryRun,
      verbose,
    });
  } catch (err) {
    process.stderr.write(`[error] Edit failed:\n${err.message}\n`);
    process.exit(1);
  }

  if (dryRun) {
    process.stdout.write('[done] Dry-run complete. Review the diff above, then re-run without --dry-run.\n');
    process.exit(0);
  }

  // ── S5: Live verify (REQUIRED in live mode) ──────────────────────────────
  // publicUrl is guaranteed non-null here — the pre-check above exited if absent.

  let verifyResult;
  try {
    verifyResult = await verifyLive({
      publicUrl,
      newValue: editResult.newValue,
      oldValue: find || null,
      verbose:  true,
      retryMs:  5000,
    });

    // Update the JSONL log with verify result
    const { appendLog } = require('./lib/ee-entry-edit');
    appendLog({
      entry_id:      entryId,
      channel_id:    channelId,
      field_name:    fieldName,
      dry_run:       false,
      old_excerpt:   editResult.diff.old_value_excerpt,
      new_value:     editResult.newValue,
      verify_result: verifyResult.pass ? 'PASS' : 'FAIL',
    });

    if (!verifyResult.pass) {
      process.stderr.write('[error] Live verify FAIL — the edit did not appear on the public page.\n');
      process.stderr.write('        Check the public URL manually. The CP POST may have succeeded\n');
      process.stderr.write('        but the EE page cache has not flushed. Do not mark this done.\n');
      process.exit(1);
    }
    process.stdout.write('[done] Edit applied and live-verified: PASS\n');
  } catch (err) {
    process.stderr.write(`[error] Live verify failed:\n${err.message}\n`);
    process.exit(1);
  }
}

main().catch(err => {
  process.stderr.write(`[fatal] Unhandled error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
