#!/usr/bin/env node
'use strict';
/**
 * readback-verifier.js — format-agnostic creative readback verifier.
 *
 * Verifies image and video PLACEMENT creative shapes: status, link, CTA,
 * url_tags, asset routing rules, DOF shape. Extracted from
 * clients/patron-gamma/projects/may-2026-offers/restructure-ss-video-ads.js:~216
 * and generalized to support both image and video creative types.
 *
 * Governing artifacts:
 *   _dev/reports/analysis/operator-decision__meta-ads-tools-promotion__20260610.md
 *   _dev/reports/analysis/convene-runs/20260610T145537Z-meta-ads-tools-promotion-review/synthesis.md
 *
 * Usage (module):
 *   const { verifyReadback } = require('./readback-verifier');
 *   const result = verifyReadback(readbackObj, expectation);
 *   // result: { pass: boolean, problems: string[], summary: string }
 *
 * Usage (CLI):
 *   node readback-verifier.js --readback path/to/readback.json --expect path/to/expect.json
 *   node readback-verifier.js --readback '{"creative":{...}}' --expect '{"status":"PAUSED",...}'
 *   node readback-verifier.js --help
 */

/**
 * verifyReadback — core verification function.
 *
 * @param {object} rb - readback object from Meta API (ad with creative edge)
 * @param {object} expectation - what to verify against
 * @param {object} [opts] - options
 * @returns {{ pass: boolean, problems: string[], summary: string }}
 *
 * expectation schema:
 * {
 *   status?: string,             // expected ad status (e.g. "PAUSED")
 *   adset_id?: string,           // expected adset_id
 *   creative_type?: "image"|"video",  // gate image vs video checks
 *   link?: string,               // expected destination URL in link_urls
 *   cta?: string,                // expected CTA type in call_to_action_types
 *   url_tags?: string,           // expected url_tags verbatim
 *   optimization_type?: string,  // expected asset_feed_spec.optimization_type
 *   rule_count?: number,         // expected number of asset_customization_rules
 *   media_count?: number,        // expected number of images[] or videos[]
 *   title_count?: number,        // expected number of titles[]
 *   body_count?: number,         // expected number of bodies[] (typically 1 for PLACEMENT)
 *   description_count?: number,  // expected number of descriptions[]
 *   body_text?: string,          // expected exact body text (bodies[0].text)
 *   // DOF checks:
 *   dof_advantage_plus_creative?: string,  // expected enroll_status (e.g. "OPT_OUT")
 *   contextual_multi_ads?: string,          // expected enroll_status
 *   // Rule checks (for video):
 *   rule_checks?: Array<{                   // verify specific rules by priority
 *     priority: number,
 *     is_catch_all?: boolean,              // true if rule has no platform-specific positions
 *     has_feed_positions?: boolean,        // true if facebook_positions includes 'feed'
 *     media_label?: string,               // expected video_label or image_label name
 *     media_thumb?: string,               // expected thumbnail_hash (video only)
 *   }>
 * }
 */
function verifyReadback(rb, expectation = {}, opts = {}) {
  const problems = [];
  const afs = (rb.creative && rb.creative.asset_feed_spec) || {};
  const rules = afs.asset_customization_rules || [];

  // Status
  if (expectation.status && rb.status !== expectation.status) {
    problems.push(`status=${rb.status} (want ${expectation.status})`);
  }

  // Adset
  if (expectation.adset_id && rb.adset_id !== String(expectation.adset_id)) {
    problems.push(`adset_id=${rb.adset_id} (want ${expectation.adset_id})`);
  }

  // Optimization type
  if (expectation.optimization_type && afs.optimization_type !== expectation.optimization_type) {
    problems.push(`optimization_type=${afs.optimization_type} (want ${expectation.optimization_type})`);
  }

  // Rule count
  if (expectation.rule_count !== undefined && rules.length !== expectation.rule_count) {
    problems.push(`rule_count=${rules.length} (want ${expectation.rule_count})`);
  }

  // Specific rule checks
  if (Array.isArray(expectation.rule_checks)) {
    for (const rc of expectation.rule_checks) {
      const rule = rules.find((r) => r.priority === rc.priority);
      if (!rule) {
        problems.push(`rule priority=${rc.priority} not found`);
        continue;
      }
      const cs = rule.customization_spec || {};
      const fpList = cs.facebook_positions || [];
      const ipList = cs.instagram_positions || [];

      if (rc.has_feed_positions === true && !fpList.includes('feed')) {
        problems.push(`rule${rc.priority} missing 'feed' in facebook_positions (positions: [${fpList.join(',')}])`);
      }
      if (rc.is_catch_all === true && (fpList.length > 0 || ipList.length > 0)) {
        problems.push(`rule${rc.priority} expected catch-all but has positions: fb=[${fpList.join(',')}] ig=[${ipList.join(',')}]`);
      }

      // Media label + thumb check (works for both image and video)
      if (rc.media_label) {
        const mediaLabelName = rc.media_label;
        // For video: check video_label; for image: check image_label
        const labelField = rule.video_label || rule.image_label;
        if (!labelField || labelField.name !== mediaLabelName) {
          problems.push(`rule${rc.priority} media_label=${labelField && labelField.name} (want ${mediaLabelName})`);
        }
        if (rc.media_thumb) {
          // Find the media asset with this label
          const mediaArr = [...(afs.videos || []), ...(afs.images || [])];
          const mediaAsset = mediaArr.find(
            (m) => (m.adlabels || []).some((l) => l.name === mediaLabelName)
          );
          if (!mediaAsset) {
            problems.push(`no media asset labelled "${mediaLabelName}"`);
          } else {
            const hash = mediaAsset.thumbnail_hash || mediaAsset.hash;
            if (hash !== rc.media_thumb) {
              problems.push(`rule${rc.priority} media hash=${hash} (want ${rc.media_thumb})`);
            }
          }
        }
      }
    }
  }

  // creative_type-specific media checks
  const ctype = expectation.creative_type;
  if (ctype === 'image') {
    const imageCount = (afs.images || []).length;
    if (expectation.media_count !== undefined && imageCount !== expectation.media_count) {
      problems.push(`images=${imageCount} (want ${expectation.media_count})`);
    }
  } else if (ctype === 'video') {
    const videoCount = (afs.videos || []).length;
    if (expectation.media_count !== undefined && videoCount !== expectation.media_count) {
      problems.push(`videos=${videoCount} (want ${expectation.media_count})`);
    }
  }

  // Text asset counts
  if (expectation.title_count !== undefined && (afs.titles || []).length !== expectation.title_count) {
    problems.push(`titles=${(afs.titles || []).length} (want ${expectation.title_count})`);
  }
  if (expectation.body_count !== undefined && (afs.bodies || []).length !== expectation.body_count) {
    problems.push(`bodies=${(afs.bodies || []).length} (want ${expectation.body_count})`);
  }
  if (expectation.description_count !== undefined && (afs.descriptions || []).length !== expectation.description_count) {
    problems.push(`descriptions=${(afs.descriptions || []).length} (want ${expectation.description_count})`);
  }

  // Body text
  if (expectation.body_text !== undefined) {
    const actualBody = ((afs.bodies || [])[0] || {}).text;
    if (actualBody !== expectation.body_text) {
      problems.push(`body text mismatch: got ${JSON.stringify((actualBody || '').slice(0, 50))}`);
    }
  }

  // Link URL
  if (expectation.link) {
    const linkUrl = ((afs.link_urls || [])[0] || {}).website_url;
    if (linkUrl !== expectation.link) {
      problems.push(`link=${linkUrl} (want ${expectation.link})`);
    }
  }

  // CTA
  if (expectation.cta) {
    const ctaTypes = afs.call_to_action_types || [];
    if (!ctaTypes.includes(expectation.cta)) {
      problems.push(`cta=[${ctaTypes.join(',')}] does not include ${expectation.cta}`);
    }
  }

  // url_tags
  if (expectation.url_tags !== undefined) {
    const actualTags = rb.creative && rb.creative.url_tags;
    if (actualTags !== expectation.url_tags) {
      problems.push(`url_tags=${actualTags} (want ${expectation.url_tags})`);
    }
  }

  // DOF: advantage_plus_creative
  if (expectation.dof_advantage_plus_creative !== undefined) {
    const dofCfs = ((rb.creative && rb.creative.degrees_of_freedom_spec) || {}).creative_features_spec || {};
    const actual = dofCfs.advantage_plus_creative && dofCfs.advantage_plus_creative.enroll_status;
    if (actual !== expectation.dof_advantage_plus_creative) {
      problems.push(`dof.advantage_plus_creative=${actual} (want ${expectation.dof_advantage_plus_creative})`);
    }
  }

  // contextual_multi_ads
  if (expectation.contextual_multi_ads !== undefined) {
    const actual = rb.creative && rb.creative.contextual_multi_ads && rb.creative.contextual_multi_ads.enroll_status;
    if (actual !== expectation.contextual_multi_ads) {
      problems.push(`contextual_multi_ads=${actual} (want ${expectation.contextual_multi_ads})`);
    }
  }

  const pass = problems.length === 0;
  const summary = pass
    ? `OK (status=${rb.status} opt=${afs.optimization_type} rules=${rules.length})`
    : `PROBLEMS [${problems.join('; ')}]`;

  return { pass, problems, summary };
}

// ---- CLI wrapper ----
if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write([
      'readback-verifier.js — format-agnostic PLACEMENT creative readback verifier',
      '',
      'Usage:',
      '  node readback-verifier.js --readback path/to/readback.json --expect path/to/expect.json',
      '  node readback-verifier.js --readback \'{"creative":{...}}\' --expect \'{"status":"PAUSED",...}\'',
      '',
      'readback: ad object from Meta API with creative edge',
      'expect: expectation schema (see source for full schema)',
      '',
      'Output: JSON result with pass, problems, summary',
      'Exit codes: 0=pass, 1=problems, 2=input error'
    ].join('\n') + '\n');
    process.exit(0);
  }

  function resolveArg(flag, argList) {
    const idx = argList.indexOf(flag);
    if (idx === -1) return null;
    const val = argList[idx + 1];
    if (!val) return null;
    // Try as file path first
    const resolved = path.resolve(val);
    if (fs.existsSync(resolved)) return JSON.parse(fs.readFileSync(resolved, 'utf8'));
    // Try as inline JSON
    try { return JSON.parse(val); } catch (_) { return null; }
  }

  const rb = resolveArg('--readback', args);
  const expect = resolveArg('--expect', args);

  if (!rb) { process.stderr.write('Error: --readback is required (file path or JSON string)\n'); process.exit(2); }
  if (!expect) { process.stderr.write('Error: --expect is required (file path or JSON string)\n'); process.exit(2); }

  const result = verifyReadback(rb, expect);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.pass) {
    result.problems.forEach((p) => process.stderr.write(`PROBLEM: ${p}\n`));
    process.exit(1);
  }
  process.exit(0);
}

module.exports = { verifyReadback };
