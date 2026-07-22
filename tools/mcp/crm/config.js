'use strict';

const path = require('path');
const { getBooleanEnv, getEnv, getNumberEnv, loadLocalEnv } = require('../shared/env');
const { resolveCredentialsFromFile } = require('../../lib/resolve-credential.cjs');

const CREDS_CONFIG_PATH = path.join(__dirname, 'creds.config.json');

// CRM lane config. Provider-pluggable: today only `moxie` config is
// populated, but the shape leaves room for a sibling block (e.g. `honeybook`)
// without touching the resolution logic below.
//
// Rate limit (Moxie, confirmed from Moxie's own help center, 2026-06-30):
// 100 requests / 5 minutes per workspace, HTTP 429 on excess. Defaults here
// match that; overridable for other providers or if Moxie's limit changes.
function loadCrmConfig() {
  loadLocalEnv();

  // Secret fields resolve through the shared 4-source chain (env -> macOS
  // Keychain -> 1Password -> env file) per creds.config.json.
  const creds = resolveCredentialsFromFile(CREDS_CONFIG_PATH);

  return {
    provider: getEnv('CRM_PROVIDER', { defaultValue: 'moxie' }),
    dryRun: getBooleanEnv('CRM_DRY_RUN', true),
    // Second, independent gate for the write lane (v1.1). A live POST requires
    // BOTH dryRun===false AND writeEnabled===true. Defaults false so writes are
    // inert unless deliberately enabled. Thread this into the client config
    // alongside dryRun wherever a write-capable client is constructed.
    writeEnabled: getBooleanEnv('CRM_WRITE_ENABLED', false),
    moxie: {
      baseUrl: normalizeBaseUrl(creds.MOXIE_BASE_URL),
      apiKey: creds.MOXIE_API_KEY,
      rateLimit: {
        maxRequests: getNumberEnv('MOXIE_RATE_LIMIT_MAX_REQUESTS', 100),
        windowMs: getNumberEnv('MOXIE_RATE_LIMIT_WINDOW_MS', 5 * 60 * 1000)
      },
      // Retry/backoff on HTTP 429 (rate-limit exceeded). See client.js.
      maxRetries: getNumberEnv('MOXIE_MAX_RETRIES', 5),
      retryBaseDelayMs: getNumberEnv('MOXIE_RETRY_BASE_DELAY_MS', 1000)
    }
  };
}

// The 1Password item stores the per-workspace base URL without a scheme
// (confirmed at the 2026-07-08 live wiring: "podNN.withmoxie.dev/api/public/").
// The HTTP client needs an absolute URL, and Moxie is HTTPS-only, so default
// a scheme-less value to https://. An explicit scheme is left untouched.
function normalizeBaseUrl(value) {
  if (!value) return value;
  // The live 1P field was observed (2026-07-08) to carry a leading space —
  // pasted values are hostile input; whitespace is never legitimate in a URL.
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

module.exports = {
  loadCrmConfig,
  normalizeBaseUrl
};
