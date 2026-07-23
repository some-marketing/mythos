/**
 * Page-level SEO signal extraction using Playwright.
 *
 * Renders each page in a real browser and extracts title, meta tags,
 * headings, links, images, Open Graph tags, and structured data.
 */

const { URL } = require('url');

/**
 * Extract SEO signals from a single page.
 *
 * @param {import('playwright').BrowserContext} context - Playwright browser context (already created)
 * @param {{ url: string, type: string }} pageInfo - Page URL and type from the inventory
 * @param {(url: string) => string} slugFn - Converts a URL to a filename-safe slug
 * @returns {Promise<object>} Extracted SEO data for the page
 */
async function extractPage(context, pageInfo, slugFn) {
  const page = await context.newPage();
  const pageUrl = pageInfo.url;
  const origin = new URL(pageUrl).origin;

  let response;
  try {
    response = await page.goto(pageUrl, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
  } catch (err) {
    await page.close();
    throw new Error(`Navigation failed for ${pageUrl}: ${err.message}`);
  }

  const statusCode = response ? response.status() : 0;

  let domData;
  try {
  domData = await page.evaluate((siteOrigin) => {
    // --- title ---
    const title = document.title || '';

    // --- h1 tags ---
    const h1_tags = Array.from(document.querySelectorAll('h1'))
      .map(el => el.textContent.trim());

    // --- canonical ---
    const canonicalEl = document.querySelector('link[rel="canonical"]');
    const canonical = canonicalEl ? canonicalEl.getAttribute('href') : null;

    // --- meta description ---
    const metaDescEl = document.querySelector('meta[name="description"]');
    const meta_description = metaDescEl ? metaDescEl.getAttribute('content') : null;

    // --- meta robots ---
    const metaRobotsEl = document.querySelector('meta[name="robots"]');
    const meta_robots = metaRobotsEl ? metaRobotsEl.getAttribute('content') : null;

    // --- Open Graph tags ---
    const og_tags = {};
    const ogKeys = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'];
    for (const key of ogKeys) {
      const el = document.querySelector(`meta[property="${key}"]`);
      og_tags[key] = el ? el.getAttribute('content') : null;
    }

    // --- Images ---
    const images = Array.from(document.querySelectorAll('img')).map(img => ({
      src: img.getAttribute('src') || '',
      alt: img.hasAttribute('alt') ? img.getAttribute('alt') : null,
      has_alt: img.hasAttribute('alt'),
      loading: img.getAttribute('loading') || null,
    }));

    // --- Links ---
    // Collect raw link data; domain filtering happens outside evaluate()
    // because we need URL resolution against the page URL.
    const rawLinks = Array.from(document.querySelectorAll('a[href]')).map(a => ({
      href: a.getAttribute('href'),
      text: a.textContent.trim(),
      rel: a.getAttribute('rel') || null,
    }));

    // --- Structured data ---
    const structured_data = [];
    const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of ldScripts) {
      const raw = script.textContent.trim();
      let type = null;
      try {
        const parsed = JSON.parse(raw);
        type = parsed['@type'] || null;
      } catch (_) {
        // Keep raw even if JSON is malformed
      }
      structured_data.push({ raw, type });
    }

    return {
      title,
      h1_tags,
      canonical,
      meta_description,
      meta_robots,
      og_tags,
      images,
      rawLinks,
      structured_data,
    };
  }, origin);

  // Classify links as internal or external, resolving relative URLs
  const internal_links = [];
  const external_links = [];

  for (const link of domData.rawLinks) {
    let resolved;
    try {
      resolved = new URL(link.href, pageUrl).href;
    } catch (_) {
      // Skip malformed hrefs (javascript:, mailto:, etc.)
      continue;
    }

    let parsedLink;
    try {
      parsedLink = new URL(resolved);
    } catch (_) {
      continue;
    }

    // Only consider http/https links
    if (parsedLink.protocol !== 'http:' && parsedLink.protocol !== 'https:') {
      continue;
    }

    if (parsedLink.origin === origin) {
      internal_links.push({ href: resolved, text: link.text });
    } else {
      external_links.push({ href: resolved, text: link.text, rel: link.rel });
    }
  }

  // Resolve relative image srcs
  const images = domData.images.map(img => {
    let src = img.src;
    if (src) {
      try {
        src = new URL(src, pageUrl).href;
      } catch (_) {
        // Keep original if resolution fails
      }
    }
    return { ...img, src };
  });

  } finally {
    await page.close();
  }

  return {
    url: pageUrl,
    slug: slugFn(pageUrl),
    page_type: pageInfo.type,
    status_code: statusCode,
    crawled_at: new Date().toISOString(),
    title: domData.title,
    h1_tags: domData.h1_tags,
    canonical: domData.canonical,
    meta_description: domData.meta_description,
    meta_robots: domData.meta_robots,
    og_tags: domData.og_tags,
    images,
    internal_links,
    external_links,
    structured_data: domData.structured_data,
  };
}

module.exports = { extractPage };
