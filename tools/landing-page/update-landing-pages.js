#!/usr/bin/env node

/**
 * update-landing-pages.js
 *
 * Updates existing CLIENTA landing page drafts with full content via Playwright.
 * Finds pages by slug, navigates to their edit screen, and fills content fields.
 *
 * Usage:
 *   node tools/landing-page/update-landing-pages.js \
 *     --user your-wp-admin-user --pass-file /tmp/.clienta-wp-pass \
 *     --data tools/landing-page/page-data-full.json
 */

const fs = require('fs');
const path = require('path');
const { fillEditorField } = require('./lib/editor-helpers');

function parseArgs(args) {
  const opts = { user: null, pass: null, siteUrl: 'https://client-a-staging.example', dataFile: null, headed: false, only: null };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--user': opts.user = args[++i]; break;
      case '--pass': opts.pass = args[++i]; break;
      case '--pass-file': opts.pass = fs.readFileSync(args[++i], 'utf8').trim(); break;
      case '--site-url': opts.siteUrl = args[++i]; break;
      case '--data': opts.dataFile = args[++i]; break;
      case '--headed': opts.headed = true; break;
      case '--only': opts.only = args[++i]; break;
    }
  }
  return opts;
}

function die(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }

async function login(page, siteUrl, user, pass) {
  await page.goto(`${siteUrl}/wp-login.php`, { waitUntil: 'networkidle' });
  if (page.url().includes('wp-admin') && !page.url().includes('wp-login')) return;
  await page.fill('#user_login', user);
  await page.fill('#user_pass', pass);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }), page.click('#wp-submit')]);
  const err = await page.$('#login_error');
  if (err) die(`Login failed: ${await err.textContent()}`);
  if (page.url().includes('wp-login')) await page.goto(`${siteUrl}/wp-admin/`, { waitUntil: 'networkidle' });
  console.log(`Logged in as ${user}`);
}

async function buildSlugToPostIdMap(page, siteUrl) {
  await page.goto(`${siteUrl}/wp-admin/edit.php?post_type=clienta_landing_page&post_status=all&posts_per_page=100`, { waitUntil: 'networkidle' });

  return page.evaluate(() => {
    const map = {};
    const rows = document.querySelectorAll('#the-list tr');
    for (const row of rows) {
      const editLink = row.querySelector('.row-title');
      const href = editLink?.getAttribute('href') || '';
      const postIdMatch = href.match(/post=(\d+)/);
      // Get slug from the row's inline data or the view link
      const viewLink = row.querySelector('.view a');
      const viewUrl = viewLink?.getAttribute('href') || '';
      const slugMatch = viewUrl.match(/\/landing\/([^/]+)\/?$/);
      if (postIdMatch && slugMatch) {
        map[slugMatch[1]] = postIdMatch[1];
      }
    }
    return map;
  });
}

async function updatePage(page, siteUrl, postId, data) {
  console.log(`\n--- Updating: ${data.slug} (post ${postId}) ---`);

  await page.goto(`${siteUrl}/wp-admin/post.php?post=${postId}&action=edit`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Use fillEditorField for TinyMCE-aware filling
  const fill = async (id, value, label) => {
    if (!value) return;
    const result = await fillEditorField(page, id, value);
    console.log(`  ${label}: ${result.ok ? 'OK' : 'FAIL'} (${result.length || 0} chars, TinyMCE=${result.isTinyMCE})${result.error ? ' ERROR: ' + result.error : ''}`);
  };

  await fill('_clienta_landing_headline', data.headline, 'Headline');
  await fill('_clienta_landing_subheadline', data.subheadline, 'Subheadline');
  await fill('_clienta_landing_opening', data.opening, 'Opening');
  await fill('_clienta_landing_before_content', data.beforeContent, 'Before Content');
  await fill('_clienta_landing_content', data.content, 'Main Content');
  await fill('_clienta_landing_cta_text', data.ctaText, 'CTA Text');
  await fill('_clienta_landing_cta_link', data.ctaLink, 'CTA Link');
  await fill('_clienta_landing_benefits', data.benefits, 'Benefits');

  // Save — prefer Save Draft to avoid accidental publish
  const updateBtn = await page.$('#save-post') || await page.$('#publish');
  if (updateBtn) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
      updateBtn.click()
    ]);
    console.log('  Saved');
  }

  return { slug: data.slug, postId, status: 'updated' };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.user) die('--user required');
  if (!opts.pass) die('--pass or --pass-file required');
  if (!opts.dataFile) die('--data required');

  const pages = JSON.parse(fs.readFileSync(path.resolve(opts.dataFile), 'utf8'));
  let toUpdate = opts.only ? pages.filter(p => p.slug === opts.only) : pages;

  console.log(`Pages to update: ${toUpdate.length}`);

  const { chromium } = require('playwright');
  let browser;

  try {
    browser = await chromium.launch({ headless: !opts.headed, args: ['--disable-blink-features=AutomationControlled'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await login(page, opts.siteUrl, opts.user, opts.pass);

    // Build slug->postId map from listing page
    const slugMap = await buildSlugToPostIdMap(page, opts.siteUrl);
    console.log(`Found ${Object.keys(slugMap).length} landing pages:`, Object.keys(slugMap).join(', '));

    const results = [];
    for (const data of toUpdate) {
      try {
        const postId = slugMap[data.slug];
        if (!postId) {
          console.log(`\n--- SKIP: ${data.slug} — not found on site ---`);
          results.push({ slug: data.slug, status: 'not-found' });
          continue;
        }
        const result = await updatePage(page, opts.siteUrl, postId, data);
        results.push(result);
      } catch (err) {
        console.error(`  FAILED: ${err.message}`);
        results.push({ slug: data.slug, status: 'error', error: err.message });
      }
    }

    console.log('\n========================================');
    console.log('UPDATE SUMMARY');
    console.log('========================================');
    results.forEach(r => console.log(`  [${r.status === 'updated' ? 'OK' : 'FAIL'}] ${r.slug} — ${r.status}`));
    const ok = results.filter(r => r.status === 'updated').length;
    console.log(`\n${ok} updated, ${results.length - ok} failed/skipped`);

    await browser.close();
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    if (browser) await browser.close();
    process.exit(1);
  }
}

main();
