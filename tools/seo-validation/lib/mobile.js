/**
 * Mobile rendering checks using Playwright device emulation.
 *
 * Selects a representative sample of pages, emulates mobile devices,
 * and checks viewport meta, horizontal overflow, tap target sizes,
 * and page performance metrics.
 */

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Fallback device configs when Playwright's device list does not
// contain an exact match for the requested device name.
const FALLBACK_DEVICES = {
  iphone: {
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  pixel: {
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36',
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
  },
};

/**
 * Find the best matching Playwright device descriptor.
 *
 * 1. Exact match against Playwright's built-in device list.
 * 2. Case-insensitive substring match (closest match).
 * 3. Fall back to a manual config based on the device name.
 *
 * @param {string} deviceName
 * @returns {{ descriptor: object, matched: string }}
 */
function resolveDevice(deviceName) {
  // Exact match
  if (devices[deviceName]) {
    return { descriptor: devices[deviceName], matched: deviceName };
  }

  // Case-insensitive substring search across Playwright's device list
  const lower = deviceName.toLowerCase();
  const candidates = Object.keys(devices).filter(k =>
    k.toLowerCase().includes(lower)
  );
  if (candidates.length > 0) {
    // Prefer the shortest name (most specific match)
    candidates.sort((a, b) => a.length - b.length);
    const best = candidates[0];
    return { descriptor: devices[best], matched: best };
  }

  // Manual fallback
  if (lower.includes('iphone')) {
    return { descriptor: FALLBACK_DEVICES.iphone, matched: `${deviceName} (fallback)` };
  }
  if (lower.includes('pixel')) {
    return { descriptor: FALLBACK_DEVICES.pixel, matched: `${deviceName} (fallback)` };
  }

  // Last resort: generic mobile viewport
  return {
    descriptor: FALLBACK_DEVICES.iphone,
    matched: `${deviceName} (generic fallback)`,
  };
}

/**
 * Convert a URL to a filesystem-safe slug.
 *
 * @param {string} url
 * @returns {string}
 */
function pageSlug(url) {
  const u = new URL(url);
  let s = u.pathname.replace(/^\/|\/$/g, '').replace(/\//g, '__') || 'index';
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Convert a device name to a filesystem-safe slug.
 *
 * @param {string} name
 * @returns {string}
 */
function deviceSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/g, '');
}

/**
 * Select a representative sample of pages from the full inventory.
 *
 * Always includes the homepage. Fills remaining slots with a balanced
 * mix of page types up to the configured maximum.
 *
 * @param {Array<{ url: string, type: string }>} pages
 * @param {number} maxSample
 * @returns {Array<{ url: string, type: string }>}
 */
function selectSample(pages, maxSample) {
  const budget = {
    inventory: 3,
    vdp: 3,
    blog: 2,
    landing: 2,
    static: 2,
  };

  const selected = [];
  const seen = new Set();

  // Always include homepage
  const homepage = pages.find(
    p => p.type === 'homepage' || new URL(p.url).pathname === '/'
  );
  if (homepage) {
    selected.push(homepage);
    seen.add(homepage.url);
  }

  // Fill per-type budgets
  for (const [type, limit] of Object.entries(budget)) {
    const candidates = pages.filter(p => p.type === type && !seen.has(p.url));
    for (let i = 0; i < Math.min(limit, candidates.length); i++) {
      if (selected.length >= maxSample) break;
      selected.push(candidates[i]);
      seen.add(candidates[i].url);
    }
  }

  // Fill remaining capacity with any unselected pages
  if (selected.length < maxSample) {
    for (const p of pages) {
      if (selected.length >= maxSample) break;
      if (!seen.has(p.url)) {
        selected.push(p);
        seen.add(p.url);
      }
    }
  }

  return selected;
}

/**
 * Run mobile rendering checks across devices and a representative page sample.
 *
 * @param {Array<{ url: string, type: string }>} pages - Full page inventory
 * @param {object} siteConfig - Site configuration (auth, etc.)
 * @param {object} checkConfig - Check configuration (mobile_devices, mobile_sample_max, etc.)
 * @param {string} outputDir - Root output directory
 * @param {boolean} doScreenshots - Whether to capture full-page screenshots
 * @returns {Promise<object>} Mobile check results and summary
 */
async function runMobileChecks(pages, siteConfig, checkConfig, outputDir, doScreenshots) {
  const maxSample = checkConfig.mobile_sample_max || 15;
  const deviceNames = checkConfig.mobile_devices || ['iPhone 14', 'Pixel 7'];
  const sample = selectSample(pages, maxSample);

  const results = [];

  for (const deviceName of deviceNames) {
    const { descriptor, matched } = resolveDevice(deviceName);
    console.log(`[mobile] Device: ${deviceName} (resolved as ${matched})`);

    const browser = await chromium.launch({ headless: true });
    try {
    const contextOptions = {
      ...descriptor,
      ...(siteConfig.auth?.type === 'basic'
        ? { httpCredentials: siteConfig.auth.credentials }
        : {}),
    };
    const context = await browser.newContext(contextOptions);

    const dSlug = deviceSlug(deviceName);

    for (const pageInfo of sample) {
      const pSlug = pageSlug(pageInfo.url);
      const entry = {
        url: pageInfo.url,
        page_type: pageInfo.type,
        device: deviceName,
        screenshot: null,
        viewport_meta: { present: false, has_device_width: false },
        horizontal_overflow: false,
        tap_targets: { total: 0, undersized: 0, details: [] },
        performance: {
          dom_content_loaded_ms: null,
          load_ms: null,
          resource_count: 0,
          resources_by_type: {},
          page_weight_bytes: 0,
        },
      };

      let page;
      try {
        page = await context.newPage();
        await page.goto(pageInfo.url, {
          waitUntil: 'networkidle',
          timeout: 30000,
        });

        // Screenshot
        if (doScreenshots) {
          const screenshotDir = path.join(outputDir, 'mobile', 'screenshots', dSlug);
          fs.mkdirSync(screenshotDir, { recursive: true });
          const screenshotPath = path.join(screenshotDir, `${pSlug}.png`);
          await page.screenshot({ fullPage: true, path: screenshotPath });
          entry.screenshot = path.relative(outputDir, screenshotPath);
        }

        // Viewport meta
        const viewportMeta = await page.evaluate(() => {
          const el = document.querySelector('meta[name="viewport"]');
          if (!el) return { present: false, content: null };
          return { present: true, content: el.getAttribute('content') || '' };
        });
        entry.viewport_meta = {
          present: viewportMeta.present,
          content: viewportMeta.content,
          has_device_width: viewportMeta.present &&
            (viewportMeta.content || '').includes('width=device-width'),
        };

        // Horizontal overflow
        entry.horizontal_overflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > document.documentElement.clientWidth;
        });

        // Tap targets
        const tapData = await page.evaluate(() => {
          const selectors = 'a, button, input[type="submit"], select';
          const elements = Array.from(document.querySelectorAll(selectors));
          const items = [];
          for (const el of elements) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            items.push({
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || '').trim().slice(0, 80),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              undersized: rect.width < 44 || rect.height < 44,
            });
          }
          return items;
        });
        const undersized = tapData.filter(t => t.undersized);
        entry.tap_targets = {
          total: tapData.length,
          undersized: undersized.length,
          details: undersized,
        };

        // Performance
        const perfData = await page.evaluate(() => {
          const timing = performance.timing;
          const domContentLoaded = timing.domContentLoadedEventEnd - timing.navigationStart;
          const load = timing.loadEventEnd - timing.navigationStart;

          const resources = performance.getEntriesByType('resource');
          const byType = {};
          let totalBytes = 0;
          for (const r of resources) {
            const ext = (r.name.split('?')[0].split('.').pop() || 'other').toLowerCase();
            const type = {
              js: 'script', css: 'stylesheet', png: 'image', jpg: 'image',
              jpeg: 'image', gif: 'image', svg: 'image', webp: 'image',
              avif: 'image', woff: 'font', woff2: 'font', ttf: 'font',
              eot: 'font',
            }[ext] || r.initiatorType || 'other';
            byType[type] = (byType[type] || 0) + 1;
            // transferSize may be 0 for cached/cross-origin resources;
            // use encodedBodySize as an approximation when available
            totalBytes += r.transferSize || r.encodedBodySize || 0;
          }

          return {
            dom_content_loaded_ms: domContentLoaded > 0 ? domContentLoaded : null,
            load_ms: load > 0 ? load : null,
            resource_count: resources.length,
            resources_by_type: byType,
            page_weight_bytes: totalBytes,
          };
        });
        entry.performance = perfData;
      } catch (err) {
        console.warn(
          `[mobile] Warning: failed on ${pageInfo.url} / ${deviceName} — ${err.message}`
        );
      } finally {
        if (page) {
          try {
            await page.close();
          } catch (_) {
            // Ignore close errors
          }
        }
      }

      results.push(entry);
    }

    } finally {
      await browser.close();
    }
  }

  // Build summary
  const pagesWithOverflow = new Set(
    results.filter(r => r.horizontal_overflow).map(r => r.url)
  ).size;
  const pagesWithUndersized = new Set(
    results.filter(r => r.tap_targets.undersized > 0).map(r => r.url)
  ).size;
  const viewportMissing = new Set(
    results.filter(r => !r.viewport_meta.present).map(r => r.url)
  ).size;

  const weights = results.map(r => r.performance.page_weight_bytes).filter(w => w > 0);
  const avgWeight = weights.length > 0
    ? Math.round(weights.reduce((s, w) => s + w, 0) / weights.length)
    : 0;

  return {
    tested_at: new Date().toISOString(),
    devices: deviceNames,
    pages_tested: sample.length,
    results,
    summary: {
      pages_with_overflow: pagesWithOverflow,
      pages_with_undersized_targets: pagesWithUndersized,
      avg_page_weight_bytes: avgWeight,
      viewport_meta_missing: viewportMissing,
    },
  };
}

module.exports = { runMobileChecks };
