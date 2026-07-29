#!/usr/bin/env node
'use strict';
/**
 * placement-ad-builder.js — parameterized placement-customized creative builder.
 *
 * Supports image and video creative types via mandatory `creative_type` param.
 * Generalized from clients/patron-gamma/projects/may-2026-offers/restructure-ss-video-ads.js.
 * patron-beta June bundle (48 static image ads) is the first consumer.
 *
 * Governing artifacts:
 *   _dev/reports/analysis/operator-decision__meta-ads-tools-promotion__20260610.md
 *   _dev/reports/analysis/convene-runs/20260610T145537Z-meta-ads-tools-promotion-review/synthesis.md
 *
 * Live-learned laws encoded:
 *   1772103: instagram_user_id required when IG positions present
 *   1885878: max ONE descriptions[] asset on PLACEMENT creatives
 *   3858504: never write standard_enhancements with advantage_plus_creative umbrella
 *   2061044: bare OPT_IN umbrella caused activation error — prefer OPT_OUT umbrella + enumerated member opt-ins
 *
 * Usage (module):
 *   const { buildAdPayload, buildBatchManifest, validateManifest } = require('./placement-ad-builder');
 *   const payload = buildAdPayload(adSpec, builderConfig);
 *   // Preview mode: buildAdPayload never makes network calls
 *
 * Usage (CLI):
 *   node placement-ad-builder.js --manifest path/to/manifest.json [--preview]
 *   node placement-ad-builder.js --manifest path/to/manifest.json --execute
 *   node placement-ad-builder.js --help
 *
 * Batch manifest schema: see MANIFEST_SCHEMA below.
 * Exit codes: 0=success, 1=error, 2=input/validation error
 */

// ---- Manifest schema (documented for callers) ----
/**
 * MANIFEST_SCHEMA — JSON schema for N-ad batch manifests.
 * {
 *   "account_id": "string",          // Meta ad account ID (without act_ prefix)
 *   "adset_id": "string",            // Target ad set ID
 *   "page_id": "string",             // Facebook Page ID
 *   "instagram_user_id": "string",   // Required when IG positions present (1772103)
 *   "link": "string",                // Destination URL
 *   "cta": "string",                 // e.g. "SHOP_NOW"
 *   "url_tags": "string",            // UTM param string
 *   "dof": object,                   // degrees_of_freedom_spec (optional; defaults to SAFE_DOF)
 *   "contextual_multi_ads": object,  // e.g. { "enroll_status": "OPT_IN" } (optional)
 *   "protected_ad_ids": ["string"],  // never-touch fence — activation tool reads this
 *   "ads": [                         // array of N ad specs
 *     {
 *       "name": "string",
 *       "creative_type": "image"|"video",
 *       "body": "string",
 *       "titles": ["string"],
 *       "descriptions": ["string"],  // max 1 for PLACEMENT (1885878 law)
 *       // For image creative_type:
 *       "images": [
 *         { "image_hash": "string", "label": "string" }  // label routes customization rule
 *       ],
 *       // For video creative_type:
 *       "videos": [
 *         { "video_id": "string", "thumbnail_hash": "string", "label": "string" }
 *       ],
 *       // asset_customization_rules (both types):
 *       "asset_customization_rules": [
 *         {
 *           "customization_spec": { ... },
 *           "image_label"?: { "name": "string" },   // for image
 *           "video_label"?: { "name": "string" },   // for video
 *           "body_label": { "name": "string" },
 *           "title_label": { "name": "string" },
 *           "link_url_label": { "name": "string" },
 *           "priority": number
 *         }
 *       ]
 *     }
 *   ]
 * }
 */

/**
 * SAFE_DOF — default DOF that avoids error 3858504 (never list standard_enhancements
 * with advantage_plus_creative umbrella) and error 2061044 (bare OPT_IN umbrella).
 * Uses OPT_OUT for umbrella advantage_plus_creative + enumerated member opt-ins.
 */
const SAFE_DOF = {
  creative_features_spec: {
    advantage_plus_creative: { enroll_status: 'OPT_OUT' },
    text_optimizations: { enroll_status: 'OPT_IN' },
    text_translation: { enroll_status: 'OPT_IN' },
    inline_comment: { enroll_status: 'OPT_IN' },
    site_extensions: { enroll_status: 'OPT_IN' },
    image_uncrop: { enroll_status: 'OPT_IN' },
    product_extensions: { enroll_status: 'OPT_OUT' }
  }
};

const SAFE_DOF_VIDEO = {
  creative_features_spec: {
    advantage_plus_creative: { enroll_status: 'OPT_OUT' },
    text_optimizations: { enroll_status: 'OPT_IN' },
    text_translation: { enroll_status: 'OPT_IN' },
    inline_comment: { enroll_status: 'OPT_IN' },
    site_extensions: { enroll_status: 'OPT_IN' },
    video_auto_crop: { enroll_status: 'OPT_IN' },
    video_filtering: { enroll_status: 'OPT_IN' },
    video_uncrop: { enroll_status: 'OPT_IN' },
    product_extensions: { enroll_status: 'OPT_OUT' }
  }
};

/**
 * validateAdSpec — validate one ad spec from a manifest.
 * Returns array of validation errors (empty = valid).
 */
function validateAdSpec(adSpec, manifestBase) {
  const errs = [];
  if (!adSpec.name) errs.push('ad.name is required');
  if (!adSpec.creative_type) errs.push('ad.creative_type is required ("image" or "video")');
  if (adSpec.creative_type && !['image', 'video'].includes(adSpec.creative_type)) {
    errs.push(`ad.creative_type must be "image" or "video", got: ${adSpec.creative_type}`);
  }
  if (!adSpec.body) errs.push('ad.body (primary text) is required');
  if (!adSpec.titles || adSpec.titles.length === 0) errs.push('ad.titles must be a non-empty array');

  // 1885878: max ONE descriptions[] on PLACEMENT creatives
  if (adSpec.descriptions && adSpec.descriptions.length > 1) {
    errs.push(`ad "${adSpec.name}": PLACEMENT law 1885878 — max ONE descriptions[] asset (got ${adSpec.descriptions.length})`);
  }

  if (adSpec.creative_type === 'image') {
    if (!adSpec.images || adSpec.images.length === 0) errs.push(`ad "${adSpec.name}": creative_type=image requires ad.images array`);
  }
  if (adSpec.creative_type === 'video') {
    if (!adSpec.videos || adSpec.videos.length === 0) errs.push(`ad "${adSpec.name}": creative_type=video requires ad.videos array`);
  }
  if (!adSpec.asset_customization_rules || adSpec.asset_customization_rules.length === 0) {
    errs.push(`ad "${adSpec.name}": asset_customization_rules are required for PLACEMENT creatives`);
  }

  // 1772103: instagram_user_id required if any rule has instagram_positions
  const hasIgPositions = (adSpec.asset_customization_rules || []).some(
    (r) => r.customization_spec && Array.isArray(r.customization_spec.instagram_positions) && r.customization_spec.instagram_positions.length > 0
  );
  if (hasIgPositions && !manifestBase.instagram_user_id) {
    errs.push(`ad "${adSpec.name}": instagram_positions present but manifest.instagram_user_id is missing (Meta error 1772103)`);
  }

  return errs;
}

/**
 * validateManifest — validate the full batch manifest.
 * @param {object} manifest
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateManifest(manifest) {
  const errors = [];
  if (!manifest.account_id) errors.push('manifest.account_id is required');
  if (!manifest.adset_id) errors.push('manifest.adset_id is required');
  if (!manifest.page_id) errors.push('manifest.page_id is required');
  if (!manifest.link) errors.push('manifest.link is required');
  if (!manifest.cta) errors.push('manifest.cta is required');
  if (!Array.isArray(manifest.ads) || manifest.ads.length === 0) errors.push('manifest.ads must be a non-empty array');

  for (const ad of (manifest.ads || [])) {
    const adErrs = validateAdSpec(ad, manifest);
    errors.push(...adErrs);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * buildAdPayload — build the Meta adcreatives API payload for one ad spec.
 * This function is PURE — no network calls. Used for preview and as the payload
 * source for live creation.
 *
 * @param {object} adSpec - one ad spec from the manifest
 * @param {object} manifest - the full manifest (for shared config)
 * @returns {object} creative payload ready for POST act_XXX/adcreatives
 */
function buildAdPayload(adSpec, manifest) {
  const type = adSpec.creative_type;
  if (!type || !['image', 'video'].includes(type)) {
    throw new Error(`creative_type must be "image" or "video", got: ${type}`);
  }

  const dof = adSpec.dof || manifest.dof || (type === 'video' ? SAFE_DOF_VIDEO : SAFE_DOF);
  const cma = adSpec.contextual_multi_ads || manifest.contextual_multi_ads || undefined;
  const both = [{ name: 'asset_feed' }, { name: 'asset_other' }];

  // Build asset_feed_spec based on creative_type
  let mediaAssets;
  if (type === 'image') {
    // Image: asset_feed_spec.images + image_label customization rules
    // No video liveness loops (images don't need video status polling)
    mediaAssets = {
      images: (adSpec.images || []).map((img) => ({
        hash: img.image_hash,
        adlabels: img.label ? [{ name: img.label }] : both
      }))
    };
  } else {
    // Video: current patron-gamma placement behavior
    mediaAssets = {
      videos: (adSpec.videos || []).map((vid) => ({
        video_id: vid.video_id,
        thumbnail_hash: vid.thumbnail_hash,
        adlabels: vid.label ? [{ name: vid.label }] : both
      }))
    };
  }

  const asset_feed_spec = {
    ...mediaAssets,
    bodies: [{ text: adSpec.body, adlabels: both }],
    titles: (adSpec.titles || []).map((text) => ({ text, adlabels: both })),
    // 1885878: descriptions are NOT label-routed (global to both rules); max 1
    descriptions: (adSpec.descriptions || []).map((text) => ({ text })),
    link_urls: [{ website_url: manifest.link, adlabels: both }],
    call_to_action_types: [manifest.cta],
    ad_formats: ['AUTOMATIC_FORMAT'],
    optimization_type: 'PLACEMENT',
    asset_customization_rules: adSpec.asset_customization_rules
  };

  const objectStorySpec = compactObject({
    page_id: manifest.page_id,
    // 1772103: include instagram_user_id when IG positions are present
    instagram_user_id: manifest.instagram_user_id || undefined
  });

  const payload = compactObject({
    name: `${adSpec.name}|PC`,
    object_story_spec: objectStorySpec,
    asset_feed_spec,
    url_tags: manifest.url_tags || undefined,
    degrees_of_freedom_spec: dof,
    contextual_multi_ads: cma
  });

  return payload;
}

/**
 * buildBatchManifest — validate and return previews for all ads in a manifest.
 * Zero network, zero side effects.
 *
 * @param {object} manifest
 * @returns {{ validation: object, previews: object[] }}
 */
function buildBatchManifest(manifest) {
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    return { validation, previews: [] };
  }

  const previews = (manifest.ads || []).map((adSpec) => {
    try {
      const payload = buildAdPayload(adSpec, manifest);
      return { name: adSpec.name, creative_type: adSpec.creative_type, payload };
    } catch (e) {
      return { name: adSpec.name, creative_type: adSpec.creative_type, error: e.message };
    }
  });

  return { validation, previews };
}

/**
 * executeManifest — create all ads in a manifest against the live API.
 * Requires client built with dryRun=false and live=true.
 * Creates PAUSED ads only; activation is a separate gate (activate-ads.js).
 *
 * @param {object} manifest
 * @param {object} client - createMetaAdsClient instance
 * @param {string} token - raw access token for direct graphPost (bypasses client for creative creation)
 * @param {object} [opts]
 * @param {boolean} [opts.stopOnError] - stop on first failure (default true)
 * @returns {Promise<object[]>} results per ad
 */
async function executeManifest(manifest, client, token, opts = {}) {
  const { stopOnError = true } = opts;
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw Object.assign(new Error('Manifest validation failed'), { validation });
  }

  const { buildUrl, requestJson } = require('./../../shared/http');
  const API = `https://graph.facebook.com/${manifest.api_version || 'v21.0'}/`;

  async function graphPost(pathname, body) {
    const url = buildUrl(API, pathname);
    const resp = await requestJson({
      method: 'POST',
      url,
      headers: { Authorization: `Bearer ${token}` },
      body,
      timeoutMs: 60000
    });
    return resp.data;
  }

  const results = [];
  for (const adSpec of manifest.ads) {
    const r = { name: adSpec.name, creative_type: adSpec.creative_type };
    try {
      const payload = buildAdPayload(adSpec, manifest);
      const creative = await graphPost(`act_${manifest.account_id}/adcreatives`, payload);
      r.creative_id = creative.id;
      const ad = await client.createAd({
        accountId: manifest.account_id,
        adSetId: manifest.adset_id,
        name: adSpec.name,
        creativeId: creative.id,
        status: 'PAUSED',
        live: true
      });
      r.ad_id = ad.id;
      console.log(`  created: ${adSpec.name} -> ad ${ad.id} (creative ${creative.id})`);
    } catch (e) {
      r.error = e.message;
      if (e.response) r.api_error = e.response.data;
      console.error(`  FAILED: ${adSpec.name}: ${e.message}`);
      if (stopOnError) {
        results.push(r);
        break;
      }
    }
    results.push(r);
  }

  return results;
}

function compactObject(input) {
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

// ---- CLI wrapper ----
if (require.main === module) {
  const path = require('path');
  const fs = require('fs');
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write([
      'placement-ad-builder.js — placement-customized ad builder (image + video)',
      '',
      'Usage:',
      '  node placement-ad-builder.js --manifest path/to/manifest.json          # preview (no network)',
      '  node placement-ad-builder.js --manifest path/to/manifest.json --validate  # validate only',
      '  node placement-ad-builder.js --manifest path/to/manifest.json --execute   # LIVE (requires run-with-op.sh)',
      '',
      'Manifest schema: see MANIFEST_SCHEMA comment at top of file.',
      '',
      'Live-learned laws enforced:',
      '  1772103: instagram_user_id required when IG positions present',
      '  1885878: max ONE descriptions[] asset on PLACEMENT creatives',
      '  3858504: never standard_enhancements with advantage_plus_creative umbrella',
      '  2061044: umbrella OPT_OUT + enumerated member opt-ins (not bare OPT_IN)',
      '',
      'Exit codes: 0=success, 1=error, 2=validation error'
    ].join('\n') + '\n');
    process.exit(0);
  }

  const manifestIdx = args.indexOf('--manifest');
  const isExecute = args.includes('--execute');
  const isValidate = args.includes('--validate');

  if (manifestIdx === -1 || !args[manifestIdx + 1]) {
    process.stderr.write('Error: --manifest path/to/manifest.json is required\n');
    process.exit(2);
  }

  const fp = path.resolve(args[manifestIdx + 1]);
  if (!fs.existsSync(fp)) {
    process.stderr.write(`Error: manifest file not found: ${fp}\n`);
    process.exit(2);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    process.stderr.write(`Error: invalid JSON in manifest: ${e.message}\n`);
    process.exit(2);
  }

  async function run() {
    if (isValidate) {
      const { valid, errors } = validateManifest(manifest);
      process.stdout.write(JSON.stringify({ valid, errors }, null, 2) + '\n');
      if (!valid) process.exit(2);
      process.exit(0);
    }

    if (!isExecute) {
      // Preview mode — no network
      const { validation, previews } = buildBatchManifest(manifest);
      if (!validation.valid) {
        process.stderr.write('Manifest validation errors:\n');
        validation.errors.forEach((e) => process.stderr.write(`  ${e}\n`));
        process.exit(2);
      }
      process.stdout.write(`Preview: ${previews.length} ads in manifest\n`);
      process.stdout.write(JSON.stringify({ ads: previews.length, account: manifest.account_id, adset: manifest.adset_id, previews }, null, 2) + '\n');
      return;
    }

    // Execute mode
    const token = process.env.META_ACCESS_TOKEN;
    if (!token || process.env.META_ADS_DRY_RUN !== 'false') {
      process.stderr.write('Error: --execute requires run-with-op.sh (META_ACCESS_TOKEN + META_ADS_DRY_RUN=false)\n');
      process.exit(2);
    }
    const { createMetaAdsClient } = require('./client');
    const { loadMetaAdsConfig } = require('./config');
    const config = loadMetaAdsConfig();
    const client = createMetaAdsClient(config);
    console.log(`LIVE: creating ${manifest.ads.length} ads in adset ${manifest.adset_id}`);
    const results = await executeManifest(manifest, client, token);
    process.stdout.write('\n===RESULTS_JSON===\n');
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    const failed = results.filter((r) => r.error);
    if (failed.length) { process.stderr.write(`${failed.length} ads failed\n`); process.exit(1); }
  }

  run().catch((e) => {
    process.stderr.write(`Fatal: ${e.message}\n`);
    if (e.response) process.stderr.write(JSON.stringify(e.response.data || e.response, null, 2) + '\n');
    process.exit(1);
  });
}

module.exports = {
  buildAdPayload,
  buildBatchManifest,
  validateManifest,
  validateAdSpec,
  executeManifest,
  SAFE_DOF,
  SAFE_DOF_VIDEO
};
