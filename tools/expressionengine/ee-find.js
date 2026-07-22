#!/usr/bin/env node
'use strict';

/**
 * ee-find.js — S7: Read-only entry-discovery CLI for the EE CP.
 *
 * Two modes:
 *
 *   --find-entry --title <substring>
 *     Authenticates, GETs the CP entry listing, returns entries whose titles
 *     contain the substring. Optional --channel-id to scope by channel.
 *
 *   --list-fields --entry-id <N>
 *     Authenticates, GETs the entry-edit page, prints all field_id_N inputs
 *     with a short value excerpt. Optional --contains <string> identifies
 *     which field holds the string (entity-decoded, so & matches &amp;).
 *
 * READ-ONLY. No POST is ever issued. No credentials, cookies, or XID/CSRF
 * tokens are printed to stdout.
 *
 * Env-var override (CI / test — skips 1Password):
 *   EE_URL, EE_USERNAME, EE_PASSWORD
 *
 * Usage:
 *
 *   # Find entries by title substring (all channels):
 *   node tools/expressionengine/ee-find.js --find-entry --title "Nadia"
 *
 *   # Find entries filtered to a specific channel:
 *   node tools/expressionengine/ee-find.js --find-entry --title "Kegan" --channel-id 7
 *
 *   # List all fields on entry 42:
 *   node tools/expressionengine/ee-find.js --list-fields --entry-id 42
 *
 *   # Find which field on entry 42 contains the given string:
 *   node tools/expressionengine/ee-find.js --list-fields --entry-id 42 \
 *     --contains "Antigonish & Guysborough"
 *
 *   # Debug: save listing HTML to _dev/debug/ for selector inspection:
 *   node tools/expressionengine/ee-find.js --find-entry --title "Nadia" --debug-html
 *
 * CREDENTIAL RULE: same as ee-edit.js — the password from resolveEECreds()
 * is never printed, logged, or serialized.
 *
 * No external npm dependencies.
 */

const { resolveEECreds, loginToCP } = require('./lib/ee-auth');
const { searchByTitle, locateField } = require('./lib/ee-find-entry');

// ─── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--find-entry')  { args.findEntry  = true; continue; }
    if (a === '--list-fields') { args.listFields = true; continue; }
    if (a === '--verbose')     { args.verbose    = true; continue; }
    if (a === '--debug-html')  { args.debugHtml  = true; continue; }
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
  # Discover entries by title substring:
  node tools/expressionengine/ee-find.js \\
    --find-entry \\
    --title "<substring>" \\
    [--channel-id <N>] \\
    [--debug-html]

  # List fields on a known entry (+ optionally locate a field by value):
  node tools/expressionengine/ee-find.js \\
    --list-fields \\
    --entry-id <N> \\
    [--contains "<string to find in field value>"]

  Env-var overrides (skip 1Password):
    EE_URL, EE_USERNAME, EE_PASSWORD

Examples:
  # Find Nadia and Kegan entries:
  node tools/expressionengine/ee-find.js --find-entry --title "Nadia"
  node tools/expressionengine/ee-find.js --find-entry --title "Kegan"

  # List fields on entry 42 and find which one holds the bio location string:
  node tools/expressionengine/ee-find.js \\
    --list-fields --entry-id 42 \\
    --contains "Antigonish & Guysborough"

⚠️  PARSER NOTE: The EE CP listing markup parser is best-effort against EE 6/7
conventions. If --find-entry returns empty results, run with --debug-html to
capture the listing HTML to _dev/debug/ee-find-listing.html and inspect it.
See README for the one-line selector fix pattern.
`;
}

// ─── Output helpers ───────────────────────────────────────────────────────────

function printEntries(entries, titleSubstr) {
  if (entries.length === 0) {
    process.stdout.write(
      `[find] No entries found matching title "${titleSubstr}".\n` +
      '       If this is unexpected, run with --debug-html and inspect the\n' +
      '       listing HTML — the CP markup may differ from the assumed EE 6/7 structure.\n'
    );
    return;
  }
  process.stdout.write(`[find] ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} found:\n\n`);
  for (const e of entries) {
    process.stdout.write(`  entry_id:   ${e.entry_id}\n`);
    process.stdout.write(`  channel_id: ${e.channel_id !== null ? e.channel_id : '(not parsed)'}\n`);
    process.stdout.write(`  title:      ${e.title}\n`);
    process.stdout.write(`  edit_url:   ${e.edit_url}\n`);
    process.stdout.write('\n');
  }
}

function printFields(result, containsStr) {
  const { entry_id, fields, match } = result;
  if (fields.length === 0) {
    process.stdout.write(
      `[fields] No field_id_N inputs found on entry ${entry_id}.\n` +
      '         Run with --debug-html on ee-edit.js to inspect the edit page HTML.\n'
    );
    return;
  }
  process.stdout.write(`[fields] Entry ${entry_id} — ${fields.length} field(s) found:\n\n`);
  for (const f of fields) {
    const marker = match && f.field_name === match.field_name ? '  ← MATCH' : '';
    process.stdout.write(`  ${f.field_name}  [${f.type}]${marker}\n`);
    process.stdout.write(`    excerpt: ${JSON.stringify(f.value_excerpt)}\n`);
  }
  process.stdout.write('\n');

  if (containsStr) {
    if (match) {
      process.stdout.write(
        `[find]  Field "${match.field_name}" contains "${containsStr}" — use this as --field-name in ee-edit.js.\n`
      );
    } else {
      process.stdout.write(
        `[find]  No field found containing "${containsStr}".\n` +
        '        Check entity encoding: "&" in your search matches decoded "&amp;" in the HTML.\n' +
        '        If no match still, the field may be a Fluid/Grid type not visible as a plain input.\n'
      );
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || (!args.findEntry && !args.listFields)) {
    process.stdout.write(usage());
    process.exit(0);
  }

  const verbose   = args.verbose   || false;
  const debugHtml = args.debugHtml || false;

  // ── S2: Resolve credentials ───────────────────────────────────────────────
  let creds;
  try {
    creds = resolveEECreds();
    if (verbose) process.stdout.write(`[auth] Credentials resolved (source: ${creds._source})\n`);
  } catch (err) {
    process.stderr.write(`[error] Credential resolution failed:\n${err.message}\n`);
    process.exit(1);
  }

  // ── S3: Login to CP ───────────────────────────────────────────────────────
  let loginCtx;
  try {
    if (verbose) process.stdout.write('[auth] Logging in to EE CP…\n');
    loginCtx = await loginToCP(creds);
    if (verbose) process.stdout.write('[auth] Login successful.\n');
  } catch (err) {
    process.stderr.write(`[error] EE CP login failed:\n${err.message}\n`);
    process.exit(1);
  }
  const { cookies, loginUrl } = loginCtx;

  // ── Mode: --find-entry ────────────────────────────────────────────────────
  if (args.findEntry) {
    const title = args.title || '';
    if (!title) {
      process.stderr.write('[error] --title is required with --find-entry.\n');
      process.exit(1);
    }
    const channelId = args.channelId ? parseInt(args.channelId, 10) : null;

    let entries;
    try {
      entries = await searchByTitle(loginUrl, cookies, title, channelId, debugHtml);
    } catch (err) {
      process.stderr.write(`[error] Entry search failed:\n${err.message}\n`);
      process.exit(1);
    }
    printEntries(entries, title);
    process.exit(0);
  }

  // ── Mode: --list-fields ───────────────────────────────────────────────────
  if (args.listFields) {
    const entryId = parseInt(args.entryId, 10);
    if (isNaN(entryId)) {
      process.stderr.write('[error] --entry-id is required with --list-fields.\n');
      process.exit(1);
    }
    const containsStr = args.contains || null;

    let result;
    try {
      result = await locateField(loginUrl, cookies, entryId, containsStr);
    } catch (err) {
      process.stderr.write(`[error] Field locator failed:\n${err.message}\n`);
      process.exit(1);
    }
    printFields(result, containsStr);
    process.exit(0);
  }
}

main().catch(err => {
  process.stderr.write(`[fatal] Unhandled error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
