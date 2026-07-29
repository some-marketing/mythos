'use strict';

const ALLOWED_FROM = new Set([
  'campaign',
  'campaign_budget',
  'campaign_conversion_goal',
  'ad_group',
  'ad_group_ad',
  'ad_group_criterion',
  'campaign_criterion',
  'customer',
  'customer_client',
  'conversion_action',
  'conversion_goal_campaign_config',
  'custom_conversion_goal',
  'keyword_view',
  'search_term_view',
  'shared_set',
  'shared_criterion',
  'campaign_shared_set',
  'asset',
  'campaign_asset',
  'asset_group',
  'asset_group_asset',
  'detail_placement_view',
  'group_placement_view',
  // Read-only recommendation surfaces. recommendation_subscription exposes the
  // account auto-apply state (which rec types Google applies automatically) —
  // load-bearing for "clean conversion window" gates (e.g. a phase-2 conversion-window gate).
  // recommendation exposes the current pending recommendation queue. SELECT-only.
  'recommendation',
  'recommendation_subscription',
  // change_event exposes the account change history (bidding strategy, budget,
  // status, targeting changes with old/new resource snapshots). Required for
  // temporal falsifier workflow: pinpoint WHEN a bidding-strategy change occurred
  // so post-change volume/CPA movement can be attributed correctly. SELECT-only;
  // the API enforces a finite date range filter (max 30-day window per query).
  'change_event'
]);

const FORBIDDEN_KEYWORDS = /\b(MUTATE|CREATE|UPDATE|DELETE|DROP|REMOVE|INSERT|ALTER|TRUNCATE)\b/i;

function validateQuery(query) {
  if (!query || typeof query !== 'string') {
    return { ok: false, error: 'Query must be a non-empty string' };
  }

  if (FORBIDDEN_KEYWORDS.test(query)) {
    return { ok: false, error: 'Only SELECT queries are allowed. Mutations must use dedicated tools.' };
  }

  if (!/^\s*SELECT\b/i.test(query.trim())) {
    return { ok: false, error: 'Only SELECT queries are allowed' };
  }

  const fromResources = extractFromResources(query);
  if (fromResources.length === 0) {
    return { ok: false, error: 'Could not identify FROM resources in query' };
  }

  const disallowed = fromResources.filter((r) => !ALLOWED_FROM.has(r));
  if (disallowed.length > 0) {
    return {
      ok: false,
      error: `Query references disallowed resources: ${disallowed.join(', ')}. Allowed: ${[...ALLOWED_FROM].sort().join(', ')}`
    };
  }

  return { ok: true };
}

function extractFromResources(query) {
  const normalized = query.replace(/\s+/g, ' ').trim();

  const fromMatch = normalized.match(/\bFROM\s+([\w_]+(?:\s*,\s*[\w_]+)*)/i);
  if (!fromMatch) return [];

  return fromMatch[1]
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

module.exports = {
  ALLOWED_FROM,
  validateQuery
};
