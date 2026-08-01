'use strict';

// Pauses every ad in an account whose delivery is blocked by a given issue
// (matched against effective_status==WITH_ISSUES + issues_info error text).
// Built for the recurring "turn off the ads for events that have ended" chore,
// but generic over any issue substring.
//
// SAFE BY DEFAULT: a dry preview unless --apply is passed. Re-reads each ad's
// effective_status after the write and reports it.
//
// Usage:
//   # preview (no writes):
//   META_AD_ACCOUNT_ID="$META_AD_ACCOUNT_ID" \
//     tools/mcp/meta-ads/run-with-op.sh node tools/mcp/meta-ads/pause-ads-by-issue.js --issue "Event Has Ended"
//   # apply:
//   META_AD_ACCOUNT_ID="$META_AD_ACCOUNT_ID" \
//     tools/mcp/meta-ads/run-with-op.sh node tools/mcp/meta-ads/pause-ads-by-issue.js --issue "Event Has Ended" --apply

const { buildUrl, requestJson } = require('../shared/http');
const { createMetaAdsClient } = require('./client');
const { loadMetaAdsConfig } = require('./config');

function parseArgs(argv) {
  const args = { account: null, issue: null, apply: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--account' || a === '-a') { args.account = argv[i + 1]; i += 1; }
    else if (a === '--issue' || a === '-i') { args.issue = argv[i + 1]; i += 1; }
    else if (a === '--apply') { args.apply = true; }
  }
  return args;
}

function normalizeAccountId(id) {
  if (!id) return null;
  return id.startsWith('act_') ? id : `act_${id}`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.issue) {
    console.error('[pause-by-issue] --issue "<substring>" is required (e.g. --issue "Event Has Ended")');
    process.exit(2);
  }
  const config = loadMetaAdsConfig();
  const accountId = normalizeAccountId(args.account || config.defaultAccountId);
  if (!accountId) {
    console.error('[pause-by-issue] no account id (pass --account or set META_AD_ACCOUNT_ID)');
    process.exit(2);
  }
  if (!config.accessToken) {
    console.error('[pause-by-issue] no META_ACCESS_TOKEN — run through run-with-op.sh.');
    process.exit(2);
  }

  const baseUrl = `${config.baseUrl.replace(/\/$/, '')}/${config.apiVersion}/`;
  const graphGet = async (pathname, query) => {
    const url = buildUrl(baseUrl, pathname, query);
    const response = await requestJson({ method: 'GET', url, headers: { Authorization: `Bearer ${config.accessToken}` } });
    return response.data;
  };

  const adsResp = await graphGet(`${accountId}/ads`, {
    fields: ['id', 'name', 'effective_status', 'configured_status', 'issues_info'].join(','),
    limit: '500'
  });
  const ads = (adsResp && adsResp.data) || [];

  const needle = args.issue.toLowerCase();
  const matched = ads.filter((ad) =>
    Array.isArray(ad.issues_info) &&
    ad.issues_info.some((i) => `${i.error_summary || ''} ${i.error_message || ''}`.toLowerCase().includes(needle))
  );

  console.error('');
  console.error(`Account ${accountId} — ads matching issue "${args.issue}": ${matched.length}`);
  for (const ad of matched) {
    const summaries = (ad.issues_info || []).map((i) => i.error_summary || i.error_message).join('; ');
    console.error(`  - ${ad.id}  ${ad.name}  [${ad.effective_status}]  (${summaries})`);
  }
  console.error('');

  if (matched.length === 0) {
    process.stdout.write(JSON.stringify({ account_id: accountId, issue: args.issue, matched: [], applied: false }, null, 2) + '\n');
    return;
  }

  if (!args.apply) {
    console.error('[pause-by-issue] DRY PREVIEW — pass --apply to pause these ads.');
    process.stdout.write(JSON.stringify({
      account_id: accountId,
      issue: args.issue,
      applied: false,
      matched: matched.map((a) => ({ id: a.id, name: a.name, effective_status: a.effective_status }))
    }, null, 2) + '\n');
    return;
  }

  const client = createMetaAdsClient(config);
  const results = [];
  for (const ad of matched) {
    try {
      await client.updateAdStatus({ adId: ad.id, status: 'PAUSED', live: true });
      // Re-read to confirm.
      const after = await graphGet(String(ad.id), { fields: 'id,name,effective_status,configured_status' });
      results.push({ id: ad.id, name: ad.name, ok: true, configured_status: after.configured_status, effective_status: after.effective_status });
      console.error(`  paused ${ad.id} ${ad.name} -> configured=${after.configured_status} effective=${after.effective_status}`);
    } catch (err) {
      results.push({ id: ad.id, name: ad.name, ok: false, error: err && err.message ? err.message : String(err) });
      console.error(`  FAILED ${ad.id} ${ad.name}: ${err && err.message ? err.message : err}`);
    }
  }
  console.error('');
  process.stdout.write(JSON.stringify({ account_id: accountId, issue: args.issue, applied: true, results }, null, 2) + '\n');
}

main().catch((err) => {
  console.error('[pause-by-issue] error:', err && err.message ? err.message : err);
  process.exit(1);
});
