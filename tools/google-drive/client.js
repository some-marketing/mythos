'use strict';
// Dependency-free Google Drive client (raw HTTPS) -- token refresh + the
// permissions API a connected Drive MCP typically does not expose (sharing).

const https = require('https');
const fs = require('fs');
const { URL, URLSearchParams } = require('url');

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : {}; } catch { /* leave null */ }
        if (!ok) {
          const e = new Error(`HTTP ${res.statusCode}`);
          e.status = res.statusCode;
          e.body = data;
          return reject(e);
        }
        resolve(parsed);
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing OAuth creds (client_id / client_secret / refresh_token). Run `node authorize.js` once, or set GOOGLE_OAUTH_* env vars.'
    );
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  }).toString();
  const res = await httpsRequest(
    {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    },
    body
  );
  if (!res.access_token) throw new Error('Token refresh returned no access_token');
  return res.access_token;
}

// Grant a permission on a file/folder. type: 'user' | 'anyone'.
async function createPermission({ accessToken, fileId, role = 'reader', type = 'user', emailAddress, sendNotificationEmail = false, dryRun = false }) {
  const payload = { role, type };
  if (type === 'user') {
    if (!emailAddress) throw new Error('emailAddress required when type=user');
    payload.emailAddress = emailAddress;
  }
  if (dryRun) return { dry_run: true, fileId, payload, sendNotificationEmail };
  const qs = new URLSearchParams({
    sendNotificationEmail: String(!!sendNotificationEmail),
    supportsAllDrives: 'true',
    fields: 'id,type,role,emailAddress'
  }).toString();
  const body = JSON.stringify(payload);
  return httpsRequest(
    {
      hostname: 'www.googleapis.com',
      path: `/drive/v3/files/${encodeURIComponent(fileId)}/permissions?${qs}`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    },
    body
  );
}

async function listPermissions({ accessToken, fileId }) {
  const qs = new URLSearchParams({
    fields: 'permissions(id,type,role,emailAddress,displayName)',
    supportsAllDrives: 'true'
  }).toString();
  return httpsRequest({
    hostname: 'www.googleapis.com',
    path: `/drive/v3/files/${encodeURIComponent(fileId)}/permissions?${qs}`,
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

// --- Files API: the read/organize/upload operations a connected MCP often
// lacks (rename, move, and large/resumable upload from disk). ---

function apiRequest({ accessToken, method, path, body }) {
  const payload = body ? JSON.stringify(body) : null;
  return httpsRequest(
    {
      hostname: 'www.googleapis.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    },
    payload
  );
}

// Find a single direct child of parentId by exact name (optionally constrained
// to a mimeType, e.g. the folder type). Returns the file object or null.
async function findChild({ accessToken, parentId, name, mimeType }) {
  const clauses = [`'${parentId}' in parents`, `name = '${String(name).replace(/'/g, "\\'")}'`, 'trashed = false'];
  if (mimeType) clauses.push(`mimeType = '${mimeType}'`);
  const qs = new URLSearchParams({
    q: clauses.join(' and '),
    fields: 'files(id,name,mimeType)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true'
  }).toString();
  const r = await apiRequest({ accessToken, method: 'GET', path: `/drive/v3/files?${qs}` });
  return (r.files || [])[0] || null;
}

async function createFolder({ accessToken, name, parentId }) {
  return apiRequest({
    accessToken,
    method: 'POST',
    path: '/drive/v3/files?fields=id,name,parents,webViewLink&supportsAllDrives=true',
    body: { name, mimeType: 'application/vnd.google-apps.folder', parents: parentId ? [parentId] : undefined }
  });
}

// Idempotent: return the existing same-named folder under parentId, else create it.
async function ensureFolder({ accessToken, name, parentId }) {
  const existing = await findChild({ accessToken, parentId, name, mimeType: 'application/vnd.google-apps.folder' });
  if (existing) return { ...existing, _existed: true };
  return createFolder({ accessToken, name, parentId });
}

// Rename and/or move a file/folder. addParents/removeParents are comma-joined id strings.
async function updateFile({ accessToken, fileId, name, addParents, removeParents }) {
  const qs = new URLSearchParams({ supportsAllDrives: 'true', fields: 'id,name,parents' });
  if (addParents) qs.set('addParents', addParents);
  if (removeParents) qs.set('removeParents', removeParents);
  const body = {};
  if (name) body.name = name;
  return apiRequest({
    accessToken,
    method: 'PATCH',
    path: `/drive/v3/files/${encodeURIComponent(fileId)}?${qs.toString()}`,
    body: Object.keys(body).length ? body : undefined
  });
}

// Resumable upload of a local file (works for any size; a connected MCP's
// base64 path often can't take large files). Two steps: init session -> PUT
// all bytes to the session URI.
async function uploadFile({ accessToken, filePath, name, parentId, mimeType = 'application/octet-stream' }) {
  const buf = fs.readFileSync(filePath);
  const metadata = { name, parents: parentId ? [parentId] : undefined };
  const initBody = JSON.stringify(metadata);

  const sessionUri = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'www.googleapis.com',
        path: '/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,parents,webViewLink',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': buf.length,
          'Content-Length': Buffer.byteLength(initBody)
        }
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          if (res.statusCode === 200 && res.headers.location) return resolve(res.headers.location);
          reject(new Error(`resumable init HTTP ${res.statusCode}: ${d}`));
        });
      }
    );
    req.on('error', reject);
    req.write(initBody);
    req.end();
  });

  return new Promise((resolve, reject) => {
    const u = new URL(sessionUri);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'PUT',
        headers: { 'Content-Type': mimeType, 'Content-Length': buf.length }
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(d)); } catch { resolve({}); }
          } else reject(new Error(`upload PUT HTTP ${res.statusCode}: ${d}`));
        });
      }
    );
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

// Replace the CONTENT of an existing Drive file in place (keeps id, name, link).
async function updateFileMedia({ accessToken, fileId, filePath, mimeType = 'application/octet-stream' }) {
  const buf = fs.readFileSync(filePath);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'www.googleapis.com',
        path: `/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true&fields=id,name,webViewLink`,
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': mimeType, 'Content-Length': buf.length }
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) { try { resolve(JSON.parse(d)); } catch { resolve({}); } }
          else reject(new Error(`media PATCH HTTP ${res.statusCode}: ${d}`));
        });
      }
    );
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

module.exports = {
  getAccessToken,
  createPermission,
  listPermissions,
  apiRequest,
  findChild,
  createFolder,
  ensureFolder,
  updateFile,
  uploadFile,
  updateFileMedia
};
