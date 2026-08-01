#!/usr/bin/env node
'use strict';

// Pull per-campaign daily performance metrics for ENABLED campaigns.
// Writes both CSV and JSON outputs for downstream analysis.
//
// Usage (from repo root):
//   node tools/mcp/google-ads/pull-daily-series.js \
//     --customerId "$GOOGLE_ADS_CUSTOMER_ID" \
//     [--days 45]              # default: 45
//     [--out-prefix _dev/reports/analysis/daily-series__YYYYMMDD]
//
// Output files: <prefix>.csv and <prefix>.json
// GOOGLE_ADS_DRY_RUN must be unset or "false" for live data.
//
// Note: impression share fields (search_impression_share, search_budget_lost_impression_share,
// search_rank_lost_impression_share) are only returned for Search/Shopping channels.
// Performance Max and Display campaigns will have null for those columns.

const fs = require('fs');
const path = require('path');
const { loadGoogleAdsConfig } = require('./config');
const { createGoogleAdsClient } = require('./client');

// ---- arg parsing -----------------------------------------------------------

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

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

// ---- query -----------------------------------------------------------------

async function fetchDailySeries(client, customerId, startStr, endStr) {
  // Note: all_conversions is a separate metric from conversions.
  // impression share fields return null for PMax / Display — handled gracefully.
  const query = `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.bidding_strategy_type,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.all_conversions,
      metrics.search_impression_share,
      metrics.search_budget_lost_impression_share,
      metrics.search_rank_lost_impression_share
    FROM campaign
    WHERE segments.date BETWEEN '${startStr}' AND '${endStr}'
      AND campaign.status = 'ENABLED'
    ORDER BY segments.date ASC, metrics.cost_micros DESC
    LIMIT 50000
  `.replace(/\s+/g, ' ').trim();

  return client.runGaql({ customerId, query });
}

// ---- response parsing ------------------------------------------------------

function extractRows(apiResponse) {
  if (!apiResponse || !Array.isArray(apiResponse)) return [];
  const rows = [];
  for (const batch of apiResponse) {
    if (batch && Array.isArray(batch.results)) {
      rows.push(...batch.results);
    }
  }
  return rows;
}

function toNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function microsToDollars(v) {
  if (v == null || v === '') return null;
  return (Number(v) / 1e6);
}

function parseRow(r) {
  const seg = r.segments || {};
  const camp = r.campaign || {};
  const m = r.metrics || {};

  const costDollars = microsToDollars(m.costMicros || m.cost_micros);
  const conversions = toNum(m.conversions);
  const cpa = (conversions && costDollars != null && conversions > 0)
    ? (costDollars / conversions)
    : null;

  return {
    date: seg.date,
    campaignId: String(camp.id || ''),
    campaignName: camp.name || '',
    channelType: camp.advertisingChannelType || camp.advertising_channel_type || '',
    biddingStrategyType: camp.biddingStrategyType || camp.bidding_strategy_type || '',
    impressions: toNum(m.impressions),
    clicks: toNum(m.clicks),
    costDollars: costDollars != null ? parseFloat(costDollars.toFixed(4)) : null,
    costMicros: toNum(m.costMicros || m.cost_micros),
    conversions: conversions,
    conversionsValue: toNum(m.conversionsValue || m.conversions_value),
    allConversions: toNum(m.allConversions || m.all_conversions),
    cpa: cpa != null ? parseFloat(cpa.toFixed(4)) : null,
    searchImpressionShare: toNum(m.searchImpressionShare || m.search_impression_share),
    searchBudgetLostIS: toNum(m.searchBudgetLostImpressionShare || m.search_budget_lost_impression_share),
    searchRankLostIS: toNum(m.searchRankLostImpressionShare || m.search_rank_lost_impression_share)
  };
}

// ---- CSV output ------------------------------------------------------------

const CSV_HEADERS = [
  'date', 'campaignId', 'campaignName', 'channelType', 'biddingStrategyType',
  'impressions', 'clicks', 'costDollars', 'conversions', 'conversionsValue',
  'allConversions', 'cpa', 'searchImpressionShare', 'searchBudgetLostIS', 'searchRankLostIS'
];

function escCsv(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(rows) {
  const lines = [CSV_HEADERS.join(',')];
  for (const r of rows) {
    lines.push(CSV_HEADERS.map((h) => escCsv(r[h])).join(','));
  }
  return lines.join('\n');
}

// ---- summary table ---------------------------------------------------------

function renderSummary(rows) {
  // Per-campaign aggregate
  const bycamp = {};
  for (const r of rows) {
    const k = `${r.campaignId}|${r.campaignName}`;
    if (!bycamp[k]) {
      bycamp[k] = {
        id: r.campaignId,
        name: r.campaignName,
        channel: r.channelType,
        bidding: r.biddingStrategyType,
        days: 0,
        impressions: 0,
        clicks: 0,
        cost: 0,
        conversions: 0,
        allConversions: 0
      };
    }
    const b = bycamp[k];
    b.days++;
    b.impressions += r.impressions || 0;
    b.clicks += r.clicks || 0;
    b.cost += r.costDollars || 0;
    b.conversions += r.conversions || 0;
    b.allConversions += r.allConversions || 0;
  }

  console.log('\n=== Daily Series — Campaign Summary ===\n');
  const PAD = { name: 32, channel: 12, bidding: 24, days: 5, impr: 10, clicks: 8, cost: 10, conv: 8, cpa: 8 };
  const pad = (s, w) => String(s ?? '').padStart(w).slice(-w);
  const padl = (s, w) => String(s ?? '').padEnd(w).slice(0, w);

  console.log([
    padl('Campaign', PAD.name), pad('Chan', PAD.channel), padl('Bidding', PAD.bidding),
    pad('Days', PAD.days), pad('Impress', PAD.impr), pad('Clicks', PAD.clicks),
    pad('Cost$', PAD.cost), pad('Conv', PAD.conv), pad('CPA$', PAD.cpa)
  ].join(' | '));

  for (const b of Object.values(bycamp).sort((a, b2) => b2.cost - a.cost)) {
    const cpa = b.conversions > 0 ? (b.cost / b.conversions).toFixed(2) : '-';
    console.log([
      padl(b.name, PAD.name),
      pad(b.channel, PAD.channel),
      padl(b.bidding, PAD.bidding),
      pad(b.days, PAD.days),
      pad(b.impressions.toLocaleString(), PAD.impr),
      pad(b.clicks.toLocaleString(), PAD.clicks),
      pad(b.cost.toFixed(2), PAD.cost),
      pad(b.conversions.toFixed(1), PAD.conv),
      pad(cpa, PAD.cpa)
    ].join(' | '));
  }

  console.log(`\nTotal rows: ${rows.length}`);
}

// ---- main ------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const customerId = String(args.customerId || args['customer-id'] || '').replace(/-/g, '');
  const days = parseInt(args.days || args.d || '45', 10);

  if (!customerId) {
    console.error('Usage: --customerId <digits> [--days 45] [--out-prefix path-prefix]');
    console.error('  Defaults: --days 45');
    console.error('  GOOGLE_ADS_DRY_RUN=false required for live data');
    process.exit(2);
  }

  const config = loadGoogleAdsConfig();
  if (config.dryRun) {
    console.error('GOOGLE_ADS_DRY_RUN=true — no live data. Set GOOGLE_ADS_DRY_RUN=false.');
    process.exit(3);
  }

  const client = createGoogleAdsClient(config);

  const endDate = new Date();
  const startDate = addDays(endDate, -days);
  const startStr = toDateStr(startDate);
  const endStr = toDateStr(endDate);

  console.error(`Fetching daily series for customer ${customerId}, ${days} days (${startStr} → ${endStr})...`);

  let apiResponse;
  try {
    apiResponse = await fetchDailySeries(client, customerId, startStr, endStr);
  } catch (err) {
    console.error('Query failed:', err.message);
    process.exit(1);
  }

  const rawRows = extractRows(apiResponse);
  console.error(`Raw rows from API: ${rawRows.length}`);

  const parsed = rawRows.map(parseRow).filter((r) => r.date);

  renderSummary(parsed);

  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const defaultPrefix = path.resolve(process.cwd(), `_dev/reports/analysis/daily-series__${dateTag}`);
  const prefix = args['out-prefix']
    ? path.resolve(process.cwd(), args['out-prefix'])
    : defaultPrefix;

  fs.mkdirSync(path.dirname(prefix), { recursive: true });

  const csvFile = `${prefix}.csv`;
  const jsonFile = `${prefix}.json`;

  fs.writeFileSync(csvFile, toCsv(parsed));
  fs.writeFileSync(jsonFile, JSON.stringify({
    customerId,
    pulledAt: new Date().toISOString(),
    daysRequested: days,
    startDate: startStr,
    endDate: endStr,
    totalRows: parsed.length,
    rows: parsed
  }, null, 2));

  console.error(`\nCSV written to:  ${csvFile}`);
  console.error(`JSON written to: ${jsonFile}`);
}

main().catch((err) => {
  console.error('pull-daily-series failed:', err.message || err);
  process.exit(1);
});
