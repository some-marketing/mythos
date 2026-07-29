'use strict';

const { buildUrl, requestJson } = require('../shared/http');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

function createMetaAdsClient(config) {
  function getBaseUrl() {
    return `${config.baseUrl.replace(/\/$/, '')}/${config.apiVersion}/`;
  }

  async function graphGet(pathname, query = {}) {
    if (config.dryRun) {
      return {
        dry_run: true,
        method: 'GET',
        url: buildUrl(getBaseUrl(), pathname, query).toString()
      };
    }

    ensureLiveAccess(config);
    const url = buildUrl(getBaseUrl(), pathname, query);
    const response = await requestJson({
      method: 'GET',
      url,
      headers: { Authorization: `Bearer ${config.accessToken}` }
    });
    return response.data;
  }

  async function graphPost(pathname, body = {}, opts = {}) {
    if (!isLiveWrite(config, opts)) {
      return {
        dry_run: true,
        method: 'POST',
        url: buildUrl(getBaseUrl(), pathname).toString(),
        body
      };
    }

    ensureLiveAccess(config);
    const url = buildUrl(getBaseUrl(), pathname);
    const response = await requestJson({
      method: 'POST',
      url,
      headers: { Authorization: `Bearer ${config.accessToken}` },
      body
    });
    return response.data;
  }

  async function graphMultipart(pathname, fields = {}, fileField, filePath, opts = {}) {
    if (!filePath) {
      throw new Error('filePath is required');
    }

    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File does not exist: ${absolutePath}`);
    }

    if (!isLiveWrite(config, opts)) {
      return {
        dry_run: true,
        method: 'POST',
        multipart: true,
        url: buildUrl(getBaseUrl(), pathname).toString(),
        fields,
        file: {
          field: fileField,
          path: absolutePath,
          size_bytes: fs.statSync(absolutePath).size
        }
      };
    }

    ensureLiveAccess(config);
    return requestMultipart({
      url: buildUrl(getBaseUrl(), pathname),
      headers: { Authorization: `Bearer ${config.accessToken}` },
      fields,
      fileField,
      filePath: absolutePath,
      // Allow callers to raise the multipart timeout for large video uploads
      // (default 30s is tight for ~20MB files on slow links).
      timeoutMs: opts && opts.timeoutMs
    });
  }

  return {
    listCampaigns({ accountId, limit = 25, fields }) {
      return graphGet(`act_${normalizeAccountId(accountId, config.defaultAccountId)}/campaigns`, {
        limit,
        fields: fields || 'id,name,status,daily_budget,lifetime_budget,objective'
      });
    },

    listAdSets({ accountId, limit = 25, fields }) {
      return graphGet(`act_${normalizeAccountId(accountId, config.defaultAccountId)}/adsets`, {
        limit,
        fields: fields || 'id,name,status,daily_budget,lifetime_budget,campaign_id'
      });
    },

    listAds({ accountId, limit = 25, fields }) {
      return graphGet(`act_${normalizeAccountId(accountId, config.defaultAccountId)}/ads`, {
        limit,
        fields: fields || 'id,name,status,adset_id,campaign_id,creative{id,name,body,title}'
      });
    },

    // Read a single ad by id. Bounded + fast — preferred over listAds() when
    // you only need a known set of ads (listAds scans the whole account and can
    // return very large payloads).
    getAd({ adId, fields = 'id,name,status,effective_status' }) {
      return graphGet(String(adId), { fields });
    },

    // Read a single uploaded video's processing status. Bounded GET on the
    // video node. Returns status.video_status ('processing'|'ready'|'error').
    // Poll this to 'ready' after uploadVideo before referencing the video_id in
    // a creative — referencing a still-processing video can fail or serve blank.
    getVideoStatus({ videoId }) {
      return graphGet(String(videoId), { fields: 'status' });
    },

    exportInsights({ accountId, level = 'campaign', datePreset = 'maximum', limit = 100, fields }) {
      return graphGet(`act_${normalizeAccountId(accountId, config.defaultAccountId)}/insights`, {
        level,
        date_preset: datePreset,
        limit,
        fields: fields || 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,impressions,clicks,spend,cpc,ctr'
      });
    },

    updateAdStatus({ adId, status, live }) {
      // Fire live when explicitly told, else when the wrapper has put us in
      // live mode (META_ADS_DRY_RUN=false). Direct/un-wrapped calls stay dry.
      return graphPost(String(adId), { status }, { live: live === undefined ? !config.dryRun : live });
    },

    // Pause/resume a whole campaign in one call (kills/restores all delivery
    // under it). Same Graph shape as updateAdStatus, at the campaign node.
    updateCampaignStatus({ campaignId, status, live }) {
      return graphPost(String(campaignId), { status }, { live: live === undefined ? !config.dryRun : live });
    },

    // Pause/resume a single ad set. Same Graph shape as updateAdStatus,
    // at the adset node.
    updateAdSetStatus({ adSetId, status, live }) {
      return graphPost(String(adSetId), { status }, { live: live === undefined ? !config.dryRun : live });
    },

    // Read a single campaign by id. Bounded + fast — preferred over
    // listCampaigns() when you only need a known campaign (e.g. readback).
    getCampaign({ campaignId, fields = 'id,name,status,effective_status' }) {
      return graphGet(String(campaignId), { fields });
    },

    updateAdSetBudget({ adSetId, dailyBudget, live }) {
      return graphPost(String(adSetId), { daily_budget: String(dailyBudget) }, { live: live === undefined ? !config.dryRun : live });
    },

    createCampaign({ accountId, name, objective, status = 'PAUSED', specialAdCategories = [], isAdsetBudgetSharingEnabled = false, live = false }) {
      return graphPost(`act_${normalizeAccountId(accountId, config.defaultAccountId)}/campaigns`, {
        name,
        objective,
        status,
        special_ad_categories: normalizeSpecialAdCategories(specialAdCategories),
        is_adset_budget_sharing_enabled: isAdsetBudgetSharingEnabled
      }, { live });
    },

    createAdSet({
      accountId,
      campaignId,
      name,
      optimizationGoal,
      billingEvent,
      bidStrategy,
      dailyBudget,
      targeting,
      promotedObject,
      status = 'PAUSED',
      live = false
    }) {
      if (!targeting || typeof targeting !== 'object' || Array.isArray(targeting)) {
        throw new Error('targeting must be an object');
      }
      const body = {
        campaign_id: campaignId,
        name,
        optimization_goal: optimizationGoal,
        billing_event: billingEvent,
        bid_strategy: bidStrategy,
        daily_budget: dailyBudget === undefined || dailyBudget === null ? undefined : String(dailyBudget),
        targeting,
        promoted_object: promotedObject,
        status
      };
      return graphPost(`act_${normalizeAccountId(accountId, config.defaultAccountId)}/adsets`, compactObject(body), { live });
    },

    uploadImage({ accountId, filePath, live = false }) {
      return graphMultipart(
        `act_${normalizeAccountId(accountId, config.defaultAccountId)}/adimages`,
        {},
        'filename',
        filePath,
        { live }
      );
    },

    uploadVideo({ accountId, filePath, name, live = false, timeoutMs }) {
      return graphMultipart(
        `act_${normalizeAccountId(accountId, config.defaultAccountId)}/advideos`,
        compactObject({ name }),
        'source',
        filePath,
        { live, timeoutMs }
      );
    },

    createAdCreative({ accountId, name, objectStorySpec, urlTags, degreesOfFreedomSpec, contextualMultiAds, live = false }) {
      return graphPost(`act_${normalizeAccountId(accountId, config.defaultAccountId)}/adcreatives`, compactObject({
        name,
        object_story_spec: objectStorySpec,
        url_tags: urlTags,
        degrees_of_freedom_spec: degreesOfFreedomSpec,
        contextual_multi_ads: contextualMultiAds
      }), { live });
    },

    updateAdCreativeRef({ adId, creativeId, live = false }) {
      return graphPost(`${adId}`, { creative: { creative_id: creativeId } }, { live });
    },

    createAdCreativeFlexible({
      accountId,
      name,
      pageId,
      instagramUserId,
      assetFeedSpec,
      urlTags,
      degreesOfFreedomSpec,
      contextualMultiAds,
      live = false
    }) {
      // instagram_user_id is required when asset_customization_rules reference
      // Instagram positions (Meta error 1772103 "Instagram Account Is Missing"
      // without it). patron-gamma scripts bypassed this method via raw graphPost
      // because this param was missing — now supported.
      const objectStorySpec = compactObject({ page_id: pageId, instagram_user_id: instagramUserId });
      return graphPost(`act_${normalizeAccountId(accountId, config.defaultAccountId)}/adcreatives`, compactObject({
        name,
        object_story_spec: objectStorySpec,
        asset_feed_spec: assetFeedSpec,
        url_tags: urlTags,
        degrees_of_freedom_spec: degreesOfFreedomSpec,
        contextual_multi_ads: contextualMultiAds
      }), { live });
    },

    createAd({ accountId, adSetId, name, creativeId, status = 'PAUSED', live = false }) {
      return graphPost(`act_${normalizeAccountId(accountId, config.defaultAccountId)}/ads`, {
        adset_id: adSetId,
        name,
        creative: { creative_id: creativeId },
        status
      }, { live });
    }
  };
}

function ensureLiveAccess(config) {
  if (!config.accessToken) {
    throw new Error('META_ACCESS_TOKEN is required when META_ADS_DRY_RUN=false');
  }
}

function normalizeAccountId(value, fallback) {
  const raw = String(value || fallback || '').replace(/^act_/, '');
  if (!raw) {
    throw new Error('Meta account ID is required');
  }
  return raw;
}

function isLiveWrite(config, opts) {
  return config.dryRun === false && opts && opts.live === true;
}

function normalizeSpecialAdCategories(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [String(value)];
}

function compactObject(input) {
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

function requestMultipart({ url, headers = {}, fields = {}, fileField, filePath, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const boundary = `----mythos-meta-ads-${Date.now().toString(16)}`;
    const target = typeof url === 'string' ? new URL(url) : url;
    const mod = target.protocol === 'https:' ? https : http;
    const fileName = path.basename(filePath);
    const fileBuffer = fs.readFileSync(filePath);
    const chunks = [];

    for (const [key, value] of Object.entries(fields || {})) {
      if (value === undefined || value === null || value === '') continue;
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${String(value)}\r\n`));
    }
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    chunks.push(fileBuffer);
    chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);

    const req = mod.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
          ...headers
        },
        timeout: timeoutMs
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          if (data) {
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = null;
            }
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const error = new Error(`Request failed with status ${res.statusCode}`);
            error.response = { status: res.statusCode, headers: res.headers, data: parsed, raw: data };
            reject(error);
            return;
          }
          resolve(parsed);
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = {
  createMetaAdsClient
};
