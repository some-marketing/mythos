#!/usr/bin/env node
'use strict';

// Pull Google Ads change_event records for campaign bidding-strategy changes.
// The change_event resource enforces a hard 30-day lookback limit (API returns
// START_DATE_TOO_OLD for any start date older than 30 days). --days is capped
// at 30 automatically. The tool still uses windowed paging in case future API
// versions loosen this limit.
//
// Usage (from repo root):
//   node tools/mcp/google-ads/pull-change-events.js \
//     --customerId 8560375238 \
//     [--days 30]              # default: 30; API hard max = 30 days (START_DATE_TOO_OLD)
//     [--out _dev/reports/analysis/change-events__YYYYMMDD.json]
//
// GOOGLE_ADS_DRY_RUN must be unset or "false" for live data.
// Prints a human-readable table to stdout; writes JSON to --out (or auto-named).

const fs = require('fs');
const path = require('path');
const { loadGoogleAdsConfig } = require('./config');
const { createGoogleAdsClient } = require('./client');

// change_event fields available for CAMPAIGN change_resource_type.
// old_resource / new_resource are JSON blobs; we parse them for bidding fields.
const CHANGE_EVENT_FIELDS = [
  'change_event.change_date_time',
  'change_event.change_resource_type',
  'change_event.changed_fields',
  'change_event.old_resource',
  'change_event.new_resource',
  'change_event.user_email',
  'change_event.client_type',
  'change_event.resource_name',
  'campaign.id',
  'campaign.name'
].join(',\n          ');

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

// ---- date helpers ----------------------------------------------------------

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

// Build 30-day windows covering [startDate, endDate] (both inclusive).
function buildWindows(startDate, endDate) {
  const windows = [];
  let cur = new Date(startDate);
  while (cur <= endDate) {
    const winEnd = addDays(cur, 29); // 30-day inclusive window
    const clampedEnd = winEnd > endDate ? endDate : winEnd;
    windows.push({ start: toDateStr(cur), end: toDateStr(clampedEnd) });
    cur = addDays(clampedEnd, 1);
  }
  return windows;
}

// ---- query -----------------------------------------------------------------

async function fetchWindow(client, customerId, startStr, endStr) {
  const query = `
    SELECT
          ${CHANGE_EVENT_FIELDS}
    FROM change_event
    WHERE change_event.change_date_time >= '${startStr} 00:00:00'
      AND change_event.change_date_time <= '${endStr} 23:59:59'
      AND change_event.change_resource_type = 'CAMPAIGN'
    ORDER BY change_event.change_date_time DESC
    LIMIT 10000
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

// Parse bidding-strategy-relevant fields from old/new resource blobs.
// The change_event API wraps the resource snapshot as { campaign: { ...fields } }.
// We extract one level down into the campaign object.
function parseBiddingInfo(resource) {
  if (!resource) return {};
  const out = {};
  try {
    let r = typeof resource === 'string' ? JSON.parse(resource) : resource;
    // The API wraps change snapshots: { campaign: { <fields> } }
    if (r && r.campaign && typeof r.campaign === 'object') r = r.campaign;
    if (!r || typeof r !== 'object') return out;

    // Bidding strategy type
    if (r.biddingStrategyType) out.biddingStrategyType = r.biddingStrategyType;
    if (r.bidding_strategy_type) out.biddingStrategyType = r.bidding_strategy_type;
    // MaximizeConversions tCPA cap
    const mc = r.maximizeConversions || r.maximize_conversions;
    if (mc) {
      out.maximizeConversions = {};
      const tCpa = mc.targetCpaMicros ?? mc.target_cpa_micros;
      if (tCpa != null) out.maximizeConversions.targetCpaMicros = tCpa;
    }
    // Portfolio bidding strategy ref
    if (r.biddingStrategy) out.biddingStrategyRef = r.biddingStrategy;
    if (r.bidding_strategy) out.biddingStrategyRef = r.bidding_strategy;
    // TargetCpa
    const tc = r.targetCpa || r.target_cpa;
    if (tc) {
      out.targetCpa = {};
      const v = tc.targetCpaMicros ?? tc.target_cpa_micros;
      if (v != null) out.targetCpa.targetCpaMicros = v;
    }
    // MaximizeConversionValue
    if (r.maximizeConversionValue) out.maximizeConversionValue = r.maximizeConversionValue;
    // TargetRoas
    if (r.targetRoas) out.targetRoas = r.targetRoas;
    // Status
    if (r.status) out.status = r.status;
    // Budget
    if (r.campaignBudget) out.campaignBudget = r.campaignBudget;
    if (r.campaign_budget) out.campaignBudget = r.campaign_budget;
  } catch (e) {
    out._parseError = String(e.message);
  }
  return out;
}

function formatMicros(v) {
  if (v == null) return '';
  return `$${(Number(v) / 1e6).toFixed(2)}`;
}

function summarizeBidding(info) {
  if (!info || !Object.keys(info).length) return '(no bidding data)';
  const parts = [];
  if (info.biddingStrategyType) parts.push(`type=${info.biddingStrategyType}`);
  if (info.maximizeConversions) {
    const mc = info.maximizeConversions;
    const tCpa = mc.targetCpaMicros != null ? formatMicros(mc.targetCpaMicros) : 'none';
    parts.push(`MaxConv tCPA=${tCpa}`);
  }
  if (info.targetCpa) {
    const tc = info.targetCpa;
    if (tc.targetCpaMicros != null) parts.push(`TargetCPA=${formatMicros(tc.targetCpaMicros)}`);
  }
  if (info.targetRoas) parts.push(`TargetROAS=${JSON.stringify(info.targetRoas)}`);
  if (info.biddingStrategyRef) parts.push(`portfolioRef=${info.biddingStrategyRef}`);
  if (info.status) parts.push(`status=${info.status}`);
  return parts.join(', ') || JSON.stringify(info);
}

// ---- table rendering -------------------------------------------------------

function renderTable(rows) {
  if (!rows.length) {
    console.log('No campaign change events found.');
    return;
  }

  const COL_W = { datetime: 22, campaign: 30, changed: 40, old: 42, new: 42, user: 28, client: 18 };
  const hr = (w) => '-'.repeat(w);
  const pad = (s, w) => String(s ?? '').padEnd(w).slice(0, w);

  const header = [
    pad('Date/Time', COL_W.datetime),
    pad('Campaign', COL_W.campaign),
    pad('Changed Fields', COL_W.changed),
    pad('Old Bidding', COL_W.old),
    pad('New Bidding', COL_W.new),
    pad('User', COL_W.user),
    pad('Client Type', COL_W.client)
  ].join(' | ');

  const divider = [
    hr(COL_W.datetime), hr(COL_W.campaign), hr(COL_W.changed),
    hr(COL_W.old), hr(COL_W.new), hr(COL_W.user), hr(COL_W.client)
  ].join('-+-');

  console.log('\n=== Campaign Change Events ===\n');
  console.log(header);
  console.log(divider);

  for (const row of rows) {
    const ce = row.changeEvent || row.change_event || {};
    const camp = row.campaign || {};
    const datetime = (ce.changeDateTime || ce.changeDatetime || ce.change_date_time || '').replace('T', ' ').slice(0, 19);
    const campName = camp.name || camp.id || '';
    const rawFields = ce.changedFields || ce.changed_fields;
    const changedFields = Array.isArray(rawFields) ? rawFields.join(', ') : String(rawFields || '');
    const oldB = summarizeBidding(parseBiddingInfo(ce.oldResource || ce.old_resource));
    const newB = summarizeBidding(parseBiddingInfo(ce.newResource || ce.new_resource));
    const user = ce.userEmail || ce.user_email || '';
    const clientType = ce.clientType || ce.client_type || '';

    console.log([
      pad(datetime, COL_W.datetime),
      pad(campName, COL_W.campaign),
      pad(changedFields, COL_W.changed),
      pad(oldB, COL_W.old),
      pad(newB, COL_W.new),
      pad(user, COL_W.user),
      pad(clientType, COL_W.client)
    ].join(' | '));
  }

  console.log('\nTotal rows:', rows.length);
}

// ---- main ------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const customerId = String(args.customerId || args['customer-id'] || '').replace(/-/g, '');
  // The Google Ads change_event API enforces a hard maximum of 30 days lookback.
  // Requests with start_date older than 30 days return START_DATE_TOO_OLD (400).
  // We use 28 days as a safe ceiling to avoid off-by-one edge cases at query time.
  const MAX_DAYS = 28;
  const requestedDays = parseInt(args.days || args.d || '28', 10);
  const days = Math.min(requestedDays, MAX_DAYS);

  if (!customerId) {
    console.error('Usage: --customerId <digits> [--days 30] [--out path.json]');
    console.error('  Defaults: --days 30 (API hard max: 30 days; requests older than 30d return START_DATE_TOO_OLD)');
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
  const windows = buildWindows(startDate, endDate);

  console.error(`Fetching change_event for customer ${customerId}, ${days} days (${windows.length} windows)...`);

  const allRows = [];
  for (const w of windows) {
    process.stderr.write(`  window ${w.start} → ${w.end} ... `);
    try {
      const res = await fetchWindow(client, customerId, w.start, w.end);
      const rows = extractRows(res);
      process.stderr.write(`${rows.length} rows\n`);
      allRows.push(...rows);
    } catch (err) {
      process.stderr.write(`ERROR: ${err.message}\n`);
    }
  }

  // Deduplicate by change_event resource_name (windows may overlap by ~0 but be safe)
  const seen = new Set();
  const deduped = allRows.filter((r) => {
    const ce = r.changeEvent || r.change_event || {};
    const key = ce.resourceName || ce.resource_name || JSON.stringify(ce.changeDatetime || ce.change_date_time);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort ascending by datetime
  deduped.sort((a, b) => {
    const ta = (a.changeEvent || a.change_event || {}).changeDateTime || (a.changeEvent || a.change_event || {}).changeDatetime || (a.changeEvent || a.change_event || {}).change_date_time || '';
    const tb = (b.changeEvent || b.change_event || {}).changeDateTime || (b.changeEvent || b.change_event || {}).changeDatetime || (b.changeEvent || b.change_event || {}).change_date_time || '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  renderTable(deduped);

  // Build enriched output
  const enriched = deduped.map((r) => {
    const ce = r.changeEvent || r.change_event || {};
    const camp = r.campaign || {};
    return {
      datetime: ce.changeDateTime || ce.changeDatetime || ce.change_date_time,
      campaignId: camp.id,
      campaignName: camp.name,
      changedFields: (() => { const f = ce.changedFields || ce.changed_fields; return Array.isArray(f) ? f : String(f || ''); })(),
      oldBidding: parseBiddingInfo(ce.oldResource || ce.old_resource),
      newBidding: parseBiddingInfo(ce.newResource || ce.new_resource),
      userEmail: ce.userEmail || ce.user_email,
      clientType: ce.clientType || ce.client_type,
      _raw: r
    };
  });

  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const defaultOut = path.resolve(process.cwd(), `_dev/reports/analysis/change-events__${dateTag}.json`);
  const outFile = args.out ? path.resolve(process.cwd(), args.out) : defaultOut;

  const output = {
    customerId,
    pulledAt: new Date().toISOString(),
    daysRequested: days,
    startDate: toDateStr(startDate),
    endDate: toDateStr(endDate),
    totalRows: enriched.length,
    rows: enriched
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.error(`\nJSON written to: ${outFile}`);
  console.error(`Total unique change events: ${enriched.length}`);
}

main().catch((err) => {
  console.error('pull-change-events failed:', err.message || err);
  process.exit(1);
});
