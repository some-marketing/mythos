'use strict';

/**
 * ee-verify.js — S5: Post-edit live public-page re-verification.
 *
 * Fetches the rendered public URL and confirms:
 *   - newValue IS present in the page HTML
 *   - oldValue is NOT present in the page HTML
 *
 * Retries once after 5s to allow for EE template-cache warm time.
 *
 * Exported functions:
 *   verifyLive(opts)   — main verification entry point
 *   checkPage(html, newValue, oldValue)  — pure-logic check (tested in unit tests)
 *
 * No external npm dependencies — Node.js built-ins only.
 */

const https  = require('https');
const http   = require('http');
const { URL } = require('url');

// ─── Pure-logic check (unit-testable) ────────────────────────────────────────

/**
 * Given a page's HTML string and the expected new/old values, return a result.
 *
 * @param {string} html
 * @param {string} newValue  — string that MUST appear on the live page
 * @param {string} oldValue  — string that MUST NOT appear on the live page (optional)
 * @returns {{ pass: boolean, newFound: boolean, oldGone: boolean, details: string }}
 */
function checkPage(html, newValue, oldValue) {
  const newFound = html.includes(newValue);
  const oldGone  = oldValue ? !html.includes(oldValue) : true;
  const pass     = newFound && oldGone;

  const details = [
    newFound ? `  [OK] New value found: ${JSON.stringify(newValue.slice(0, 80))}` :
               `  [FAIL] New value NOT found: ${JSON.stringify(newValue.slice(0, 80))}`,
    oldValue
      ? (oldGone
          ? `  [OK] Old value absent: ${JSON.stringify(oldValue.slice(0, 80))}`
          : `  [FAIL] Old value still present: ${JSON.stringify(oldValue.slice(0, 80))}`)
      : '  [SKIP] No old value to check',
  ].join('\n');

  return { pass, newFound, oldGone, details };
}

// ─── HTTP fetch (no external deps) ───────────────────────────────────────────

function fetchPage(rawUrl) {
  return new Promise((resolve, reject) => {
    const u   = new URL(rawUrl);
    const lib = u.protocol === 'http:' ? http : https;
    const opts = {
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'https:' ? 443 : 80),
      path:     u.pathname + u.search,
      method:   'GET',
      headers:  {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cache-Control': 'no-cache',
      },
    };
    const req = lib.request(opts, (res) => {
      // Follow one level of redirect
      if ([301, 302, 303].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const nextUrl = new URL(res.headers.location, rawUrl);
        return fetchPage(nextUrl.toString()).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── S5: Main verification ────────────────────────────────────────────────────

/**
 * Fetch a public URL and verify the edit is live.
 * Retries once after RETRY_DELAY_MS if the first attempt fails (cache warm time).
 *
 * @param {object} opts
 *   opts.publicUrl  {string}  URL of the public page to check
 *   opts.newValue   {string}  text that must be present
 *   opts.oldValue   {string}  text that must be absent (optional)
 *   opts.verbose    {boolean} print result to stdout
 *   opts.retryMs    {number}  retry delay in ms (default 5000)
 * @returns {Promise<{ pass: boolean, attempt: number, result: object }>}
 */
async function verifyLive(opts) {
  const { publicUrl, newValue, oldValue, verbose, retryMs = 5000 } = opts;

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) {
      if (verbose) process.stdout.write(`  [verify] Retrying after ${retryMs}ms (EE cache flush)…\n`);
      await sleep(retryMs);
    }

    let resp;
    try {
      resp = await fetchPage(publicUrl);
    } catch (err) {
      if (attempt === 2) throw new Error(`Verify fetch failed: ${err.message}`);
      continue;
    }

    if (resp.statusCode >= 400) {
      throw new Error(`Verify page returned HTTP ${resp.statusCode} for ${publicUrl}`);
    }

    const result = checkPage(resp.body, newValue, oldValue);

    if (verbose) {
      process.stdout.write(`\n[VERIFY] ${publicUrl} (attempt ${attempt})\n`);
      process.stdout.write(result.details + '\n');
      process.stdout.write(`  => ${result.pass ? 'PASS' : 'FAIL'}\n\n`);
    }

    if (result.pass || attempt === 2) {
      return { pass: result.pass, attempt, result };
    }
  }
}

module.exports = { verifyLive, checkPage };
