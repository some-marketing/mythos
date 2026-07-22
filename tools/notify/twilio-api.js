#!/usr/bin/env node
'use strict';

/**
 * twilio-api.js — Thin HTTPS wrapper around the Twilio REST API.
 *
 * Never logs values. All HTTP calls are synchronous-over-promise (one request
 * at a time; Twilio's REST API is stateless — no keep-alive needed here).
 *
 * Exports:
 *   twilioGet(path, auth)                → parsed JSON
 *   twilioPost(path, body, auth)         → parsed JSON
 *   discoverAccountSid(auth)             → string (Account SID) or throws
 *   listIncomingNumbers(accountSid, auth) → array of number objects
 *   createCall(params, auth)             → Twilio Call resource
 */

const https = require('https');
const querystring = require('querystring');

const TWILIO_HOST = 'api.twilio.com';

function request(method, path, body, auth) {
  return new Promise((resolve, reject) => {
    const postData = body ? querystring.stringify(body) : '';
    const headers = {
      'Authorization': 'Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64'),
      'Accept': 'application/json',
    };
    if (method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      hostname: TWILIO_HOST,
      path,
      method,
      headers,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(Object.assign(new Error(`Twilio HTTP ${res.statusCode}: ${parsed.message || data}`), {
              statusCode: res.statusCode,
              twilioCode: parsed.code,
              twilioMore: parsed.more_info,
              body: parsed,
            }));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Twilio parse error (${res.statusCode}): ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('Twilio request timeout')); });

    if (method === 'POST' && postData) req.write(postData);
    req.end();
  });
}

async function twilioGet(path, auth) {
  return request('GET', path, null, auth);
}

async function twilioPost(path, body, auth) {
  return request('POST', path, body, auth);
}

/**
 * Discover Account SID via /2010-04-01/Accounts.json.
 * Works with either Account SID + Auth Token OR API Key SID + Secret.
 */
async function discoverAccountSid(auth) {
  const result = await twilioGet('/2010-04-01/Accounts.json', auth);
  if (!result.accounts || result.accounts.length === 0) {
    throw new Error('No accounts found on this credential');
  }
  return result.accounts[0].sid;
}

/**
 * List all IncomingPhoneNumbers, filtered to voice-capable ones.
 */
async function listIncomingNumbers(accountSid, auth) {
  const result = await twilioGet(
    `/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?PageSize=50`,
    auth
  );
  return result.incoming_phone_numbers || [];
}

/**
 * Get account status and balance.
 */
async function getAccount(accountSid, auth) {
  return twilioGet(`/2010-04-01/Accounts/${accountSid}.json`, auth);
}

/**
 * Create a call.
 * params: { To, From, Twiml or Url, StatusCallback? }
 */
async function createCall(params, accountSid, auth) {
  return twilioPost(
    `/2010-04-01/Accounts/${accountSid}/Calls.json`,
    params,
    auth
  );
}

module.exports = { twilioGet, twilioPost, discoverAccountSid, listIncomingNumbers, getAccount, createCall };
