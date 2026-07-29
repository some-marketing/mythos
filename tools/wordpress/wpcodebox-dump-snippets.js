#!/usr/bin/env node
'use strict';

/**
 * wpcodebox-dump-snippets.js — READ-ONLY WPCodeBox 2 snippet auditor.
 *
 * Authenticates to a WordPress admin (credentials pulled from 1Password at
 * runtime — bytes never pass through argv or this process's output) and pulls
 * the full WPCodeBox 2 snippet set via the plugin's own local API
 * (`admin.php?page=wpcodebox2&wpcb2_route=/acs/snippets`, headers
 * `X-Wpcb-Authorization: <WPCB_NONCE>` + `X-Wpcb-Secret: <WPCB_SECRET>`).
 *
 * READ-ONLY BY CONSTRUCTION: the only endpoint this tool ever calls is the
 * GET snippets-list route. It never POSTs/PUTs/DELETEs, never touches a write
 * route, and never edits the backend. Use it to find which snippet contains a
 * string (e.g. an attribution value) without exporting through the UI.
 *
 * Why this exists: WPCodeBox stores snippet bodies server-side (no public REST
 * namespace), so a string like `organic_paid` is invisible to anonymous probes
 * and to `grep` over the repo. This is the sanctioned authenticated read path.
 *
 * Usage:
 *   # Registered site (see SITES below -- empty by default; add your own):
 *   node tools/wordpress/wpcodebox-dump-snippets.js --site my-site --grep organic_paid
 *
 *   # Ad-hoc site (no registration needed):
 *   node tools/wordpress/wpcodebox-dump-snippets.js \
 *     --base-url https://example.com --op-item "Example WP" --op-vault Personal --grep utm_source
 *
 * Options:
 *   --site <name>        Registered site (see SITES below)
 *   --base-url <url>     Site origin (ad-hoc; with --op-item)
 *   --op-item <name>     1Password item holding the WP admin login
 *   --op-vault <vault>   1Password vault (default: Personal)
 *   --grep <pattern>     Case-insensitive regex; reports matching snippets + lines (no full-body dump)
 *   --out <file>         Write the full snippet JSON to <file> (explicit opt-in; contains client code)
 *   --json               Print the summary as JSON instead of a table
 *   --help
 *
 * Requires: the `op` 1Password CLI signed in (op whoami) with access to the vault.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Known sites — extend as needed. Keep creds in 1Password, never inline.
// Empty by default; add your own sites here, or use --base-url/--op-item for
// an ad-hoc site with no registration needed. Example shape:
//   'my-site': { baseUrl: 'https://www.my-site.example', opItem: 'My Site WP Admin', opVault: 'Personal' },
const SITES = {};

function parseArgs(argv) {
  const o = { opVault: 'Personal' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--site') o.site = argv[++i];
    else if (a === '--base-url') o.baseUrl = argv[++i];
    else if (a === '--op-item') o.opItem = argv[++i];
    else if (a === '--op-vault') o.opVault = argv[++i];
    else if (a === '--grep') o.grep = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--json') o.json = true;
    else if (a === '--help' || a === '-h') o.help = true;
  }
  return o;
}

function op(args) {
  // Runs the 1Password CLI on-device; returns trimmed stdout. Secret bytes stay here.
  return execFileSync('op', args, { encoding: 'utf8' }).trim();
}

// Resolve the USERNAME/PASSWORD fields of a login item by their 1Password purpose,
// then read their values. Handles items with non-standard labels (log/pwd vs username/password).
function readLogin(item, vault) {
  const meta = JSON.parse(op(['item', 'get', item, '--vault', vault, '--format', 'json']));
  const fields = meta.fields || [];
  const byPurpose = (p) => fields.find((f) => f.purpose === p);
  const uf = byPurpose('USERNAME');
  const pf = byPurpose('PASSWORD');
  if (!uf || !pf) throw new Error(`item "${item}" missing USERNAME/PASSWORD fields`);
  const user = op(['read', `op://${vault}/${item}/${uf.label}`]);
  const pass = op(['read', `op://${vault}/${item}/${pf.label}`]);
  return { user, pass };
}

function cookieHeaderFrom(setCookies) {
  // Keep only the pairs we need for an authenticated session.
  const jar = {};
  for (const sc of setCookies) {
    const pair = sc.split(';', 1)[0];
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function login(baseUrl, user, pass) {
  const body = new URLSearchParams();
  body.set('log', user);
  body.set('pwd', pass);
  body.set('wp-submit', 'Log In');
  body.set('redirect_to', `${baseUrl}/wp-admin/`);
  body.set('testcookie', '1');
  const res = await fetch(`${baseUrl}/wp-login.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0', 'Cookie': 'wordpress_test_cookie=WP+Cookie+check' },
    body: body.toString(),
    redirect: 'manual',
  });
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  const cookie = cookieHeaderFrom(setCookies);
  if (!/wordpress_logged_in/.test(cookie)) throw new Error('login failed (no wordpress_logged_in cookie)');
  return cookie;
}

function extract(html, key) {
  const m = html.match(new RegExp(`${key}\\s*=\\s*'([^']*)'`));
  return m ? m[1] : null;
}

async function pullSnippets(baseUrl, cookie) {
  const adminUrl = `${baseUrl}/wp-admin/admin.php?page=wpcodebox2`;
  const page = await (await fetch(adminUrl, { headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0' } })).text();
  const nonce = extract(page, 'WPCB_NONCE');
  const secret = extract(page, 'WPCB_SECRET');
  if (!nonce || !secret) throw new Error('could not read WPCB_NONCE/WPCB_SECRET (is WPCodeBox 2 active and the user an admin?)');
  // The ONLY route this tool ever calls — read-only list of snippets.
  const res = await fetch(`${adminUrl}&wpcb2_route=/acs/snippets`, {
    headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0', 'X-Wpcb-Authorization': nonce, 'X-Wpcb-Secret': secret },
  });
  const data = await res.json();
  return Array.isArray(data) ? data : (data.snippets || data.data || []);
}

function bodyOf(s) {
  return ['code', 'content', 'php_code', 'body', 'js_code', 'css_code'].map((k) => s[k] || '').join('\n');
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || (!o.site && !(o.baseUrl && o.opItem))) {
    console.log('Usage: node tools/wordpress/wpcodebox-dump-snippets.js --site <name> [--grep <pat>] [--out <file>]');
    console.log('       (or --base-url <url> --op-item <name> [--op-vault Personal])');
    console.log('Registered sites:', Object.keys(SITES).join(', '));
    process.exit(o.help ? 0 : 2);
  }
  const cfg = o.site ? SITES[o.site] : { baseUrl: o.baseUrl, opItem: o.opItem, opVault: o.opVault };
  if (!cfg) { console.error(`unknown --site "${o.site}". Known: ${Object.keys(SITES).join(', ')}`); process.exit(2); }

  (async () => {
    const { user, pass } = readLogin(cfg.opItem, cfg.opVault);
    const cookie = await login(cfg.baseUrl, user, pass);
    const snippets = await pullSnippets(cfg.baseUrl, cookie);

    if (o.out) {
      fs.writeFileSync(o.out, JSON.stringify(snippets, null, 2));
      console.error(`[wrote ${snippets.length} snippets -> ${o.out}]`);
    }

    const re = o.grep ? new RegExp(o.grep, 'i') : null;
    const rows = snippets.map((s) => {
      const hit = re ? re.test(bodyOf(s)) : undefined;
      return { id: s.id, enabled: !!s.enabled, title: s.title, hit };
    });

    if (o.json) { console.log(JSON.stringify(rows, null, 2)); return; }

    console.log(`${cfg.baseUrl} — ${snippets.length} WPCodeBox snippets${re ? ` (grep /${o.grep}/i)` : ''}`);
    for (const r of rows) {
      const flag = r.hit === true ? '  <<< MATCH' : '';
      console.log(`  #${String(r.id).padStart(3)} [${r.enabled ? 'ON ' : 'off'}] ${r.title}${flag}`);
    }
    if (re) {
      for (const s of snippets) {
        const body = bodyOf(s);
        if (!re.test(body)) continue;
        console.log(`\n--- #${s.id} "${s.title}" matching lines ---`);
        body.split('\n').forEach((ln, i) => { if (re.test(ln)) console.log(`  L${i + 1}: ${ln.trim().slice(0, 180)}`); });
      }
    }
  })().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}

main();
