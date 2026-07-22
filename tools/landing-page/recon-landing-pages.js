#!/usr/bin/env node

/**
 * recon-landing-pages.js
 *
 * Reconnaissance script for CLIENTA geo landing page creation.
 * Logs into WP admin, inspects the landing page post type,
 * maps editor fields, checks REST API, and documents findings.
 *
 * Usage:
 *   node tools/landing-page/recon-landing-pages.js \
 *     --user your-wp-admin-user \
 *     --pass "password" \
 *     --output-dir _dev/reports/landing-page-recon/
 *
 * Optional:
 *   --headed           Run with visible browser (default: headless)
 *   --site-url <url>   Override site URL (default: https://client-a-staging.example)
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const opts = {
    user: null,
    pass: null,
    siteUrl: 'https://client-a-staging.example',
    outputDir: null,
    headed: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--user': opts.user = args[++i]; break;
      case '--pass': opts.pass = args[++i]; break;
      // --pass-env is unreliable due to bash ! expansion; use --pass-file instead
      case '--pass-env': opts.pass = process.env[args[++i]] || ''; break;
      case '--pass-file': opts.pass = require('fs').readFileSync(args[++i], 'utf8').trim(); break;
      case '--site-url': opts.siteUrl = args[++i]; break;
      case '--output-dir': opts.outputDir = args[++i]; break;
      case '--headed': opts.headed = true; break;
      case '--help': case '-h':
        console.log(`Usage: node recon-landing-pages.js --user <wp-user> --pass <wp-pass> --output-dir <path>

Recon for CLIENTA landing page creation via Playwright.

Required:
  --user <username>    WordPress admin username
  --pass <password>    WordPress admin password
  --output-dir <path>  Where to write recon output

Options:
  --site-url <url>     Site URL (default: https://client-a-staging.example)
  --headed             Show browser window
  --help, -h           Show this help
`);
        process.exit(0);
    }
  }
  return opts;
}

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Recon tasks
// ---------------------------------------------------------------------------

/**
 * Phase 1: Login to WordPress admin
 */
async function login(page, siteUrl, user, pass) {
  console.log('\n=== Phase 1: Login ===');
  await page.goto(`${siteUrl}/wp-login.php`, { waitUntil: 'networkidle' });

  // Check if already logged in (redirected to dashboard)
  if (page.url().includes('wp-admin') && !page.url().includes('wp-login')) {
    console.log('Already logged in (session active)');
    return true;
  }

  await page.fill('#user_login', user);
  await page.fill('#user_pass', pass);
  await page.check('#rememberme');

  // Click submit and wait for navigation
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
    page.click('#wp-submit')
  ]);

  const url = page.url();
  console.log(`After login, URL: ${url}`);

  // Check for login error
  const loginError = await page.$('#login_error');
  if (loginError) {
    const errorText = await loginError.textContent();
    die(`Login failed: ${errorText.trim()}`);
  }

  if (url.includes('wp-login')) {
    // May need to handle intermediate redirect
    console.log('Still on login page, waiting...');
    await page.waitForTimeout(3000);
    await page.goto(`${siteUrl}/wp-admin/`, { waitUntil: 'networkidle', timeout: 30000 });
  }

  console.log(`Logged in as ${user} -> ${page.url()}`);
  return true;
}

/**
 * Phase 2: List existing landing pages
 */
async function listExistingPages(page, siteUrl) {
  console.log('\n=== Phase 2: Existing Landing Pages ===');
  await page.goto(`${siteUrl}/wp-admin/edit.php?post_type=clienta_landing_page`, {
    waitUntil: 'networkidle'
  });

  const pages = await page.evaluate(() => {
    const rows = document.querySelectorAll('#the-list tr');
    return Array.from(rows).map(row => {
      const titleLink = row.querySelector('.row-title');
      const viewLink = row.querySelector('.view a');
      const statusEl = row.querySelector('.post-state');
      const dateEl = row.querySelector('.date .published');
      return {
        title: titleLink?.textContent?.trim() || '',
        editUrl: titleLink?.getAttribute('href') || '',
        viewUrl: viewLink?.getAttribute('href') || '',
        status: statusEl?.textContent?.trim() || 'Published',
        date: dateEl?.textContent?.trim() || '',
        postId: (titleLink?.getAttribute('href') || '').match(/post=(\d+)/)?.[1] || ''
      };
    }).filter(p => p.title);
  });

  console.log(`Found ${pages.length} landing page(s):`);
  pages.forEach(p => console.log(`  - [${p.postId}] ${p.title} (${p.status}) -> ${p.viewUrl}`));
  return pages;
}

/**
 * Phase 3: Inspect "Add New Landing Page" editor to map fields
 */
async function inspectEditorFields(page, siteUrl) {
  console.log('\n=== Phase 3: Editor Field Mapping ===');
  await page.goto(`${siteUrl}/wp-admin/post-new.php?post_type=clienta_landing_page`, {
    waitUntil: 'networkidle'
  });

  // Wait for editor to fully initialize
  await page.waitForTimeout(2000);

  // Capture all form fields, meta boxes, and their structure
  const editorData = await page.evaluate(() => {
    const result = {
      title: null,
      slug: null,
      metaBoxes: [],
      textFields: [],
      textareas: [],
      selects: [],
      checkboxes: [],
      taxonomyBoxes: [],
      breakdanceBtn: null,
      publishBox: null
    };

    // Title field
    const titleField = document.querySelector('#title') || document.querySelector('[name="post_title"]');
    if (titleField) result.title = { id: titleField.id, name: titleField.name, type: titleField.type };

    // Slug field
    const slugField = document.querySelector('#post_name') || document.querySelector('[name="post_name"]');
    if (slugField) result.slug = { id: slugField.id, name: slugField.name };

    // All meta boxes
    const metaBoxes = document.querySelectorAll('.postbox');
    result.metaBoxes = Array.from(metaBoxes).map(box => {
      const heading = box.querySelector('.hndle, .postbox-header h2, .postbox-header button');
      const fields = box.querySelectorAll('input, textarea, select');
      return {
        id: box.id,
        title: heading?.textContent?.trim() || '',
        fieldCount: fields.length,
        fields: Array.from(fields).slice(0, 20).map(f => ({
          tag: f.tagName.toLowerCase(),
          type: f.type || '',
          name: f.name || '',
          id: f.id || '',
          placeholder: f.placeholder || '',
          value: f.value || '',
          label: f.closest('label')?.textContent?.trim()
            || document.querySelector(`label[for="${f.id}"]`)?.textContent?.trim()
            || ''
        }))
      };
    });

    // Taxonomy meta boxes specifically
    const taxBoxes = document.querySelectorAll('[id^="taxonomy-"], [id$="-all"], .categorydiv, .tagsdiv');
    result.taxonomyBoxes = Array.from(new Set(
      Array.from(taxBoxes).map(el => {
        const box = el.closest('.postbox');
        return box ? { id: box.id, title: box.querySelector('.hndle')?.textContent?.trim() || '' } : null;
      }).filter(Boolean)
    ));

    // Breakdance edit button
    const bdBtn = document.querySelector('[href*="breakdance"], .breakdance-edit-link, [data-breakdance]');
    if (bdBtn) result.breakdanceBtn = { href: bdBtn.href || '', text: bdBtn.textContent?.trim() || '' };

    // Also look for breakdance in scripts
    const scripts = document.querySelectorAll('script');
    scripts.forEach(s => {
      if (s.textContent.includes('breakdance') && !result.breakdanceBtn) {
        result.breakdanceBtn = { note: 'Breakdance JS detected in page scripts' };
      }
    });

    // Publish box
    const publishBox = document.querySelector('#submitdiv');
    if (publishBox) {
      const publishBtn = publishBox.querySelector('#publish, [name="publish"]');
      const saveDraft = publishBox.querySelector('#save-post, [name="save"]');
      result.publishBox = {
        publishBtn: publishBtn ? { id: publishBtn.id, value: publishBtn.value } : null,
        saveDraft: saveDraft ? { id: saveDraft.id, value: saveDraft.value } : null
      };
    }

    return result;
  });

  console.log('Title field:', editorData.title);
  console.log('Slug field:', editorData.slug);
  console.log(`Meta boxes (${editorData.metaBoxes.length}):`);
  editorData.metaBoxes.forEach(mb => {
    console.log(`  [${mb.id}] "${mb.title}" — ${mb.fieldCount} fields`);
  });
  console.log('Taxonomy boxes:', editorData.taxonomyBoxes);
  console.log('Breakdance button:', editorData.breakdanceBtn);
  console.log('Publish box:', editorData.publishBox);

  // Take a screenshot of the editor
  return editorData;
}

/**
 * Phase 4: Inspect existing landing page edit screen
 */
async function inspectExistingPage(page, siteUrl, postId) {
  console.log(`\n=== Phase 4: Inspect Existing Page (post ${postId}) ===`);
  await page.goto(`${siteUrl}/wp-admin/post.php?post=${postId}&action=edit`, {
    waitUntil: 'networkidle'
  });
  await page.waitForTimeout(2000);

  const pageData = await page.evaluate(() => {
    const result = {
      title: '',
      slug: '',
      status: '',
      allFields: {},
      metaBoxContents: []
    };

    // Title
    const titleEl = document.querySelector('#title');
    if (titleEl) result.title = titleEl.value;

    // Slug
    const slugEl = document.querySelector('#post_name');
    if (slugEl) result.slug = slugEl.value;

    // Status
    const statusEl = document.querySelector('#post-status-display, #post_status');
    if (statusEl) result.status = statusEl.textContent?.trim() || statusEl.value;

    // All named input fields with values
    const allInputs = document.querySelectorAll('#post-body input[name], #post-body textarea[name], #post-body select[name]');
    allInputs.forEach(el => {
      const name = el.name;
      if (name && !name.startsWith('_') && !name.startsWith('tax_input') && el.type !== 'hidden') {
        result.allFields[name] = {
          type: el.type || el.tagName.toLowerCase(),
          value: el.type === 'checkbox' ? el.checked : el.value,
          label: document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() || ''
        };
      }
    });

    // Meta box contents with values
    const metaBoxes = document.querySelectorAll('#post-body .postbox');
    result.metaBoxContents = Array.from(metaBoxes).map(box => {
      const heading = box.querySelector('.hndle, .postbox-header h2, .postbox-header button');
      const fields = box.querySelectorAll('input, textarea, select');
      return {
        id: box.id,
        title: heading?.textContent?.trim() || '',
        visibleFields: Array.from(fields)
          .filter(f => f.type !== 'hidden' && f.name && !f.name.startsWith('_'))
          .map(f => ({
            name: f.name,
            type: f.type || f.tagName.toLowerCase(),
            value: f.type === 'checkbox' ? f.checked : f.value?.substring(0, 200),
            label: document.querySelector(`label[for="${f.id}"]`)?.textContent?.trim() || '',
            id: f.id
          }))
      };
    }).filter(mb => mb.visibleFields.length > 0);

    // Taxonomy selections
    const checkedTaxonomies = document.querySelectorAll('.categorychecklist input:checked');
    result.selectedTaxonomies = Array.from(checkedTaxonomies).map(cb => ({
      name: cb.name,
      value: cb.value,
      label: cb.closest('label')?.textContent?.trim() || ''
    }));

    return result;
  });

  console.log(`Title: "${pageData.title}"`);
  console.log(`Slug: "${pageData.slug}"`);
  console.log(`Status: ${pageData.status}`);
  console.log(`Named fields with values (${Object.keys(pageData.allFields).length}):`);
  Object.entries(pageData.allFields).forEach(([name, info]) => {
    console.log(`  ${name}: ${JSON.stringify(info.value).substring(0, 80)} (${info.type})`);
  });
  console.log(`Meta boxes with visible fields:`);
  pageData.metaBoxContents.forEach(mb => {
    console.log(`  [${mb.id}] "${mb.title}"`);
    mb.visibleFields.forEach(f => {
      console.log(`    ${f.name} = ${JSON.stringify(f.value).substring(0, 80)} (${f.type}) label:"${f.label}"`);
    });
  });
  console.log('Selected taxonomies:', pageData.selectedTaxonomies);
  return pageData;
}

/**
 * Phase 5: Check REST API for clienta_landing_page
 */
async function checkRestApi(page, siteUrl) {
  console.log('\n=== Phase 5: REST API Check ===');

  const apiData = await page.evaluate(async (baseUrl) => {
    const results = { endpoints: [], samplePage: null, error: null };

    // Check if the REST API endpoint exists for this post type
    try {
      const typesResp = await fetch(`${baseUrl}/wp-json/wp/v2/types`, { credentials: 'include' });
      const types = await typesResp.json();
      results.endpoints = Object.entries(types).map(([key, val]) => ({
        slug: key,
        name: val.name,
        restBase: val.rest_base,
        restNamespace: val.rest_namespace
      }));
    } catch (e) {
      results.error = `Types fetch failed: ${e.message}`;
    }

    // Try to read clienta_landing_page via various possible REST bases
    const possibleBases = ['clienta_landing_page', 'clienta-landing-page', 'landing-pages', 'landing_pages'];
    for (const base of possibleBases) {
      try {
        const resp = await fetch(`${baseUrl}/wp-json/wp/v2/${base}?per_page=1&context=edit`, {
          credentials: 'include'
        });
        if (resp.ok) {
          const data = await resp.json();
          results.samplePage = {
            restBase: base,
            count: data.length,
            fields: data[0] ? Object.keys(data[0]) : [],
            sample: data[0] ? {
              id: data[0].id,
              title: data[0].title?.rendered || data[0].title,
              slug: data[0].slug,
              status: data[0].status,
              meta: data[0].meta || {},
              type: data[0].type
            } : null
          };
          break;
        }
      } catch { /* try next */ }
    }

    return results;
  }, siteUrl);

  // Find landing page in registered types
  const landingType = apiData.endpoints.find(e =>
    e.slug === 'clienta_landing_page' || e.name?.toLowerCase().includes('landing')
  );

  if (landingType) {
    console.log(`Landing page type found: ${landingType.slug}`);
    console.log(`  REST base: ${landingType.restBase || 'unknown'}`);
  } else {
    console.log('Landing page type NOT found in registered types');
    console.log('Available types:', apiData.endpoints.map(e => e.slug).join(', '));
  }

  if (apiData.samplePage) {
    console.log(`\nREST API accessible at: /wp-json/wp/v2/${apiData.samplePage.restBase}`);
    console.log(`Fields available: ${apiData.samplePage.fields.join(', ')}`);
    if (apiData.samplePage.sample) {
      console.log(`Sample page: [${apiData.samplePage.sample.id}] "${apiData.samplePage.sample.title}"`);
      console.log(`Meta keys: ${JSON.stringify(apiData.samplePage.sample.meta)}`);
    }
  } else {
    console.log('Could not access landing pages via REST API (may not be exposed)');
  }

  if (apiData.error) console.log(`Error: ${apiData.error}`);
  return apiData;
}

/**
 * Phase 6: Check Breakdance templates
 */
async function checkBreakdanceTemplates(page, siteUrl) {
  console.log('\n=== Phase 6: Breakdance Templates ===');
  await page.goto(`${siteUrl}/wp-admin/admin.php?page=breakdance_template`, {
    waitUntil: 'networkidle'
  });

  const templates = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr, .breakdance-templates-list .template-item, [data-template]');
    return Array.from(rows).map(row => {
      const links = row.querySelectorAll('a');
      const cells = row.querySelectorAll('td');
      return {
        text: row.textContent?.trim()?.substring(0, 200) || '',
        links: Array.from(links).map(a => ({ text: a.textContent?.trim(), href: a.href })),
        cells: Array.from(cells).map(c => c.textContent?.trim()?.substring(0, 100))
      };
    });
  });

  console.log(`Found ${templates.length} template entries`);
  templates.forEach((t, i) => {
    console.log(`  ${i + 1}: ${t.text.substring(0, 120)}`);
  });

  // Also check Global Blocks
  await page.goto(`${siteUrl}/wp-admin/admin.php?page=breakdance_block`, {
    waitUntil: 'networkidle'
  });

  const blocks = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr, .breakdance-blocks-list .block-item');
    return Array.from(rows).map(row => ({
      text: row.textContent?.trim()?.substring(0, 200) || ''
    }));
  });

  console.log(`\nGlobal Blocks: ${blocks.length} entries`);
  blocks.forEach((b, i) => console.log(`  ${i + 1}: ${b.text.substring(0, 120)}`));

  return { templates, blocks };
}

/**
 * Phase 7: Check frontend structure of existing page
 */
async function checkFrontendStructure(page, siteUrl, viewUrl) {
  console.log('\n=== Phase 7: Frontend Structure ===');
  const fullUrl = viewUrl.startsWith('http') ? viewUrl : `${siteUrl}${viewUrl}`;
  await page.goto(fullUrl, { waitUntil: 'networkidle' });

  const structure = await page.evaluate(() => {
    // Get all major sections
    const sections = document.querySelectorAll('section, [class*="bde-section"], [class*="clienta-"], main > div, [class*="landing"]');
    const sectionData = Array.from(sections).map(s => {
      const heading = s.querySelector('h1, h2, h3');
      const classes = s.className || '';
      const id = s.id || '';
      return {
        tag: s.tagName.toLowerCase(),
        id,
        classes: classes.substring(0, 150),
        heading: heading?.textContent?.trim()?.substring(0, 100) || '',
        childCount: s.children.length,
        hasVehicleSlider: !!s.querySelector('[class*="vehicle"], [class*="slider"], [class*="carousel"]'),
        hasForm: !!s.querySelector('form'),
        hasAccordion: !!s.querySelector('[class*="accordion"], [class*="faq"], details')
      };
    });

    // Find the vehicle slider/carousel specifically
    const vehicleSlider = document.querySelector('[class*="vehicle-slider"], [class*="vehicle-carousel"], [data-vehicle]');
    let vehicleSliderInfo = null;
    if (vehicleSlider) {
      vehicleSliderInfo = {
        classes: vehicleSlider.className,
        id: vehicleSlider.id,
        childCount: vehicleSlider.children.length,
        vehicleCards: document.querySelectorAll('[class*="vehicle-card"], [class*="clienta-card"]').length
      };
    }

    // Check for body_type filter issue
    const brokenLinks = Array.from(document.querySelectorAll('a')).filter(a =>
      a.href.includes('[body_type]') || a.href.includes('%5Bbody_type%5D')
    ).map(a => ({ text: a.textContent?.trim(), href: a.href }));

    // Check for old URL patterns
    const oldPatternLinks = Array.from(document.querySelectorAll('a')).filter(a =>
      a.href.includes('/step-1') || a.href.includes('/listings/')
    ).map(a => ({ text: a.textContent?.trim()?.substring(0, 50), href: a.href }));

    return { sections: sectionData, vehicleSliderInfo, brokenLinks, oldPatternLinks };
  });

  console.log(`Page sections (${structure.sections.length}):`);
  structure.sections.forEach((s, i) => {
    const flags = [
      s.hasVehicleSlider && 'VEHICLE_SLIDER',
      s.hasForm && 'FORM',
      s.hasAccordion && 'ACCORDION'
    ].filter(Boolean).join(', ');
    console.log(`  ${i + 1}. <${s.tag}> "${s.heading}" [${s.classes.substring(0, 60)}] ${flags ? `(${flags})` : ''}`);
  });

  if (structure.vehicleSliderInfo) {
    console.log(`\nVehicle slider: ${structure.vehicleSliderInfo.vehicleCards} cards`);
    console.log(`  Classes: ${structure.vehicleSliderInfo.classes}`);
  }

  if (structure.brokenLinks.length) {
    console.log(`\nBROKEN LINKS (literal [body_type]):`);
    structure.brokenLinks.forEach(l => console.log(`  ${l.text}: ${l.href}`));
  }

  if (structure.oldPatternLinks.length) {
    console.log(`\nOLD URL PATTERNS found:`);
    structure.oldPatternLinks.forEach(l => console.log(`  ${l.text}: ${l.href}`));
  }

  // Take a full-page screenshot
  return structure;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.user) die('--user is required');
  if (!opts.pass) die('--pass is required');
  if (!opts.outputDir) die('--output-dir is required');

  const { chromium } = require('playwright');

  const outputDir = path.resolve(opts.outputDir);
  fs.mkdirSync(path.join(outputDir, 'screenshots'), { recursive: true });

  console.log(`Site:   ${opts.siteUrl}`);
  console.log(`Output: ${outputDir}`);
  console.log(`Mode:   ${opts.headed ? 'headed' : 'headless'}`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: !opts.headed,
      args: ['--disable-blink-features=AutomationControlled', '--no-first-run']
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    const results = {};

    // Phase 1: Login
    await login(page, opts.siteUrl, opts.user, opts.pass);

    // Phase 2: List existing pages
    results.existingPages = await listExistingPages(page, opts.siteUrl);

    // Phase 3: Inspect editor fields (Add New)
    results.editorFields = await inspectEditorFields(page, opts.siteUrl);
    await page.screenshot({ path: path.join(outputDir, 'screenshots', 'editor-new.png'), fullPage: true });

    // Phase 4: Inspect existing page if any exist
    if (results.existingPages.length > 0) {
      const postId = results.existingPages[0].postId;
      results.existingPageData = await inspectExistingPage(page, opts.siteUrl, postId);
      await page.screenshot({ path: path.join(outputDir, 'screenshots', 'editor-existing.png'), fullPage: true });
    }

    // Phase 5: REST API check
    results.restApi = await checkRestApi(page, opts.siteUrl);

    // Phase 6: Breakdance templates
    results.breakdance = await checkBreakdanceTemplates(page, opts.siteUrl);

    // Phase 7: Frontend structure of existing page
    if (results.existingPages.length > 0 && results.existingPages[0].viewUrl) {
      results.frontendStructure = await checkFrontendStructure(
        page, opts.siteUrl, results.existingPages[0].viewUrl
      );
      await page.screenshot({ path: path.join(outputDir, 'screenshots', 'frontend.png'), fullPage: true });
    }

    // Write consolidated findings
    console.log('\n=== Writing Results ===');
    const outputFile = path.join(outputDir, 'recon-results.json');
    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
    console.log(`Results written to: ${outputFile}`);

    // Summary
    console.log('\n========================================');
    console.log('RECON SUMMARY');
    console.log('========================================');
    console.log(`Existing pages: ${results.existingPages.length}`);
    console.log(`Editor meta boxes: ${results.editorFields?.metaBoxes?.length || 0}`);
    console.log(`REST API accessible: ${results.restApi?.samplePage ? 'YES' : 'NO'}`);
    console.log(`Breakdance templates: ${results.breakdance?.templates?.length || 0}`);
    console.log(`Frontend sections: ${results.frontendStructure?.sections?.length || 0}`);
    console.log(`Vehicle slider found: ${results.frontendStructure?.vehicleSliderInfo ? 'YES' : 'NO'}`);
    console.log(`Broken links: ${results.frontendStructure?.brokenLinks?.length || 0}`);
    console.log(`Old URL patterns: ${results.frontendStructure?.oldPatternLinks?.length || 0}`);

    await browser.close();
    console.log('\nDone.');

  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    console.error(err.stack);
    if (browser) await browser.close();
    process.exit(1);
  }
}

main();
