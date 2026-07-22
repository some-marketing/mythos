#!/usr/bin/env node
'use strict';

// lead-value-monitor.js — validate that tiered lead-conversion actions are
// firing with the expected non-zero value, and that the underlying
// conversion-action config hasn't silently regressed.
//
// Generic pattern extracted from a real zero-value-lead fix: after correcting
// a conversion-action's value settings, this monitor re-checks BOTH halves of
// the signal so a fix isn't declared done on faith:
//   - FIRING side: per-day post-fix firings carry real (non-zero, tiered) value.
//   - CONFIG side: the ENABLED primary tiers still hold the right default_value
//     and always_use_default_value=true (catches a silent config regression
//     even when firing volume is too low to judge), plus flags HIDDEN/REMOVED
//     duplicate actions matching the same prefix (conversion-action sprawl).
//
// SELECT-only (no mutations). Reads always hit the live API regardless of
// GOOGLE_ADS_DRY_RUN — the idempotency/validation logic needs truthful state.
// Run from repo root (env resolver is cwd-relative).
//
// Usage:
//   node tools/google-ads/lead-value-monitor.js \
//     --customer-id <id> \
//     --action-prefix lead_submit \
//     --expected-defaults '{"lead_submit_T1":250,"lead_submit_T2":167}' \
//     [--date-range LAST_14_DAYS] \
//     [--fix-date 2026-05-27] \
//     [--out <path.json>]
//
// --expected-defaults is optional; without it the monitor still reports
// firing volume and value per action but skips the config-drift check
// against a specific expected dollar figure.

const fs = require('fs');
const path = require('path');
const { loadGoogleAdsConfig } = require('../mcp/google-ads/config');
const { createGoogleAdsClient } = require('../mcp/google-ads/client');

// The REST googleAds:searchStream endpoint returns an array of batches,
// each shaped { results: [...] }. Older non-stream calls return { results }.
// Flatten both into a single results array.
function flattenSearchStream(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res.flatMap((batch) => (batch && batch.results) || []);
  return res.results || [];
}

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

async function main() {
  const args = parseArgs(process.argv);
  const customerId = String(args['customer-id'] || '').replace(/-/g, '');
  if (!customerId) {
    console.error('Usage: node tools/google-ads/lead-value-monitor.js --customer-id <id> [--action-prefix lead_submit] [--expected-defaults \'{"action_name":dollar_value}\'] [--date-range LAST_14_DAYS] [--fix-date YYYY-MM-DD] [--out <path.json>]');
    process.exit(2);
  }
  const dateRange = args['date-range'] || 'LAST_14_DAYS';
  const fixDate = args['fix-date'] || null;
  const actionPrefix = String(args['action-prefix'] || 'lead_submit');
  const expectedDefaults = args['expected-defaults'] ? JSON.parse(args['expected-defaults']) : {};

  const config = loadGoogleAdsConfig();
  // Reads go live regardless of dry-run; only warn so the operator knows.
  if (config.dryRun) {
    process.stderr.write('note: GOOGLE_ADS_DRY_RUN=true — reads still hit live API; only mutations are stubbed.\n');
  }

  const client = createGoogleAdsClient(config);

  // Per-action firings by date. all_conversions captures every fire (not just
  // primary-for-goal), which is what we need to confirm value population.
  const query = `
    SELECT
      segments.date,
      segments.conversion_action_name,
      metrics.all_conversions,
      metrics.all_conversions_value
    FROM customer
    WHERE segments.date DURING ${dateRange}
      AND segments.conversion_action_name LIKE '${actionPrefix}%'
    ORDER BY segments.date
  `.replace(/\s+/g, ' ').trim();

  const res = await client.runGaql({ customerId, query });
  const rows = flattenSearchStream(res);

  const firings = rows.map((r) => {
    const name = r.segments?.conversionActionName;
    const date = r.segments?.date;
    const conv = Number(r.metrics?.allConversions || 0);
    const value = Number(r.metrics?.allConversionsValue || 0);
    return {
      date,
      action: name,
      conversions: conv,
      value,
      value_per_conv: conv > 0 ? Number((value / conv).toFixed(2)) : 0,
      post_fix: fixDate ? date >= fixDate : null,
      expected_default: expectedDefaults[name] ?? null
    };
  });

  const postFix = fixDate ? firings.filter((f) => f.post_fix && f.conversions > 0) : firings.filter((f) => f.conversions > 0);
  const postFixWithValue = postFix.filter((f) => f.value > 0);
  const tiersValidated = [...new Set(postFixWithValue.map((f) => f.action))].sort();

  // --- CONFIG side ---
  // The firing side can only judge what has volume; the config side catches a
  // silent regression (default_value reset to 1, or always_use_default_value
  // flipped off) even with zero post-fix firings, and surfaces HIDDEN/REMOVED
  // duplicate actions (conversion-action sprawl).
  const configQuery = `
    SELECT
      conversion_action.name,
      conversion_action.status,
      conversion_action.type,
      conversion_action.primary_for_goal,
      conversion_action.value_settings.default_value,
      conversion_action.value_settings.always_use_default_value
    FROM conversion_action
    ORDER BY conversion_action.id
  `.replace(/\s+/g, ' ').trim();

  let configRows = [];
  try {
    configRows = flattenSearchStream(await client.runGaql({ customerId, query: configQuery }));
  } catch (err) {
    process.stderr.write(`config-posture query failed (non-fatal): ${err.message || err}\n`);
  }

  const matchingActions = configRows
    .map((r) => r.conversionAction || {})
    .filter((ca) => String(ca.name || '').toLowerCase().includes(actionPrefix.toLowerCase()))
    .map((ca) => ({
      name: ca.name,
      status: ca.status,
      primary_for_goal: ca.primaryForGoal === true,
      default_value: Number(ca.valueSettings?.defaultValue || 0),
      always_use_default_value: !!ca.valueSettings?.alwaysUseDefaultValue,
      expected_default: expectedDefaults[ca.name] ?? null
    }));

  // Active primary tiers we expect to carry a tiered value.
  const activeTiers = matchingActions.filter(
    (a) => a.status === 'ENABLED' && a.primary_for_goal && a.expected_default != null
  );
  const configIssues = [];
  for (const a of activeTiers) {
    if (!a.always_use_default_value) {
      configIssues.push(`${a.name}: always_use_default_value=false (value will not be stamped)`);
    }
    if (a.default_value <= 1.5) {
      configIssues.push(`${a.name}: default_value=$${a.default_value} (flat-default signature)`);
    } else if (a.expected_default != null && Math.abs(a.default_value - a.expected_default) > 0.5) {
      configIssues.push(`${a.name}: default_value=$${a.default_value} != expected $${a.expected_default}`);
    }
  }
  const hiddenDuplicates = matchingActions
    .filter((a) => (a.status === 'HIDDEN' || a.status === 'REMOVED'))
    .map((a) => a.name);
  const configPosture = {
    expected_defaults: expectedDefaults,
    active_primary_tiers: activeTiers,
    config_ok: activeTiers.length === 0 || configIssues.length === 0,
    config_issues: configIssues,
    hidden_or_removed_duplicates: hiddenDuplicates,
    all_matching_actions: matchingActions
  };

  // --- Verdict: config gate first (a config regression is decisive even with
  // no firings), then the firing-side verdict. ---
  let verdict;
  if (activeTiers.length > 0 && configIssues.length > 0) {
    verdict = `CONFIG-FAIL — value config regressed: ${configIssues.join('; ')}`;
  } else if (postFix.length === 0) {
    verdict = 'PENDING — config OK; no firings in range yet; re-run after natural lead volume';
  } else if (postFixWithValue.length === 0) {
    verdict = 'FAIL — firings exist but still report value=0; fix may not be live';
  } else if (postFixWithValue.length === postFix.length) {
    verdict = `PASS — config OK and all ${postFix.length} firing-days carry non-zero value (tiers: ${tiersValidated.join(', ')})`;
  } else {
    verdict = `PARTIAL — ${postFixWithValue.length}/${postFix.length} firing-days carry value (tiers: ${tiersValidated.join(', ')})`;
  }

  const report = {
    schema: 'lead-value-monitor/1.1',
    customer_id: customerId,
    date_range: dateRange,
    fix_date: fixDate,
    action_prefix: actionPrefix,
    pulled_at: new Date().toISOString(),
    query,
    config_query: configQuery,
    verdict,
    config_posture: configPosture,
    tiers_validated_post_fix: tiersValidated,
    counts: {
      total_firing_days: firings.length,
      post_fix_firing_days: postFix.length,
      post_fix_firing_days_with_value: postFixWithValue.length
    },
    firings
  };

  if (args.out) {
    const abs = path.resolve(process.cwd(), args.out);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(report, null, 2));
    process.stderr.write(`wrote ${path.relative(process.cwd(), abs)}\n`);
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('lead-value-monitor failed:', err.message || err);
  process.exit(1);
});
