'use strict';
//
// YouTube Data API v3 upload client — resumable upload via REST.
// Uses google-auth-library (already a dependency) to mint a short-lived access
// token from the channel's refresh token, then performs a resumable upload with
// the global fetch. No googleapis package required.
//
const fs = require('fs');
const { OAuth2Client } = require('google-auth-library');

const RESUMABLE_INIT =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const oauth2 = new OAuth2Client({ clientId, clientSecret });
  oauth2.setCredentials({ refresh_token: refreshToken });
  const { token } = await oauth2.getAccessToken();
  if (!token) throw new Error('Failed to mint access token from refresh token');
  return token;
}

/**
 * Upload a local video file to YouTube.
 * @returns {Promise<{videoId,url,privacyStatus,raw}|{dryRun,wouldUpload}>}
 */
async function uploadVideo(config, opts) {
  const {
    filePath,
    title,
    description = '',
    privacyStatus = 'unlisted',
    tags = [],
    categoryId = '2', // Autos & Vehicles
  } = opts;

  if (!filePath) throw new Error('filePath is required');
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  if (!title) throw new Error('title is required');
  const stat = fs.statSync(filePath);

  const metadata = {
    snippet: { title, description, tags, categoryId },
    status: { privacyStatus, selfDeclaredMadeForKids: false },
  };

  if (config.dryRun) {
    return { dryRun: true, wouldUpload: { filePath, bytes: stat.size, metadata } };
  }

  const accessToken = await getAccessToken(config);

  // 1) Initiate the resumable session.
  const initRes = await fetch(RESUMABLE_INIT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/*',
      'X-Upload-Content-Length': String(stat.size),
    },
    body: JSON.stringify(metadata),
  });
  if (!initRes.ok) {
    const t = await initRes.text();
    throw new Error(`Resumable init failed: ${initRes.status} ${t}`);
  }
  const sessionUri = initRes.headers.get('location');
  if (!sessionUri) throw new Error('No resumable session URI returned by YouTube');

  // 2) Upload the bytes in a single PUT (fine for ad-sized clips; well under
  //    the multi-GB range where chunking matters).
  const body = fs.readFileSync(filePath);
  const putRes = await fetch(sessionUri, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/*', 'Content-Length': String(stat.size) },
    body,
  });
  if (!putRes.ok) {
    const t = await putRes.text();
    throw new Error(`Upload PUT failed: ${putRes.status} ${t}`);
  }
  const json = await putRes.json();
  if (!json.id) throw new Error(`Upload returned no video id: ${JSON.stringify(json)}`);
  // Canonical result shape (codex review A2): provider-agnostic { provider, id, url,
  // privacyStatus } + a `portal` adapter block carrying the field name the
  // ads-approval portal expects (video_id). Keeps the uploader output stable
  // across providers and removes the plan/concept/code contract drift.
  const id = json.id;
  return {
    provider: 'youtube',
    id,
    url: `https://youtu.be/${id}`,
    privacyStatus: json.status && json.status.privacyStatus,
    portal: { video_id: id },
    raw: json,
  };
}

module.exports = { getAccessToken, uploadVideo };
