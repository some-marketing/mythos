#!/usr/bin/env node
'use strict';

const { loadGoogleAdsConfig } = require('./config');
const { createGoogleAdsClient } = require('./client');

async function main() {
  const liveCheck = process.argv.includes('--live-check');
  const config = loadGoogleAdsConfig();

  const summary = {
    platform: 'google-ads',
    dry_run: config.dryRun,
    config: {
      api_version: config.apiVersion,
      default_customer_id_present: Boolean(config.defaultCustomerId),
      login_customer_id_present: Boolean(config.loginCustomerId),
      developer_token_present: Boolean(config.developerToken),
      client_id_present: Boolean(config.clientId),
      client_secret_present: Boolean(config.clientSecret),
      refresh_token_present: Boolean(config.refreshToken)
    },
    ready_for_live_reads: Boolean(
      config.defaultCustomerId &&
      config.developerToken &&
      config.clientId &&
      config.clientSecret &&
      config.refreshToken
    ),
    live_check: null
  };

  if (liveCheck) {
    if (config.dryRun) {
      summary.live_check = {
        attempted: false,
        ok: false,
        reason: 'GOOGLE_ADS_DRY_RUN=true'
      };
      print(summary);
      process.exit(1);
    }

    try {
      const client = createGoogleAdsClient(config);
      const result = await client.search({
        customerId: config.defaultCustomerId,
        query: 'SELECT campaign.id, campaign.name FROM campaign LIMIT 1'
      });

      summary.live_check = {
        attempted: true,
        ok: true,
        result_type: Array.isArray(result) ? 'array' : typeof result
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
