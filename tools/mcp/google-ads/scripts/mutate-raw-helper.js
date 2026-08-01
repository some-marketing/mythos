'use strict';

// Thin helper that performs a Google Ads mutate using the same auth + HTTP
// machinery the main client uses, but exposes the generic POST so new
// service paths (e.g., conversionActions:mutate) can be issued without
// editing client.js.
//
// Read GOOGLE_ADS_DRY_RUN via the same config loader as client.js.

const https = require('https');
const { loadGoogleAdsConfig } = require('../config');
const { buildUrl, requestJson } = require('../../shared/http');

// requestJson always JSON-stringifies the body, which is wrong for OAuth's
// application/x-www-form-urlencoded token endpoint. Inline a form-post helper.
function postForm(url, body) {
  return new Promise((resolve, reject) => {
    const target = typeof url === 'string' ? new URL(url) : url;
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data || '{}');
            if (res.statusCode < 200 || res.statusCode >= 300) {
              const e = new Error(`Token request failed ${res.statusCode}`);
              e.response = { status: res.statusCode, data: parsed, raw: data };
              reject(e); return;
            }
            resolve(parsed);
          } catch (err) { reject(err); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function mutateRaw({ customerId, servicePath, body, dryRun }) {
  const config = loadGoogleAdsConfig();
  const resolvedCustomerId = String(customerId || config.defaultCustomerId || '').replace(/-/g, '');
  if (!resolvedCustomerId) throw new Error('mutateRaw: customer id required');

  const apiVersion = config.apiVersion || 'v20';
  const baseApiUrl = `https://googleads.googleapis.com/${apiVersion}/`;
  const url = buildUrl(baseApiUrl, `customers/${resolvedCustomerId}/${servicePath}`);

  const effectiveDryRun = dryRun !== undefined ? dryRun : config.dryRun;
  if (effectiveDryRun) {
    return { dry_run: true, method: 'POST', url: url.toString(), body };
  }

  // Live: get access token via proper form-encoded POST
  const tokenResp = await postForm(
    new URL('https://oauth2.googleapis.com/token'),
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }).toString()
  );

  const accessToken = tokenResp.access_token;
  if (!accessToken) throw new Error('Failed to obtain Google Ads access token');

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': config.developerToken,
    'Content-Type': 'application/json',
  };
  if (config.loginCustomerId) headers['login-customer-id'] = String(config.loginCustomerId).replace(/-/g, '');

  // requestJson stringifies body itself; pass the object directly.
  const response = await requestJson({
    method: 'POST',
    url,
    headers,
    body,
  });
  return response.data;
}

module.exports = { mutateRaw };
