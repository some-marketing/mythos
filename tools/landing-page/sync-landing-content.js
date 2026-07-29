#!/usr/bin/env node

/**
 * sync-landing-content.js
 *
 * End-to-end pipeline: extract HTML from production landing pages,
 * update staging drafts via TinyMCE HTML mode, and verify results.
 *
 * Usage:
 *   node tools/landing-page/sync-landing-content.js \
 *     --user your-wp-admin-user --pass-file /tmp/.clienta-wp-pass \
 *     --output-dir _dev/reports/landing-page-sync/
 *
 * Options:
 *   --only <slug>    Process only one page
 *   --headed         Show browser
 *   --skip-extract   Reuse previously extracted HTML from output-dir
 */

const fs = require('fs');
const path = require('path');
const { fillEditorField, verifyEditorField } = require('./lib/editor-helpers');

const PRODUCTION_URL = 'https://www.client-a.example';
const STAGING_URL = 'https://client-a-staging.example';

// Production image paths -> staging image paths
const IMAGE_MAP = {
  '/wp-content/uploads/2025/09/car-1.webp': '/wp-content/uploads/2026/03/car-1.webp',
  '/wp-content/uploads/2025/09/suv-1.webp': '/wp-content/uploads/2026/03/suv-1.webp',
  '/wp-content/uploads/2025/09/truck-1.webp': '/wp-content/uploads/2026/03/truck-1.webp',
  '/wp-content/uploads/2025/10/clienta-vehicle-image.webp': '/wp-content/uploads/2026/03/clienta-vehicle-image.webp',
  '/wp-content/uploads/2025/09/clienta-vehicle-image.png': '/wp-content/uploads/2026/03/clienta-vehicle-image.webp'
};

const PAGES = [
  { slug: 'used-cars-halifax', prodPath: '/used-cars-halifax/' },
  { slug: 'used-cars-truro', prodPath: '/used-cars-truro/' },
  { slug: 'used-cars-dartmouth', prodPath: '/used-cars-dartmouth/' },
  { slug: 'used-cars-miramichi', prodPath: '/used-cars-miramichi/' },
  { slug: 'used-car-dealers-moncton', prodPath: '/used-car-dealers-moncton/' },
  { slug: 'used-suvs-atlantic-canada', prodPath: '/used-suvs-atlantic-canada/' },
  { slug: 'used-trucks-nova-scotia', prodPath: '/used-trucks-nova-scotia/' },
  { slug: 'used-trucks-atlantic-canada', prodPath: '/used-trucks-atlantic-canada/' },
  { slug: 'used-dealership-atlantic-canada', prodPath: '/used-dealership-atlantic-canada/' },
  { slug: 'truro-used-dealership', prodPath: '/truro-used-dealership/' }
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const opts = { user: null, pass: null, outputDir: null, headed: false, only: null, skipExtract: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--user': opts.user = args[++i]; break;
      case '--pass': opts.pass = args[++i]; break;
      case '--pass-file': opts.pass = fs.readFileSync(args[++i], 'utf8').trim(); break;
      case '--output-dir': opts.outputDir = args[++i]; break;
      case '--headed': opts.headed = true; break;
      case '--only': opts.only = args[++i]; break;
      case '--skip-extract': opts.skipExtract = true; break;
    }
  }
  return opts;
}

function die(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }

// ---------------------------------------------------------------------------
// HTML cleanup
// ---------------------------------------------------------------------------

function cleanExtractedHtml(html) {
  let h = html;
  // Map production image paths to staging paths
  for (const [oldPath, newPath] of Object.entries(IMAGE_MAP)) {
    h = h.split(oldPath).join(newPath);
  }
  return h;
}

// ---------------------------------------------------------------------------
// Extract from production
// ---------------------------------------------------------------------------

async function extractFromProduction(page, prodPath) {
  await page.goto(`${PRODUCTION_URL}${prodPath}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  return page.evaluate(() => {
    const pc = document.querySelector('#page-content');
    if (!pc) return null;
    const rows = pc.querySelectorAll('.row');

    const cleanImages = (container) => {
      container.querySelectorAll('img').forEach(img => {
        const realSrc = img.getAttribute('data-lazy-src') || img.getAttribute('src') || '';
        if (realSrc.startsWith('data:')) { img.remove(); return; }
        const alt = img.getAttribute('alt') || '';
        const cls = (img.getAttribute('class') || '').replace(/entered|lazyloaded|lazy/g, '').trim();
        Array.from(img.attributes).forEach(a => img.removeAttribute(a.name));
        img.setAttribute('src', realSrc);
        if (alt) img.setAttribute('alt', alt);
        if (cls) img.setAttribute('class', cls);
      });
      container.querySelectorAll('noscript').forEach(n => n.remove());
    };

    const getContentWithImage = (row) => {
      if (!row) return null;
      const cols = row.querySelectorAll('[class*="col-md"]');
      let textCol = null;
      let imgCol = null;

      for (const col of cols) {
        if (col.querySelector('h2')) textCol = col;
        else if (col.querySelector('img')) imgCol = col;
      }

      if (!textCol) return null;

      // Extract image HTML from the image column
      let imageHtml = '';
      if (imgCol) {
        const imgClone = imgCol.cloneNode(true);
        cleanImages(imgClone);
        const img = imgClone.querySelector('img');
        if (img) imageHtml = img.outerHTML;
      }

      // Extract text content from the text column
      const textClone = textCol.cloneNode(true);
      cleanImages(textClone);

      // Remove leading H2 (template renders it from headline field)
      const leadH2 = textClone.querySelector('h2');
      if (leadH2) leadH2.remove();

      // Fix /step-1 -> /apply/
      textClone.querySelectorAll('a[href="/step-1"]').forEach(a => a.setAttribute('href', '/apply/'));

      // Combine: image first, then text content
      const textHtml = textClone.innerHTML.trim();
      return imageHtml ? imageHtml + '\n' + textHtml : textHtml;
    };

    return {
      opening: getContentWithImage(rows[0]),
      content: getContentWithImage(rows[1])
    };
  });
}

// ---------------------------------------------------------------------------
// Login + slug map
// ---------------------------------------------------------------------------

async function loginToStaging(page, user, pass) {
  await page.goto(`${STAGING_URL}/wp-login.php`, { waitUntil: 'networkidle' });
  if (page.url().includes('wp-admin') && !page.url().includes('wp-login')) return;
  await page.fill('#user_login', user);
  await page.fill('#user_pass', pass);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
    page.click('#wp-submit')
  ]);
  const err = await page.$('#login_error');
  if (err) die(`Login failed: ${await err.textContent()}`);
  if (page.url().includes('wp-login')) {
    await page.goto(`${STAGING_URL}/wp-admin/`, { waitUntil: 'networkidle' });
  }
}

async function getSlugToPostIdMap(page) {
  await page.goto(`${STAGING_URL}/wp-admin/edit.php?post_type=clienta_landing_page&post_status=all&posts_per_page=100`, {
    waitUntil: 'networkidle'
  });
  return page.evaluate(() => {
    const map = {};
    for (const row of document.querySelectorAll('#the-list tr')) {
      const pid = (row.querySelector('.row-title')?.getAttribute('href') || '').match(/post=(\d+)/);
      const slug = (row.querySelector('.view a')?.getAttribute('href') || '').match(/\/landing\/([^/]+)\/?$/);
      if (pid && slug) map[slug[1]] = pid[1];
    }
    return map;
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.user) die('--user required');
  if (!opts.pass) die('--pass or --pass-file required');
  if (!opts.outputDir) die('--output-dir required');

  const outputDir = path.resolve(opts.outputDir);
  fs.mkdirSync(path.join(outputDir, 'extracted'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'screenshots'), { recursive: true });

  let pages = opts.only ? PAGES.filter(p => p.slug === opts.only) : PAGES;
  if (opts.only && pages.length === 0) die(`No page with slug "${opts.only}"`);

  console.log(`Pages: ${pages.length}`);
  console.log(`Output: ${outputDir}\n`);

  const { chromium } = require('playwright');
  let browser;

  try {
    browser = await chromium.launch({
      headless: !opts.headed,
      args: ['--disable-blink-features=AutomationControlled']
    });

    // =====================================================================
    // PHASE 1: EXTRACT from production
    // =====================================================================
    console.log('=== PHASE 1: Extract from production ===\n');

    const extracted = {};

    if (opts.skipExtract) {
      // Load from previously saved files
      for (const p of pages) {
        const file = path.join(outputDir, 'extracted', `${p.slug}.json`);
        if (fs.existsSync(file)) {
          extracted[p.slug] = JSON.parse(fs.readFileSync(file, 'utf8'));
          console.log(`[${p.slug}] loaded from cache`);
        }
      }
    } else {
      const prodCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const prodPage = await prodCtx.newPage();

      for (const p of pages) {
        process.stdout.write(`[${p.slug}] `);
        const raw = await extractFromProduction(prodPage, p.prodPath);
        if (!raw || !raw.opening || !raw.content) {
          console.log('FAILED - missing content');
          continue;
        }

        const data = {
          opening: cleanExtractedHtml(raw.opening),
          content: cleanExtractedHtml(raw.content)
        };

        extracted[p.slug] = data;
        fs.writeFileSync(path.join(outputDir, 'extracted', `${p.slug}.json`), JSON.stringify(data, null, 2));
        console.log(`opening=${data.opening.length} content=${data.content.length}`);
      }
      await prodCtx.close();
    }

    // Write expectations
    const expectations = {};
    for (const [slug, data] of Object.entries(extracted)) {
      expectations[slug] = {
        opening: { minLength: data.opening.length - 50, hasHTML: true, substring: '<p>' },
        content: { minLength: data.content.length - 50, hasHTML: true, substring: '<p>' }
      };
    }
    fs.writeFileSync(path.join(outputDir, 'expectations.json'), JSON.stringify(expectations, null, 2));
    console.log('\nExpectations written.\n');

    // =====================================================================
    // PHASE 2: UPDATE staging
    // =====================================================================
    console.log('=== PHASE 2: Update staging via TinyMCE HTML mode ===\n');

    const stagCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const stagPage = await stagCtx.newPage();

    await loginToStaging(stagPage, opts.user, opts.pass);
    console.log('Logged in to staging\n');

    const slugMap = await getSlugToPostIdMap(stagPage);

    const results = [];

    for (const p of pages) {
      const postId = slugMap[p.slug];
      const data = extracted[p.slug];
      if (!postId) { console.log(`[${p.slug}] SKIP - not on staging`); results.push({ slug: p.slug, status: 'not-found' }); continue; }
      if (!data) { console.log(`[${p.slug}] SKIP - no extracted data`); results.push({ slug: p.slug, status: 'no-data' }); continue; }

      console.log(`[${p.slug}] post ${postId}`);

      // Navigate to editor
      await stagPage.goto(`${STAGING_URL}/wp-admin/post.php?post=${postId}&action=edit`, { waitUntil: 'networkidle' });
      await stagPage.waitForTimeout(2000);

      // Clear post_content (main editor) to prevent leftover HTML rendering
      const textTab = await stagPage.$('#content-html');
      if (textTab) await textTab.click();
      await stagPage.waitForTimeout(300);
      const mainEditor = await stagPage.$('#content');
      if (mainEditor) {
        const existing = await mainEditor.evaluate(el => el.value);
        if (existing) {
          await mainEditor.fill('');
          console.log(`  cleared post_content (${existing.length} chars)`);
        }
      }

      // Fill TinyMCE fields with HTML
      const openingResult = await fillEditorField(stagPage, '_clienta_landing_opening', data.opening);
      console.log(`  opening: ${openingResult.ok ? 'OK' : 'FAIL'} (${openingResult.length || 0} chars, TinyMCE=${openingResult.isTinyMCE})${openingResult.error ? ' ERROR: ' + openingResult.error : ''}`);

      const contentResult = await fillEditorField(stagPage, '_clienta_landing_content', data.content);
      console.log(`  content: ${contentResult.ok ? 'OK' : 'FAIL'} (${contentResult.length || 0} chars, TinyMCE=${contentResult.isTinyMCE})${contentResult.error ? ' ERROR: ' + contentResult.error : ''}`);

      if (!openingResult.ok || !contentResult.ok) {
        results.push({ slug: p.slug, postId, status: 'fill-error', openingResult, contentResult });
        continue;
      }

      // Save
      const btn = await stagPage.$('#publish');
      if (btn) {
        await Promise.all([
          stagPage.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
          btn.click()
        ]);
      }
      await stagPage.waitForTimeout(1000);

      // =====================================================================
      // PHASE 3: VERIFY editor (saved values)
      // =====================================================================
      const openingVerify = await verifyEditorField(stagPage, '_clienta_landing_opening', expectations[p.slug]?.opening || {});
      const contentVerify = await verifyEditorField(stagPage, '_clienta_landing_content', expectations[p.slug]?.content || {});

      console.log(`  verify opening: ${openingVerify.pass ? 'PASS' : 'FAIL'} (${openingVerify.checks.length} chars, HTML=${openingVerify.checks.hasHTML})`);
      console.log(`  verify content: ${contentVerify.pass ? 'PASS' : 'FAIL'} (${contentVerify.checks.length} chars, HTML=${contentVerify.checks.hasHTML})`);

      // =====================================================================
      // PHASE 4: VERIFY frontend
      // =====================================================================
      await stagPage.goto(`${STAGING_URL}/?post_type=clienta_landing_page&p=${postId}&preview=true`, {
        waitUntil: 'domcontentloaded', timeout: 60000
      });
      await stagPage.waitForTimeout(3000);

      const frontend = await stagPage.evaluate(() => {
        const h2s = Array.from(document.querySelectorAll('h2')).map(h => h.textContent.trim().substring(0, 60));
        const h3s = Array.from(document.querySelectorAll('h3')).map(h => h.textContent.trim().substring(0, 60));
        const imgs = Array.from(document.querySelectorAll('img'))
          .filter(i => !i.src.includes('emoji') && !i.src.includes('gravatar') && !i.src.includes('data:'))
          .map(i => ({ src: i.src.substring(0, 100), alt: i.alt, visible: i.offsetHeight > 0 }));
        const bolds = document.querySelectorAll('strong').length;
        const lists = document.querySelectorAll('ul li').length;

        return { h2s, h3s, imgCount: imgs.length, visibleImgs: imgs.filter(i => i.visible).length, bolds, lists, imgs: imgs.slice(0, 10) };
      });

      console.log(`  frontend: ${frontend.h2s.length} h2s, ${frontend.h3s.length} h3s, ${frontend.visibleImgs}/${frontend.imgCount} imgs visible, ${frontend.bolds} bolds, ${frontend.lists} list items`);

      // Screenshot
      await stagPage.screenshot({ path: path.join(outputDir, 'screenshots', `${p.slug}.png`), fullPage: true });

      // Check for content duplication (same h2 text appearing multiple times)
      const duplicateH2s = await stagPage.evaluate(() => {
        const h2s = Array.from(document.querySelectorAll('h2')).map(h => h.textContent.trim());
        const bodyText = document.body.textContent;
        return h2s.filter(h => {
          if (h.length < 10) return false;
          const first = bodyText.indexOf(h);
          return bodyText.indexOf(h, first + h.length) > -1;
        });
      });

      if (duplicateH2s.length > 0) {
        console.log(`  WARNING: duplicate content detected: ${duplicateH2s.map(d => d.substring(0, 40)).join(' | ')}`);
      }

      const frontendPass = frontend.h2s.length >= 2 && frontend.bolds >= 3 && duplicateH2s.length === 0;

      results.push({
        slug: p.slug,
        postId,
        status: (openingVerify.pass && contentVerify.pass && frontendPass) ? 'PASS' : 'FAIL',
        editor: { opening: openingVerify.checks, content: contentVerify.checks },
        frontend: { h2s: frontend.h2s.length, h3s: frontend.h3s.length, imgs: frontend.visibleImgs, bolds: frontend.bolds, lists: frontend.lists }
      });

      console.log(`  => ${results[results.length - 1].status}\n`);
    }

    await stagCtx.close();
    await browser.close();

    // =====================================================================
    // SUMMARY
    // =====================================================================
    console.log('========================================');
    console.log('SYNC RESULTS');
    console.log('========================================');
    results.forEach(r => {
      console.log(`  [${r.status}] ${r.slug}${r.postId ? ` (post ${r.postId})` : ''}`);
      if (r.status === 'FAIL' && r.editor) {
        if (!r.editor.opening.hasHTML) console.log('    - opening: HTML not preserved');
        if (!r.editor.content.hasHTML) console.log('    - content: HTML not preserved');
      }
    });

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const skipped = results.filter(r => !['PASS', 'FAIL'].includes(r.status)).length;
    console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);

    fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`Results: ${path.join(outputDir, 'results.json')}`);

  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    console.error(err.stack);
    if (browser) await browser.close();
    process.exit(1);
  }
}

main();
