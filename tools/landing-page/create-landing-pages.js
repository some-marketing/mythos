#!/usr/bin/env node

/**
 * create-landing-pages.js
 *
 * Creates CLIENTA geo landing pages via Playwright by filling the WP admin
 * editor form for the clienta_landing_page custom post type.
 *
 * Usage:
 *   node tools/landing-page/create-landing-pages.js \
 *     --user your-wp-admin-user --pass-file /tmp/.clienta-wp-pass \
 *     --data tools/landing-page/page-data.json \
 *     --output-dir _dev/reports/landing-page-creation/
 *
 * Options:
 *   --headed         Show browser window
 *   --dry-run        Log actions without creating pages
 *   --only <slug>    Create only the specified page
 *   --skip-existing  Skip pages whose slug already exists
 *   --publish        Publish immediately (default: save as draft)
 */

const fs = require('fs');
const path = require('path');

function parseArgs(args) {
  const opts = {
    user: null,
    pass: null,
    siteUrl: 'https://client-a-staging.example',
    dataFile: null,
    outputDir: null,
    headed: false,
    dryRun: false,
    only: null,
    skipExisting: true,
    publish: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--user': opts.user = args[++i]; break;
      case '--pass': opts.pass = args[++i]; break;
      case '--pass-file': opts.pass = fs.readFileSync(args[++i], 'utf8').trim(); break;
      case '--site-url': opts.siteUrl = args[++i]; break;
      case '--data': opts.dataFile = args[++i]; break;
      case '--output-dir': opts.outputDir = args[++i]; break;
      case '--headed': opts.headed = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--only': opts.only = args[++i]; break;
      case '--skip-existing': opts.skipExisting = true; break;
      case '--no-skip-existing': opts.skipExisting = false; break;
      case '--publish': opts.publish = true; break;
    }
  }
  return opts;
}

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

async function login(page, siteUrl, user, pass) {
  console.log('Logging in...');
  await page.goto(`${siteUrl}/wp-login.php`, { waitUntil: 'networkidle' });

  if (page.url().includes('wp-admin') && !page.url().includes('wp-login')) {
    console.log('Already logged in');
    return;
  }

  await page.fill('#user_login', user);
  await page.fill('#user_pass', pass);
  await page.check('#rememberme');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
    page.click('#wp-submit')
  ]);

  const loginError = await page.$('#login_error');
  if (loginError) {
    const errorText = await loginError.textContent();
    die(`Login failed: ${errorText.trim()}`);
  }

  if (page.url().includes('wp-login')) {
    await page.goto(`${siteUrl}/wp-admin/`, { waitUntil: 'networkidle', timeout: 30000 });
  }

  console.log(`Logged in as ${user}`);
}

async function getExistingSlugs(page, siteUrl) {
  await page.goto(`${siteUrl}/wp-admin/edit.php?post_type=clienta_landing_page`, {
    waitUntil: 'networkidle'
  });

  return page.evaluate(() => {
    const rows = document.querySelectorAll('#the-list tr');
    return Array.from(rows).map(row => {
      const viewLink = row.querySelector('.view a');
      const url = viewLink?.getAttribute('href') || '';
      const match = url.match(/\/landing\/([^/]+)\/?$/);
      return match ? match[1] : null;
    }).filter(Boolean);
  });
}

async function createPage(page, siteUrl, pageData, opts) {
  const { slug, title, bodyType, location, headline, subheadline,
          opening, beforeContent, content, ctaText, ctaLink, benefits } = pageData;

  console.log(`\n--- Creating: ${title} (/${slug}/) ---`);

  if (opts.dryRun) {
    console.log('  [DRY RUN] Would create page with:');
    console.log(`    Title: ${title}`);
    console.log(`    Slug: ${slug}`);
    console.log(`    Body Type: ${bodyType || '(none)'}`);
    console.log(`    Location: ${location}`);
    console.log(`    Headline: ${headline}`);
    return { slug, status: 'dry-run' };
  }

  // Navigate to Add New Landing Page
  await page.goto(`${siteUrl}/wp-admin/post-new.php?post_type=clienta_landing_page`, {
    waitUntil: 'networkidle'
  });
  await page.waitForTimeout(1500);

  // 1. Set title
  await page.fill('#title', title);
  console.log(`  Title: ${title}`);

  // Trigger slug generation by tabbing out of title
  await page.press('#title', 'Tab');
  await page.waitForTimeout(1000);

  // 2. Set slug (need to click edit, then set it)
  // The slug auto-generates from title. We need to override it.
  // First save as draft to generate the slug field
  const saveDraft = await page.$('#save-post');
  if (saveDraft) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
      saveDraft.click()
    ]);
    console.log('  Saved draft to generate slug');
  }

  // Now edit the slug
  const editSlugBtn = await page.$('#edit-slug-buttons .edit-slug');
  if (editSlugBtn) {
    await editSlugBtn.click();
    await page.waitForTimeout(500);
    const slugInput = await page.$('#new-post-slug');
    if (slugInput) {
      await slugInput.fill(slug);
      const okBtn = await page.$('#edit-slug-buttons .save');
      if (okBtn) await okBtn.click();
      await page.waitForTimeout(500);
      console.log(`  Slug: ${slug}`);
    }
  } else {
    // Fallback: set slug via the hidden field at bottom
    const slugField = await page.$('#post_name');
    if (slugField) {
      await slugField.fill(slug);
      console.log(`  Slug (via field): ${slug}`);
    }
  }

  // 3. Set Body Type tag (WordPress tag-style input: newtag input + Add button)
  if (bodyType) {
    const bodyTypeInput = await page.$('#new-tag-clienta_body_type');
    if (bodyTypeInput) {
      await bodyTypeInput.fill(bodyType);
      const addBtn = await page.$('#tagsdiv-clienta_body_type .tagadd');
      if (addBtn) {
        await addBtn.click();
        await page.waitForTimeout(800);
      }
      console.log(`  Body Type: ${bodyType}`);
    } else {
      console.log('  WARNING: Body Type input not found');
    }
  }

  // 4. Set Location tag
  if (location) {
    const locationInput = await page.$('#new-tag-clienta_location');
    if (locationInput) {
      await locationInput.fill(location);
      const addBtn = await page.$('#tagsdiv-clienta_location .tagadd');
      if (addBtn) {
        await addBtn.click();
        await page.waitForTimeout(800);
      }
      console.log(`  Location: ${location}`);
    } else {
      console.log('  WARNING: Location input not found');
    }
  }

  // 5. Fill Generated Content fields
  const fillField = async (selector, value, label) => {
    if (!value) return;
    const el = await page.$(selector);
    if (el) {
      await el.fill(value);
      console.log(`  ${label}: ${value.substring(0, 60)}...`);
    } else {
      console.log(`  WARNING: ${label} field not found (${selector})`);
    }
  };

  await fillField('#_clienta_landing_headline', headline, 'Headline');
  await fillField('#_clienta_landing_subheadline', subheadline, 'Subheadline');
  await fillField('#_clienta_landing_opening', opening, 'Opening');
  await fillField('#_clienta_landing_before_content', beforeContent, 'Before Content');
  await fillField('#_clienta_landing_content', content, 'Main Content');
  await fillField('#_clienta_landing_cta_text', ctaText, 'CTA Text');
  await fillField('#_clienta_landing_cta_link', ctaLink, 'CTA Link');
  await fillField('#_clienta_landing_benefits', benefits, 'Benefits');

  // 6. Save / Publish
  if (opts.publish) {
    const publishBtn = await page.$('#publish');
    if (publishBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
        publishBtn.click()
      ]);
      console.log('  PUBLISHED');
    }
  } else {
    // Save/update the draft — prefer Save Draft over Update to avoid accidental publish
    const saveBtn = await page.$('#save-post') || await page.$('#publish');
    if (saveBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
        saveBtn.click()
      ]);
      console.log('  Saved as draft');
    }
  }

  // Capture the post ID from the URL
  const postUrl = page.url();
  const postIdMatch = postUrl.match(/post=(\d+)/);
  const postId = postIdMatch ? postIdMatch[1] : 'unknown';

  // Verify the slug
  const actualSlug = await page.evaluate(() => {
    const el = document.querySelector('#editable-post-name-full, #sample-permalink a');
    return el?.textContent?.trim() || document.querySelector('#post_name')?.value || '';
  });

  console.log(`  Post ID: ${postId}`);
  console.log(`  Actual slug: ${actualSlug}`);

  // Take screenshot
  if (opts.outputDir) {
    const ssDir = path.join(opts.outputDir, 'screenshots');
    fs.mkdirSync(ssDir, { recursive: true });
    await page.screenshot({
      path: path.join(ssDir, `${slug}-editor.png`),
      fullPage: true
    });
  }

  return { slug, postId, status: opts.publish ? 'published' : 'draft', actualSlug };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.user) die('--user is required');
  if (!opts.pass) die('--pass or --pass-file is required');
  if (!opts.dataFile) die('--data is required');

  const pages = JSON.parse(fs.readFileSync(path.resolve(opts.dataFile), 'utf8'));
  const outputDir = opts.outputDir ? path.resolve(opts.outputDir) : null;
  if (outputDir) fs.mkdirSync(outputDir, { recursive: true });

  console.log(`Pages to create: ${pages.length}`);
  console.log(`Mode: ${opts.dryRun ? 'DRY RUN' : opts.publish ? 'PUBLISH' : 'DRAFT'}`);
  console.log(`Site: ${opts.siteUrl}`);
  console.log('');

  // Filter to --only if specified
  let pagesToCreate = opts.only
    ? pages.filter(p => p.slug === opts.only)
    : pages;

  if (opts.only && pagesToCreate.length === 0) {
    die(`No page found with slug "${opts.only}"`);
  }

  const { chromium } = require('playwright');

  let browser;
  try {
    browser = await chromium.launch({
      headless: !opts.headed,
      args: ['--disable-blink-features=AutomationControlled', '--no-first-run']
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    });

    const page = await context.newPage();
    await login(page, opts.siteUrl, opts.user, opts.pass);

    // Check existing pages
    if (opts.skipExisting) {
      const existingSlugs = await getExistingSlugs(page, opts.siteUrl);
      console.log(`\nExisting landing page slugs: ${existingSlugs.join(', ') || '(none aside from default)'}`);

      const before = pagesToCreate.length;
      pagesToCreate = pagesToCreate.filter(p => !existingSlugs.includes(p.slug));
      if (before !== pagesToCreate.length) {
        console.log(`Skipping ${before - pagesToCreate.length} existing page(s)`);
      }
    }

    console.log(`\nCreating ${pagesToCreate.length} page(s)...`);

    const results = [];
    for (const pageData of pagesToCreate) {
      try {
        const result = await createPage(page, opts.siteUrl, pageData, { ...opts, outputDir });
        results.push(result);
      } catch (err) {
        console.error(`  FAILED: ${err.message}`);
        results.push({ slug: pageData.slug, status: 'error', error: err.message });
        // Take error screenshot
        if (outputDir) {
          await page.screenshot({
            path: path.join(outputDir, 'screenshots', `${pageData.slug}-ERROR.png`),
            fullPage: true
          }).catch(() => {});
        }
      }
    }

    // Summary
    console.log('\n========================================');
    console.log('CREATION SUMMARY');
    console.log('========================================');
    results.forEach(r => {
      const icon = r.status === 'error' ? 'FAIL' : 'OK';
      console.log(`  [${icon}] ${r.slug} — ${r.status}${r.postId ? ` (post ${r.postId})` : ''}`);
    });

    const succeeded = results.filter(r => r.status !== 'error').length;
    const failed = results.filter(r => r.status === 'error').length;
    console.log(`\n${succeeded} succeeded, ${failed} failed out of ${results.length} total`);

    // Write results
    if (outputDir) {
      const resultsFile = path.join(outputDir, 'creation-results.json');
      fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
      console.log(`Results written to: ${resultsFile}`);
    }

    await browser.close();

  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    console.error(err.stack);
    if (browser) await browser.close();
    process.exit(1);
  }
}

main();
