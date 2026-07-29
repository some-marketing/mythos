#!/usr/bin/env node
'use strict';

// pmax-url-exclusions.js — Generic, config-driven — see inputs/ for the JSON shape.
//
// Adds URL exclusions to a Performance Max campaign via Google Ads v20 API.
// Each path becomes a campaignCriterion of type=WEBPAGE, negative=true, with
// a single condition {operand: URL, operator: <CONTAINS|EQUALS>, argument: <path>}.
//
// Idempotent: queries existing WEBPAGE criteria on each campaign and skips
// any (operator, argument) pair already attached.
//
// --dry-run or GOOGLE_ADS_DRY_RUN=true plans without sending mutations.
// Reads always go live (the idempotency check needs truthful state).

const fs = require('fs');
const path = require('path');
const { loadGoogleAdsConfig } = require('../mcp/google-ads/config');
const { createGoogleAdsClient } = require('../mcp/google-ads/client');
const { mutateRaw } = require('../mcp/google-ads/scripts/mutate-raw-helper');

function usage() {
  console.error('Usage: [GOOGLE_ADS_DRY_RUN=<true|false>] node tools/google-ads/pmax-url-exclusions.js <input.json> [--dry-run]');
  process.exit(2);
}

async function listExistingWebpageExclusions(client, customerId, campaignId) {
  const q = `SELECT campaign_criterion.criterion_id, campaign_criterion.webpage.conditions FROM campaign_criterion WHERE campaign.id = ${campaignId} AND campaign_criterion.type = WEBPAGE AND campaign_criterion.negative = TRUE`;
  const r = await client.runGaql({ customerId, query: q });
  const present = new Set();
  for (const b of r) for (const row of (b.results || [])) {
    const conds = row.campaignCriterion?.webpage?.conditions || [];
    for (const c of conds) {
      if (c.operand === 'URL') present.add(`${c.operator}::${c.argument.toLowerCase()}`);
    }
  }
  return present;
}

async function createWebpageExclusion(customerId, campaignResourceName, label, operator, argument, dryRun) {
  return mutateRaw({
    customerId,
    servicePath: 'campaignCriteria:mutate',
    body: {
      operations: [{
        create: {
          campaign: campaignResourceName,
          negative: true,
          webpage: {
            criterionName: label,
            conditions: [{ operand: 'URL', operator, argument }]
          }
        }
      }]
    },
    dryRun
  });
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) usage();
  const spec = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  const customerId = spec.customer_id;
  if (!customerId) throw new Error('input config missing customer_id');

  // --dry-run / GOOGLE_ADS_DRY_RUN controls mutations only; reads always live.
  const envDryRun = String(process.env.GOOGLE_ADS_DRY_RUN || '').toLowerCase() === 'true';
  const dryRun = envDryRun || process.argv.includes('--dry-run');
  process.env.GOOGLE_ADS_DRY_RUN = 'false';
  const cfg = loadGoogleAdsConfig();
  const client = createGoogleAdsClient(cfg);

  const startedAt = new Date().toISOString();
  const log = {
    schema: 'google-ads-mutation-batch/1.0',
    task_id: spec.task_id || 'unknown',
    tool: 'tools/google-ads/pmax-url-exclusions.js',
    customer_id: customerId,
    input_config: path.relative(process.cwd(), path.resolve(inputPath)),
    started_at: startedAt,
    dry_run: dryRun,
    operations: []
  };

  for (const entry of spec.exclusions) {
    const campaignResourceName = `customers/${customerId}/campaigns/${entry.campaign_id}`;
    const op = entry.operator || 'CONTAINS';
    const existing = await listExistingWebpageExclusions(client, customerId, entry.campaign_id);

    for (const p of entry.paths) {
      const key = `${op}::${p.toLowerCase()}`;
      if (existing.has(key)) {
        log.operations.push({ campaign_id: entry.campaign_id, campaign_name: entry.campaign_name, path: p, operator: op, status: 'skipped-already-present' });
        continue;
      }
      const label = `Exclude ${p}`;
      try {
        const r = await createWebpageExclusion(customerId, campaignResourceName, label, op, p, dryRun);
        log.operations.push({ campaign_id: entry.campaign_id, campaign_name: entry.campaign_name, path: p, operator: op, label, status: dryRun ? 'dry-run' : 'applied', response: r });
      } catch (e) {
        log.operations.push({ campaign_id: entry.campaign_id, campaign_name: entry.campaign_name, path: p, operator: op, status: 'error', error: e.message });
      }
    }
  }

  log.completed_at = new Date().toISOString();
  log.summary = {
    total: log.operations.length,
    applied: log.operations.filter(o => o.status === 'applied').length,
    skipped: log.operations.filter(o => o.status === 'skipped-already-present').length,
    dry_run_ops: log.operations.filter(o => o.status === 'dry-run').length,
    errors: log.operations.filter(o => o.status === 'error').length
  };

  const ts = startedAt.replace(/[:.]/g, '-');
  const outDir = path.join(__dirname, '..', '..', '_dev', 'reports', 'google-ads-mutations');
  fs.mkdirSync(outDir, { recursive: true });
  const tag = dryRun ? 'dryrun' : 'live';
  const outPath = path.join(outDir, `${ts}__pmax-url-exclusions-${tag}__${customerId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(log, null, 2));
  console.log('WROTE', outPath);
  console.log(JSON.stringify(log.summary, null, 2));
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
