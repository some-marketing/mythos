#!/usr/bin/env node
'use strict';

// apply-negatives.js — apply campaign-level PHRASE negative keywords via the
// Google Ads MCP client, driven by a declarative input file (see
// inputs/example-negatives-plan.json for the shape).
//
// Idempotent: skips keywords already attached to the campaign. Honors
// GOOGLE_ADS_DRY_RUN (defaults to true in mcp/google-ads/config.js — mutations
// are stubbed unless you explicitly set it to false).
// Writes a single batched mutation log to _dev/reports/google-ads-mutations/.
//
// Usage:
//   node tools/google-ads/apply-negatives.js <input.json>

const fs = require('fs');
const path = require('path');
const { loadGoogleAdsConfig } = require('../mcp/google-ads/config');
const { createGoogleAdsClient } = require('../mcp/google-ads/client');

function usage() {
  console.error('Usage: node tools/google-ads/apply-negatives.js <input.json>');
  process.exit(2);
}

async function existingNegatives(client, customerId, campaignId) {
  const q = `SELECT campaign_criterion.keyword.text, campaign_criterion.keyword.match_type FROM campaign_criterion WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD' AND campaign.id = ${campaignId}`;
  const r = await client.runGaql({ customerId, query: q });
  const set = new Set();
  for (const b of r) for (const row of (b.results || [])) {
    const k = row.campaignCriterion?.keyword;
    if (k?.text) set.add(`${k.matchType}::${k.text.toLowerCase()}`);
  }
  return set;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) usage();
  const spec = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  const customerId = spec.customer_id;
  if (!customerId) throw new Error('input config missing customer_id');
  const plan = spec.plan;
  if (!Array.isArray(plan) || plan.length === 0) throw new Error('input config missing a non-empty plan[] array');

  const cfg = loadGoogleAdsConfig();
  const client = createGoogleAdsClient(cfg);

  const startedAt = new Date().toISOString();
  const log = {
    schema: 'google-ads-mutation-batch/1.0',
    task_id: spec.task_id || 'unknown',
    tool: 'tools/google-ads/apply-negatives.js',
    customer_id: customerId,
    input_config: path.relative(process.cwd(), path.resolve(inputPath)),
    started_at: startedAt,
    dry_run: cfg.dryRun,
    operations: []
  };

  for (const entry of plan) {
    for (const t of entry.targets) {
      const existing = await existingNegatives(client, customerId, t.id);
      for (const kw of entry.keywords) {
        const key = `PHRASE::${kw.toLowerCase()}`;
        if (existing.has(key)) {
          log.operations.push({ list: entry.list, campaign: t.name, campaign_id: t.id, keyword: kw, match_type: 'PHRASE', status: 'skipped-already-present' });
          continue;
        }
        try {
          const res = await client.mutateCampaignNegativeKeyword({ customerId, campaignId: t.id, keywordText: kw, matchType: 'PHRASE' });
          log.operations.push({ list: entry.list, campaign: t.name, campaign_id: t.id, keyword: kw, match_type: 'PHRASE', status: 'applied', response: res });
        } catch (e) {
          log.operations.push({ list: entry.list, campaign: t.name, campaign_id: t.id, keyword: kw, match_type: 'PHRASE', status: 'error', error: e.message });
        }
      }
    }
  }

  log.completed_at = new Date().toISOString();
  log.summary = {
    total: log.operations.length,
    applied: log.operations.filter(o => o.status === 'applied').length,
    skipped: log.operations.filter(o => o.status === 'skipped-already-present').length,
    errors: log.operations.filter(o => o.status === 'error').length
  };

  const ts = startedAt.replace(/[:.]/g, '-');
  const outDir = path.join(__dirname, '..', '..', '_dev', 'reports', 'google-ads-mutations');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${ts}__apply-negatives__${customerId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(log, null, 2));
  console.log('WROTE', outPath);
  console.log(JSON.stringify(log.summary, null, 2));
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
