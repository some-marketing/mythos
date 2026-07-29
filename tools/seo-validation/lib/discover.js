/**
 * Site Discovery Module
 *
 * Discovers pages for SEO validation by parsing robots.txt, fetching XML sitemaps,
 * classifying URLs by type, and applying scope filters.
 *
 * No external dependencies — uses Node 18+ built-in fetch and regex-based XML parsing.
 */

const { URL } = require('url');

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

/**
 * Fetch a URL with a timeout. Returns { ok, status, text } on success,
 * or { ok: false, status: 0, text: '' } on network/timeout error.
 */
async function safeFetch(url, timeoutMs = 10000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mythos-SEO-Validator/1.0' },
    });
    clearTimeout(timer);
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    console.warn(`[discover] Fetch failed for ${url}: ${err.message}`);
    return { ok: false, status: 0, text: '' };
  }
}

// ---------------------------------------------------------------------------
// robots.txt parsing
// ---------------------------------------------------------------------------

function parseRobotsTxt(raw) {
  const disallowRules = [];
  const sitemapUrls = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const sitemapMatch = trimmed.match(/^Sitemap:\s*(.+)/i);
    if (sitemapMatch) {
      sitemapUrls.push(sitemapMatch[1].trim());
      continue;
    }

    const disallowMatch = trimmed.match(/^Disallow:\s*(.*)/i);
    if (disallowMatch) {
      const path = disallowMatch[1].trim();
      if (path) disallowRules.push(path);
    }
  }

  return { disallowRules, sitemapUrls };
}

// ---------------------------------------------------------------------------
// XML sitemap parsing (regex-based, no XML parser needed)
// ---------------------------------------------------------------------------

/**
 * Extract all <loc> values from an XML string.
 */
function extractLocs(xml) {
  const locs = [];
  const re = /<loc>\s*(.*?)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const url = m[1].replace(/&amp;/g, '&').trim();
    if (url) locs.push(url);
  }
  return locs;
}

/**
 * Returns true if the XML looks like a sitemap index (contains <sitemapindex> or <sitemap>).
 */
function isSitemapIndex(xml) {
  return /<sitemapindex[\s>]/i.test(xml) || /<sitemap[\s>]/i.test(xml);
}

/**
 * Fetch a sitemap URL. If it's an index, recursively follow child sitemaps.
 * Returns { urls, type, issues }.
 */
async function fetchSitemap(url, depth = 0) {
  const maxDepth = 2; // prevent runaway recursion
  const result = { urls: [], type: 'unknown', issues: [] };

  if (depth > maxDepth) {
    result.issues.push(`Max sitemap depth (${maxDepth}) exceeded at ${url}`);
    return result;
  }

  const res = await safeFetch(url);
  if (!res.ok) {
    result.issues.push(`Failed to fetch sitemap ${url} (status ${res.status})`);
    return result;
  }

  const xml = res.text;

  if (isSitemapIndex(xml)) {
    result.type = 'index';
    const childUrls = extractLocs(xml);
    for (const childUrl of childUrls) {
      const child = await fetchSitemap(childUrl, depth + 1);
      result.urls.push(...child.urls);
      result.issues.push(...child.issues);
    }
  } else {
    result.type = 'urlset';
    result.urls = extractLocs(xml);
  }

  return result;
}

// ---------------------------------------------------------------------------
// URL classification
// ---------------------------------------------------------------------------

/**
 * Classify a URL into a page type based on its path.
 */
function classifyUrl(urlStr, siteUrl, pageTypePatterns = {}) {
  let pathname;
  try {
    pathname = new URL(urlStr).pathname;
  } catch {
    return 'static';
  }

  const normalizedSiteRoot = new URL(siteUrl).pathname.replace(/\/+$/, '');
  const normalizedPath = pathname.replace(/\/+$/, '');

  // Homepage: exact root match
  if (!normalizedPath || normalizedPath === normalizedSiteRoot) {
    return 'homepage';
  }

  // Project-specific types are configuration, not baked-in business assumptions.
  for (const [type, patterns] of Object.entries(pageTypePatterns)) {
    const candidates = Array.isArray(patterns) ? patterns : [patterns];
    if (candidates.some(pattern => new RegExp(pattern, 'i').test(pathname))) return type;
  }

  // Blog / news
  if (/\/(blog|news)\//i.test(pathname) || /\/(blog|news)\/?$/i.test(pathname)) {
    return 'blog';
  }

  // Landing pages: service collections or common geographic patterns.
  if (/\/service-landing-pages?\//i.test(pathname)) {
    return 'landing';
  }
  if (/\/(serving|near)-/i.test(pathname)) {
    return 'landing';
  }

  return 'static';
}

// ---------------------------------------------------------------------------
// Scope filtering
// ---------------------------------------------------------------------------

/**
 * Test whether a URL is in scope given include/exclude pattern arrays.
 * Patterns are strings that will be compiled to RegExp.
 */
function isInScope(urlStr, siteConfig) {
  const includePatterns = (siteConfig.include_patterns || []).map(p => new RegExp(p));
  const excludePatterns = (siteConfig.exclude_patterns || []).map(p => new RegExp(p));

  // If include patterns exist, URL must match at least one
  if (includePatterns.length > 0) {
    const included = includePatterns.some(re => re.test(urlStr));
    if (!included) return false;
  }

  // If exclude patterns exist, URL must not match any
  if (excludePatterns.length > 0) {
    const excluded = excludePatterns.some(re => re.test(urlStr));
    if (excluded) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Main discovery function
// ---------------------------------------------------------------------------

/**
 * Discover pages for SEO validation.
 *
 * @param {string} siteUrl          - The root URL to crawl (e.g., "https://example.com")
 * @param {object} siteConfig       - Site-specific config (include_patterns, exclude_patterns, etc.)
 * @param {object} checkConfig      - Check config (max_pages, etc.)
 * @returns {object}                - Inventory object with robots_txt, sitemap_validation, pages, summary
 */
async function discover(siteUrl, siteConfig, checkConfig) {
  // Normalize site URL: remove trailing slash for consistent comparison
  const normalizedSiteUrl = siteUrl.replace(/\/+$/, '');

  // -----------------------------------------------------------------------
  // Step 1: Fetch and parse robots.txt
  // -----------------------------------------------------------------------
  console.log('[discover] Fetching robots.txt');
  const robotsUrl = `${normalizedSiteUrl}/robots.txt`;
  const robotsRes = await safeFetch(robotsUrl);

  let robotsRaw = '';
  let disallowRules = [];
  let robotsSitemapUrls = [];

  if (robotsRes.ok) {
    robotsRaw = robotsRes.text;
    const parsed = parseRobotsTxt(robotsRaw);
    disallowRules = parsed.disallowRules;
    robotsSitemapUrls = parsed.sitemapUrls;
    console.log(`[discover] robots.txt: ${disallowRules.length} disallow rules, ${robotsSitemapUrls.length} sitemap directives`);
  } else {
    console.log('[discover] No robots.txt found (or not accessible) — continuing without it');
  }

  // -----------------------------------------------------------------------
  // Step 2: Discover and parse XML sitemaps
  // -----------------------------------------------------------------------
  console.log('[discover] Discovering sitemaps');

  // Build candidate list in priority order
  const sitemapCandidates = [
    ...robotsSitemapUrls,
    `${normalizedSiteUrl}/sitemap.xml`,
    `${normalizedSiteUrl}/sitemap_index.xml`,
    `${normalizedSiteUrl}/wp-sitemap.xml`,
  ];

  // Deduplicate while preserving order
  const seen = new Set();
  const uniqueCandidates = [];
  for (const url of sitemapCandidates) {
    const normalized = url.replace(/\/+$/, '');
    if (!seen.has(normalized)) {
      seen.add(normalized);
      uniqueCandidates.push(url);
    }
  }

  let allSitemapUrls = [];
  let sitemapType = 'none';
  let sitemapSourceUrl = null;
  const sitemapIssues = [];

  for (const candidateUrl of uniqueCandidates) {
    console.log(`[discover] Trying sitemap: ${candidateUrl}`);
    const result = await fetchSitemap(candidateUrl);

    if (result.urls.length > 0) {
      allSitemapUrls = result.urls;
      sitemapType = result.type;
      sitemapSourceUrl = candidateUrl;
      sitemapIssues.push(...result.issues);
      console.log(`[discover] Found ${result.urls.length} URLs in ${candidateUrl} (type: ${result.type})`);
      break; // Use first successful sitemap
    }

    if (result.issues.length > 0) {
      sitemapIssues.push(...result.issues);
    }
  }

  if (allSitemapUrls.length === 0) {
    console.warn('[discover] No sitemap URLs discovered — page inventory will be empty');
    sitemapIssues.push('No working sitemap found at any candidate location');
  }

  // -----------------------------------------------------------------------
  // Step 3: Build page inventory with classification
  // -----------------------------------------------------------------------
  console.log('[discover] Building page inventory');

  // Deduplicate sitemap URLs
  const uniquePageUrls = [...new Set(allSitemapUrls)];

  const pages = uniquePageUrls.map(url => {
    const type = classifyUrl(url, normalizedSiteUrl, siteConfig.page_type_patterns || {});
    const inScope = isInScope(url, siteConfig);
    return {
      url,
      type,
      from_sitemap: true,
      in_scope: inScope,
    };
  });

  // -----------------------------------------------------------------------
  // Step 4: Apply scope filters and cap
  // -----------------------------------------------------------------------
  const maxPages = checkConfig.max_pages || 500;

  // Mark out-of-scope pages (already done above), then select in-scope pages up to the cap
  const inScopePages = pages.filter(p => p.in_scope);
  const cappedPages = inScopePages.slice(0, maxPages);

  if (inScopePages.length > maxPages) {
    console.warn(`[discover] In-scope pages (${inScopePages.length}) exceed max_pages (${maxPages}); capping`);
  }

  // -----------------------------------------------------------------------
  // Step 5: Build summary
  // -----------------------------------------------------------------------
  const byType = {};
  for (const page of cappedPages) {
    byType[page.type] = (byType[page.type] || 0) + 1;
  }

  const inventory = {
    site_url: normalizedSiteUrl,
    discovered_at: new Date().toISOString(),
    robots_txt: {
      raw: robotsRaw,
      disallow_rules: disallowRules,
      sitemap_urls: robotsSitemapUrls,
    },
    sitemap_validation: {
      found: allSitemapUrls.length > 0,
      type: sitemapType,
      url_count: allSitemapUrls.length,
      source_url: sitemapSourceUrl,
      issues: sitemapIssues,
    },
    pages: cappedPages,
    summary: {
      total_discovered: pages.length,
      in_scope: inScopePages.length,
      capped_to: cappedPages.length,
      by_type: byType,
    },
  };

  return inventory;
}

module.exports = { discover, classifyUrl, isInScope };
