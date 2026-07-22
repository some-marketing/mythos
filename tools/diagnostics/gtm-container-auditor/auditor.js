'use strict';

// gtm-container-auditor — captures a structured snapshot of a GTM container's
// triggers, tags, and variables. Designed to run via Playwright CDP attach to
// the operator's already-authenticated Chrome session (i.e. NO interactive
// Google login required).
//
// Three attach modes:
//   1. cdp        — connectOverCDP to a Chrome launched with --remote-debugging-port
//   2. storageState — recorded Google login (last resort; prefer CDP)
//   3. mcp-eval-emit — emit raw JS payloads for use via claude-in-chrome MCP
//                     (when this tool is being driven by an agent that already
//                      has an authenticated browser tab via the MCP)
//
// The third mode is what we used to validate the readers initially. The first
// two are the durable headless paths.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { READ_TRIGGERS_LIST, READ_TAGS_LIST, READ_VARIABLES_LIST, READ_TRIGGER_DETAIL, GTM_HASH_PATHS } = require('./lib/readers');

function parseContainerUrl(url) {
  // Accepts e.g. https://tagmanager.google.com/#/container/accounts/<A>/containers/<C>/workspaces/<W>
  const m = String(url).match(/accounts\/(\d+)\/containers\/(\d+)\/workspaces\/(\d+)/);
  if (!m) throw new Error('Could not parse GTM container URL — expected accounts/<A>/containers/<C>/workspaces/<W>');
  return { account: m[1], container: m[2], workspace: m[3] };
}

async function attach(opts) {
  if (opts.cdp) {
    const browser = await chromium.connectOverCDP(opts.cdp);
    const contexts = browser.contexts();
    const ctx = contexts[0];
    let page = ctx.pages().find(p => /tagmanager\.google\.com/.test(p.url()));
    if (!page) {
      page = await ctx.newPage();
      await page.goto(opts.url);
    } else {
      await page.bringToFront();
      if (opts.url && page.url() !== opts.url) await page.goto(opts.url);
    }
    return { browser, page, mode: 'cdp', detach: () => browser.close().catch(() => {}) };
  }
  if (opts.storageState) {
    const browser = await chromium.launch({ headless: opts.headless !== false });
    const ctx = await browser.newContext({ storageState: opts.storageState });
    const page = await ctx.newPage();
    await page.goto(opts.url);
    return { browser, page, mode: 'storageState', detach: () => browser.close() };
  }
  throw new Error('Auditor needs --cdp or --storage-state (or use --emit-mcp-payloads to drive via claude-in-chrome)');
}

async function snapshotContainer(page, ids, { triggerDetailRowPrefixes = [] } = {}) {
  const out = { capturedAt: new Date().toISOString(), ids, triggers: null, tags: null, variables: null, triggerDetails: [] };

  await page.goto('https://tagmanager.google.com/' + GTM_HASH_PATHS.triggers(ids.account, ids.container, ids.workspace));
  out.triggers = await page.evaluate(READ_TRIGGERS_LIST);

  await page.goto('https://tagmanager.google.com/' + GTM_HASH_PATHS.tags(ids.account, ids.container, ids.workspace));
  out.tags = await page.evaluate(READ_TAGS_LIST);

  await page.goto('https://tagmanager.google.com/' + GTM_HASH_PATHS.variables(ids.account, ids.container, ids.workspace));
  out.variables = await page.evaluate(READ_VARIABLES_LIST);

  for (const prefix of triggerDetailRowPrefixes) {
    await page.goto('https://tagmanager.google.com/' + GTM_HASH_PATHS.triggers(ids.account, ids.container, ids.workspace));
    const detail = await page.evaluate(READ_TRIGGER_DETAIL(prefix));
    out.triggerDetails.push({ rowPrefix: prefix, ...detail });
  }

  return out;
}

function emitMcpPayloads(ids, opts = {}) {
  // For the claude-in-chrome mode: return a list of {label, hash, js} steps the
  // agent can execute via the MCP. No Playwright launched.
  const acct = ids.account, ctr = ids.container, ws = ids.workspace;
  const steps = [
    { label: 'goto-triggers', hash: GTM_HASH_PATHS.triggers(acct, ctr, ws), js: 'JSON.stringify(await ' + READ_TRIGGERS_LIST + ')' },
    { label: 'goto-tags',     hash: GTM_HASH_PATHS.tags(acct, ctr, ws),     js: 'JSON.stringify(await ' + READ_TAGS_LIST + ')' },
    { label: 'goto-variables',hash: GTM_HASH_PATHS.variables(acct, ctr, ws),js: 'JSON.stringify(await ' + READ_VARIABLES_LIST + ')' },
  ];
  for (const prefix of (opts.triggerDetailRowPrefixes || [])) {
    steps.push({
      label: 'trigger-detail:' + prefix,
      hash: GTM_HASH_PATHS.triggers(acct, ctr, ws),
      js: 'JSON.stringify(await ' + READ_TRIGGER_DETAIL(prefix) + ')',
    });
  }
  return steps;
}

module.exports = { attach, snapshotContainer, parseContainerUrl, emitMcpPayloads };
