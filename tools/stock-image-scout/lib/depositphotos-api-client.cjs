'use strict';

/**
 * depositphotos-api-client.cjs — Depositphotos Partner API client (subscription
 * download path), NOT the Playwright/session flow.
 *
 * Research basis (2026-07-01, see download.cjs / README for source URLs):
 *   - https://api.depositphotos.com/doc/  (API index)
 *   - https://api.depositphotos.com/doc/classes/API.Purchase.html (getMedia,
 *     getPurchases, reDownload)
 *   - https://github.com/depositphotos/dp-api (reference PHP client)
 *
 * Depositphotos' API is API-KEY + LOGIN/PASSWORD session auth, not a modern
 * OAuth2 client-credentials/bearer-token flow: `login` exchanges
 * dp_apikey + dp_login_user + dp_login_password for a dp_session_id (session
 * documented as ~3h TTL). Every subsequent call (including the purchase/
 * download call) sends dp_apikey + dp_session_id. This module still treats
 * those three values as "the OAuth-shaped credential" per operator direction:
 * they are resolved via 1Password/Keychain/env exactly like the sheets tool's
 * OAuth triplet (see run-with-op.sh), never typed into argv or committed.
 *
 * Confirmed from docs: API.Purchase.getMedia supports
 * dp_purchase_currency=subscription — i.e. downloading a file BY ID under an
 * active subscription (not just credits/ondemand) is a real, documented API
 * capability. This is the primary download path for this tool.
 *
 * LIVE-VALIDATION-REQUIRED: the exact JSON response envelope shape for
 * `login` and `getMedia` was not directly inspectable (doc pages didn't
 * expose a live example payload). parseLoginResponse/parseGetMediaResponse
 * below are written defensively against the several envelope shapes this API
 * family commonly uses, and will throw a descriptive error naming the actual
 * top-level keys seen if none match — that error is the signal to add the
 * real shape once observed against a live account. The REQUEST BUILDERS
 * (buildLoginUrl / buildGetMediaUrl / buildRedownloadUrl) are fully
 * determined by the documented parameter names and are unit-tested exactly.
 */

const DEFAULT_BASE_URL = 'https://api.depositphotos.com/';
const DEFAULT_MEDIA_OPTION = 'xl'; // largest raster size per API.Purchase docs (s/m/l/xl)
const DEFAULT_MEDIA_LICENSE = 'standard';
const DEFAULT_PURCHASE_CURRENCY = 'subscription'; // All-In-One plan spend, not credits/ondemand

function baseUrlWithTrailingSlash(baseUrl) {
  const url = baseUrl || DEFAULT_BASE_URL;
  return url.endsWith('/') ? url : `${url}/`;
}

function buildLoginUrl({ baseUrl, apiKey, username, password }) {
  if (!apiKey || !username || !password) {
    throw new Error('buildLoginUrl requires apiKey, username, and password');
  }
  const url = new URL(baseUrlWithTrailingSlash(baseUrl));
  url.searchParams.set('dp_command', 'login');
  url.searchParams.set('dp_apikey', apiKey);
  url.searchParams.set('dp_login_user', username);
  url.searchParams.set('dp_login_password', password);
  return url.toString();
}

function buildGetMediaUrl({
  baseUrl,
  apiKey,
  sessionId,
  mediaId,
  mediaOption = DEFAULT_MEDIA_OPTION,
  mediaLicense = DEFAULT_MEDIA_LICENSE,
  purchaseCurrency = DEFAULT_PURCHASE_CURRENCY
}) {
  if (!apiKey || !sessionId || !mediaId) {
    throw new Error('buildGetMediaUrl requires apiKey, sessionId, and mediaId');
  }
  const url = new URL(baseUrlWithTrailingSlash(baseUrl));
  url.searchParams.set('dp_command', 'getMedia');
  url.searchParams.set('dp_apikey', apiKey);
  url.searchParams.set('dp_session_id', sessionId);
  url.searchParams.set('dp_media_id', mediaId);
  url.searchParams.set('dp_media_option', mediaOption);
  url.searchParams.set('dp_media_license', mediaLicense);
  url.searchParams.set('dp_purchase_currency', purchaseCurrency);
  return url.toString();
}

function buildRedownloadUrl({ baseUrl, apiKey, sessionId, licenseId }) {
  if (!apiKey || !sessionId || !licenseId) {
    throw new Error('buildRedownloadUrl requires apiKey, sessionId, and licenseId');
  }
  const url = new URL(baseUrlWithTrailingSlash(baseUrl));
  url.searchParams.set('dp_command', 'reDownload');
  url.searchParams.set('dp_apikey', apiKey);
  url.searchParams.set('dp_session_id', sessionId);
  url.searchParams.set('dp_license_id', licenseId);
  return url.toString();
}

// LIVE-VALIDATION-REQUIRED — see module header.
function parseLoginResponse(json) {
  const candidates = [
    json && json.response && json.response.data && json.response.data.dp_session_id,
    json && json.response && json.response.data && json.response.data.session_id,
    json && json.data && json.data.session_id,
    json && json.data && json.data.dp_session_id,
    json && json.session_id,
    json && json.dp_session_id,
    json && json.result && json.result.session_id
  ];
  const sessionId = candidates.find(v => typeof v === 'string' && v.length > 0);
  if (!sessionId) {
    throw new Error(
      `Unrecognized login response shape from Depositphotos API. Top-level keys: ${Object.keys(json || {}).join(', ') || '<none>'}. ` +
      'This parser is LIVE-VALIDATION-REQUIRED — update parseLoginResponse() in lib/depositphotos-api-client.cjs against the real payload.'
    );
  }
  return { sessionId, raw: json };
}

// LIVE-VALIDATION-REQUIRED — see module header.
function parseGetMediaResponse(json) {
  const dataCandidates = [
    json && json.response && json.response.data,
    json && json.data,
    json && json.result,
    json
  ].filter(Boolean);

  for (const data of dataCandidates) {
    if (data && typeof data.downloadLink === 'string') {
      return { downloadLink: data.downloadLink, licenseId: data.licenseId || null, raw: json };
    }
  }

  throw new Error(
    `Unrecognized getMedia response shape from Depositphotos API. Top-level keys: ${Object.keys(json || {}).join(', ') || '<none>'}. ` +
    'This parser is LIVE-VALIDATION-REQUIRED — update parseGetMediaResponse() in lib/depositphotos-api-client.cjs against the real payload.'
  );
}

// LIVE-VALIDATION-REQUIRED — performs the actual network login call.
async function login(fetchImpl, { baseUrl, apiKey, username, password }) {
  const url = buildLoginUrl({ baseUrl, apiKey, username, password });
  const res = await fetchImpl(url, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Depositphotos login failed: HTTP ${res.status}`);
  }
  const json = await res.json();
  return parseLoginResponse(json);
}

// LIVE-VALIDATION-REQUIRED — performs the actual network purchase/download-link call.
async function getMediaDownloadLink(fetchImpl, params) {
  const url = buildGetMediaUrl(params);
  const res = await fetchImpl(url, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Depositphotos getMedia failed for id=${params.mediaId}: HTTP ${res.status}`);
  }
  const json = await res.json();
  return parseGetMediaResponse(json);
}

// Downloads the actual asset bytes from a resolved downloadLink. Not
// Depositphotos-API-shaped (no dp_ params) — this is a plain HTTPS GET, so it
// carries lower live-validation risk than login/getMedia above.
async function fetchAssetBytes(fetchImpl, downloadLink) {
  const res = await fetchImpl(downloadLink, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Failed to fetch asset bytes from downloadLink: HTTP ${res.status}`);
  }
  const contentType = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') : null;
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

function extensionForContentType(contentType) {
  if (!contentType) return 'jpg';
  const type = contentType.split(';')[0].trim().toLowerCase();
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/tiff': 'tiff'
  };
  return map[type] || 'jpg';
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MEDIA_OPTION,
  DEFAULT_MEDIA_LICENSE,
  DEFAULT_PURCHASE_CURRENCY,
  buildLoginUrl,
  buildGetMediaUrl,
  buildRedownloadUrl,
  parseLoginResponse,
  parseGetMediaResponse,
  login,
  getMediaDownloadLink,
  fetchAssetBytes,
  extensionForContentType
};
