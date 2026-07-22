#!/usr/bin/env node
'use strict';

const { loadMetaAdsConfig } = require('./config');
const { createMetaAdsClient } = require('./client');

async function main() {
  const liveCheck = process.argv.includes('--live-check');
  const config = loadMetaAdsConfig();

  const summary = {
    platform: 'meta-ads',
    dry_run: config.dryRun,
    config: {
      api_version: config.apiVersion,
      base_url: config.baseUrl,
      default_account_id_present: Boolean(config.defaultAccountId),
      access_token_present: Boolean(config.accessToken)
    },
    ready_for_live_reads: Boolean(config.accessToken && config.defaultAccountId),
    live_check: null
  };

  if (liveCheck) {
    if (config.dryRun) {
      summary.live_check = {
        attempted: false,
        ok: false,
        reason: 'META_ADS_DRY_RUN=true'
      };
      print(summary);
      process.exit(1);
    }

    try {
      const client = createMetaAdsClient(config);
      const result = await client.listCampaigns({
        accountId: config.defaultAccountId,
        limit: 1
      });

      summary.live_check = {
        attempted: true,
        ok: true,
        sample_count: Array.isArray(result && result.data) ? result.data.length : null
      };
    } catch (error) {
      summary.live_check = {
        attempted: true,
        ok: false,
        error: error.message
      };
      print(summary);
      process.exit(1);
    }
  }

  print(summary);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
