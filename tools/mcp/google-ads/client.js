'use strict';

const { buildUrl, requestJson } = require('../shared/http');
const { validateQuery } = require('./gaql-allowlist');

function createGoogleAdsClient(config) {
  let tokenCache = null;

  function resolveCustomerId(customerId) {
    const resolved = String(customerId || config.defaultCustomerId || '').replace(/-/g, '');
    if (!resolved) {
      throw new Error('Google Ads customer ID is required');
    }
    return resolved;
  }

  function baseApiUrl() {
    return `https://googleads.googleapis.com/${config.apiVersion}/`;
  }

  async function getAccessToken() {
    if (config.dryRun) return 'dry-run-token';
    if (tokenCache && tokenCache.expiresAt > Date.now() + 30000) {
      return tokenCache.accessToken;
    }

    ensureLiveAccess(config);

    const url = new URL('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token'
    });
    const payload = await rawFormRequest(url, form.toString());
    const accessToken = payload.access_token;
    if (!accessToken) {
      throw new Error('Failed to obtain Google Ads access token');
    }

    tokenCache = {
      accessToken,
      expiresAt: Date.now() + ((payload.expires_in || 3600) * 1000)
    };
    return accessToken;
  }

  async function search({ customerId, query }) {
    const resolvedCustomerId = resolveCustomerId(customerId);

    if (config.dryRun) {
      return {
        dry_run: true,
        method: 'POST',
        url: buildUrl(baseApiUrl(), `customers/${resolvedCustomerId}/googleAds:searchStream`).toString(),
        body: { query }
      };
    }

    const accessToken = await getAccessToken();
    const url = buildUrl(baseApiUrl(), `customers/${resolvedCustomerId}/googleAds:searchStream`);
    const response = await requestJson({
      method: 'POST',
      url,
      headers: buildHeaders(config, accessToken),
      body: { query }
    });
    return response.data;
  }

  async function mutateCampaignStatus({ customerId, campaignId, status }) {
    const resolvedCustomerId = resolveCustomerId(customerId);
    const resourceName = `customers/${resolvedCustomerId}/campaigns/${campaignId}`;
    const body = {
      operations: [
        {
          update: {
            resourceName,
            status
          },
          updateMask: 'status'
        }
      ]
    };

    return mutate({
      customerId: resolvedCustomerId,
      servicePath: 'campaigns:mutate',
      body
    });
  }

  async function mutateCampaignBudget({ customerId, budgetId, amountMicros }) {
    const resolvedCustomerId = resolveCustomerId(customerId);
    const resourceName = `customers/${resolvedCustomerId}/campaignBudgets/${budgetId}`;
    const body = {
      operations: [
        {
          update: {
            resourceName,
            amountMicros: String(amountMicros)
          },
          updateMask: 'amountMicros'
        }
      ]
    };

    return mutate({
      customerId: resolvedCustomerId,
      servicePath: 'campaignBudgets:mutate',
      body
    });
  }

  async function runGaql({ customerId, query }) {
    const validation = validateQuery(query);
    if (!validation.ok) {
      throw new Error(`GAQL validation failed: ${validation.error}`);
    }
    return search({ customerId, query });
  }

  async function mutate({ customerId, servicePath, body }) {
    if (config.dryRun) {
      return {
        dry_run: true,
        method: 'POST',
        url: buildUrl(baseApiUrl(), `customers/${customerId}/${servicePath}`).toString(),
        body
      };
    }

    const accessToken = await getAccessToken();
    const url = buildUrl(baseApiUrl(), `customers/${customerId}/${servicePath}`);
    const response = await requestJson({
      method: 'POST',
      url,
      headers: buildHeaders(config, accessToken),
      body
    });
    return response.data;
  }

  async function mutateCampaignNegativeKeyword({ customerId, campaignId, keywordText, matchType }) {
    const resolvedCustomerId = resolveCustomerId(customerId);
    const campaignResourceName = `customers/${resolvedCustomerId}/campaigns/${campaignId}`;
    const body = {
      operations: [
        {
          create: {
            campaign: campaignResourceName,
            negative: true,
            status: 'ENABLED',
            keyword: {
              text: keywordText,
              matchType
            }
          }
        }
      ]
    };

    return mutate({
      customerId: resolvedCustomerId,
      servicePath: 'campaignCriteria:mutate',
      body
    });
  }

  async function mutateSharedNegativeKeyword({ customerId, sharedSetId, keywordText, matchType }) {
    const resolvedCustomerId = resolveCustomerId(customerId);
    const sharedSetResourceName = `customers/${resolvedCustomerId}/sharedSets/${sharedSetId}`;
    const body = {
      operations: [
        {
          create: {
            sharedSet: sharedSetResourceName,
            keyword: {
              text: keywordText,
              matchType
            }
          }
        }
      ]
    };

    return mutate({
      customerId: resolvedCustomerId,
      servicePath: 'sharedCriteria:mutate',
      body
    });
  }

  // Remove a campaign negative keyword by its criterion resource name
  // (resolve the resourceName first via GAQL on campaign_criterion). Reversible:
  // re-add via mutateCampaignNegativeKeyword. Used to undo wrongful negatives.
  async function removeCampaignNegativeKeyword({ customerId, resourceName }) {
    const resolvedCustomerId = resolveCustomerId(customerId);
    return mutate({
      customerId: resolvedCustomerId,
      servicePath: 'campaignCriteria:mutate',
      body: { operations: [{ remove: resourceName }] }
    });
  }

  // Update a campaign's Maximize-Conversions target CPA (the tCPA cap).
  // NOTE: assumes the campaign runs MaximizeConversions with a target_cpa; verify
  // the bidding strategy before live push (a standalone/portfolio TargetCpa uses a
  // different field path). targetCpaMicros = dollars * 1_000_000.
  async function updateCampaignTargetCpa({ customerId, campaignId, targetCpaMicros }) {
    const resolvedCustomerId = resolveCustomerId(customerId);
    const resourceName = `customers/${resolvedCustomerId}/campaigns/${campaignId}`;
    return mutate({
      customerId: resolvedCustomerId,
      servicePath: 'campaigns:mutate',
      body: {
        operations: [
          {
            update: { resourceName, maximizeConversions: { targetCpaMicros } },
            updateMask: 'maximizeConversions.targetCpaMicros'
          }
        ]
      }
    });
  }

  // Update an ad's final URL(s) IN PLACE (AdService.mutateAds). Only URL-class
  // fields are mutable on an existing ad (creative/headlines are immutable), so
  // this keeps the same ad id + stats/learning — no recreate, no reset. Reversible
  // (set the URLs back). resourceName = customers/{cid}/ads/{adId}.
  async function updateAdFinalUrls({ customerId, adId, finalUrls }) {
    const resolvedCustomerId = resolveCustomerId(customerId);
    const resourceName = `customers/${resolvedCustomerId}/ads/${adId}`;
    return mutate({
      customerId: resolvedCustomerId,
      servicePath: 'ads:mutate',
      body: {
        operations: [
          { update: { resourceName, finalUrls }, updateMask: 'final_urls' }
        ]
      }
    });
  }

  // Pause (or enable) an account-level auto-apply recommendation subscription.
  // Resource name is keyed by the recommendation TYPE (immutable); only `status`
  // is mutable, so disabling = update status -> PAUSED with updateMask=status.
  // Subscriptions cannot be deleted per the API, only paused.
  // Ref: googleads v20 RecommendationSubscriptionService.MutateRecommendationSubscription
  //   POST customers/{cid}/recommendationSubscriptions:mutateRecommendationSubscription
  async function mutateRecommendationSubscription({ customerId, type, status, validateOnly }) {
    const resolvedCustomerId = resolveCustomerId(customerId);
    if (!type) throw new Error('recommendation subscription type is required');
    if (!status) throw new Error('recommendation subscription status is required (ENABLED | PAUSED)');
    const resourceName = `customers/${resolvedCustomerId}/recommendationSubscriptions/${type}`;
    const body = {
      operations: [
        {
          update: {
            resourceName,
            status
          },
          updateMask: 'status'
        }
      ]
    };
    if (validateOnly) body.validateOnly = true;

    return mutate({
      customerId: resolvedCustomerId,
      servicePath: 'recommendationSubscriptions:mutateRecommendationSubscription',
      body
    });
  }

  // Pause (or enable) an ad group by resource name.
  // status: 'ENABLED' | 'PAUSED' | 'REMOVED'
  async function mutateAdGroupStatus({ customerId, adGroupId, status }) {
    const resolvedCustomerId = resolveCustomerId(customerId);
    const resourceName = `customers/${resolvedCustomerId}/adGroups/${adGroupId}`;
    return mutate({
      customerId: resolvedCustomerId,
      servicePath: 'adGroups:mutate',
      body: {
        operations: [
          {
            update: { resourceName, status },
            updateMask: 'status'
          }
        ]
      }
    });
  }

  // Create a new RSA in an ad group.
  // adGroupResourceName: customers/{cid}/adGroups/{agId}
  // headlines: [{ text, pinnedField? }]  (max 15, text ≤30 chars each)
  // descriptions: [{ text, pinnedField? }]  (max 4, text ≤90 chars each)
  // finalUrls: string[]
  // status: 'ENABLED' | 'PAUSED' (default ENABLED)
  async function createRsa({ customerId, adGroupId, headlines, descriptions, finalUrls, status }) {
    const resolvedCustomerId = resolveCustomerId(customerId);
    const adGroupResourceName = `customers/${resolvedCustomerId}/adGroups/${adGroupId}`;

    const headlineAssets = headlines.map((h) => ({
      text: h.text,
      ...(h.pinnedField ? { pinnedField: h.pinnedField } : {})
    }));
    const descriptionAssets = descriptions.map((d) => ({
      text: d.text,
      ...(d.pinnedField ? { pinnedField: d.pinnedField } : {})
    }));

    return mutate({
      customerId: resolvedCustomerId,
      servicePath: 'adGroupAds:mutate',
      body: {
        operations: [
          {
            create: {
              adGroup: adGroupResourceName,
              status: status || 'ENABLED',
              ad: {
                finalUrls: finalUrls || [],
                responsiveSearchAd: {
                  headlines: headlineAssets,
                  descriptions: descriptionAssets
                }
              }
            }
          }
        ]
      }
    });
  }

  // Create one or more campaign-level assets via AssetService.mutateAssets.
  // Generic creator: callers pass fully-formed asset create operations (each
  // `create` object is an Asset resource, e.g. { name?, calloutAsset:{...} } or
  // { sitelinkAsset:{...} } or { promotionAsset:{...} }). The asset itself is NOT
  // campaign-scoped — link it to a campaign separately via linkCampaignAsset.
  // Returns the mutate response whose results[].resourceName are the new asset
  // resource names (customers/{cid}/assets/{assetId}). Reversible: assets can be
  // removed via a remove op, or simply left unlinked (an unlinked asset never serves).
  // assets: Array<object> — each is the Asset create payload (sans resourceName).
  async function createAssets({ customerId, assets }) {
    const resolvedCustomerId = resolveCustomerId(customerId);
    if (!Array.isArray(assets) || assets.length === 0) {
      throw new Error('createAssets requires a non-empty assets[] array');
    }
    return mutate({
      customerId: resolvedCustomerId,
      servicePath: 'assets:mutate',
      body: { operations: assets.map((a) => ({ create: a })) }
    });
  }

  // Link an existing asset to a campaign via CampaignAssetService.mutateCampaignAssets.
  // assetResourceName: customers/{cid}/assets/{assetId} (from createAssets results).
  // fieldType: 'PROMOTION' | 'SITELINK' | 'CALLOUT' | 'STRUCTURED_SNIPPET' | ...
  // campaignId: the campaign to attach to (asset serves under that campaign only).
  // Returns the mutate response; the link resourceName is
  // customers/{cid}/campaignAssets/{campaignId}~{assetId}~{fieldType}. Reversible:
  // remove that campaignAsset link (the asset survives, just stops serving there).
  async function linkCampaignAsset({ customerId, campaignId, assetResourceName, fieldType }) {
    const resolvedCustomerId = resolveCustomerId(customerId);
    if (!campaignId) throw new Error('linkCampaignAsset requires campaignId');
    if (!assetResourceName) throw new Error('linkCampaignAsset requires assetResourceName');
    if (!fieldType) throw new Error('linkCampaignAsset requires fieldType (PROMOTION|SITELINK|CALLOUT|...)');
    const campaignResourceName = `customers/${resolvedCustomerId}/campaigns/${campaignId}`;
    return mutate({
      customerId: resolvedCustomerId,
      servicePath: 'campaignAssets:mutate',
      body: {
        operations: [
          {
            create: {
              campaign: campaignResourceName,
              asset: assetResourceName,
              fieldType
            }
          }
        ]
      }
    });
  }

  // Pause (or enable/remove) an ad_group_ad by its resource name.
  // resourceName: customers/{cid}/adGroupAds/{agId}~{adId}
  // status: 'ENABLED' | 'PAUSED' | 'REMOVED'
  async function mutateAdGroupAdStatus({ customerId, adGroupId, adId, status }) {
    const resolvedCustomerId = resolveCustomerId(customerId);
    const resourceName = `customers/${resolvedCustomerId}/adGroupAds/${adGroupId}~${adId}`;
    return mutate({
      customerId: resolvedCustomerId,
      servicePath: 'adGroupAds:mutate',
      body: {
        operations: [
          {
            update: { resourceName, status },
            updateMask: 'status'
          }
        ]
      }
    });
  }

  return {
    search,
    runGaql,
    mutate,
    mutateCampaignBudget,
    mutateCampaignStatus,
    mutateCampaignNegativeKeyword,
    mutateSharedNegativeKeyword,
    removeCampaignNegativeKeyword,
    updateCampaignTargetCpa,
    updateAdFinalUrls,
    mutateRecommendationSubscription,
    mutateAdGroupStatus,
    createRsa,
    createAssets,
    linkCampaignAsset,
    mutateAdGroupAdStatus
  };
}

function buildHeaders(config, accessToken) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': config.developerToken
  };

  if (config.loginCustomerId) {
    headers['login-customer-id'] = config.loginCustomerId;
  }

  return headers;
}

function ensureLiveAccess(config) {
  if (!config.developerToken) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN is required when GOOGLE_ADS_DRY_RUN=false');
  if (!config.clientId) throw new Error('GOOGLE_ADS_CLIENT_ID is required when GOOGLE_ADS_DRY_RUN=false');
  if (!config.clientSecret) throw new Error('GOOGLE_ADS_CLIENT_SECRET is required when GOOGLE_ADS_DRY_RUN=false');
  if (!config.refreshToken) throw new Error('GOOGLE_ADS_REFRESH_TOKEN is required when GOOGLE_ADS_DRY_RUN=false');
}

async function rawFormRequest(url, body) {
  const https = require('https');

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode < 200 || res.statusCode >= 300) {
              const error = new Error(`Token request failed with status ${res.statusCode}`);
              error.response = parsed;
              reject(error);
              return;
            }
            resolve(parsed);
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = {
  createGoogleAdsClient
};
