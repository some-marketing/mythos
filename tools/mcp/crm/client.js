'use strict';

const { buildUrl, requestJson } = require('../shared/http');

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 1000;

// Moxie HTTP client.
//
// READS (`get`) are enabled whenever not in dry-run. WRITES (`post`, added for
// the v1.1 write lane) are gated behind TWO independent switches and go live
// ONLY when both are open: `config.dryRun === false` AND
// `config.writeEnabled === true` (env CRM_WRITE_ENABLED, default false). In any
// other state `post` makes no network call — it returns an inert descriptor
// carrying the RELATIVE path only (never the full URL; the per-workspace base
// URL must not leak — see the pull.js redaction lesson). There is deliberately
// no write CLI runner: a live write requires intentional wiring plus per-call
// operator approval. See tools/mcp/crm/README.md ("Write lane").
//
// Auth: Moxie sends the API key as a custom header, `X-API-KEY` (confirmed
// from Moxie's own help center, 2026-06-30). Base URL is per-workspace and
// must be supplied via config — never assumed/hardcoded.
//
// `deps` is test-only dependency injection (transport + sleep) so retry/
// backoff behavior can be exercised offline with no real network or timers.
function createMoxieClient(config, deps = {}) {
  const transport = deps.requestJson || requestJson;
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxRetries = config.maxRetries !== undefined ? config.maxRetries : DEFAULT_MAX_RETRIES;
  const baseDelayMs = config.retryBaseDelayMs !== undefined ? config.retryBaseDelayMs : DEFAULT_BASE_DELAY_MS;

  function getBaseUrl() {
    if (!config.baseUrl) {
      throw new Error('MOXIE_BASE_URL is required (per-workspace; not publicly discoverable — see run-with-op.sh)');
    }
    return config.baseUrl.endsWith('/') ? config.baseUrl : `${config.baseUrl}/`;
  }

  // Sends one request via the transport, retrying on HTTP 429 with exponential
  // backoff (or a Retry-After header, if present) up to maxRetries. Shared by
  // get() and post() so both have identical rate-limit behavior.
  async function sendWithRetry(requestOptions) {
    let attempt = 0;
    for (;;) {
      try {
        const response = await transport(requestOptions);
        return response.data;
      } catch (error) {
        const status = error && error.response && error.response.status;
        if (status === 429 && attempt < maxRetries) {
          const backoffMs = retryDelayMs(error, attempt, baseDelayMs);
          attempt += 1;
          await sleep(backoffMs);
          continue;
        }
        throw error;
      }
    }
  }

  // GET. In dry-run returns a descriptor (with the full URL — reads are safe to
  // preview). Live reads require an api key.
  async function get(pathname, query = {}) {
    const url = buildUrl(getBaseUrl(), pathname, query);

    if (config.dryRun) {
      return {
        dry_run: true,
        method: 'GET',
        url: url.toString()
      };
    }

    if (!config.apiKey) {
      throw new Error('MOXIE_API_KEY is required when CRM_DRY_RUN=false');
    }

    return sendWithRetry({
      method: 'GET',
      url,
      headers: { 'X-API-KEY': config.apiKey }
    });
  }

  // POST (write lane, v1.1). Goes live ONLY when writes are fully enabled —
  // dry-run OFF and CRM_WRITE_ENABLED ON. In every other state it returns an
  // inert descriptor and makes no network call. The descriptor carries the
  // relative `path` only (never the full URL), mirroring the base-URL redaction
  // rule. Live writes require an api key and share get()'s 429 retry behavior.
  async function post(pathname, body = {}) {
    // Fail-safe write gate: go live ONLY when BOTH switches are set as OWN
    // properties AND STRICTLY the enabling booleans. Requiring own-ness (not
    // just `=== true/false`) closes prototype-inherited configs — e.g.
    // Object.create({ dryRun: false, writeEnabled: true }) — from reading as
    // live. Everything non-strict/non-own falls to the inert branch.
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const liveWrite = own(config, 'dryRun') && own(config, 'writeEnabled')
      && config.dryRun === false && config.writeEnabled === true;
    if (!liveWrite) {
      return {
        dry_run: true,
        method: 'POST',
        path: pathname,
        body
      };
    }

    if (!config.apiKey) {
      throw new Error('MOXIE_API_KEY is required when CRM_DRY_RUN=false');
    }

    const url = buildUrl(getBaseUrl(), pathname);
    return sendWithRetry({
      method: 'POST',
      url,
      headers: { 'X-API-KEY': config.apiKey },
      body
    });
  }

  return { get, post };
}

function retryDelayMs(error, attempt, baseDelayMs) {
  const headers = (error && error.response && error.response.headers) || {};
  const retryAfterHeader = headers['retry-after'] || headers['Retry-After'];
  if (retryAfterHeader !== undefined) {
    const retryAfterMs = Number(retryAfterHeader) * 1000;
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      return retryAfterMs;
    }
  }
  return baseDelayMs * Math.pow(2, attempt);
}

module.exports = {
  createMoxieClient,
  DEFAULT_MAX_RETRIES,
  DEFAULT_BASE_DELAY_MS
};
