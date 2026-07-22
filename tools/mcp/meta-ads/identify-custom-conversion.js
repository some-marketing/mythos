#!/usr/bin/env node
'use strict';

// Diagnostic: identify a Meta custom conversion and check whether a campaign's
// ad sets are optimizing toward it — without asking the client.
//
// Answers three independent questions about a "0 conversions" tracking problem:
//   1. WHAT IS IT      — read the custom conversion's definition (name, event type, rule).
//   2. WHAT'S CONFIGURED — read each ad set's optimization_goal + promoted_object.
//   3. WHAT'S FIRING    — read last-30d ad-level insights `actions` to see which
//                          conversion action actually records, and how many.
//
// Read-only. Run live via the 1Password wrapper:
//   META_AD_ACCOUNT_ID=10151393423266343 \
//     tools/mcp/meta-ads/run-with-op.sh node tools/mcp/meta-ads/identify-custom-conversion.js \
//     --conversion 1258568162774895 --campaign-filter BetterHearingMonth
//
// Env: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID (from wrapper/project.json),
//      META_API_VERSION, META_GRAPH_BASE_URL.

const { buildUrl, requestJson } = require('../shared/http');
const { loadMetaAdsConfig } = require('./config');

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const cfg = loadMetaAdsConfig();
const ACCOUNT = String(arg('--account', cfg.defaultAccountId) || '').replace(/^act_/, '');
const CONVERSION_ID = arg('--conversion', null);
const CAMPAIGN_FILTER = arg('--campaign-filter', null); // substring match on campaign/adset name

if (!cfg.accessToken) { console.error('No META_ACCESS_TOKEN (run via run-with-op.sh).'); process.exit(1); }
if (!ACCOUNT) { console.error('No ad account id (--account or META_AD_ACCOUNT_ID).'); process.exit(1); }

const base = `${cfg.baseUrl.replace(/\/$/, '')}/${cfg.apiVersion}/`;
async function get(pathname, query = {}) {
  const url = buildUrl(base, pathname, query);
  const res = await requestJson({ method: 'GET', url, headers: { Authorization: `Bearer ${cfg.accessToken}` } });
  return res.data;
}

(async () => {
  const out = { account: ACCOUNT };

  // 1. WHAT IS IT — all custom conversions on the account (id→name→rule map).
  try {
    const cc = await get(`act_${ACCOUNT}/customconversions`, {
      fields: 'id,name,custom_event_type,rule,default_conversion_value,creation_time,is_archived,data_sources{id,name,source_type}',
      limit: 200
    });
    out.custom_conversions = (cc.data || []).map(c => ({
      id: c.id, name: c.name, type: c.custom_event_type,
      archived: c.is_archived, created: c.creation_time,
      rule: c.rule, sources: c.data_sources
    }));
    out.target_conversion = out.custom_conversions.find(c => String(c.id) === String(CONVERSION_ID)) || null;
  } catch (e) { out.custom_conversions_error = e.message; }

  // 2. WHAT'S CONFIGURED — ad sets' optimization + promoted object.
  try {
    const as = await get(`act_${ACCOUNT}/adsets`, {
      fields: 'name,effective_status,optimization_goal,billing_event,promoted_object,campaign{name}',
      limit: 200
    });
    let sets = as.data || [];
    if (CAMPAIGN_FILTER) {
      const f = CAMPAIGN_FILTER.toLowerCase();
      sets = sets.filter(s => (s.name || '').toLowerCase().includes(f) ||
        ((s.campaign && s.campaign.name) || '').toLowerCase().includes(f));
    }
    out.adsets = sets.map(s => ({
      name: s.name, status: s.effective_status, campaign: s.campaign && s.campaign.name,
      optimization_goal: s.optimization_goal, promoted_object: s.promoted_object
    }));
  } catch (e) { out.adsets_error = e.message; }

  // 3. WHAT'S FIRING — last-30d ad-level insights actions.
  try {
    const ins = await get(`act_${ACCOUNT}/insights`, {
      level: 'ad', date_preset: 'last_30d',
      fields: 'ad_name,campaign_name,spend,actions,action_values', limit: 200
    });
    let rows = ins.data || [];
    if (CAMPAIGN_FILTER) {
      const f = CAMPAIGN_FILTER.toLowerCase();
      rows = rows.filter(r => (r.campaign_name || '').toLowerCase().includes(f) || (r.ad_name || '').toLowerCase().includes(f));
    }
    out.firing = rows.map(r => ({
      ad: r.ad_name, campaign: r.campaign_name, spend: r.spend,
      conversion_actions: (r.actions || []).filter(a => /conversion|lead|complete|contact|appointment|schedule|custom/i.test(a.action_type))
    }));
  } catch (e) { out.firing_error = e.message; }

  console.log(JSON.stringify(out, null, 2));
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
