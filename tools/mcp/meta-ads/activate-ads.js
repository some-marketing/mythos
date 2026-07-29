#!/usr/bin/env node
'use strict';
/**
 * activate-ads.js — explicit-ID-allowlist ad activation gate.
 *
 * Distinct, operator-gated tool. Does NOT fold into the builder.
 * Adapted from clients/patron-gamma/projects/may-2026-offers/activate-ss-video-ads.js.
 *
 * Design principles:
 *   - No-args = list-only (never activates without explicit IDs)
 *   - Explicit ad ID allowlist only (refuses unknown IDs)
 *   - protected_ad_ids config key: IDs that must NEVER be touched (CATALOG_AD_ID pattern)
 *   - Reads back effective_status after each write
 *   - Respects META_ADS_DRY_RUN — refuses to run live without explicit setup
 *
 * Governing artifacts:
 *   _dev/reports/analysis/operator-decision__meta-ads-tools-promotion__20260610.md
 *   _dev/reports/analysis/convene-runs/20260610T145537Z-meta-ads-tools-promotion-review/synthesis.md
 *
 * Usage (module):
 *   const { activateAds } = require('./activate-ads');
 *   const results = await activateAds({ adIds, allowlist, protectedAdIds, client });
 *   // Always dry-run unless client was built with dryRun=false and live=true
 *
 * Usage (CLI):
 *   node activate-ads.js --config path/to/activation-config.json [adId ...]
 *   node activate-ads.js --config path/to/activation-config.json --all
 *   node activate-ads.js --config path/to/activation-config.json   # list-only
 *   node activate-ads.js --help
 *
 * Activation config schema:
 * {
 *   "allowlist": {                         // known ad IDs that CAN be activated
 *     "<ad_id>": "<ad_name>"
 *   },
 *   "protected_ad_ids": ["<ad_id>", ...],  // never-touch fence (CATALOG_AD_ID pattern)
 *   "account_id": "string"                 // optional, for display only
 * }
 *
 * Exit codes: 0=success/list, 1=error, 2=input error
 */

/**
 * activateAds — core activation function.
 *
 * @param {object} opts
 * @param {string[]} opts.adIds - IDs to activate (must all be in allowlist)
 * @param {object} opts.allowlist - { [adId]: adName } map of known activatable IDs
 * @param {string[]} [opts.protectedAdIds] - never-touch fence; function throws if any overlap
 * @param {object} opts.client - createMetaAdsClient instance (must have dryRun=false for live)
 * @param {boolean} [opts.live] - pass true to activate live (default false = dry run)
 * @returns {Promise<object[]>} results per ad: { id, name, status, effective_status, error? }
 */
async function activateAds({ adIds, allowlist, protectedAdIds = [], client, live = false }) {
  if (!adIds || adIds.length === 0) {
    throw new Error('activateAds: adIds must be a non-empty array');
  }

  // Protected fence check — hard stop, no partial activation
  const protected_ = new Set(protectedAdIds.map(String));
  const hitProtected = adIds.filter((id) => protected_.has(String(id)));
  if (hitProtected.length > 0) {
    throw new Error(`activateAds: REFUSED — requested IDs overlap protected_ad_ids fence: ${hitProtected.join(', ')}`);
  }

  // Allowlist check — refuse unknown IDs
  const known = new Set(Object.keys(allowlist).map(String));
  const unknown = adIds.filter((id) => !known.has(String(id)));
  if (unknown.length > 0) {
    throw new Error(
      `activateAds: REFUSED — unknown ad IDs (not in allowlist): ${unknown.join(', ')}\n` +
      `Known allowlist: ${Object.entries(allowlist).map(([id, name]) => `${id} (${name})`).join(', ')}`
    );
  }

  const results = [];
  for (const id of adIds) {
    const r = { id, name: allowlist[id] || id };
    try {
      await client.updateAdStatus({ adId: id, status: 'ACTIVE', live });
      const rb = await client.getAd({ adId: id, fields: 'id,name,status,effective_status' });
      r.status = rb.status;
      r.effective_status = rb.effective_status;
      console.log(`${r.name}: status=${r.status} effective=${r.effective_status}`);
    } catch (e) {
      r.error = e.message;
      console.error(`FAILED ${r.name}: ${e.message}`);
    }
    results.push(r);
  }

  return results;
}

// ---- CLI wrapper ----
if (require.main === module) {
  const path = require('path');
  const fs = require('fs');
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write([
      'activate-ads.js — operator-gated explicit-allowlist ad activation',
      '',
      'Usage:',
      '  node activate-ads.js --config path/to/config.json              # list-only (no IDs = no activation)',
      '  node activate-ads.js --config path/to/config.json <adId> ...   # activate specific IDs',
      '  node activate-ads.js --config path/to/config.json --all        # activate all in allowlist',
      '',
      'LIVE run (requires run-with-op.sh):',
      '  METAOP_ITEM="example-meta-ads API Credential" METAOP_VAULT="Employee" METAOP_FIELD_TOKEN="credential" \\',
      '    tools/mcp/meta-ads/run-with-op.sh node tools/mcp/meta-ads/activate-ads.js --config ... <adId> ...',
      '',
      'Config schema:',
      '  {',
      '    "allowlist": { "<adId>": "<adName>", ... },',
      '    "protected_ad_ids": ["<adId>", ...],',
      '    "account_id": "string"',
      '  }',
      '',
      'Exit codes: 0=success/list, 1=error, 2=input error'
    ].join('\n') + '\n');
    process.exit(0);
  }

  const configIdx = args.indexOf('--config');
  if (configIdx === -1 || !args[configIdx + 1]) {
    process.stderr.write('Error: --config path/to/config.json is required. Use --help for usage.\n');
    process.exit(2);
  }

  const fp = path.resolve(args[configIdx + 1]);
  if (!fs.existsSync(fp)) {
    process.stderr.write(`Error: config file not found: ${fp}\n`);
    process.exit(2);
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    process.stderr.write(`Error: invalid JSON in config: ${e.message}\n`);
    process.exit(2);
  }

  const allowlist = config.allowlist || {};
  const protectedAdIds = config.protected_ad_ids || [];
  const allFlag = args.includes('--all');
  // Remaining args (not flags, not config path) are treated as explicit ad IDs
  const explicitIds = args.filter((a, i) => {
    if (a.startsWith('--')) return false;
    if (i > 0 && args[i - 1] === '--config') return false;
    return true;
  });

  // List-only mode if no IDs given
  if (!allFlag && explicitIds.length === 0) {
    process.stderr.write('No ad IDs given — listing allowlist (no activation).\n');
    for (const [id, name] of Object.entries(allowlist)) {
      const isProtected = protectedAdIds.includes(id);
      process.stderr.write(`  ${id}  ${name}${isProtected ? '  [PROTECTED]' : ''}\n`);
    }
    if (protectedAdIds.length) {
      process.stderr.write(`Protected fence: ${protectedAdIds.join(', ')}\n`);
    }
    process.stderr.write('Pass ad IDs to activate, or --all.\n');
    process.exit(0);
  }

  const ids = allFlag ? Object.keys(allowlist) : explicitIds;

  const token = process.env.META_ACCESS_TOKEN;
  const isLive = token && process.env.META_ADS_DRY_RUN === 'false';
  if (!isLive) {
    process.stderr.write('Error: activation requires META_ACCESS_TOKEN + META_ADS_DRY_RUN=false. Run via run-with-op.sh.\n');
    process.exit(2);
  }

  const { createMetaAdsClient } = require('./client');
  const { loadMetaAdsConfig } = require('./config');
  const cfg = loadMetaAdsConfig();
  const client = createMetaAdsClient(cfg);

  activateAds({ adIds: ids, allowlist, protectedAdIds, client, live: true })
    .then((results) => {
      process.stdout.write(JSON.stringify(results, null, 2) + '\n');
      const failed = results.filter((r) => r.error);
      if (failed.length) { process.stderr.write(`${failed.length} ads failed\n`); process.exit(1); }
    })
    .catch((e) => {
      process.stderr.write(`Fatal: ${e.message}\n`);
      process.exit(1);
    });
}

module.exports = { activateAds };
