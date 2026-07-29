#!/usr/bin/env node
'use strict';

/**
 * twilio-creds.js — Runtime credential resolver for Twilio.
 *
 * Delegates every field to the shared BYO-credential resolver
 * (tools/lib/resolve-credential.cjs) via this directory's creds.config.json,
 * so Twilio secrets follow the same 4-source chain (env -> macOS Keychain ->
 * 1Password -> env-file) as every other tool in this tree.
 *
 * Returns an object:
 *   {
 *     accountSid:       string | null,
 *     authToken:        string | null,
 *     apiKeySid:        string | null,   // SK... prefix — alternative auth
 *     apiKeySecret:     string | null,
 *     fromNumber:       string | null,   // your Twilio phone number (E.164)
 *     operatorPhone:    string | null,   // your personal number (E.164) — NEVER hardcoded in files
 *   }
 *
 * NEVER log or echo values. Callers must pass via env to child processes,
 * never in argv.
 *
 * If Account SID is missing but API Key SID + secret exist, the caller should
 * use /2010-04-01/Accounts.json (HTTP Basic: apiKeySid:apiKeySecret) to
 * discover the Account SID at runtime.
 */

const path = require('path');
const { resolveCredentialsFromFile } = require('../lib/resolve-credential.cjs');

const CONFIG_PATH = path.join(__dirname, 'creds.config.json');

// Internal shorthand key -> creds.config.json field name.
const FIELD_MAP = {
  accountSid: 'TWILIO_ACCOUNT_SID',
  authToken: 'TWILIO_AUTH_TOKEN',
  apiKeySid: 'TWILIO_API_KEY_SID',
  apiKeySecret: 'TWILIO_API_KEY_SECRET',
  fromNumber: 'TWILIO_FROM_NUMBER',
  operatorPhone: 'TWILIO_OPERATOR_PHONE',
};

/**
 * Resolve all Twilio credential fields. Every field is declared optional in
 * creds.config.json (and resolved with `optional` here as a defensive
 * second layer) because Twilio accepts either an Account SID + Auth Token
 * pair OR an API Key SID + Secret pair — buildAuth() below decides which
 * combination, if any, is usable. A field simply resolves to null if none
 * of the four sources have it.
 */
function resolveCreds(options = {}) {
  const resolved = resolveCredentialsFromFile(CONFIG_PATH, {
    ...options,
    optional: Object.values(FIELD_MAP),
  });
  const creds = {};
  for (const [shorthand, field] of Object.entries(FIELD_MAP)) {
    creds[shorthand] = resolved[field] || null;
  }
  return creds;
}

/**
 * Build HTTP Basic auth header. Prefers Account SID + Auth Token; falls back
 * to Account SID + API Key Secret (with apiKeySid as username for Twilio
 * "API key" auth pair), or API Key SID + secret (no Account SID, for /Accounts
 * discovery).
 *
 * Returns { username, password, accountSid } — accountSid may be null if
 * unknown (caller should discover via /Accounts.json).
 */
function buildAuth(creds) {
  if (creds.accountSid && creds.authToken) {
    return { username: creds.accountSid, password: creds.authToken, accountSid: creds.accountSid, method: 'account+authtoken' };
  }
  if (creds.accountSid && creds.apiKeySid && creds.apiKeySecret) {
    return { username: creds.apiKeySid, password: creds.apiKeySecret, accountSid: creds.accountSid, method: 'account+apikey' };
  }
  if (creds.apiKeySid && creds.apiKeySecret) {
    // No Account SID yet — use API Key pair; caller must discover Account SID
    return { username: creds.apiKeySid, password: creds.apiKeySecret, accountSid: null, method: 'apikey-only' };
  }
  return null;
}

module.exports = { resolveCreds, buildAuth };
