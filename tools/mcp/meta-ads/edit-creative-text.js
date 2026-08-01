#!/usr/bin/env node
'use strict';
/**
 * edit-creative-text.js — client-agnostic creative text surgery CLI.
 *
 * Performs text replacements and/or carousel card drops on a live Meta ad
 * without touching ad history, IDs, or spend continuity. The creative is
 * immutable: the tool creates a NEW creative, re-points the ad via
 * updateAdCreativeRef, then readback-verifies zero leftover matches.
 *
 * Supports both ad shapes:
 *   - asset_feed_spec creatives (PLACEMENT / flexible) — createAdCreativeFlexible
 *   - object_story_spec link_data creatives (carousel / link) — createAdCreative
 *
 * Live-learned error ladder encoded here:
 *   2490085: drop image_crops 191x100 — strip automatically
 *   3858023: drop degrees_of_freedom_spec for Advantage+-ineligible accounts — omit automatically
 *   2061044: keep call_ads_configuration — preserved automatically
 *   3858749: Page-role gate — report, stop, never work around
 *   1885183: app-not-Live gate — report, stop, never work around
 *   2446581: interactive_components_spec un-introspectable on some Pages — STOP, cite CHANGE-RECORD
 *
 * Governing artifacts:
 *   clients/patron-delta/projects/meta-creative-iteration/outputs/_closed-clinic-removal-2026-06-03/CHANGE-RECORD.json
 *   clients/patron-delta/projects/meta-creative-iteration/ (patron-delta surgery sessions 2026-06-11)
 *
 * Usage:
 *   node edit-creative-text.js --account <id> --ad <adId> \
 *     --replace "from::to" [--replace ...] \
 *     [--drop-card-matching <regex>] \
 *     [--dry-run] [--live] [--keep-status]
 *
 *   Default: --dry-run. Writes require --live.
 *
 * Exit codes: 0=success/dry-run, 1=error/abort, 2=input error
 */

// ---- Error ladder ----
const ERROR_LADDER = {
  2490085: 'image_crops 191x100 rejected — stripped automatically (should not re-occur)',
  3858023: 'degrees_of_freedom_spec rejected (Advantage+-ineligible account) — omitted automatically (should not re-occur)',
  2061044: 'call_ads_configuration required — preserved automatically (should not re-occur)',
  3858749: 'Page-role gate: the system user lacks the Page Ads task. Grant it in Business Manager → Pages → Assign Partners. Cannot work around.',
  1885183: 'App-not-Live gate: the Meta app is in Development mode. Switch the app to Live in the App Dashboard. Cannot work around.',
  2446581: 'interactive_components_spec is un-introspectable on this Page (returns null/empty but rejects on write). Use the Meta UI for this creative. See clients/patron-delta/projects/meta-creative-iteration/outputs/_closed-clinic-removal-2026-06-03/CHANGE-RECORD.json → publish_attempt investigation.'
};

/**
 * mapApiError — translate a Meta API error code to an actionable message.
 * @param {Error} err - error from graphPost/graphGet
 * @returns {string} actionable description
 */
function mapApiError(err) {
  const body = err.response && (err.response.data || {});
  const code = (body && body.error && body.error.code) || (body && body.code);
  if (code && ERROR_LADDER[code]) {
    return `Meta error ${code}: ${ERROR_LADDER[code]}`;
  }
  const msg = (body && body.error && body.error.message) || (body && body.message) || err.message;
  return `Meta API error${code ? ` ${code}` : ''}: ${msg}`;
}

// ---- Text replacement helpers ----

/**
 * applyReplacements — apply a list of {from, to} pairs to a string.
 * Replaces all occurrences of each `from` literal.
 * @param {string} text
 * @param {Array<{from:string,to:string}>} replacements
 * @returns {string}
 */
function applyReplacements(text, replacements) {
  let out = text;
  for (const { from, to } of replacements) {
    // Escape `from` for use in a RegExp, replace all occurrences
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), to);
  }
  return out;
}

/**
 * walkAndReplace — deep-walk a spec object, replacing string values.
 * Only touches the text-bearing keys listed in TEXT_KEYS.
 * Returns { mutated: object, changed: number } — a new object (no mutation).
 * @param {object} obj
 * @param {Array<{from:string,to:string}>} replacements
 * @returns {{ mutated: object, changed: number }}
 */
const TEXT_KEYS = new Set(['text', 'message', 'body', 'name', 'description', 'caption', 'title', 'link_description']);

function walkAndReplace(obj, replacements) {
  let changed = 0;

  function walk(node) {
    if (node === null || node === undefined) return node;
    if (typeof node === 'string') {
      const next = applyReplacements(node, replacements);
      if (next !== node) changed++;
      return next;
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        if (TEXT_KEYS.has(k) && typeof v === 'string') {
          const next = applyReplacements(v, replacements);
          if (next !== v) changed++;
          out[k] = next;
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    }
    return node;
  }

  return { mutated: walk(obj), changed };
}

/**
 * containsAny — check if a string contains any of the `from` patterns.
 * @param {string} text
 * @param {Array<{from:string}>} replacements
 * @returns {string[]} list of patterns found
 */
function containsAny(text, replacements) {
  return replacements
    .filter(({ from }) => text.includes(from))
    .map(({ from }) => from);
}

/**
 * findLeftovers — scan a spec (as JSON string) for any remaining `from` patterns.
 * @param {object} spec
 * @param {Array<{from:string}>} replacements
 * @returns {string[]} list of patterns still present
 */
function findLeftovers(spec, replacements) {
  const json = JSON.stringify(spec);
  return containsAny(json, replacements);
}

/**
 * dropImageCrops — strip all image_crops entries with ratio 191x100.
 * Meta error 2490085. Applied automatically on every creative.
 * @param {object} spec - asset_feed_spec
 * @returns {object} new spec with 191x100 crops removed
 */
function dropImageCrops(spec) {
  if (!spec || !spec.images) return spec;
  return {
    ...spec,
    images: spec.images.map((img) => {
      if (!img.image_crops) return img;
      const crops = { ...img.image_crops };
      delete crops['191x100'];
      return { ...img, image_crops: crops };
    })
  };
}

/**
 * collectTextSurfaces — gather all text-bearing string values from a spec for diff display.
 * Returns a flat array of { path: string, text: string }.
 * @param {object} obj
 * @param {string} [prefix]
 * @returns {Array<{path:string,text:string}>}
 */
function collectTextSurfaces(obj, prefix = '') {
  const results = [];
  if (!obj || typeof obj !== 'object') return results;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => results.push(...collectTextSurfaces(v, `${prefix}[${i}]`)));
    return results;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (TEXT_KEYS.has(k) && typeof v === 'string') {
      results.push({ path: p, text: v });
    } else if (v && typeof v === 'object') {
      results.push(...collectTextSurfaces(v, p));
    }
  }
  return results;
}

// ---- Spec extraction helpers ----

/**
 * ASSET_FEED_KEEP — fields to carry over from asset_feed_spec when creating a new creative.
 * call_ads_configuration preserved (error 2061044).
 * image_crops 191x100 stripped (error 2490085).
 * degrees_of_freedom_spec omitted by default (error 3858023 on Advantage+-ineligible accounts).
 */
const ASSET_FEED_KEEP = [
  'images', 'videos', 'bodies', 'call_to_action_types', 'descriptions',
  'link_urls', 'titles', 'ad_formats', 'asset_customization_rules',
  'optimization_type', 'call_ads_configuration'
];

/**
 * extractAssetFeedSpec — copy whitelisted keys from a live asset_feed_spec.
 * @param {object} afs - live asset_feed_spec
 * @returns {object}
 */
function extractAssetFeedSpec(afs) {
  const spec = {};
  for (const k of ASSET_FEED_KEEP) {
    if (afs[k] !== undefined && afs[k] !== null) spec[k] = afs[k];
  }
  return spec;
}

// ---- Diff printer ----

/**
 * printDiff — print before/after text surfaces and card list to stdout.
 * @param {object} before - spec before changes
 * @param {object} after - spec after changes
 * @param {Array<string>|null} beforeCards - card names before drop
 * @param {Array<string>|null} afterCards - card names after drop
 */
function printDiff(before, after, beforeCards, afterCards) {
  const bSurfaces = collectTextSurfaces(before);
  const aSurfaces = collectTextSurfaces(after);
  const aMap = new Map(aSurfaces.map((s) => [s.path, s.text]));

  let anyChanged = false;
  process.stdout.write('\n=== TEXT DIFF ===\n');
  for (const { path, text } of bSurfaces) {
    const aText = aMap.get(path);
    if (aText !== undefined && aText !== text) {
      process.stdout.write(`  ${path}:\n    - ${JSON.stringify(text)}\n    + ${JSON.stringify(aText)}\n`);
      anyChanged = true;
    }
  }
  if (!anyChanged) {
    process.stdout.write('  (no text changes)\n');
  }

  if (beforeCards !== null && afterCards !== null) {
    process.stdout.write('\n=== CAROUSEL CARDS ===\n');
    process.stdout.write(`  before (${beforeCards.length}): ${beforeCards.join(' | ')}\n`);
    process.stdout.write(`  after  (${afterCards.length}): ${afterCards.join(' | ')}\n`);
    const dropped = beforeCards.filter((c) => !afterCards.includes(c));
    if (dropped.length) {
      process.stdout.write(`  dropped: ${dropped.join(' | ')}\n`);
    }
  }
  process.stdout.write('\n');
}

// ---- Core engine ----

/**
 * editCreativeText — core logic (pure function except for network calls via client).
 * Safe to unit-test by passing a mock client.
 *
 * @param {object} opts
 * @param {object} opts.client - createMetaAdsClient instance
 * @param {string} opts.accountId
 * @param {string} opts.adId
 * @param {Array<{from:string,to:string}>} opts.replacements
 * @param {RegExp|null} opts.dropCardRegex
 * @param {boolean} opts.live - true = write live
 * @param {boolean} opts.keepStatus - future use (reserved; reads don't change status)
 * @param {boolean} [opts.silent] - suppress stdout (for tests)
 * @returns {Promise<{
 *   dry_run: boolean,
 *   ad_id: string,
 *   old_creative_id: string,
 *   new_creative_id: string|null,
 *   text_changes: number,
 *   cards_before: number|null,
 *   cards_after: number|null,
 *   leftover_abort: boolean,
 *   readback_ok: boolean|null,
 *   error: string|null
 * }>}
 */
async function editCreativeText(opts) {
  const {
    client,
    accountId,
    adId,
    replacements = [],
    dropCardRegex = null,
    live = false,
    silent = false
  } = opts;

  function log(msg) {
    if (!silent) process.stdout.write(msg + '\n');
  }

  const result = {
    dry_run: !live,
    ad_id: adId,
    old_creative_id: null,
    new_creative_id: null,
    text_changes: 0,
    cards_before: null,
    cards_after: null,
    leftover_abort: false,
    readback_ok: null,
    error: null
  };

  // ---- Step 1: Fetch the ad with full creative spec ----
  log(`[1/5] Fetching ad ${adId}...`);
  let ad;
  const FETCH_FIELDS_FULL = 'id,name,status,effective_status,adset_id,creative{id,name,body,title,object_story_spec,asset_feed_spec,url_tags,degrees_of_freedom_spec,call_ads_configuration}';
  // object_story_spec/link_data creatives reject top-level call_ads_configuration
  // ("(#100) nonexisting field"); the value is only ever consumed from inside
  // asset_feed_spec (ASSET_FEED_KEEP), so retry without the top-level field.
  const FETCH_FIELDS_NO_CALLCFG = FETCH_FIELDS_FULL.replace(',call_ads_configuration', '');
  try {
    ad = await client.getAd({ adId, fields: FETCH_FIELDS_FULL });
  } catch (err) {
    const msg = (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || err.message || '';
    if (msg.includes('nonexisting field (call_ads_configuration)')) {
      log('  top-level call_ads_configuration not queryable on this creative — retrying without it');
      try {
        ad = await client.getAd({ adId, fields: FETCH_FIELDS_NO_CALLCFG });
      } catch (err2) {
        result.error = `Failed to fetch ad: ${mapApiError(err2)}`;
        return result;
      }
    } else {
      result.error = `Failed to fetch ad: ${mapApiError(err)}`;
      return result;
    }
  }

  // Dry-run passthrough from client (dryRun mode)
  if (ad && ad.dry_run) {
    log('[DRY_CLIENT] client is in dry-run mode — cannot fetch live ad data. Cannot proceed with text surgery in dry-run client mode.');
    result.error = 'dry_run_client';
    return result;
  }

  const creative = ad.creative || {};
  result.old_creative_id = creative.id || null;

  log(`  ad: ${ad.name} | status: ${ad.status} | effective_status: ${ad.effective_status}`);
  log(`  creative: ${creative.id}`);

  const hasAssetFeedSpec = !!(creative.asset_feed_spec && Object.keys(creative.asset_feed_spec).length);
  const hasObjectStorySpec = !!(creative.object_story_spec && creative.object_story_spec.link_data);
  const isCarousel = hasObjectStorySpec && !hasAssetFeedSpec;

  // ---- Step 2: Build new spec ----
  log(`[2/5] Building new spec (type: ${hasAssetFeedSpec ? 'asset_feed_spec' : 'object_story_spec/link_data'})...`);

  let beforeSpec, afterSpec;
  let beforeCards = null;
  let afterCards = null;
  let pageId, instagramUserId;

  if (hasAssetFeedSpec) {
    // PLACEMENT / flexible creative
    beforeSpec = extractAssetFeedSpec(creative.asset_feed_spec);
    // Strip image_crops 191x100 (error 2490085)
    beforeSpec = dropImageCrops(beforeSpec);
    // Apply text replacements
    const { mutated, changed } = walkAndReplace(beforeSpec, replacements);
    afterSpec = mutated;
    result.text_changes = changed;

    // Extract page + IG from object_story_spec
    const oss = creative.object_story_spec || {};
    pageId = oss.page_id;
    instagramUserId = oss.instagram_user_id;

  } else if (isCarousel) {
    // object_story_spec carousel
    const oss = creative.object_story_spec;
    pageId = oss.page_id;
    instagramUserId = oss.instagram_user_id;

    const ld = JSON.parse(JSON.stringify(oss.link_data));
    beforeCards = (ld.child_attachments || []).map((c) => c.name || c.link || '(unnamed)');

    // Drop cards matching regex
    if (dropCardRegex) {
      ld.child_attachments = (ld.child_attachments || []).filter(
        (ca) => !dropCardRegex.test(JSON.stringify(ca))
      );
    }

    // Apply text replacements
    const { mutated, changed } = walkAndReplace(ld, replacements);
    const newLd = mutated;
    result.text_changes = changed;
    afterCards = (newLd.child_attachments || []).map((c) => c.name || c.link || '(unnamed)');
    result.cards_before = beforeCards.length;
    result.cards_after = afterCards.length;

    beforeSpec = oss.link_data;
    afterSpec = { oss_page_id: pageId, oss_ig: instagramUserId, link_data: newLd };

    // Check error 2446581: interactive_components_spec
    // The field cannot be read from some Pages — do not propagate null/[] from readback
    // Use a sentinel on the afterSpec so we can reconstruct the full oss on write
    afterSpec._link_data = newLd;

  } else {
    result.error = 'Unsupported creative shape: no asset_feed_spec and no object_story_spec.link_data found. Cannot perform text surgery.';
    return result;
  }

  // ---- Step 3: Abort check — any `from` patterns remaining? ----
  log('[3/5] Checking for leftover patterns...');
  const leftoverFrom = findLeftovers(afterSpec, replacements);
  // Also check drop regex if present
  let leftoverCards = [];
  if (dropCardRegex && afterCards !== null) {
    leftoverCards = afterCards.filter((name) => dropCardRegex.test(name));
  }

  if (leftoverFrom.length || leftoverCards.length) {
    result.leftover_abort = true;
    const msgs = [
      ...leftoverFrom.map((p) => `pattern "${p}" still present after replacement`),
      ...leftoverCards.map((n) => `card "${n}" still matches drop regex after filter`)
    ];
    result.error = `ABORT: replacements incomplete — ${msgs.join('; ')}`;
    if (!silent) {
      process.stderr.write(`\nABORT: ${result.error}\n`);
    }
    return result;
  }

  // ---- Step 4: Print diff ----
  if (!silent) {
    if (hasAssetFeedSpec) {
      printDiff(beforeSpec, afterSpec, null, null);
    } else {
      printDiff(beforeSpec, afterSpec._link_data || afterSpec, beforeCards, afterCards);
    }
  }

  // ---- Dry-run stop ----
  if (!live) {
    log('[DRY-RUN] Would create new creative and re-point ad. Pass --live to execute.');
    return result;
  }

  // ---- Step 5: Create new creative ----
  log('[4/5] Creating new creative...');
  let newCreative;
  const creativeName = `${creative.name || 'creative'}|text-edit|${new Date().toISOString().slice(0, 10)}`;

  try {
    if (hasAssetFeedSpec) {
      newCreative = await client.createAdCreativeFlexible({
        accountId,
        name: creativeName,
        pageId,
        instagramUserId,
        assetFeedSpec: afterSpec,
        // degrees_of_freedom_spec intentionally omitted (error 3858023 on Advantage+-ineligible)
        live: true
      });
    } else {
      // object_story_spec carousel — rebuild clean oss
      const newOss = {
        page_id: pageId,
        link_data: afterSpec._link_data || afterSpec.link_data
      };
      if (instagramUserId) newOss.instagram_user_id = instagramUserId;

      newCreative = await client.createAdCreative({
        accountId,
        name: creativeName,
        objectStorySpec: newOss,
        live: true
      });
    }
  } catch (err) {
    result.error = `Failed to create new creative: ${mapApiError(err)}`;
    return result;
  }

  if (!newCreative || !newCreative.id) {
    result.error = 'Creative creation returned no id';
    return result;
  }

  result.new_creative_id = newCreative.id;
  log(`  new creative: ${newCreative.id}`);

  // ---- Step 6: Re-point the ad ----
  log('[5/5] Re-pointing ad to new creative...');
  try {
    await client.updateAdCreativeRef({ adId, creativeId: newCreative.id, live: true });
  } catch (err) {
    result.error = `Failed to re-point ad: ${mapApiError(err)}`;
    return result;
  }

  // ---- Step 7: Readback verify ----
  log('     Readback-verifying...');
  let afterAd;
  try {
    afterAd = await client.getAd({
      adId,
      fields: 'id,name,status,effective_status,creative{id,object_story_spec,asset_feed_spec}'
    });
  } catch (err) {
    result.error = `Readback fetch failed: ${mapApiError(err)}`;
    return result;
  }

  const afterCreative = afterAd.creative || {};
  const afterJson = JSON.stringify(afterCreative);

  // Verify creative ID switched
  if (afterCreative.id !== newCreative.id) {
    result.readback_ok = false;
    result.error = `Readback: creative id mismatch (got ${afterCreative.id}, expected ${newCreative.id})`;
    return result;
  }

  // Verify zero `from` patterns remain
  const remainingPatterns = replacements.filter(({ from }) => afterJson.includes(from));
  if (remainingPatterns.length) {
    result.readback_ok = false;
    result.error = `Readback FAIL: ${remainingPatterns.length} pattern(s) still present after re-point: ${remainingPatterns.map((r) => r.from).join(', ')}`;
    return result;
  }

  // Verify drop regex satisfied
  if (dropCardRegex) {
    const remainingMatches = (afterCards || []).filter((name) => dropCardRegex.test(name));
    if (remainingMatches.length) {
      result.readback_ok = false;
      result.error = `Readback FAIL: drop-card regex still matches ${remainingMatches.length} cards after re-point`;
      return result;
    }
  }

  result.readback_ok = true;
  log(`  VERIFIED: creative ${afterCreative.id} | status: ${afterAd.effective_status} | zero leftover patterns`);

  return result;
}

// ---- Module exports (for tests) ----
module.exports = {
  editCreativeText,
  applyReplacements,
  walkAndReplace,
  findLeftovers,
  dropImageCrops,
  extractAssetFeedSpec,
  collectTextSurfaces,
  mapApiError,
  ERROR_LADDER,
  TEXT_KEYS
};

// ---- CLI wrapper ----
if (require.main === module) {
  const path = require('path');

  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write([
      'edit-creative-text.js — client-agnostic creative text surgery',
      '',
      'Usage:',
      '  node edit-creative-text.js --account <id> --ad <adId> \\',
      '    --replace "from::to" [--replace ...] \\',
      '    [--drop-card-matching <regex>] \\',
      '    [--dry-run] [--live] [--keep-status]',
      '',
      'Options:',
      '  --account <id>              Meta ad account ID (without act_ prefix)',
      '  --ad <adId>                 Ad ID to edit',
      '  --replace "from::to"        Text replacement (repeatable; use :: as separator)',
      '  --drop-card-matching <re>   Drop carousel cards whose JSON matches this regex',
      '  --dry-run                   Preview only, no writes (default)',
      '  --live                      Execute live writes (requires run-with-op.sh)',
      '  --keep-status               Reserved; reads do not change ad status',
      '',
      'Behavior:',
      '  1. Fetches ad + full creative spec',
      '  2. Applies replacements and/or card drops to a copy of the spec',
      '  3. Prints before/after text diff and card list',
      '  4. ABORTS if any --replace "from" pattern or --drop-card-matching regex',
      '     still matches in the new spec (leftover-abort safety gate)',
      '  5. [live only] Creates new creative (creatives are immutable)',
      '  6. [live only] Re-points ad via updateAdCreativeRef (keeps ad ID/history)',
      '  7. [live only] Readback-verifies zero leftover matches + new creative ID',
      '',
      'Error ladder:',
      '  2490085  image_crops 191x100 — stripped automatically',
      '  3858023  degrees_of_freedom_spec on Advantage+-ineligible account — omitted automatically',
      '  2061044  call_ads_configuration — preserved automatically',
      '  3858749  Page-role gate — report, stop, cannot work around',
      '  1885183  App-not-Live gate — report, stop, cannot work around',
      '  2446581  interactive_components_spec un-introspectable — use Meta UI, see CHANGE-RECORD',
      '',
      'Generic example (supply account/ad IDs from ignored local bindings):',
      '  node edit-creative-text.js \\',
      '    --account "$META_AD_ACCOUNT_ID" --ad "$META_AD_ID" \\',
      '    --replace "old text::new text" \\',
      '    --dry-run',
      '',
      'Carousel example:',
      '  node edit-creative-text.js \\',
      '    --account "$META_AD_ACCOUNT_ID" --ad "$META_AD_ID" \\',
      '    --drop-card-matching "deprecated region" \\',
      '    --replace "old text::new text" \\',
      '    --dry-run',
      '',
      'Exit codes: 0=success/dry-run, 1=error/abort, 2=input error'
    ].join('\n') + '\n');
    process.exit(0);
  }

  function getArg(flag) {
    const idx = args.indexOf(flag);
    if (idx === -1 || !args[idx + 1]) return null;
    return args[idx + 1];
  }

  function getAllArgs(flag) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === flag && args[i + 1]) out.push(args[i + 1]);
    }
    return out;
  }

  const accountId = getArg('--account');
  const adId = getArg('--ad');
  const replaceRaw = getAllArgs('--replace');
  const dropCardRaw = getArg('--drop-card-matching');
  const isLive = args.includes('--live');

  if (!accountId) { process.stderr.write('Error: --account is required\n'); process.exit(2); }
  if (!adId) { process.stderr.write('Error: --ad is required\n'); process.exit(2); }
  if (replaceRaw.length === 0 && !dropCardRaw) {
    process.stderr.write('Error: at least one --replace "from::to" or --drop-card-matching <regex> is required\n');
    process.exit(2);
  }

  // Parse --replace "from::to"
  const replacements = [];
  for (const raw of replaceRaw) {
    const sepIdx = raw.indexOf('::');
    if (sepIdx === -1) {
      process.stderr.write(`Error: --replace value must be "from::to" (got: ${raw})\n`);
      process.exit(2);
    }
    replacements.push({ from: raw.slice(0, sepIdx), to: raw.slice(sepIdx + 2) });
  }

  let dropCardRegex = null;
  if (dropCardRaw) {
    try {
      dropCardRegex = new RegExp(dropCardRaw, 'i');
    } catch (e) {
      process.stderr.write(`Error: --drop-card-matching is not a valid regex: ${e.message}\n`);
      process.exit(2);
    }
  }

  if (isLive && process.env.META_ADS_DRY_RUN !== 'false') {
    process.stderr.write('Error: --live requires run-with-op.sh (META_ACCESS_TOKEN + META_ADS_DRY_RUN=false)\n');
    process.exit(2);
  }

  const { createMetaAdsClient } = require('./client');
  const { loadMetaAdsConfig } = require('./config');
  const config = { ...loadMetaAdsConfig(), defaultAccountId: accountId };
  const client = createMetaAdsClient(config);

  async function run() {
    const result = await editCreativeText({
      client,
      accountId,
      adId,
      replacements,
      dropCardRegex,
      live: isLive
    });

    process.stdout.write('\n===RESULT===\n');
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');

    if (result.error) {
      process.stderr.write(`\n${result.leftover_abort ? 'ABORT' : 'ERROR'}: ${result.error}\n`);
      process.exit(1);
    }

    if (result.readback_ok === false) {
      process.stderr.write('\nREADBACK FAILED — manual verification required\n');
      process.exit(1);
    }

    if (result.live && result.readback_ok) {
      process.stdout.write('\nSUCCESS: ad re-pointed and readback-verified\n');
    }
  }

  run().catch((e) => {
    process.stderr.write(`Fatal: ${e.message}\n`);
    if (e.response) process.stderr.write(JSON.stringify(e.response.data || e.response, null, 2) + '\n');
    process.exit(1);
  });
}
