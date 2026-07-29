'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const readers = require('./lib/reader');

/**
 * Tag Assistant driver. Two execution modes:
 *
 *  1. cdp:  attach to a running Chrome (the operator's), via the CDP endpoint
 *           Chrome must be launched with --remote-debugging-port=9222.
 *           Tag Assistant must already be paired and connected in that Chrome.
 *
 *  2. fresh + storageState: launch Playwright Chromium with a previously
 *           recorded Google login. The storage state must include the
 *           tagassistant.google.com cookies. Use record-storage-state.js (from
 *           the QA framework runner) to capture it interactively.
 *
 * The reader functions read the Tag Assistant event list, click into an event,
 * switch to the Data Layer tab, etc. They are layered with fallback selectors —
 * Tag Assistant DOM changes frequently. If they break, run with --debug-dom and
 * inspect the dumped html sample.
 */
async function attachOrLaunch(opts) {
  if (opts.cdp) {
    const browser = await chromium.connectOverCDP(opts.cdp);
    const contexts = browser.contexts();
    const ctx = contexts[0];
    const pages = ctx.pages();
    let page = pages.find(p => p.url().includes('tagassistant.google.com'));
    if (!page) {
      page = await ctx.newPage();
      await page.goto(opts.url || 'https://tagassistant.google.com/');
    }
    return { browser, page, mode: 'cdp' };
  }
  if (opts.storageState) {
    const browser = await chromium.launch({ headless: opts.headless !== false });
    const ctx = await browser.newContext({ storageState: opts.storageState });
    const page = await ctx.newPage();
    await page.goto(opts.url || 'https://tagassistant.google.com/');
    return { browser, page, mode: 'storageState' };
  }
  throw new Error('Tag Assistant driver needs --cdp <ws-endpoint> or --storage-state <path>');
}

async function readEventList(page) {
  return await page.evaluate(readers.READ_EVENT_LIST);
}
async function readContainerInfo(page) {
  return await page.evaluate(readers.READ_CONTAINER_INFO);
}
async function readDataLayerTab(page) {
  return await page.evaluate(readers.READ_DATALAYER_TAB);
}
async function readTagsFired(page) {
  return await page.evaluate(readers.READ_TAGS_FIRED);
}
async function clickEventByIndex(page, idx) {
  return await page.evaluate(readers.CLICK_EVENT_BY_INDEX(idx));
}
async function clickTabByName(page, name) {
  return await page.evaluate(readers.CLICK_TAB_BY_NAME(name));
}

async function snapshot(page, { eventIndexes } = {}) {
  const out = {
    capturedAt: new Date().toISOString(),
    container: await readContainerInfo(page),
    events: await readEventList(page),
    perEvent: [],
  };
  const indexes = Array.isArray(eventIndexes) ? eventIndexes : Array.from({ length: Math.min(out.events.count, 20) }, (_, i) => i);
  for (const idx of indexes) {
    await clickEventByIndex(page, idx);
    await page.waitForTimeout(300);
    await clickTabByName(page, 'Data Layer');
    await page.waitForTimeout(200);
    const dl = await readDataLayerTab(page);
    await clickTabByName(page, 'Tags Fired');
    await page.waitForTimeout(200);
    const tags = await readTagsFired(page);
    out.perEvent.push({ idx, dataLayer: dl, tagsFired: tags });
  }
  return out;
}

async function dumpHtmlSample(page, outPath) {
  const html = await page.content();
  fs.writeFileSync(outPath, html);
  return outPath;
}

module.exports = {
  attachOrLaunch,
  readEventList,
  readContainerInfo,
  readDataLayerTab,
  readTagsFired,
  clickEventByIndex,
  clickTabByName,
  snapshot,
  dumpHtmlSample,
};
