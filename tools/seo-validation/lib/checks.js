/**
 * checks.js — SEO validation checks against extracted page data.
 *
 * Runs page-level and site-level checks, respecting skip lists and
 * configurable thresholds. Writes detail files when affected URL count
 * exceeds 10.
 *
 * @param {Array} extracted  - Per-page extraction objects (from extract.js)
 * @param {Object} inventory - Page inventory object (from discover.js)
 * @param {Object} checkConfig - { thresholds, skip_checks, structured_data_expected_types, external_link_timeout_ms, external_link_concurrency }
 * @param {string} outputDir - Output directory path
 * @returns {Object} { checked_at, total_checks, passed, failed, warned, results }
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a URL for comparison: strip trailing slash, lowercase. */
function normalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    u.hash = '';
    let s = u.toString();
    return s.replace(/\/+$/, '').toLowerCase();
  } catch {
    return String(url).replace(/\/+$/, '').toLowerCase();
  }
}

/** HEAD request with timeout, follows redirects up to 5 hops. Returns { status, ok, error }. */
function headRequest(url, timeoutMs, maxRedirects = 5) {
  return new Promise((resolve) => {
    if (maxRedirects <= 0) {
      resolve({ status: 0, ok: false, error: 'Too many redirects' });
      return;
    }
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, { method: 'HEAD', timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        headRequest(next, timeoutMs, maxRedirects - 1).then(resolve);
        return;
      }
      resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 400, error: null });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, ok: false, error: 'Timeout' }); });
    req.on('error', (err) => { resolve({ status: 0, ok: false, error: err.message }); });
    req.end();
  });
}

/** Run an array of promises with a concurrency limit. */
async function promisePool(tasks, concurrency) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(concurrency, tasks.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

/** Build a check result object. */
function result(checkId, checkName, scope, status, summary, evidence) {
  return { check_id: checkId, check_name: checkName, scope, status, summary, affected_urls: evidence.map(e => e.url), evidence };
}

/** Write detail files for checks with many affected URLs. */
function writeDetailIfNeeded(checkResult, outputDir) {
  if (checkResult.affected_urls.length > 10) {
    const checksDir = path.join(outputDir, 'checks');
    fs.mkdirSync(checksDir, { recursive: true });
    fs.writeFileSync(
      path.join(checksDir, `${checkResult.check_id}.json`),
      JSON.stringify({ check_id: checkResult.check_id, evidence: checkResult.evidence }, null, 2)
    );
  }
}

// ---------------------------------------------------------------------------
// Page-level checks
// ---------------------------------------------------------------------------

function checkH1Presence(extracted) {
  const evidence = [];
  for (const page of extracted) {
    const count = page.h1_tags ? page.h1_tags.length : 0;
    if (count === 0) {
      evidence.push({ url: page.url, detail: 'No H1 tag found' });
    } else if (count > 1) {
      evidence.push({ url: page.url, detail: `${count} H1 tags found: ${page.h1_tags.join(' | ')}` });
    }
  }
  const status = evidence.length > 0 ? 'fail' : 'pass';
  const summary = evidence.length === 0
    ? 'All pages have exactly one H1'
    : `${evidence.length} page(s) have missing or multiple H1 tags`;
  return result('h1-presence', 'H1 Presence', 'page', status, summary, evidence);
}

function checkTitlePresence(extracted) {
  const evidence = [];
  for (const page of extracted) {
    if (!page.title || page.title.trim() === '') {
      evidence.push({ url: page.url, detail: 'Missing or empty title tag' });
    }
  }
  const status = evidence.length > 0 ? 'fail' : 'pass';
  const summary = evidence.length === 0
    ? 'All pages have a title tag'
    : `${evidence.length} page(s) missing title tag`;
  return result('title-presence', 'Title Presence', 'page', status, summary, evidence);
}

function checkTitleLength(extracted, thresholds) {
  const min = thresholds['title-min-length'] || 30;
  const max = thresholds['title-max-length'] || 60;
  const evidence = [];
  for (const page of extracted) {
    if (!page.title) continue; // covered by title-presence
    const len = page.title.length;
    if (len < min) {
      evidence.push({ url: page.url, detail: `Title too short (${len} chars, min ${min}): "${page.title}"` });
    } else if (len > max) {
      evidence.push({ url: page.url, detail: `Title too long (${len} chars, max ${max}): "${page.title}"` });
    }
  }
  const status = evidence.length > 0 ? 'warn' : 'pass';
  const summary = evidence.length === 0
    ? `All titles within ${min}-${max} char range`
    : `${evidence.length} page(s) with title length outside ${min}-${max} chars`;
  return result('title-length', 'Title Length', 'page', status, summary, evidence);
}

function checkMetaDescriptionPresence(extracted) {
  const evidence = [];
  for (const page of extracted) {
    if (!page.meta_description || page.meta_description.trim() === '') {
      evidence.push({ url: page.url, detail: 'Missing or empty meta description' });
    }
  }
  const status = evidence.length > 0 ? 'warn' : 'pass';
  const summary = evidence.length === 0
    ? 'All pages have a meta description'
    : `${evidence.length} page(s) missing meta description`;
  return result('meta-description-presence', 'Meta Description Presence', 'page', status, summary, evidence);
}

function checkMetaDescriptionLength(extracted, thresholds) {
  const min = thresholds['meta-description-min-length'] || 120;
  const max = thresholds['meta-description-max-length'] || 160;
  const evidence = [];
  for (const page of extracted) {
    if (!page.meta_description) continue; // covered by presence check
    const len = page.meta_description.length;
    if (len < min) {
      evidence.push({ url: page.url, detail: `Meta description too short (${len} chars, min ${min})` });
    } else if (len > max) {
      evidence.push({ url: page.url, detail: `Meta description too long (${len} chars, max ${max})` });
    }
  }
  const status = evidence.length > 0 ? 'warn' : 'pass';
  const summary = evidence.length === 0
    ? `All meta descriptions within ${min}-${max} char range`
    : `${evidence.length} page(s) with meta description length outside ${min}-${max} chars`;
  return result('meta-description-length', 'Meta Description Length', 'page', status, summary, evidence);
}

function checkCanonicalPresence(extracted) {
  const evidence = [];
  for (const page of extracted) {
    if (!page.canonical || page.canonical.trim() === '') {
      evidence.push({ url: page.url, detail: 'Missing canonical tag' });
    }
  }
  const status = evidence.length > 0 ? 'fail' : 'pass';
  const summary = evidence.length === 0
    ? 'All pages have a canonical tag'
    : `${evidence.length} page(s) missing canonical tag`;
  return result('canonical-presence', 'Canonical Presence', 'page', status, summary, evidence);
}

function checkCanonicalSelfReferencing(extracted) {
  const evidence = [];
  for (const page of extracted) {
    if (!page.canonical) continue; // covered by canonical-presence
    const pageNorm = normalizeUrl(page.url);
    const canonNorm = normalizeUrl(page.canonical);
    if (pageNorm !== canonNorm) {
      evidence.push({ url: page.url, detail: `Canonical "${page.canonical}" does not match page URL` });
    }
  }
  const status = evidence.length > 0 ? 'warn' : 'pass';
  const summary = evidence.length === 0
    ? 'All canonical tags are self-referencing'
    : `${evidence.length} page(s) have non-self-referencing canonical tags`;
  return result('canonical-self-referencing', 'Canonical Self-Referencing', 'page', status, summary, evidence);
}

function checkOgRequiredTags(extracted) {
  const required = ['og:title', 'og:description', 'og:image', 'og:url'];
  const evidence = [];
  for (const page of extracted) {
    const og = page.og_tags || {};
    const missing = required.filter(tag => !og[tag] || og[tag].trim() === '');
    if (missing.length > 0) {
      evidence.push({ url: page.url, detail: `Missing OG tags: ${missing.join(', ')}` });
    }
  }
  const status = evidence.length > 0 ? 'fail' : 'pass';
  const summary = evidence.length === 0
    ? 'All pages have required Open Graph tags'
    : `${evidence.length} page(s) missing required OG tags`;
  return result('og-required-tags', 'Open Graph Required Tags', 'page', status, summary, evidence);
}

function checkAltTextPresence(extracted, thresholds) {
  const warnThreshold = thresholds['alt-text-warn'] || 0.80;
  const failThreshold = thresholds['alt-text-fail'] || 0.50;
  const evidence = [];

  for (const page of extracted) {
    const images = page.images || [];
    if (images.length === 0) continue;
    const withAlt = images.filter(img => img.alt && img.alt.trim() !== '').length;
    const ratio = withAlt / images.length;
    if (ratio < failThreshold) {
      evidence.push({ url: page.url, detail: `Alt text coverage ${(ratio * 100).toFixed(1)}% (${withAlt}/${images.length}) — below fail threshold ${(failThreshold * 100).toFixed(0)}%` });
    } else if (ratio < warnThreshold) {
      evidence.push({ url: page.url, detail: `Alt text coverage ${(ratio * 100).toFixed(1)}% (${withAlt}/${images.length}) — below warn threshold ${(warnThreshold * 100).toFixed(0)}%` });
    }
  }

  // Determine overall status from worst case
  let status = 'pass';
  if (evidence.some(e => e.detail.includes('below fail threshold'))) {
    status = 'fail';
  } else if (evidence.length > 0) {
    status = 'warn';
  }

  const totalImages = extracted.reduce((s, p) => s + (p.images || []).length, 0);
  const totalWithAlt = extracted.reduce((s, p) => s + (p.images || []).filter(i => i.alt && i.alt.trim() !== '').length, 0);
  const overallRatio = totalImages > 0 ? (totalWithAlt / totalImages * 100).toFixed(1) : '100.0';

  const summary = status === 'pass'
    ? `Image alt text coverage ${overallRatio}% across ${totalImages} images`
    : `${evidence.length} page(s) below alt text threshold (overall ${overallRatio}% across ${totalImages} images)`;

  return result('alt-text-presence', 'Image Alt Text Presence', 'page', status, summary, evidence);
}

function checkStatusCode(extracted) {
  const evidence = [];
  for (const page of extracted) {
    const code = page.status_code;
    if (code && code !== 200) {
      evidence.push({ url: page.url, detail: `HTTP ${code}` });
    }
  }
  const status = evidence.length > 0 ? 'fail' : 'pass';
  const summary = evidence.length === 0
    ? 'All pages returned HTTP 200'
    : `${evidence.length} page(s) returned non-200 status codes`;
  return result('status-code', 'Status Code', 'page', status, summary, evidence);
}

// ---------------------------------------------------------------------------
// Site-level checks
// ---------------------------------------------------------------------------

function checkH1UniquenessSite(extracted) {
  const seen = new Map(); // lowercase h1 -> [urls]
  for (const page of extracted) {
    for (const h1 of (page.h1_tags || [])) {
      const key = h1.toLowerCase().trim();
      if (!key) continue;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(page.url);
    }
  }

  const evidence = [];
  for (const [h1Text, urls] of seen) {
    if (urls.length > 1) {
      for (const url of urls) {
        evidence.push({ url, detail: `Duplicate H1 "${h1Text}" shared with ${urls.length - 1} other page(s)` });
      }
    }
  }

  const status = evidence.length > 0 ? 'fail' : 'pass';
  const dupeCount = [...seen.values()].filter(v => v.length > 1).length;
  const summary = evidence.length === 0
    ? 'All H1 tags are unique across the site'
    : `${dupeCount} duplicate H1 text(s) found across ${evidence.length} pages`;
  return result('h1-uniqueness-site', 'H1 Uniqueness (Site-Level)', 'site', status, summary, evidence);
}

function checkCanonicalUniqueness(extracted) {
  const seen = new Map(); // normalized canonical -> [urls]
  for (const page of extracted) {
    if (!page.canonical) continue;
    const key = normalizeUrl(page.canonical);
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(page.url);
  }

  const evidence = [];
  for (const [canonical, urls] of seen) {
    if (urls.length > 1) {
      for (const url of urls) {
        evidence.push({ url, detail: `Canonical "${canonical}" claimed by ${urls.length} pages` });
      }
    }
  }

  const status = evidence.length > 0 ? 'fail' : 'pass';
  const conflictCount = [...seen.values()].filter(v => v.length > 1).length;
  const summary = evidence.length === 0
    ? 'All canonical URLs are unique'
    : `${conflictCount} canonical URL(s) claimed by multiple pages`;
  return result('canonical-uniqueness', 'Canonical Uniqueness', 'site', status, summary, evidence);
}

/** Check if a URL is dynamic (query string or known plugin pattern). */
function isDynamicUrl(href, dynamicPatterns) {
  try {
    const u = new URL(href);
    // Any URL with a query string is treated as dynamic
    if (u.search && u.search.length > 1) return true;
  } catch { /* ignore parse errors */ }

  // Check against site-config dynamic_url_patterns
  for (const pattern of (dynamicPatterns || [])) {
    try {
      if (new RegExp(pattern).test(href)) return true;
    } catch { /* skip invalid regex */ }
  }
  return false;
}

async function checkBrokenInternalLinks(extracted, inventory, checkConfig) {
  const dynamicPatterns = (checkConfig && checkConfig.dynamic_url_patterns) || [];
  const timeoutMs = (checkConfig && checkConfig.external_link_timeout_ms) || 3000;

  // Build set of known URLs from extracted pages and inventory
  const knownUrls = new Set();
  for (const page of extracted) {
    knownUrls.add(normalizeUrl(page.url));
  }
  if (inventory && inventory.pages) {
    for (const p of inventory.pages) {
      knownUrls.add(normalizeUrl(p.url));
    }
  }

  // Collect all unique internal link hrefs
  const internalLinks = new Map(); // normalized href -> [source urls]
  for (const page of extracted) {
    for (const link of (page.internal_links || [])) {
      if (!link) continue; // guard null entries
      const href = normalizeUrl(link.href || link);
      if (!href) continue;
      if (!internalLinks.has(href)) internalLinks.set(href, []);
      internalLinks.get(href).push(page.url);
    }
  }

  // Separate static unknown links from dynamic links
  const unknownStatic = [];
  const dynamicToVerify = [];

  for (const [href, sourceUrls] of internalLinks) {
    if (knownUrls.has(href)) continue;
    if (isDynamicUrl(href, dynamicPatterns)) {
      dynamicToVerify.push({ href, sourceUrls });
    } else {
      unknownStatic.push({ href, sourceUrls });
    }
  }

  // HEAD-request dynamic URLs to verify they're reachable
  const dynamicBroken = [];
  if (dynamicToVerify.length > 0) {
    const tasks = dynamicToVerify.map(({ href, sourceUrls }) =>
      () => headRequest(href, timeoutMs).then(res => ({ href, sourceUrls, ...res }))
    );
    const responses = await promisePool(tasks, 10);
    for (const res of responses) {
      if (!res.ok) {
        dynamicBroken.push({ href: res.href, sourceUrls: res.sourceUrls, error: res.error || `HTTP ${res.status}` });
      }
    }
  }

  const evidence = [];

  // Static unknown links are broken
  for (const { href, sourceUrls } of unknownStatic) {
    const uniqueSources = [...new Set(sourceUrls)];
    evidence.push({
      url: href,
      detail: `Internal link not found in site inventory. Linked from ${uniqueSources.length} page(s): ${uniqueSources.slice(0, 5).join(', ')}${uniqueSources.length > 5 ? '...' : ''}`
    });
  }

  // Dynamic links that fail HEAD request are broken
  for (const { href, sourceUrls, error } of dynamicBroken) {
    const uniqueSources = [...new Set(sourceUrls)];
    evidence.push({
      url: href,
      detail: `Dynamic URL unreachable (${error}). Linked from ${uniqueSources.length} page(s): ${uniqueSources.slice(0, 5).join(', ')}${uniqueSources.length > 5 ? '...' : ''}`
    });
  }

  const status = evidence.length > 0 ? 'fail' : 'pass';
  const dynamicPassCount = dynamicToVerify.length - dynamicBroken.length;
  const summary = evidence.length === 0
    ? `All internal links resolve to known pages${dynamicPassCount > 0 ? ` (${dynamicPassCount} dynamic URLs verified via HEAD request)` : ''}`
    : `${evidence.length} internal link target(s) broken${dynamicPassCount > 0 ? ` (${dynamicPassCount} dynamic URLs passed HEAD check)` : ''}`;
  return result('broken-internal-links', 'Broken Internal Links', 'site', status, summary, evidence);
}

async function checkBrokenExternalLinks(extracted, checkConfig) {
  const timeoutMs = checkConfig.external_link_timeout_ms || 3000;
  const concurrency = checkConfig.external_link_concurrency || 50;

  // Collect unique external links -> source pages
  const externalLinks = new Map();
  for (const page of extracted) {
    for (const link of (page.external_links || [])) {
      const href = link.href || link;
      if (!href) continue;
      if (!externalLinks.has(href)) externalLinks.set(href, []);
      externalLinks.get(href).push(page.url);
    }
  }

  const urls = [...externalLinks.keys()];
  if (urls.length === 0) {
    return result('broken-external-links', 'Broken External Links', 'site', 'pass', 'No external links found', []);
  }

  const tasks = urls.map((url) => () => headRequest(url, timeoutMs).then(res => ({ url, ...res })));
  const responses = await promisePool(tasks, concurrency);

  const evidence = [];
  for (const res of responses) {
    if (!res.ok) {
      const sources = externalLinks.get(res.url) || [];
      const uniqueSources = [...new Set(sources)];
      const detail = res.error
        ? `${res.error} — linked from ${uniqueSources.length} page(s)`
        : `HTTP ${res.status} — linked from ${uniqueSources.length} page(s)`;
      evidence.push({ url: res.url, detail });
    }
  }

  const status = evidence.length > 0 ? 'fail' : 'pass';
  const summary = evidence.length === 0
    ? `All ${urls.length} external links are reachable`
    : `${evidence.length} of ${urls.length} external link(s) are broken or unreachable`;
  return result('broken-external-links', 'Broken External Links', 'site', status, summary, evidence);
}

// Schema.org type hierarchy — child types satisfy parent expectations
const TYPE_HIERARCHY = {
  'AutoDealer': ['LocalBusiness', 'Organization'],
  'AutoRepair': ['LocalBusiness', 'Organization'],
  'AutoPartsStore': ['LocalBusiness', 'Organization'],
  'Vehicle': ['Product'],
  'Car': ['Product', 'Vehicle'],
  'CollectionPage': ['WebPage'],
};

/** Extract all @type values from structured data, including @graph arrays. */
function extractStructuredTypes(structuredData) {
  const types = [];
  for (const sd of (structuredData || [])) {
    if (!sd) continue; // guard null entries

    // Parse raw JSON if needed
    let parsed = sd.raw || sd;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { continue; }
    }
    if (!parsed || typeof parsed !== 'object') continue;

    // Direct @type
    if (parsed['@type']) {
      const t = Array.isArray(parsed['@type']) ? parsed['@type'] : [parsed['@type']];
      types.push(...t);
    }

    // @graph array — flatten all @type values from graph nodes
    if (parsed['@graph'] && Array.isArray(parsed['@graph'])) {
      for (const node of parsed['@graph']) {
        if (!node) continue; // guard null graph nodes
        if (node['@type']) {
          const t = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
          types.push(...t);
        }
      }
    }

    // Also check sd.type (from extract.js)
    if (sd.type && !types.includes(sd.type)) {
      types.push(sd.type);
    }
  }
  return types;
}

/** Check if a found type satisfies an expected type via hierarchy. */
function typeSatisfies(foundType, expectedType) {
  if (foundType === expectedType) return true;
  const parents = TYPE_HIERARCHY[foundType] || [];
  return parents.includes(expectedType);
}

function checkStructuredDataPresence(extracted, expectedTypes) {
  if (!expectedTypes || Object.keys(expectedTypes).length === 0) {
    return result('structured-data-presence', 'Structured Data Presence', 'site', 'pass', 'No expected structured data types configured', []);
  }

  const evidence = [];

  for (const page of extracted) {
    const pageType = page.page_type;
    if (!pageType || !expectedTypes[pageType]) continue;

    const expected = expectedTypes[pageType];
    const foundTypes = extractStructuredTypes(page.structured_data);

    const missing = expected.filter(expectedType =>
      !foundTypes.some(foundType => typeSatisfies(foundType, expectedType))
    );

    if (missing.length > 0) {
      evidence.push({
        url: page.url,
        detail: `Page type "${pageType}" missing expected structured data: ${missing.join(', ')}. Found: ${foundTypes.length > 0 ? foundTypes.join(', ') : 'none'}`
      });
    }
  }

  const status = evidence.length > 0 ? 'warn' : 'pass';
  const summary = evidence.length === 0
    ? 'All pages have expected structured data for their type'
    : `${evidence.length} page(s) missing expected structured data types`;
  return result('structured-data-presence', 'Structured Data Presence', 'site', status, summary, evidence);
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function runChecks(extracted, inventory, checkConfig, outputDir) {
  const thresholds = checkConfig.thresholds || {};
  const skipChecks = new Set(checkConfig.skip_checks || []);
  const expectedTypes = checkConfig.structured_data_expected_types || {};

  const allChecks = [];

  function add(checkId, fn) {
    if (skipChecks.has(checkId)) return;
    allChecks.push({ checkId, fn });
  }

  // Register page-level checks
  add('h1-presence', () => checkH1Presence(extracted));
  add('title-presence', () => checkTitlePresence(extracted));
  add('title-length', () => checkTitleLength(extracted, thresholds));
  add('meta-description-presence', () => checkMetaDescriptionPresence(extracted));
  add('meta-description-length', () => checkMetaDescriptionLength(extracted, thresholds));
  add('canonical-presence', () => checkCanonicalPresence(extracted));
  add('canonical-self-referencing', () => checkCanonicalSelfReferencing(extracted));
  add('og-required-tags', () => checkOgRequiredTags(extracted));
  add('alt-text-presence', () => checkAltTextPresence(extracted, thresholds));
  add('status-code', () => checkStatusCode(extracted));

  // Register site-level checks
  add('h1-uniqueness-site', () => checkH1UniquenessSite(extracted));
  add('canonical-uniqueness', () => checkCanonicalUniqueness(extracted));
  add('broken-internal-links', () => checkBrokenInternalLinks(extracted, inventory, checkConfig));
  add('broken-external-links', () => checkBrokenExternalLinks(extracted, checkConfig));
  add('structured-data-presence', () => checkStructuredDataPresence(extracted, expectedTypes));

  // Execute all checks
  const results = [];
  for (const { fn } of allChecks) {
    const r = await fn();
    writeDetailIfNeeded(r, outputDir);
    results.push(r);
  }

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const warned = results.filter(r => r.status === 'warn').length;

  return {
    checked_at: new Date().toISOString(),
    total_checks: results.length,
    passed,
    failed,
    warned,
    results,
  };
}

module.exports = { runChecks };
