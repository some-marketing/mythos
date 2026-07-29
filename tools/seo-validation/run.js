#!/usr/bin/env node
/**
 * SEO Validation Runner
 *
 * Playwright-based pre-launch SEO validation crawl.
 * Discovers pages via sitemap, renders in a real browser, extracts and validates
 * SEO signals, checks mobile rendering, and produces a findings report.
 *
 * Usage:
 *   node tools/seo-validation/run.js --site <url> --output <dir> [--config <path>] [--mobile] [--screenshots]
 */

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// --- CLI args ---
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  return args[idx + 1] || null;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const siteUrl = getArg('site');
const outputDir = getArg('output') || 'seo-validation-output';
const configPath = getArg('config');
const doMobile = hasFlag('mobile');
const doScreenshots = hasFlag('screenshots');

if (!siteUrl) {
  console.error('Usage: node run.js --site <url> --output <dir> [--config <path>] [--mobile] [--screenshots]');
  process.exit(1);
}

// --- Config ---
const DEFAULT_CHECK_CONFIG = {
  thresholds: {
    'alt-text-warn': 0.80,
    'alt-text-fail': 0.50,
    'title-min-length': 30,
    'title-max-length': 60,
    'meta-description-min-length': 120,
    'meta-description-max-length': 160,
  },
  skip_checks: [],
  structured_data_expected_types: {
    homepage: ['Organization'],
  },
  mobile_devices: ['iPhone 14', 'Pixel 7'],
  max_pages: 500,
  crawl_delay_ms: 500,
  external_link_timeout_ms: 3000,
  external_link_concurrency: 50,
  mobile_sample_max: 15,
  dynamic_url_patterns: [],
};

let siteConfig = {};
let checkConfig = { ...DEFAULT_CHECK_CONFIG };

// --- Helpers ---
const { discover } = require('./lib/discover');
const { extractPage } = require('./lib/extract');
const { runChecks } = require('./lib/checks');
const { runMobileChecks } = require('./lib/mobile');
const { generateReport } = require('./lib/report');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function slug(url) {
  const u = new URL(url);
  let s = u.pathname.replace(/^\/|\/$/g, '').replace(/\//g, '__') || 'index';
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// --- Main ---
async function main() {
  console.log(`[seo-validation] Starting crawl of ${siteUrl}`);
  const startTime = Date.now();

  // Load configs
  if (configPath && fs.existsSync(configPath)) {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (raw.site) siteConfig = raw.site;
    if (raw.checks) checkConfig = { ...DEFAULT_CHECK_CONFIG, ...raw.checks };
    // Site-config may also contain check-relevant fields at the top level
    if (raw.dynamic_url_patterns) checkConfig.dynamic_url_patterns = raw.dynamic_url_patterns;
    if (raw.site_url) siteConfig.site_url = raw.site_url;
    if (raw.auth) siteConfig.auth = raw.auth;
    if (raw.scope) siteConfig.scope = raw.scope;
  }

  // Setup output dirs
  ensureDir(path.join(outputDir, 'crawl', 'extracted'));
  ensureDir(path.join(outputDir, 'checks'));
  ensureDir(path.join(outputDir, 'reports'));
  if (doMobile) {
    ensureDir(path.join(outputDir, 'mobile', 'screenshots'));
  }

  // Phase 1: Site discovery
  console.log('[seo-validation] Phase 1: Site discovery');
  const inventory = await discover(siteUrl, siteConfig, checkConfig);
  fs.writeFileSync(
    path.join(outputDir, 'crawl', 'page-inventory.json'),
    JSON.stringify(inventory, null, 2)
  );
  console.log(`[seo-validation] Discovered ${inventory.pages.length} in-scope pages`);

  if (inventory.pages.length === 0) {
    console.error('[seo-validation] No pages found. Aborting.');
    process.exit(1);
  }

  // Phase 2: Crawl and extract
  console.log('[seo-validation] Phase 2: Crawl and extract');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...(siteConfig.auth?.type === 'basic' ? {
      httpCredentials: siteConfig.auth.credentials
    } : {}),
  });

  const extracted = [];
  const errors = [];

  for (const page of inventory.pages) {
    try {
      const data = await extractPage(context, page, slug);
      fs.writeFileSync(
        path.join(outputDir, 'crawl', 'extracted', `${slug(page.url)}.json`),
        JSON.stringify(data, null, 2)
      );
      extracted.push(data);
    } catch (err) {
      errors.push({ url: page.url, error: err.message });
      console.warn(`[seo-validation] Failed: ${page.url} — ${err.message}`);
    }
    await new Promise(r => setTimeout(r, checkConfig.crawl_delay_ms));
  }

  await browser.close();

  const crawlSummary = {
    crawled_at: new Date().toISOString(),
    total_pages: inventory.pages.length,
    successful: extracted.length,
    failed: errors.length,
    errors,
    extraction_stats: {
      pages_with_h1: extracted.filter(p => p.h1_tags.length > 0).length,
      pages_with_canonical: extracted.filter(p => p.canonical).length,
      pages_with_og: extracted.filter(p => p.og_tags && p.og_tags['og:title']).length,
      pages_with_structured_data: extracted.filter(p => p.structured_data.length > 0).length,
      total_images: extracted.reduce((s, p) => s + p.images.length, 0),
      total_internal_links: extracted.reduce((s, p) => s + p.internal_links.length, 0),
      total_external_links: extracted.reduce((s, p) => s + p.external_links.length, 0),
    },
  };
  fs.writeFileSync(
    path.join(outputDir, 'crawl', 'crawl-summary.json'),
    JSON.stringify(crawlSummary, null, 2)
  );
  console.log(`[seo-validation] Crawled ${extracted.length} pages (${errors.length} errors)`);

  // Phase 3: Validation checks
  console.log('[seo-validation] Phase 3: Validation checks');
  const checkResults = await runChecks(extracted, inventory, checkConfig, outputDir);
  fs.writeFileSync(
    path.join(outputDir, 'checks', 'results.json'),
    JSON.stringify(checkResults, null, 2)
  );
  console.log(`[seo-validation] Checks: ${checkResults.passed} passed, ${checkResults.failed} failed, ${checkResults.warned} warned`);

  // Phase 4: Mobile (optional)
  let mobileResults = null;
  if (doMobile) {
    console.log('[seo-validation] Phase 4: Mobile rendering checks');
    mobileResults = await runMobileChecks(
      inventory.pages,
      siteConfig,
      checkConfig,
      outputDir,
      doScreenshots
    );
    fs.writeFileSync(
      path.join(outputDir, 'mobile', 'results.json'),
      JSON.stringify(mobileResults, null, 2)
    );
    console.log(`[seo-validation] Mobile: ${mobileResults.pages_tested} pages tested on ${mobileResults.devices.length} devices`);
  }

  // Phase 5: Report
  console.log('[seo-validation] Phase 5: Generating report');
  const report = generateReport(inventory, crawlSummary, checkResults, mobileResults);
  fs.writeFileSync(path.join(outputDir, 'reports', 'summary.json'), JSON.stringify(report.summary, null, 2));
  fs.writeFileSync(path.join(outputDir, 'reports', 'findings.md'), report.markdown);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[seo-validation] Complete in ${elapsed}s. Report: ${path.join(outputDir, 'reports', 'findings.md')}`);
  console.log(`[seo-validation] Overall health: ${report.summary.overall_health}`);
}

main().catch(err => {
  console.error('[seo-validation] Fatal:', err);
  process.exit(1);
});
