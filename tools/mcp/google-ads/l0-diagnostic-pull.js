#!/usr/bin/env node
'use strict';

// L0 diagnostic pull for paid-media/google-ads-account-optimization framework.
// Pulls a fixed set of read-only GAQL reports against a Google Ads customer
// and writes them to a timestamped output directory. SELECT-only; mutations
// are forbidden by the gaql-allowlist.
//
// Usage:
//   node tools/mcp/google-ads/l0-diagnostic-pull.js \
//     --customer-id 8560375238 \
//     --out-dir clients/YOUR_CLIENT/shared/google-ads-l0-pull__YYYYMMDD \
//     [--date-range LAST_30_DAYS]
//
// GOOGLE_ADS_DRY_RUN must be unset or "false" for this to hit the live API.
// The script does not call any mutate-class tool; reads only.

const fs = require('fs');
const path = require('path');
const { loadGoogleAdsConfig } = require('./config');
const loadConfig = loadGoogleAdsConfig;
const { createGoogleAdsClient } = require('./client');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (!val || val.startsWith('--')) { args[key] = true; continue; }
    args[key] = val;
    i++;
  }
  return args;
}

async function runQuery(client, name, query, customerId) {
  const start = Date.now();
  try {
    const res = await client.search({ customerId, query: query.replace(/\s+/g, ' ').trim() });
    return { name, ok: true, ms: Date.now() - start, result: res };
  } catch (err) {
    return { name, ok: false, ms: Date.now() - start, error: String(err.message || err) };
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const customerId = args['customer-id'];
  const outDir = args['out-dir'];
  const dateRange = args['date-range'] || 'LAST_30_DAYS';

  if (!customerId || !outDir) {
    console.error('Usage: --customer-id <digits> --out-dir <path> [--date-range LAST_30_DAYS]');
    process.exit(2);
  }

  const config = loadConfig();
  if (config.dryRun) {
    console.error('GOOGLE_ADS_DRY_RUN=true — reads return stubs. Set GOOGLE_ADS_DRY_RUN=false for live data.');
    process.exit(3);
  }

  const absOut = path.resolve(process.cwd(), outDir);
  fs.mkdirSync(absOut, { recursive: true });

  const client = createGoogleAdsClient(config);
  const cidStripped = String(customerId).replace(/-/g, '');

  // Define L0 query battery. Each entry: name + GAQL string.
  // Notes:
  // - search_term_view: zero-converting queries with cost > $30 (cost_micros > 30000000) over date range
  // - campaign perf last-7d and last-30d separately (caller can diff)
  // - hour-of-day on Car Loans needs campaign-id filter; caller can re-run with a filter if Car Loans is identified
  // - asset-group / auction insights / geo / age-of-data segments deferred to follow-up: not all in allowlist
  const queries = [
    {
      name: 'campaigns-list',
      gaql: `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          campaign.advertising_channel_sub_type,
          campaign.bidding_strategy_type,
          campaign.campaign_budget,
          campaign_budget.id,
          campaign_budget.name,
          campaign_budget.amount_micros,
          campaign_budget.explicitly_shared
        FROM campaign
        ORDER BY campaign.id
      `
    },
    {
      name: 'campaign-perf-last-7d',
      gaql: `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.search_impression_share,
          metrics.search_budget_lost_impression_share,
          metrics.search_rank_lost_impression_share
        FROM campaign
        WHERE segments.date DURING LAST_7_DAYS
        ORDER BY metrics.cost_micros DESC
      `
    },
    {
      name: 'campaign-perf-last-30d',
      gaql: `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.search_impression_share,
          metrics.search_budget_lost_impression_share,
          metrics.search_rank_lost_impression_share
        FROM campaign
        WHERE segments.date DURING LAST_30_DAYS
        ORDER BY metrics.cost_micros DESC
      `
    },
    {
      // FIX (2026-06-01): prior query 400'd. `search_term_view.ad_group_criterion.keyword.match_type`
      // is not a valid selectable field on search_term_view in Google Ads API v20.
      // Match type of the triggering keyword is exposed via the segment
      // `segments.keyword.info.match_type`. search_term_view.status added for
      // negative-keyword discovery (ADDED/EXCLUDED/NONE).
      name: 'search-terms-top-spend-last-30d',
      gaql: `
        SELECT
          search_term_view.search_term,
          search_term_view.status,
          segments.keyword.info.text,
          segments.keyword.info.match_type,
          campaign.id,
          campaign.name,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions
        FROM search_term_view
        WHERE segments.date DURING LAST_30_DAYS
        ORDER BY metrics.cost_micros DESC
        LIMIT 500
      `
    },
    {
      name: 'keyword-perf-with-qs-last-30d',
      gaql: `
        SELECT
          ad_group_criterion.criterion_id,
          ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type,
          ad_group_criterion.quality_info.quality_score,
          ad_group_criterion.quality_info.creative_quality_score,
          ad_group_criterion.quality_info.post_click_quality_score,
          ad_group_criterion.quality_info.search_predicted_ctr,
          campaign.id,
          campaign.name,
          ad_group.id,
          ad_group.name,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.average_cpc
        FROM keyword_view
        WHERE segments.date DURING LAST_30_DAYS
          AND ad_group_criterion.status = 'ENABLED'
        ORDER BY metrics.cost_micros DESC
        LIMIT 500
      `
    },
    {
      name: 'conversion-actions',
      gaql: `
        SELECT
          conversion_action.id,
          conversion_action.name,
          conversion_action.status,
          conversion_action.type,
          conversion_action.category,
          conversion_action.primary_for_goal,
          conversion_action.counting_type,
          conversion_action.click_through_lookback_window_days
        FROM conversion_action
        ORDER BY conversion_action.id
      `
    },
    {
      // Auto-apply state. Each row is an auto-apply subscription for a
      // recommendation type. status=ENABLED → that type is auto-applied by
      // Google (silent account mutation); status=PAUSED → subscription exists
      // but dormant; zero rows → auto-apply fully off. v20 conveys auto-apply
      // via row existence + status (there is no apply_recommendation_automatically
      // field). Load-bearing for "clean conversion window" gates (a client-specific phase-2
      // L3 / amendment D10): ENABLED RAISE_TARGET_CPA/SET_TARGET_CPA contaminate
      // a tCPA test; ENABLED RESPONSIVE_SEARCH_AD* contaminate ad-copy tests.
      // SELECT-only; no date segment.
      name: 'recommendation-subscriptions',
      gaql: `
        SELECT
          recommendation_subscription.type,
          recommendation_subscription.status,
          recommendation_subscription.create_date_time,
          recommendation_subscription.modify_date_time
        FROM recommendation_subscription
      `
    },
    {
      name: 'ad-group-perf-last-30d',
      gaql: `
        SELECT
          ad_group.id,
          ad_group.name,
          ad_group.status,
          ad_group.type,
          campaign.id,
          campaign.name,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions
        FROM ad_group
        WHERE segments.date DURING LAST_30_DAYS
        ORDER BY metrics.cost_micros DESC
        LIMIT 200
      `
    }
  ];

  const summary = {
    customer_id: cidStripped,
    date_range: dateRange,
    pulled_at: new Date().toISOString(),
    out_dir: outDir,
    queries: []
  };

  for (const q of queries) {
    process.stderr.write(`-- ${q.name} ... `);
    const r = await runQuery(client, q.name, q.gaql, cidStripped);
    process.stderr.write(`${r.ok ? 'ok' : 'FAIL'} (${r.ms}ms)\n`);
    const file = path.join(absOut, `${q.name}.json`);
    fs.writeFileSync(file, JSON.stringify(r, null, 2));
    summary.queries.push({
      name: q.name,
      ok: r.ok,
      ms: r.ms,
      file: path.relative(process.cwd(), file),
      result_rows: r.ok
        ? (Array.isArray(r.result)
            ? r.result.reduce((n, b) => n + ((b && b.results && b.results.length) || 0), 0)
            : (r.result?.results?.length || 0))
        : 0,
      error: r.error || null
    });
  }

  fs.writeFileSync(path.join(absOut, 'manifest.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('L0 pull failed:', err.message || err);
  process.exit(1);
});
