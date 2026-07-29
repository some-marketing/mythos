#!/usr/bin/env node
'use strict';

// shared-list-builder.js — Generic, config-driven — see inputs/ for the JSON shape.
//
// Creates shared NEGATIVE_KEYWORDS lists in Google Ads via API, populates them
// with keywords, and attaches them to specified campaigns. Idempotent at each
// stage: skips lists that already exist by name, skips keywords/attachments
// already present.
//
// Reads a declarative input config (see tools/google-ads/inputs/*.json).
// Honors GOOGLE_ADS_DRY_RUN — dry-run prints the planned API calls without
// sending them.
//
// Writes a batch mutation log to _dev/reports/google-ads-mutations/.

const fs = require('fs');
const path = require('path');
const { loadGoogleAdsConfig } = require('../mcp/google-ads/config');
const { createGoogleAdsClient } = require('../mcp/google-ads/client');
const { mutateRaw } = require('../mcp/google-ads/scripts/mutate-raw-helper');

function usage() {
  console.error('Usage: GOOGLE_ADS_DRY_RUN=<true|false> node tools/google-ads/shared-list-builder.js <input.json>');
  process.exit(2);
}

async function listExistingSharedSets(client, customerId) {
  const q = 'SELECT shared_set.id, shared_set.name, shared_set.type, shared_set.resource_name FROM shared_set';
  const r = await client.runGaql({ customerId, query: q });
  const byName = new Map();
  for (const b of r) for (const row of (b.results || [])) {
    const s = row.sharedSet;
    if (s?.name) byName.set(s.name.toLowerCase(), s);
  }
  return byName;
}

async function listSharedSetKeywords(client, customerId, sharedSetResourceName) {
  const id = sharedSetResourceName.split('/').pop();
  const q = `SELECT shared_criterion.keyword.text, shared_criterion.keyword.match_type FROM shared_criterion WHERE shared_set.id = ${id}`;
  const r = await client.runGaql({ customerId, query: q });
  const present = new Set();
  for (const b of r) for (const row of (b.results || [])) {
    const k = row.sharedCriterion?.keyword;
    if (k?.text) present.add(`${k.matchType}::${k.text.toLowerCase()}`);
  }
  return present;
}

async function listCampaignSharedSets(client, customerId, campaignId) {
  const q = `SELECT campaign_shared_set.shared_set, campaign_shared_set.status FROM campaign_shared_set WHERE campaign.id = ${campaignId}`;
  const r = await client.runGaql({ customerId, query: q });
  const attached = new Set();
  for (const b of r) for (const row of (b.results || [])) {
    attached.add(row.campaignSharedSet.sharedSet);
  }
  return attached;
}

async function createSharedSet(customerId, name, dryRun) {
  return mutateRaw({
    customerId,
    servicePath: 'sharedSets:mutate',
    body: { operations: [{ create: { name, type: 'NEGATIVE_KEYWORDS', status: 'ENABLED' } }] },
    dryRun
  });
}

async function createSharedCriteria(customerId, sharedSetResourceName, keywords, matchType, dryRun) {
  const operations = keywords.map(kw => ({
    create: {
      sharedSet: sharedSetResourceName,
      keyword: { text: kw, matchType }
    }
  }));
  return mutateRaw({
    customerId,
    servicePath: 'sharedCriteria:mutate',
    body: { operations },
    dryRun
  });
}

async function attachSharedSetToCampaign(customerId, campaignResourceName, sharedSetResourceName, dryRun) {
  return mutateRaw({
    customerId,
    servicePath: 'campaignSharedSets:mutate',
    body: { operations: [{ create: { campaign: campaignResourceName, sharedSet: sharedSetResourceName, status: 'ENABLED' } }] },
    dryRun
  });
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) usage();
  const spec = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  const customerId = spec.customer_id;
  if (!customerId) throw new Error('input config missing customer_id');

  // Tool semantics: --dry-run / GOOGLE_ADS_DRY_RUN controls MUTATIONS only.
  // Reads (GAQL discovery) must always go live so idempotency logic gets
  // truthful existing-state. Force the read-client to live mode while
  // remembering the operator-intended dry-run for the mutate calls.
  const envDryRun = String(process.env.GOOGLE_ADS_DRY_RUN || '').toLowerCase() === 'true';
  const dryRun = envDryRun || process.argv.includes('--dry-run');
  process.env.GOOGLE_ADS_DRY_RUN = 'false';
  const cfg = loadGoogleAdsConfig();
  const client = createGoogleAdsClient(cfg);

  const startedAt = new Date().toISOString();
  const log = {
    schema: 'google-ads-mutation-batch/1.0',
    task_id: spec.task_id || 'unknown',
    tool: 'tools/google-ads/shared-list-builder.js',
    customer_id: customerId,
    input_config: path.relative(process.cwd(), path.resolve(inputPath)),
    started_at: startedAt,
    dry_run: dryRun,
    operations: []
  };

  const existing = await listExistingSharedSets(client, customerId);

  for (const list of spec.shared_lists) {
    let setResourceName;
    let setId;

    // Step 1: ensure shared set exists
    const found = existing.get(list.name.toLowerCase());
    if (found) {
      setResourceName = found.resourceName;
      setId = found.id;
      log.operations.push({ stage: 'create-set', list: list.name, status: 'skipped-already-present', set_id: setId, resource_name: setResourceName });
    } else {
      const r = await createSharedSet(customerId, list.name, dryRun);
      if (dryRun) {
        log.operations.push({ stage: 'create-set', list: list.name, status: 'dry-run', request: r });
        setResourceName = `DRYRUN_customers/${customerId}/sharedSets/PENDING`;
      } else {
        setResourceName = r?.results?.[0]?.resourceName;
        setId = setResourceName?.split('/')?.pop();
        log.operations.push({ stage: 'create-set', list: list.name, status: 'created', set_id: setId, resource_name: setResourceName, response: r });
      }
    }

    // Step 2: add keywords (idempotent)
    if (dryRun && !found) {
      log.operations.push({ stage: 'add-keywords', list: list.name, status: 'dry-run-skipped', note: 'set creation dry-runs so cannot enumerate existing kws; would add all', keywords: list.keywords });
    } else {
      const present = setResourceName?.startsWith('DRYRUN_') ? new Set() : await listSharedSetKeywords(client, customerId, setResourceName);
      const matchType = list.match_type || 'PHRASE';
      const toAdd = list.keywords.filter(kw => !present.has(`${matchType}::${kw.toLowerCase()}`));
      if (toAdd.length === 0) {
        log.operations.push({ stage: 'add-keywords', list: list.name, status: 'all-already-present', existing_count: present.size });
      } else {
        const r = await createSharedCriteria(customerId, setResourceName, toAdd, matchType, dryRun);
        log.operations.push({ stage: 'add-keywords', list: list.name, status: dryRun ? 'dry-run' : 'applied', match_type: matchType, added_count: toAdd.length, added_keywords: toAdd, skipped_count: present.size, response: r });
      }
    }

    // Step 3: attach to campaigns (idempotent)
    for (const campaignKey of list.apply_to_campaigns) {
      const campaign = spec.campaigns[campaignKey];
      if (!campaign) {
        log.operations.push({ stage: 'attach-campaign', list: list.name, campaign_key: campaignKey, status: 'error-unknown-campaign-key' });
        continue;
      }
      const campaignResourceName = `customers/${customerId}/campaigns/${campaign.id}`;
      if (dryRun && setResourceName.startsWith('DRYRUN_')) {
        log.operations.push({ stage: 'attach-campaign', list: list.name, campaign_key: campaignKey, campaign_id: campaign.id, status: 'dry-run-skipped', note: 'shared set creation dry-runs, cannot resolve resource name' });
        continue;
      }
      const attached = await listCampaignSharedSets(client, customerId, campaign.id);
      if (attached.has(setResourceName)) {
        log.operations.push({ stage: 'attach-campaign', list: list.name, campaign_key: campaignKey, campaign_id: campaign.id, status: 'skipped-already-attached' });
        continue;
      }
      const r = await attachSharedSetToCampaign(customerId, campaignResourceName, setResourceName, dryRun);
      log.operations.push({ stage: 'attach-campaign', list: list.name, campaign_key: campaignKey, campaign_id: campaign.id, campaign_name: campaign.name, status: dryRun ? 'dry-run' : 'applied', response: r });
    }
  }

  log.completed_at = new Date().toISOString();
  log.summary = {
    total_ops: log.operations.length,
    applied: log.operations.filter(o => o.status === 'applied' || o.status === 'created').length,
    skipped: log.operations.filter(o => String(o.status).startsWith('skipped') || o.status === 'all-already-present').length,
    dry_run_ops: log.operations.filter(o => String(o.status).startsWith('dry-run')).length,
    errors: log.operations.filter(o => String(o.status).startsWith('error')).length
  };

  const ts = startedAt.replace(/[:.]/g, '-');
  const outDir = path.join(__dirname, '..', '..', '_dev', 'reports', 'google-ads-mutations');
  fs.mkdirSync(outDir, { recursive: true });
  const tag = dryRun ? 'dryrun' : 'live';
  const outPath = path.join(outDir, `${ts}__shared-list-builder-${tag}__${customerId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(log, null, 2));
  console.log('WROTE', outPath);
  console.log(JSON.stringify(log.summary, null, 2));
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
