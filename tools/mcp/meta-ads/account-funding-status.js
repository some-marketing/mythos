'use strict';

// Reads an ad account's funding/health and per-ad delivery status in one shot.
// Answers the recurring question "is this Meta ad account funded and are its
// ads actually delivering?" without poking the dashboard.
//
// Usage (live reads require a real token; run through run-with-op.sh):
//   META_AD_ACCOUNT_ID=10151393423266343 \
//     tools/mcp/meta-ads/run-with-op.sh node tools/mcp/meta-ads/account-funding-status.js
//   tools/mcp/meta-ads/run-with-op.sh node tools/mcp/meta-ads/account-funding-status.js --account 10151393423266343
//
// Pure read (GET only). Emits a human summary to stderr and the raw JSON to
// stdout so it can be piped/saved.

const { buildUrl, requestJson } = require('../shared/http');
const { loadMetaAdsConfig } = require('./config');

// Meta account_status enum → label.
const ACCOUNT_STATUS = {
  1: 'ACTIVE',
  2: 'DISABLED',
  3: 'UNSETTLED',
  7: 'PENDING_RISK_REVIEW',
  8: 'PENDING_SETTLEMENT',
  9: 'IN_GRACE_PERIOD',
  100: 'PENDING_CLOSURE',
  101: 'CLOSED',
  201: 'ANY_ACTIVE',
  202: 'ANY_CLOSED'
};

// disable_reason enum → label.
const DISABLE_REASON = {
  0: 'NONE',
  1: 'ADS_INTEGRITY_POLICY',
  2: 'ADS_IP_REVIEW',
  3: 'RISK_PAYMENT',
  4: 'GRAY_ACCOUNT_SHUT_DOWN',
  5: 'ADS_AFC_REVIEW',
  6: 'BUSINESS_INTEGRITY_RAR',
  7: 'PERMANENT_CLOSE',
  8: 'UNUSED_RESELLER_ACCOUNT',
  9: 'UNUSED_ACCOUNT'
};

function parseArgs(argv) {
  const args = { account: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--account' || a === '-a') {
      args.account = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function normalizeAccountId(id) {
  if (!id) return null;
  return id.startsWith('act_') ? id : `act_${id}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const config = loadMetaAdsConfig();
  const accountId = normalizeAccountId(args.account || config.defaultAccountId);
  if (!accountId) {
    console.error('[funding-status] no account id (pass --account or set META_AD_ACCOUNT_ID)');
    process.exit(2);
  }
  if (!config.accessToken) {
    console.error('[funding-status] no META_ACCESS_TOKEN — run through run-with-op.sh for live data.');
    process.exit(2);
  }

  const baseUrl = `${config.baseUrl.replace(/\/$/, '')}/${config.apiVersion}/`;
  const graphGet = async (pathname, query) => {
    const url = buildUrl(baseUrl, pathname, query);
    const response = await requestJson({
      method: 'GET',
      url,
      headers: { Authorization: `Bearer ${config.accessToken}` }
    });
    return response.data;
  };

  const account = await graphGet(accountId, {
    fields: [
      'name',
      'account_status',
      'disable_reason',
      'currency',
      'balance',
      'amount_spent',
      'spend_cap',
      'funding_source',
      'funding_source_details'
    ].join(',')
  });

  // Pull ads with their delivery state + any review/issue feedback.
  const adsResp = await graphGet(`${accountId}/ads`, {
    fields: [
      'name',
      'effective_status',
      'configured_status',
      'issues_info',
      'ad_review_feedback'
    ].join(','),
    limit: '200'
  });
  const ads = (adsResp && adsResp.data) || [];

  const statusLabel = ACCOUNT_STATUS[account.account_status] || `UNKNOWN(${account.account_status})`;
  const reasonLabel = DISABLE_REASON[account.disable_reason] || `UNKNOWN(${account.disable_reason})`;
  const funding = account.funding_source_details || {};

  // Meta returns balance/amount_spent/spend_cap as integer minor units (cents)
  // in the account currency. Convert to a major-unit number for display.
  const toMajor = (v) => (v === undefined || v === null ? null : Number(v) / 100);

  const summary = {
    account_id: accountId,
    name: account.name,
    account_status: statusLabel,
    disable_reason: reasonLabel,
    currency: account.currency,
    balance: toMajor(account.balance),
    amount_spent: toMajor(account.amount_spent),
    spend_cap: toMajor(account.spend_cap),
    funding_source_id: account.funding_source,
    funding_type: funding.type,
    funding_display: funding.display_string,
    ads_total: ads.length,
    ads_by_status: ads.reduce((acc, ad) => {
      const s = ad.effective_status || 'UNKNOWN';
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {}),
    ads_with_issues: ads
      .filter((ad) => Array.isArray(ad.issues_info) && ad.issues_info.length > 0)
      .map((ad) => ({
        name: ad.name,
        effective_status: ad.effective_status,
        issues: ad.issues_info.map((i) => i.error_summary || i.error_message || i.level)
      }))
  };

  // Human-readable to stderr.
  const has = (label) => (label === undefined || label === null ? '—' : label);
  console.error('');
  console.error(`Ad account: ${has(summary.name)} (${accountId})`);
  console.error(`  Status:        ${summary.account_status}` + (summary.disable_reason !== 'NONE' ? `  (disable_reason: ${summary.disable_reason})` : ''));
  console.error(`  Funding:       ${has(summary.funding_display)}${summary.funding_type ? ` [${summary.funding_type}]` : ''} (source id: ${has(summary.funding_source_id)})`);
  console.error(`  Balance/spent: ${has(summary.balance)} ${has(summary.currency)} owing / ${has(summary.amount_spent)} ${has(summary.currency)} lifetime spend` + (summary.spend_cap ? `  (spend_cap ${summary.spend_cap})` : ''));
  console.error(`  Ads:           ${summary.ads_total} total — ${JSON.stringify(summary.ads_by_status)}`);
  if (summary.ads_with_issues.length > 0) {
    console.error('  Ads with issues:');
    for (const ad of summary.ads_with_issues) {
      console.error(`    - ${ad.name} [${ad.effective_status}]: ${ad.issues.join('; ')}`);
    }
  }
  console.error('');

  // Machine-readable to stdout.
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

main().catch((err) => {
  console.error('[funding-status] error:', err && err.message ? err.message : err);
  process.exit(1);
});
