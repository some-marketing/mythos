#!/usr/bin/env node
'use strict';

/**
 * download.cjs — Depositphotos LICENSED DOWNLOAD CLI.
 *
 * This is the credit-CONSUMING counterpart to scout.cjs. scout.cjs is
 * explicitly documented as having "NO download or licensing code paths" —
 * this file exists precisely so that invariant can stay true. Do not add
 * download logic to scout.cjs; do not add scouting/search logic here.
 *
 * PRIMARY PATH: Depositphotos Partner API (lib/depositphotos-api-client.cjs).
 * Confirmed via api.depositphotos.com/doc/classes/API.Purchase.html: getMedia
 * supports dp_purchase_currency=subscription — downloading a file by ID under
 * an active subscription (e.g. All-In-One) is a documented API capability,
 * not just search. Credentials (API key + account login/password — this API
 * predates modern OAuth2 bearer tokens, see the client module header) are
 * resolved via run-with-op.sh, which delegates to the shared
 * tools/lib/resolve-credential.cjs 4-source chain (env / Keychain /
 * 1Password / env-file). No credential bytes ever appear in argv,
 * stdout, or a committed file.
 *
 * FALLBACK PATH (documented, opt-in, NOT primary): the Playwright
 * headed-session flow using lib/auth/session.cjs + lib/adapters/depositphotos.cjs
 * (the same session store scout.cjs uses for --login). Use only if the API
 * path is unavailable for this account. Enable with --use-session-fallback.
 *
 * CHROME-PROFILE PATH (documented, opt-in, NOT primary): --use-chrome-profile
 * drives the browser download flow inside a persistent Chrome profile via
 * chromium.launchPersistentContext. This is the route for accounts whose
 * ONLY login is OAuth ("Sign in with Google"), where there is no API key /
 * password to resolve. The persistent profile (default:
 * ~/Library/Application Support/Chrome-Automation-StockScout, "Default",
 * signed into the operator's Google account) supplies an already-authenticated
 * Google session, so the Depositphotos "Continue with Google" handshake
 * completes without a fresh login. Config is env-overridable:
 * STOCK_SCOUT_CHROME_USER_DATA_DIR / STOCK_SCOUT_CHROME_PROFILE
 * (or --chrome-user-data-dir / --chrome-profile).
 *
 *   FedCM GOTCHA (load-bearing): Depositphotos renders "Continue with Google"
 *   as a Google Identity Services (GIS) iframe with FedCM enabled. When FedCM
 *   is active, Chrome shows a NATIVE account-picker dialog that is browser UI,
 *   not page DOM — Playwright cannot see or click it, so the login silently
 *   stalls. We launch with --disable-features=FedCm, which makes GIS fall back
 *   to the classic in-page flow that completes automatically against the
 *   existing Google session. Do not remove that flag.
 *
 *   This path performs SUBSCRIPTION downloads only (the "Download Image"
 *   button under "DOWNLOAD USING: All-In-One"); it never clicks a purchase
 *   control ($ / Buy Now / Get now / Go Unlimited / subscribe) and skips any
 *   image whose only path is a purchase, reporting it instead.
 *
 * Guardrails enforced by this tool:
 *   - Only image ids present in a --manifest file with approved:true may be
 *     downloaded (see lib/manifest.cjs). There is no code path to download an
 *     arbitrary id passed on the command line.
 *   - Idempotent: images already present in --dest (by target filename) are
 *     skipped and reported, not re-downloaded.
 *   - Rate-limited: sequential downloads with a short delay between requests.
 *   - Auditable: writes/updates download-receipt.json in --dest recording
 *     every completed download (credit-spend audit trail).
 *   - Safe-by-default: --dry-run prints the plan and exits without any
 *     network/credential access. A live run without valid credentials fails
 *     fast with setup instructions; it never prompts for or attempts to mint
 *     credentials itself.
 *
 * Usage:
 *   node download.cjs --manifest <path> --dest <dir> --dry-run
 *   tools/stock-image-scout/run-with-op.sh node download.cjs --manifest <path> --dest <dir> [--limit N]
 *   node download.cjs --manifest <path> --dest <dir> --use-session-fallback [--limit N]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadManifest } = require('./lib/manifest.cjs');
const { buildDownloadPlan, buildReceiptEntry, buildReceiptDocument, loadExistingReceipt, receiptPathFor } = require('./lib/download-plan.cjs');
const dpApi = require('./lib/depositphotos-api-client.cjs');
const sessionHelper = require('./lib/auth/session.cjs');
const depositphotosAdapter = require('./lib/adapters/depositphotos.cjs');

const DOWNLOAD_DELAY_MS = 2500;

// Chrome-profile path defaults. The persistent profile is signed into the
// operator's Google account, which is what lets the Depositphotos OAuth
// ("Continue with Google") handshake complete headlessly.
const CHROME_PROFILE_DEFAULTS = {
  userDataDir: '~/Library/Application Support/Chrome-Automation-StockScout',
  profile: 'Default',
  channel: 'chrome'
};

// Text that marks a PURCHASE / credit-spend control (never click) vs. a
// SUBSCRIPTION download control (the authorized path for approved images).
const PURCHASE_TEXT_RX = /\$|buy now|get now|get this image|go unlimited|subscribe\b|credit|purchase|checkout|add to cart|upgrade plan|pricing/i;
const DOWNLOAD_TEXT_RX = /^\s*download\b|download using|download image|download file|free download/i;

/** Expand a leading ~ to the user's home directory. */
function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Resolve Chrome-profile config from CLI overrides, then env, then defaults.
 * Kept pure (no filesystem/browser access) so it is unit-testable offline.
 */
function resolveChromeProfileConfig(params = {}) {
  return {
    userDataDir: expandHome(
      params.chromeUserDataDir ||
      process.env.STOCK_SCOUT_CHROME_USER_DATA_DIR ||
      CHROME_PROFILE_DEFAULTS.userDataDir
    ),
    profile:
      params.chromeProfile ||
      process.env.STOCK_SCOUT_CHROME_PROFILE ||
      CHROME_PROFILE_DEFAULTS.profile,
    channel: process.env.STOCK_SCOUT_CHROME_CHANNEL || CHROME_PROFILE_DEFAULTS.channel
  };
}

/**
 * Decide which download path a set of parsed args selects, without any side
 * effects. chrome-profile wins over session-fallback wins over api (the
 * default). Exported so argument routing can be tested without a browser.
 */
function selectDownloadPath(params = {}) {
  if (params.useChromeProfile) return 'chrome-profile';
  if (params.useSessionFallback) return 'session-fallback';
  return 'api';
}

function printHelp() {
  console.log(`
Stock Image Scout — Depositphotos Licensed Download CLI
(Credit-consuming. Manifest-authorized downloads only.)

Usage:
  node download.cjs --manifest <path> --dest <dir> --dry-run
  tools/stock-image-scout/run-with-op.sh node download.cjs --manifest <path> --dest <dir> [--limit N]

Options:
  --manifest <path>        Required. Path to an approved-image JSON manifest
                            (see lib/manifest.cjs for schema). Only images
                            with approved:true in this file may be downloaded.
  --dest <dir>              Required. Output directory for downloaded images
                            and the download-receipt.json audit trail.
  --dry-run                 List what WOULD be downloaded and exit. No
                            network/credential access, nothing downloaded.
  --limit <n>                Cap the number of NEW downloads this run (safety).
  --use-session-fallback     Use the Playwright saved-session flow instead of
                            the Depositphotos API. Documented fallback only —
                            requires a session from
                            "scout.cjs --login --provider depositphotos".
  --use-chrome-profile       Drive the browser download inside a persistent
                            Chrome profile (OAuth "Sign in with Google" accounts
                            with no API key). launchPersistentContext with
                            --disable-features=FedCm. Precedence over
                            --use-session-fallback.
  --chrome-user-data-dir <dir>  Override Chrome user-data-dir for
                            --use-chrome-profile (env
                            STOCK_SCOUT_CHROME_USER_DATA_DIR; default
                            ~/Library/Application Support/Chrome-Automation-StockScout).
  --chrome-profile <name>    Override Chrome profile dir name for
                            --use-chrome-profile (env STOCK_SCOUT_CHROME_PROFILE;
                            default "Default").
  -h, --help                 Show help.

Live API run — credentials resolved from 1Password/Keychain/env, never argv:
  tools/stock-image-scout/run-with-op.sh node tools/stock-image-scout/download.cjs \\
    --manifest <path> --dest <dir> --limit 1
`);
}

function parseArgs(argv) {
  const params = {
    manifest: '',
    dest: '',
    dryRun: false,
    limit: null,
    useSessionFallback: false,
    useChromeProfile: false,
    chromeUserDataDir: '',
    chromeProfile: '',
    help: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--manifest') {
      params.manifest = argv[++i];
    } else if (arg === '--dest') {
      params.dest = argv[++i];
    } else if (arg === '--dry-run') {
      params.dryRun = true;
    } else if (arg === '--limit') {
      params.limit = parseInt(argv[++i], 10);
    } else if (arg === '--use-session-fallback') {
      params.useSessionFallback = true;
    } else if (arg === '--use-chrome-profile') {
      params.useChromeProfile = true;
    } else if (arg === '--chrome-user-data-dir') {
      params.chromeUserDataDir = argv[++i];
    } else if (arg === '--chrome-profile') {
      params.chromeProfile = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      params.help = true;
    }
  }
  return params;
}

/**
 * PRIMARY PATH — Depositphotos Partner API.
 * LIVE-VALIDATION-REQUIRED: login()/getMediaDownloadLink() response parsing
 * (see lib/depositphotos-api-client.cjs header). The request-URL builders
 * they call are fully determined by documented parameter names and are
 * unit-tested exactly; only the response envelope shape is unconfirmed.
 */
async function runApiDownloads(pendingPlanEntries, destDir, credentials) {
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is not available in this Node runtime (need Node 18+).');
  }

  const { sessionId } = await dpApi.login(fetchImpl, credentials);
  const completedEntries = [];

  for (const entry of pendingPlanEntries) {
    console.log(`Downloading id=${entry.id} -> ${entry.filename} ...`);
    try {
      const { downloadLink } = await dpApi.getMediaDownloadLink(fetchImpl, {
        baseUrl: credentials.baseUrl,
        apiKey: credentials.apiKey,
        sessionId,
        mediaId: entry.id
      });
      const { buffer, contentType } = await dpApi.fetchAssetBytes(fetchImpl, downloadLink);
      const ext = dpApi.extensionForContentType(contentType);
      const filename = ext === 'jpg' ? entry.filename : entry.filename.replace(/\.jpg$/, `.${ext}`);
      const destPath = path.join(destDir, filename);
      fs.writeFileSync(destPath, buffer);

      completedEntries.push(buildReceiptEntry({
        id: entry.id,
        title: entry.title,
        page_url: entry.page_url,
        filename,
        fileSizeBytes: buffer.length,
        nowIso: new Date().toISOString()
      }));
      console.log(`  OK (${buffer.length} bytes)`);
    } catch (err) {
      console.error(`  FAILED id=${entry.id}: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, DOWNLOAD_DELAY_MS));
  }

  return completedEntries;
}

/**
 * FALLBACK PATH (documented, opt-in) — Playwright saved-session flow.
 * LIVE-VALIDATION-REQUIRED: this function drives the actual Depositphotos
 * logged-in download flow via Playwright: navigate to the photo page,
 * trigger the plan/download action, capture the resulting file. It has NOT
 * been exercised against a live Depositphotos session and its selectors are
 * best-effort based on the adapter's checkSession() signals (e.g. "DOWNLOAD
 * USING: All-In-One" text). Only reached with --use-session-fallback.
 */
async function downloadOneImageLiveViaSession(page, image, destDir, filename) {
  await page.goto(image.page_url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const downloadButtonSelector = 'button:has-text("Download"), a:has-text("Download")';
  await page.waitForSelector(downloadButtonSelector, { timeout: 15000 });

  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.click(downloadButtonSelector);

  const allInOneOptionSelector = 'text=/All-In-One/i';
  try {
    await page.waitForSelector(allInOneOptionSelector, { timeout: 5000 });
    await page.click(allInOneOptionSelector);
  } catch (e) {
    // No plan picker shown — download may have started directly.
  }

  const download = await downloadPromise;
  const destPath = path.join(destDir, filename);
  await download.saveAs(destPath);

  const stats = fs.statSync(destPath);
  return { filePath: destPath, fileSizeBytes: stats.size };
}

async function runSessionFallbackDownloads(pendingPlanEntries, manifestImagesById, destDir) {
  if (!sessionHelper.hasSession('depositphotos')) {
    throw new Error(
      'No saved authenticated Depositphotos session found. Run: ' +
      'node tools/stock-image-scout/scout.cjs --login --provider depositphotos'
    );
  }

  const { chromium } = require('playwright');
  const sessionPath = sessionHelper.getStorageStatePath('depositphotos');
  console.warn(`[fallback] Launching headless browser using storageState: ${sessionPath}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: sessionPath, acceptDownloads: true });
  const page = await context.newPage();

  const completedEntries = [];

  try {
    await page.goto('https://depositphotos.com/', { waitUntil: 'domcontentloaded' });
    const sessionStatus = await depositphotosAdapter.checkSession(page);
    if (!sessionStatus.logged_in) {
      throw new Error('Session expired or invalid. Please re-run: node scout.cjs --login --provider depositphotos');
    }

    for (const entry of pendingPlanEntries) {
      const image = manifestImagesById.get(entry.id);
      console.log(`[fallback] Downloading id=${entry.id} -> ${entry.filename} ...`);
      try {
        const result = await downloadOneImageLiveViaSession(page, image, destDir, entry.filename);
        completedEntries.push(buildReceiptEntry({
          id: entry.id,
          title: entry.title,
          page_url: entry.page_url,
          filename: entry.filename,
          fileSizeBytes: result.fileSizeBytes,
          nowIso: new Date().toISOString()
        }));
        console.log(`  OK (${result.fileSizeBytes} bytes)`);
      } catch (err) {
        console.error(`  FAILED id=${entry.id}: ${err.message}`);
      }

      await new Promise(r => setTimeout(r, DOWNLOAD_DELAY_MS));
    }
  } finally {
    await browser.close();
  }

  return completedEntries;
}

/**
 * CHROME-PROFILE PATH (documented, opt-in) — persistent Chrome profile flow.
 * Reuses the operator's already-authenticated Google session (in the profile)
 * to satisfy Depositphotos' "Continue with Google" OAuth login, then performs
 * subscription downloads via the "Download Image" button. See the file header
 * for the FedCM gotcha (--disable-features=FedCm is load-bearing).
 * Validated live against a real client approved-image manifest.
 */
async function isLoggedInDepositphotos(page) {
  // The top-nav "Log In" control is present only when logged out.
  const logInCount = await page.locator('text=/^\\s*Log In\\s*$/i').count().catch(() => 0);
  return logInCount === 0;
}

async function downloadOneImageViaChromeProfile(page, image, destDir, filename) {
  await page.goto(image.page_url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);

  // Find the subscription download control (visible, download-text, not purchase).
  const controls = await page.evaluate(() => {
    const out = [];
    const clickableElements = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    for (const el of clickableElements) {
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (!t) continue;
      const r = el.getBoundingClientRect();
      out.push({ text: t.slice(0, 80), visible: r.width > 0 && r.height > 0, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    }
    return out;
  });
  const target = controls.find(c => c.visible && DOWNLOAD_TEXT_RX.test(c.text) && !PURCHASE_TEXT_RX.test(c.text));
  if (!target) {
    throw new Error('no subscription-download control found (only purchase paths) — skipped to avoid credit spend');
  }

  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.locator(`text=${JSON.stringify(target.text)}`).first().click({ timeout: 15000 })
    .catch(async () => { await page.mouse.click(target.x, target.y); });

  // If a plan picker appears, choose the All-In-One (subscription) option only.
  try {
    const picker = page.locator('text=/All-In-One/i').first();
    if (await picker.count()) await picker.click({ timeout: 4000 });
  } catch (_) { /* no picker — download may have started directly */ }

  const download = await downloadPromise;
  const destPath = path.join(destDir, filename);
  await download.saveAs(destPath);
  const stats = fs.statSync(destPath);
  return { filePath: destPath, fileSizeBytes: stats.size };
}

async function runChromeProfileDownloads(pendingPlanEntries, manifestImagesById, destDir, chromeCfg) {
  const { chromium } = require('playwright');
  if (!fs.existsSync(chromeCfg.userDataDir)) {
    throw new Error(
      `Chrome user-data-dir not found: ${chromeCfg.userDataDir}\n` +
      'Set STOCK_SCOUT_CHROME_USER_DATA_DIR (or --chrome-user-data-dir) to a profile ' +
      'signed into the Depositphotos-linked Google account.'
    );
  }

  console.warn(`[chrome-profile] Launching persistent context: ${chromeCfg.userDataDir} ("${chromeCfg.profile}")`);
  const context = await chromium.launchPersistentContext(chromeCfg.userDataDir, {
    channel: chromeCfg.channel,
    headless: false,
    acceptDownloads: true,
    viewport: { width: 1440, height: 960 },
    // --disable-features=FedCm is load-bearing: see file header FedCM GOTCHA.
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=FedCm',
      `--profile-directory=${chromeCfg.profile}`
    ]
  }).catch((err) => {
    throw new Error(
      `Could not open persistent Chrome profile ("${chromeCfg.profile}" in ${chromeCfg.userDataDir}). ` +
      'Close any Chrome window already using that profile and retry. ' +
      `Underlying error: ${err.message}`
    );
  });

  const completedEntries = [];

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto('https://depositphotos.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    if (!(await isLoggedInDepositphotos(page))) {
      throw new Error(
        'Chrome profile is not logged into Depositphotos. Sign in once via ' +
        '"Continue with Google" in this profile, then retry (the session persists in the profile).'
      );
    }

    for (const entry of pendingPlanEntries) {
      const image = manifestImagesById.get(entry.id);
      console.log(`[chrome-profile] Downloading id=${entry.id} -> ${entry.filename} ...`);
      try {
        const result = await downloadOneImageViaChromeProfile(page, image, destDir, entry.filename);
        completedEntries.push(buildReceiptEntry({
          id: entry.id,
          title: entry.title,
          page_url: entry.page_url,
          filename: entry.filename,
          fileSizeBytes: result.fileSizeBytes,
          nowIso: new Date().toISOString()
        }));
        console.log(`  OK (${result.fileSizeBytes} bytes)`);
      } catch (err) {
        console.error(`  FAILED id=${entry.id}: ${err.message}`);
      }

      await new Promise(r => setTimeout(r, DOWNLOAD_DELAY_MS));
    }
  } finally {
    await context.close();
  }

  return completedEntries;
}

async function run() {
  const params = parseArgs(process.argv.slice(2));

  if (params.help) {
    printHelp();
    process.exit(0);
  }

  if (!params.manifest || !params.dest) {
    console.error('Error: --manifest and --dest are required.');
    printHelp();
    process.exit(1);
  }

  const manifest = loadManifest(params.manifest);
  if (manifest.approved_images.length === 0) {
    console.error(`Error: manifest has no images with approved:true (${manifest.source_path})`);
    process.exit(1);
  }

  const destDir = path.resolve(params.dest);
  fs.mkdirSync(destDir, { recursive: true });

  const planOptions = {};
  if (params.limit !== null && !Number.isNaN(params.limit)) {
    planOptions.limit = params.limit;
  }

  const plan = buildDownloadPlan(manifest.approved_images, destDir, planOptions);

  const pathChoice = selectDownloadPath(params);
  const pathLabel = {
    'chrome-profile': 'Persistent Chrome profile (opt-in, OAuth)',
    'session-fallback': 'Playwright session fallback (opt-in)',
    'api': 'Depositphotos API (primary)'
  }[pathChoice];

  console.log(`Manifest: ${manifest.source_path}`);
  console.log(`Client/Project: ${manifest.client} / ${manifest.project}`);
  console.log(`Destination: ${destDir}`);
  console.log(`Path: ${pathLabel}`);
  console.log('');
  for (const entry of plan) {
    console.log(`  [${entry.status.padEnd(13)}] id=${entry.id}  ${entry.filename}`);
  }
  console.log('');

  const pendingEntries = plan.filter(e => e.status === 'pending');
  const skippedExisting = plan.filter(e => e.status === 'skip_existing').length;
  const skippedLimit = plan.filter(e => e.status === 'skip_limit').length;
  console.log(`Pending: ${pendingEntries.length}  Skipped (existing): ${skippedExisting}  Skipped (limit): ${skippedLimit}`);

  if (params.dryRun) {
    console.log('\n--dry-run set: no network/credential access, nothing downloaded.');
    return;
  }

  if (pendingEntries.length === 0) {
    console.log('\nNothing to download.');
    return;
  }

  let completedEntries;

  if (pathChoice === 'chrome-profile') {
    const manifestImagesById = new Map(manifest.approved_images.map(img => [img.id, img]));
    const chromeCfg = resolveChromeProfileConfig(params);
    completedEntries = await runChromeProfileDownloads(pendingEntries, manifestImagesById, destDir, chromeCfg);
  } else if (pathChoice === 'session-fallback') {
    const manifestImagesById = new Map(manifest.approved_images.map(img => [img.id, img]));
    completedEntries = await runSessionFallbackDownloads(pendingEntries, manifestImagesById, destDir);
  } else {
    const apiKey = process.env.DP_API_KEY;
    const username = process.env.DP_LOGIN_USER;
    const password = process.env.DP_LOGIN_PASSWORD;

    if (!apiKey || !username || !password) {
      console.error('\nError: Depositphotos API credentials not found in env.');
      console.error('Run this tool via the credential resolver, e.g.:');
      console.error('  tools/stock-image-scout/run-with-op.sh node tools/stock-image-scout/download.cjs \\');
      console.error(`    --manifest ${params.manifest} --dest ${params.dest} --limit 1`);
      console.error('(Needs DP_API_KEY, DP_LOGIN_USER, DP_LOGIN_PASSWORD — see run-with-op.sh header for setup.)');
      process.exit(1);
    }

    completedEntries = await runApiDownloads(pendingEntries, destDir, {
      apiKey,
      username,
      password,
      baseUrl: process.env.DP_API_BASE_URL || dpApi.DEFAULT_BASE_URL
    });
  }

  const existingReceipt = loadExistingReceipt(destDir);
  const receiptDoc = buildReceiptDocument({
    client: manifest.client,
    project: manifest.project,
    manifestSourcePath: manifest.source_path,
    entries: completedEntries,
    existingReceipt,
    nowIso: new Date().toISOString()
  });
  fs.writeFileSync(receiptPathFor(destDir), JSON.stringify(receiptDoc, null, 2), 'utf8');

  console.log(`\nDownloaded ${completedEntries.length}/${pendingEntries.length}. Receipt: ${receiptPathFor(destDir)}`);
}

if (require.main === module) {
  run().catch(err => {
    console.error(`Fatal error: ${err.stack}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  selectDownloadPath,
  resolveChromeProfileConfig,
  expandHome,
  CHROME_PROFILE_DEFAULTS,
  runApiDownloads,
  downloadOneImageLiveViaSession,
  runSessionFallbackDownloads,
  downloadOneImageViaChromeProfile,
  runChromeProfileDownloads
};
