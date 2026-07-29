'use strict';
//
// Google Sheets API v4 client — auth + a thin authed-REST helper.
//
// AUTH APPROACH (mirrors tools/mcp/youtube/client.js): use google-auth-library
// (already a dependency; googleapis is NOT installed) to mint a short-lived
// access token from the operator's refresh token, then talk to the Sheets/Drive
// REST APIs with the global fetch. No googleapis package required.
//
const { OAuth2Client } = require('google-auth-library');

/**
 * Mint a short-lived access token from a long-lived refresh token.
 * @param {{clientId:string, clientSecret:string, refreshToken:string}} cfg
 * @returns {Promise<string>} bearer access token
 */
async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const oauth2 = new OAuth2Client({ clientId, clientSecret });
  oauth2.setCredentials({ refresh_token: refreshToken });
  const { token } = await oauth2.getAccessToken();
  if (!token) throw new Error('Failed to mint access token from refresh token');
  return token;
}

/**
 * Make an authenticated JSON request against a Google REST endpoint.
 * Throws with the API's structured error message on a non-2xx response.
 * @param {{accessToken:string, method:string, url:string, body?:any}} args
 * @returns {Promise<object>} parsed JSON response ({} for empty bodies)
 */
async function googleApiRequest({ accessToken, method, url, body }) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json; charset=UTF-8';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json && json.error && json.error.message ? json.error.message : text;
    throw new Error(`Google API ${method} ${res.status}: ${msg || '(no body)'}`);
  }
  return json;
}

module.exports = { getAccessToken, googleApiRequest };
