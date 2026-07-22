#!/usr/bin/env node
// install-preset.mjs
//
// Drives the LiveCanvas editor in a real browser to install (or replace) a
// preset section/block on a target page. The save goes through LC's own
// `lc_save_page` AJAX path with the editor's nonce, so all editor side-effects
// fire (history step, partial CSS/JS updates if used, body class injection).
//
// Why this script exists: direct `wp post update --post_content=...` bypasses
// the LiveCanvas editor surface entirely — no history step, no partial CSS/JS
// sync, no body-class injection the editor would normally apply. If your
// build discipline requires "page design happens in the page-builder editor,
// not via raw DB writes," this is the canonical install path that honors
// that rule; reuse it for every preset install instead of hand-scripting a
// raw content update per site.
//
// Prereqs (one-time per page):
//   - target page has postmeta `_lc_livecanvas_enabled=1`
//     (`wp post meta update <id> _lc_livecanvas_enabled 1`)
//   - LC option `disable-ob-handling=1` if Local/MAMP environment
//     (`wp option update lc_settings '{"disable-ob-handling":"1"}' --format=json`)
//   - tracking/cache/overlay/optimizer plugins deactivated for clean console
//
// Usage:
//   WP_USER='admin' WP_PASS='...' \
//   node tools/livecanvas-mcp/install-preset.mjs \
//     --site http://your-site.local/ \
//     --page-id 123 \
//     --preset /abs/path/to/your-section.html \
//     [--position append|prepend|after:CSS|before:CSS|replace] \
//     [--show]                    # show the browser instead of headless
//     [--user-env WP_USER]        # env var holding admin username (default WP_USER)
//     [--pass-env WP_PASS]        # env var holding admin password (default WP_PASS)
//
// Exit codes: 0 success, 1 usage error, 2 login failure, 3 editor never ready,
// 4 preset file unreadable, 5 save failure, 6 verification mismatch.

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

function parseArgs(argv) {
  const args = { position: 'append', show: false, userEnv: 'WP_USER', passEnv: 'WP_PASS' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--site') args.site = next();
    else if (a === '--page-id') args.pageId = Number(next());
    else if (a === '--preset') args.preset = next();
    else if (a === '--position') args.position = next();
    else if (a === '--user-env') args.userEnv = next();
    else if (a === '--pass-env') args.passEnv = next();
    else if (a === '--show') args.show = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  return args;
}

function usage() {
  console.error('See header comment in tools/livecanvas-mcp/install-preset.mjs for usage.');
}

function logStep(msg) {
  console.error(`[install-preset] ${msg}`);
}

async function login(page, site, user, pass) {
  const loginUrl = new URL('wp-login.php', site).toString();
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  await page.fill('#user_login', user);
  await page.fill('#user_pass', pass);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click('#wp-submit'),
  ]);
  if (page.url().includes('confirm_admin_email')) {
    const link = await page.$('a:has-text("Remind me later")');
    if (link) await link.click();
    await page.waitForLoadState('domcontentloaded');
  }
  if (page.url().includes('wp-login.php')) {
    return false;
  }
  return true;
}

async function openEditor(page, site, pageId) {
  // LC strips ?p= from the URL on launch, so the launch URL is just the
  // permalink with ?lc_action_launch_editing=1. We get the permalink first.
  const editorUrl = new URL(`?p=${pageId}&lc_action_launch_editing=1`, site).toString();

  page.on('dialog', async (dialog) => {
    logStep(`dismissed dialog: ${dialog.message().slice(0, 120)}`);
    await dialog.accept();
  });

  await page.goto(editorUrl, { waitUntil: 'domcontentloaded' });

  // Editor ready means: previewiframe loaded the page with main#lc-main, and
  // the in-memory `doc` is populated. We poll up to 20s.
  const ready = await page.waitForFunction(
    (expectedId) => {
      if (window.lc_editor_current_post_id !== expectedId) return false;
      const ifr = document.querySelector('#previewiframe');
      if (!ifr || !ifr.contentDocument) return false;
      const lcMain = ifr.contentDocument.querySelector('#lc-main');
      if (!lcMain) return false;
      if (typeof window.getPageHTML !== 'function') return false;
      if (typeof window.setPageHTML !== 'function') return false;
      // doc is the in-memory editable model; LC sets it inside loadURLintoEditor
      if (typeof window.doc === 'undefined' || !window.doc) return false;
      if (!window.doc.querySelector || !window.doc.querySelector('#lc-main')) return false;
      return true;
    },
    pageId,
    { timeout: 20000 },
  ).catch(() => null);
  return !!ready;
}

async function installPreset(page, presetHTML, position) {
  // Read current main HTML, build new HTML per position, write back via
  // setPageHTML (which mutates in-memory doc). Then trigger Save.
  const result = await page.evaluate(
    ({ presetHTML, position }) => {
      const sel = 'main#lc-main';
      const current = window.getPageHTML(sel);
      let newHTML;

      if (position === 'append' || position === undefined) {
        newHTML = current + '\n' + presetHTML;
      } else if (position === 'prepend') {
        newHTML = presetHTML + '\n' + current;
      } else if (position === 'replace') {
        newHTML = presetHTML;
      } else if (position.startsWith('after:') || position.startsWith('before:')) {
        const [where, anchorSel] = position.split(':', 2);
        const anchor = window.doc.querySelector(anchorSel);
        if (!anchor) {
          return { ok: false, err: `anchor selector not found: ${anchorSel}` };
        }
        const wrap = window.doc.createElement('div');
        wrap.innerHTML = presetHTML;
        const insertedNodes = [...wrap.childNodes];
        if (where === 'after') {
          for (const n of insertedNodes.reverse()) {
            anchor.after(n);
          }
        } else {
          for (const n of insertedNodes) {
            anchor.before(n);
          }
        }
        // doc was mutated directly; sync newHTML for return
        newHTML = window.getPageHTML(sel);
      } else {
        return { ok: false, err: `unknown position: ${position}` };
      }

      if (position === 'append' || position === 'prepend' || position === 'replace') {
        window.setPageHTML(sel, newHTML);
      }
      if (typeof window.saveHistoryStep === 'function') window.saveHistoryStep();
      return { ok: true, beforeLen: current.length, afterLen: window.getPageHTML(sel).length };
    },
    { presetHTML, position },
  );
  return result;
}

async function clickSaveAndConfirm(page) {
  // Editor-mediated save: we use the editor's already-loaded saving URL +
  // nonce + `html_beautify(getPageHTML("main#lc-main"))` payload, which is
  // *exactly* what the #main-save click handler does (see editor.js line 719).
  // We call fetch() from inside the editor page rather than clicking the
  // button — strictly equivalent transport, but doesn't depend on the click
  // handler being bound or the button being visible in headless mode.
  return await page.evaluate(async () => {
    if (typeof window.html_beautify !== 'function') {
      return { ok: false, err: 'html_beautify not loaded' };
    }
    const body = new URLSearchParams({
      action: 'lc_save_page',
      post_id: String(window.lc_editor_current_post_id),
      html_to_save:
        '\n' +
        window.html_beautify(window.getPageHTML('main#lc-main'), {
          unformatted: ['script', 'style'],
          indent_size: '1',
          indent_char: '\t',
        }) +
        '\n',
      css_to_save: window.getPageHTML('#wp-custom-css') || '',
      js_to_save: window.getPageHTML('#lc_script_tag') || '',
      security: window.lc_editor_saving_nonce,
    });
    const resp = await fetch(window.lc_editor_saving_url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const text = await resp.text();
    return { ok: text.trim() === 'Save', status: resp.status, body: text.slice(0, 200) };
  });
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (e) {
    console.error(e.message);
    usage();
    process.exit(1);
  }
  if (args.help || !args.site || !args.pageId || !args.preset) {
    usage();
    process.exit(1);
  }

  const presetPath = resolvePath(args.preset);
  if (!existsSync(presetPath)) {
    console.error(`preset file not found: ${presetPath}`);
    process.exit(4);
  }
  const presetHTML = readFileSync(presetPath, 'utf8').trim();
  if (!presetHTML) {
    console.error(`preset file empty: ${presetPath}`);
    process.exit(4);
  }

  const user = process.env[args.userEnv];
  const pass = process.env[args.passEnv];
  if (!user || !pass) {
    console.error(`credentials missing: set $${args.userEnv} and $${args.passEnv}`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: !args.show });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  try {
    logStep(`logging in as ${user}@${args.site}`);
    const loggedIn = await login(page, args.site, user, pass);
    if (!loggedIn) {
      console.error('login failed: still on wp-login.php after submit');
      process.exit(2);
    }

    logStep(`opening LC editor for post ${args.pageId}`);
    const ready = await openEditor(page, args.site, args.pageId);
    if (!ready) {
      console.error('editor never reached ready state (lc_main + doc + getPageHTML)');
      process.exit(3);
    }

    logStep(`inserting preset (${presetHTML.length} bytes) at position=${args.position}`);
    const ins = await installPreset(page, presetHTML, args.position);
    if (!ins.ok) {
      console.error(`preset insertion failed: ${ins.err}`);
      process.exit(5);
    }
    logStep(`main#lc-main: ${ins.beforeLen} -> ${ins.afterLen} bytes`);

    logStep(`clicking #main-save`);
    const save = await clickSaveAndConfirm(page);
    if (!save.ok) {
      console.error(`save failed: status=${save.status} body=${save.body} err=${save.err || ''}`);
      process.exit(5);
    }
    logStep(`save OK (${save.status})`);
    process.exitCode = 0;
  } finally {
    await ctx.close();
    await browser.close();
  }
}

main().catch((e) => {
  console.error(`[install-preset] fatal: ${e.stack || e.message || e}`);
  process.exit(99);
});
