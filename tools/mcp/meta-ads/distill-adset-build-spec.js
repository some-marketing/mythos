#!/usr/bin/env node
'use strict';
/**
 * distill-adset-build-spec.js — GET-only ad-set recon distiller.
 *
 * Reads in-set proof ads' asset_feed_spec / customization rules / DOF shape
 * from a recon JSON fixture (default) or live API (requires --live flag) and
 * emits a build spec: the canonical shape used by ads in this set, including
 * optimization_type, asset_customization_rules pattern, DOF spec, video count,
 * positions used, and CTA.
 *
 * Pattern extracted from clients/patron-gamma/projects/may-2026-offers/recon-used-adset.js
 *
 * Governing artifacts:
 *   _dev/reports/analysis/operator-decision__meta-ads-tools-promotion__20260610.md
 *   _dev/reports/analysis/convene-runs/20260610T145537Z-meta-ads-tools-promotion-review/synthesis.md
 *
 * Usage (module):
 *   const { distillBuildSpec } = require('./distill-adset-build-spec');
 *   // From fixture:
 *   const spec = distillBuildSpec({ reconJson: require('./recon.json'), adsetId });
 *   // From live (requires client):
 *   const spec = await distillBuildSpec({ client, adsetId, live: true });
 *
 * Usage (CLI):
 *   node distill-adset-build-spec.js --fixture path/to/recon.json [--adset-id 1234]
 *   node distill-adset-build-spec.js --live --adset-id 1234   # requires live config
 *   node distill-adset-build-spec.js --help
 *
 * Exit codes: 0=success, 1=error, 2=input error
 */

/**
 * Classify the predominant creative shape in a set of ads.
 * Returns the most-common optimization_type among ads that have an asset_feed_spec.
 */
function classifyOptimizationType(ads) {
  const counts = {};
  for (const ad of ads) {
    const afs = (ad.creative && ad.creative.asset_feed_spec) || {};
    const t = afs.optimization_type;
    if (t) counts[t] = (counts[t] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted.length ? sorted[0][0] : null;
}

/**
 * Extract the asset_customization_rules shape from a PLACEMENT ad, normalizing
 * to a canonical descriptor (number of rules, positions per rule, catch-all present).
 */
function describeCustomizationRules(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return null;
  return rules.map((r) => ({
    priority: r.priority,
    has_explicit_positions: !!(
      (r.customization_spec && r.customization_spec.facebook_positions) ||
      (r.customization_spec && r.customization_spec.instagram_positions)
    ),
    is_catch_all: !!(
      r.customization_spec &&
      !r.customization_spec.facebook_positions &&
      !r.customization_spec.instagram_positions
    ),
    video_label: r.video_label && r.video_label.name,
    body_label: r.body_label && r.body_label.name,
    title_label: r.title_label && r.title_label.name,
    link_url_label: r.link_url_label && r.link_url_label.name,
    image_label: r.image_label && r.image_label.name,
    facebook_positions: (r.customization_spec && r.customization_spec.facebook_positions) || null,
    instagram_positions: (r.customization_spec && r.customization_spec.instagram_positions) || null,
    threads_positions: (r.customization_spec && r.customization_spec.threads_positions) || null
  }));
}

/**
 * Derive a DOF shape summary from degrees_of_freedom_spec.
 */
function describeDof(dof) {
  if (!dof || !dof.creative_features_spec) return null;
  const cfs = dof.creative_features_spec;
  const summary = {};
  for (const [key, val] of Object.entries(cfs)) {
    summary[key] = val && val.enroll_status;
  }
  return summary;
}

/**
 * Distill a build spec from an array of proof ads in a set.
 * Proof ads are those with asset_feed_spec and optimization_type (filters out catalog/DPA ads).
 *
 * @param {object[]} ads - array of ad objects with .creative.asset_feed_spec
 * @param {object} [opts]
 * @param {string} [opts.adsetId] - adset ID for labeling
 * @param {string} [opts.adsetName] - adset name for labeling
 * @returns {object} build spec
 */
function distillFromAds(ads, opts = {}) {
  // Filter to proof ads with a meaningful asset_feed_spec
  const proofAds = ads.filter((ad) => {
    const afs = (ad.creative && ad.creative.asset_feed_spec) || {};
    return afs.optimization_type && afs.optimization_type !== 'FORMAT_AUTOMATION';
  });

  if (proofAds.length === 0) {
    return {
      adset_id: opts.adsetId,
      adset_name: opts.adsetName,
      proof_ads_found: 0,
      build_spec: null,
      note: 'No proof ads with PLACEMENT or DEGREES_OF_FREEDOM optimization found in set'
    };
  }

  const optimizationType = classifyOptimizationType(proofAds);

  // Sample the first PLACEMENT proof ad for structural analysis
  const placementAds = proofAds.filter((a) => (a.creative.asset_feed_spec.optimization_type) === 'PLACEMENT');
  const sampleAd = placementAds[0] || proofAds[0];
  const afs = sampleAd.creative.asset_feed_spec || {};
  const rules = describeCustomizationRules(afs.asset_customization_rules);
  const dof = describeDof(sampleAd.creative.degrees_of_freedom_spec);

  // Detect video vs image creative shape
  const hasVideos = Array.isArray(afs.videos) && afs.videos.length > 0;
  const hasImages = Array.isArray(afs.images) && afs.images.length > 0;
  const creativeType = hasVideos ? 'video' : (hasImages ? 'image' : 'unknown');

  // Positions referenced across all rules
  const allPositions = { facebook: new Set(), instagram: new Set(), threads: new Set() };
  if (rules) {
    for (const r of rules) {
      (r.facebook_positions || []).forEach((p) => allPositions.facebook.add(p));
      (r.instagram_positions || []).forEach((p) => allPositions.instagram.add(p));
      (r.threads_positions || []).forEach((p) => allPositions.threads.add(p));
    }
  }

  // Text asset count profile across all proof ads
  const titleCounts = proofAds.map((a) => ((a.creative.asset_feed_spec || {}).titles || []).length);
  const bodyCounts = proofAds.map((a) => ((a.creative.asset_feed_spec || {}).bodies || []).length);
  const descCounts = proofAds.map((a) => ((a.creative.asset_feed_spec || {}).descriptions || []).length);

  return {
    adset_id: opts.adsetId,
    adset_name: opts.adsetName,
    proof_ads_found: proofAds.length,
    predominant_optimization_type: optimizationType,
    creative_type: creativeType,
    build_spec: {
      optimization_type: optimizationType,
      creative_type: creativeType,
      customization_rules: rules,
      rule_count: rules ? rules.length : 0,
      has_catch_all_rule: rules ? rules.some((r) => r.is_catch_all) : false,
      positions: {
        facebook: Array.from(allPositions.facebook),
        instagram: Array.from(allPositions.instagram),
        threads: Array.from(allPositions.threads)
      },
      instagram_user_id_required: allPositions.instagram.size > 0,
      cta_types: Array.from(new Set((afs.call_to_action_types || []))),
      ad_formats: afs.ad_formats || [],
      dof_shape: dof,
      contextual_multi_ads_present: !!(sampleAd.creative.contextual_multi_ads),
      url_tags_pattern: sampleAd.creative.url_tags || null,
      text_asset_profile: {
        titles: { min: Math.min(...titleCounts), max: Math.max(...titleCounts) },
        bodies: { min: Math.min(...bodyCounts), max: Math.max(...bodyCounts) },
        descriptions: { min: Math.min(...descCounts), max: Math.max(...descCounts) }
      },
      // PLACEMENT law: max ONE descriptions[] asset (Meta error 1885878)
      placement_description_max: optimizationType === 'PLACEMENT' ? 1 : null,
      sample_ad_id: sampleAd.id,
      sample_creative_id: sampleAd.creative && sampleAd.creative.id
    }
  };
}

/**
 * distillBuildSpec — primary entry point.
 *
 * Fixture mode (no network): pass reconJson + adsetId.
 * Live mode: pass client + adsetId + live:true (requires META_ADS_DRY_RUN=false).
 */
async function distillBuildSpec({ reconJson, client, adsetId, adsetName, live = false } = {}) {
  if (live) {
    if (!client) throw new Error('distillBuildSpec live mode requires a client instance');
    if (!adsetId) throw new Error('distillBuildSpec requires adsetId');

    const CREATIVE_FIELDS = [
      'id', 'name', 'object_type', 'object_story_spec', 'asset_feed_spec', 'url_tags',
      'degrees_of_freedom_spec', 'contextual_multi_ads', 'call_to_action_type'
    ].join(',');
    const AD_FIELDS = `id,name,status,effective_status,creative{${CREATIVE_FIELDS}}`;

    const adsResp = await client.getAd({ adId: adsetId, fields: `ads.limit(100){${AD_FIELDS}}` });
    const ads = (adsResp.ads && adsResp.ads.data) || [];

    // Also try to get adset name
    let resolvedName = adsetName;
    if (!resolvedName) {
      try {
        const adsetObj = await client.getAd({ adId: adsetId, fields: 'id,name' });
        resolvedName = adsetObj.name;
      } catch (_) { /* non-fatal */ }
    }

    return distillFromAds(ads, { adsetId, adsetName: resolvedName });
  }

  // Fixture mode
  if (!reconJson) throw new Error('distillBuildSpec fixture mode requires reconJson');

  const adsets = reconJson.adsets || [];
  if (adsetId) {
    const target = adsets.find((a) => a.id === String(adsetId));
    if (!target) {
      throw new Error(`adsetId ${adsetId} not found in reconJson (available: ${adsets.map((a) => a.id).join(', ')})`);
    }
    return distillFromAds(target.ads || [], { adsetId: target.id, adsetName: target.name });
  }

  // No adsetId: distill all adsets and return array
  return adsets.map((adset) =>
    distillFromAds(adset.ads || [], { adsetId: adset.id, adsetName: adset.name })
  );
}

// ---- CLI wrapper ----
if (require.main === module) {
  const path = require('path');
  const fs = require('fs');
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write([
      'distill-adset-build-spec.js — ad-set recon distiller',
      '',
      'Usage (fixture mode — no network):',
      '  node distill-adset-build-spec.js --fixture path/to/recon.json [--adset-id ID]',
      '',
      'Usage (live mode — requires META_ADS_DRY_RUN=false + META_ACCESS_TOKEN):',
      '  node distill-adset-build-spec.js --live --adset-id ID',
      '',
      'Output: JSON build spec to stdout.',
      'Exit codes: 0=success, 1=error, 2=input error'
    ].join('\n') + '\n');
    process.exit(0);
  }

  const isLive = args.includes('--live');
  const fixtureIdx = args.indexOf('--fixture');
  const adsetIdIdx = args.indexOf('--adset-id');
  const targetAdsetId = adsetIdIdx !== -1 ? args[adsetIdIdx + 1] : undefined;

  async function run() {
    let result;
    if (isLive) {
      if (!targetAdsetId) {
        process.stderr.write('Error: --adset-id is required in live mode\n');
        process.exit(2);
      }
      const { createMetaAdsClient } = require('./client');
      const { loadMetaAdsConfig } = require('./config');
      const config = loadMetaAdsConfig();
      if (config.dryRun !== false) {
        process.stderr.write('Error: live mode requires META_ADS_DRY_RUN=false\n');
        process.exit(2);
      }
      const client = createMetaAdsClient(config);
      result = await distillBuildSpec({ client, adsetId: targetAdsetId, live: true });
    } else {
      if (fixtureIdx === -1 || !args[fixtureIdx + 1]) {
        process.stderr.write('Error: pass --fixture path/to/recon.json (or --live for network mode)\n');
        process.exit(2);
      }
      const fp = path.resolve(args[fixtureIdx + 1]);
      if (!fs.existsSync(fp)) {
        process.stderr.write(`Error: fixture file not found: ${fp}\n`);
        process.exit(2);
      }
      const reconJson = JSON.parse(fs.readFileSync(fp, 'utf8'));
      result = await distillBuildSpec({ reconJson, adsetId: targetAdsetId });
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }

  run().catch((e) => {
    process.stderr.write(`Fatal: ${e.message}\n`);
    process.exit(1);
  });
}

module.exports = { distillBuildSpec, distillFromAds };
