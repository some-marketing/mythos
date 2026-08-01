'use strict';

// Minimal Microsoft Graph client for the identity-bound OneDrive quota check
// used by client-storage preflight. Credentials stay process-local.

const crypto = require('crypto');
const https = require('https');
const { URLSearchParams } = require('url');

function graphError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function requestJson(options, body, transport = https) {
  return new Promise((resolve, reject) => {
    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = data ? JSON.parse(data) : {};
        } catch {
          reject(graphError('GRAPH_JSON_ERROR', 'Microsoft Graph returned invalid JSON'));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(graphError('GRAPH_HTTP_ERROR', `Microsoft Graph HTTP ${res.statusCode}`, {
            status: res.statusCode
          }));
          return;
        }
        resolve(parsed);
      });
    });
    req.on('error', () => reject(graphError('GRAPH_NETWORK_ERROR', 'Microsoft Graph request failed')));
    if (body) req.write(body);
    req.end();
  });
}

function profilePrefix(profile) {
  if (typeof profile !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(profile)) {
    throw graphError('GRAPH_PROFILE_INVALID', 'A valid registered Microsoft Graph credential profile is required');
  }
  const encoded = Buffer.from(profile.toLowerCase(), 'utf8').toString('hex').toUpperCase();
  return `MS_GRAPH_PROFILE_${encoded}`;
}

function profileCredentials(profile, env = process.env) {
  const prefix = profilePrefix(profile);
  return {
    accessToken: env[`${prefix}_ACCESS_TOKEN`] || '',
    clientId: env[`${prefix}_CLIENT_ID`] || '',
    clientSecret: env[`${prefix}_CLIENT_SECRET`] || '',
    refreshToken: env[`${prefix}_REFRESH_TOKEN`] || '',
    tenant: env[`${prefix}_TENANT_ID`] || 'common'
  };
}

async function getAccessToken(options = {}) {
  const { profile, env = process.env, request = requestJson } = options;
  const credentials = profileCredentials(profile, env);
  if (credentials.accessToken) return credentials.accessToken;
  if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
    throw graphError('GRAPH_CREDENTIALS_MISSING', 'Microsoft Graph named-profile credentials are not configured');
  }

  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token',
    scope: 'https://graph.microsoft.com/.default offline_access'
  }).toString();
  const token = await request({
    hostname: 'login.microsoftonline.com',
    path: `/${encodeURIComponent(credentials.tenant)}/oauth2/v2.0/token`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);
  if (!token.access_token) {
    throw graphError('GRAPH_TOKEN_INVALID', 'Microsoft Graph token response omitted access_token');
  }
  return token.access_token;
}

function identityHash(value) {
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

async function getOneDriveQuotaEvidence(options = {}) {
  const {
    profile,
    expectedAccountIdentitySha256,
    remoteRootId,
    env = process.env,
    request = requestJson
  } = options;
  if (!/^[a-f0-9]{64}$/i.test(expectedAccountIdentitySha256 || '')) {
    throw graphError('GRAPH_ACCOUNT_BINDING_MISSING', 'Registered Microsoft Graph account binding is required');
  }
  if (typeof remoteRootId !== 'string' || !remoteRootId.trim()) {
    throw graphError('GRAPH_REMOTE_ROOT_BINDING_MISSING', 'Registered Microsoft Graph remote root binding is required');
  }

  const accessToken = options.accessToken || await getAccessToken({ profile, env, request });
  const headers = { Authorization: `Bearer ${accessToken}` };
  const account = await request({
    hostname: 'graph.microsoft.com',
    path: '/v1.0/me?$select=id,mail,userPrincipalName',
    method: 'GET',
    headers
  });
  const observedHashes = [account && account.mail, account && account.userPrincipalName]
    .filter(Boolean)
    .map(identityHash);
  if (!observedHashes.includes(String(expectedAccountIdentitySha256).toLowerCase())) {
    throw graphError('GRAPH_ACCOUNT_MISMATCH', 'Microsoft Graph account identity does not match registration');
  }

  const drive = await request({
    hostname: 'graph.microsoft.com',
    path: '/v1.0/me/drive?$select=id,quota',
    method: 'GET',
    headers
  });
  const root = await request({
    hostname: 'graph.microsoft.com',
    path: '/v1.0/me/drive/root?$select=id,parentReference',
    method: 'GET',
    headers
  });
  if (remoteRootId !== drive.id && remoteRootId !== root.id) {
    throw graphError('GRAPH_REMOTE_ROOT_MISMATCH', 'Microsoft Graph remote root does not match registration');
  }

  const remaining = Number(drive && drive.quota && drive.quota.remaining);
  if (!Number.isFinite(remaining) || remaining < 0) {
    throw graphError('GRAPH_QUOTA_INVALID', 'Microsoft Graph drive quota omitted a valid remaining-byte value');
  }
  return { remaining, driveId: drive.id, rootId: root.id };
}

async function getOneDriveFreeBytes(options = {}) {
  return (await getOneDriveQuotaEvidence(options)).remaining;
}

module.exports = {
  getAccessToken,
  getOneDriveFreeBytes,
  getOneDriveQuotaEvidence,
  graphError,
  identityHash,
  profileCredentials,
  profilePrefix,
  requestJson
};
