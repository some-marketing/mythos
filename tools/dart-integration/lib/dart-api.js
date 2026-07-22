'use strict';

/**
 * dart-api.js
 * Standalone Node.js REST client for the Dart API.
 * No external dependencies — uses only Node.js built-ins.
 *
 * Token resolution is delegated to the shared credential resolver
 * (tools/lib/resolve-credential.cjs) — the same 4-source chain this module
 * used to implement directly (env → macOS Keychain → 1Password → env-file),
 * now factored out so every tool in this tree resolves secrets the same way.
 * See creds.config.json in this tool's directory for the declared DART_TOKEN
 * field (Keychain service/account, 1Password vault/item/field), and SETUP.md
 * for how to seed each source.
 *
 * Seed the headless Keychain source with:
 *   tools/boot/keychain-store.sh DART_TOKEN mythos
 */

const https = require('https');
const { verifyDartIdentity } = require('./identity');
const {
  resolveField,
  CredentialError,
} = require('../../lib/resolve-credential.cjs');

const BASE_URL = 'https://app.dartai.com/api/v0/public';
const DART_KEYCHAIN_SERVICE = 'DART_TOKEN';
const DART_KEYCHAIN_ACCOUNT = 'mythos';
const DART_OP_VAULT = 'Automation';
const DART_OP_ITEM = 'DART';
const DART_OP_FIELDS = Object.freeze(['DART_TOKEN', 'credential']);
const KEYCHAIN_VERIFY_COMMAND = `security find-generic-password -s "${DART_KEYCHAIN_SERVICE}" -a "${DART_KEYCHAIN_ACCOUNT}"`;
const KEYCHAIN_SEED_COMMAND = `tools/boot/keychain-store.sh ${DART_KEYCHAIN_SERVICE} ${DART_KEYCHAIN_ACCOUNT}`;

// The field config passed to resolveField() for every DART_TOKEN resolution.
// Mirrors creds.config.json's `fields.DART_TOKEN` — kept in sync by hand since
// this module needs it as a JS object, not JSON, at require-time.
const DART_TOKEN_FIELD_CONFIG = Object.freeze({
  keychainService: DART_KEYCHAIN_SERVICE,
  keychainAccount: DART_KEYCHAIN_ACCOUNT,
  opVault: DART_OP_VAULT,
  opItem: DART_OP_ITEM,
  opField: DART_OP_FIELDS,
});

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

let _cachedToken = null;
let _writeIdentityVerified = false;

class DartCredentialError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DartCredentialError';
    this.code = code;
    this.details = details;
  }
}

function createCredentialError(code, message, details = {}) {
  return new DartCredentialError(code, message, details);
}

/**
 * Resolve DART_TOKEN through the shared 4-source resolver chain (env → macOS
 * Keychain → 1Password → env-file), then adapt its result/error shape back to
 * this module's historical `{ token, source }` / `DartCredentialError`
 * contract so existing callers (getToken, probeAuthState, and
 * create-task-from-plan.js's handleTokenResolutionFailure) keep working
 * unchanged.
 * @param {{env?:Object, useCache?:boolean, runSecurity?:Function, runCommand?:Function, envFiles?:string[]}} [options]
 * @returns {{token: string, source: string}}
 */
function resolveToken(options = {}) {
  const env = options.env || process.env;
  const useCache = options.useCache !== false;
  if (useCache && _cachedToken) {
    return { token: _cachedToken, source: 'memory-cache' };
  }

  // Guard against an obviously-bogus env value (e.g. a stray `export DART_TOKEN=echo`
  // in the launching shell). A real Dart token is long and not a shell-builtin name.
  // If the env value is implausible, resolve as though it were unset so the
  // resolver falls through to Keychain rather than 401-looping on a bad token.
  const rawEnvToken = Object.prototype.hasOwnProperty.call(env, 'DART_TOKEN')
    ? String(env.DART_TOKEN || '').trim()
    : '';
  const envTokenLooksReal = rawEnvToken.length >= 20
    && !/^(echo|true|false|yes|no|null|undefined)$/i.test(rawEnvToken);
  const effectiveEnv = (rawEnvToken && !envTokenLooksReal)
    ? Object.fromEntries(Object.entries(env).filter(([key]) => key !== 'DART_TOKEN'))
    : env;

  let resolved;
  try {
    resolved = resolveField('DART_TOKEN', DART_TOKEN_FIELD_CONFIG, {
      ...options,
      env: effectiveEnv,
    });
  } catch (error) {
    if (error instanceof CredentialError) {
      // Re-throw as this module's historical DartCredentialError so
      // `e.name === 'DartCredentialError'` checks elsewhere keep working, and
      // point at the DART_TOKEN-specific Keychain seed command.
      const message = error.message.includes(KEYCHAIN_SEED_COMMAND)
        ? error.message
        : `${error.message} Seed the headless Keychain source via \`${KEYCHAIN_SEED_COMMAND}\`.`;
      throw createCredentialError(error.code, message, error.details);
    }
    throw error;
  }

  // Map the shared resolver's source vocabulary back onto this module's
  // historical names — 'onepassword-automation' rather than 'onepassword' —
  // since callers/logs have keyed off the exact string historically.
  const sourceMap = Object.freeze({
    onepassword: 'onepassword-automation',
  });

  return { token: resolved.value, source: sourceMap[resolved.source] || resolved.source };
}

async function probeAuthState(options = {}) {
  let resolved;
  try {
    resolved = resolveToken(options);
  } catch (error) {
    if (error instanceof DartCredentialError) {
      return {
        ok: false,
        state: error.code === 'DART_TOKEN_MISSING' ? 'missing' : 'unreadable',
        source: 'macos-keychain',
        error: error.message,
        code: error.code,
        details: error.details || {}
      };
    }
    throw error;
  }

  const requestFn = typeof options.requestConfig === 'function'
    ? options.requestConfig
    : getConfig;

  try {
    const config = await requestFn();
    return {
      ok: true,
      state: 'valid',
      source: resolved.source,
      token_source: resolved.source,
      config
    };
  } catch (error) {
    if (error && error.code === 'DART_TOKEN_INVALID') {
      return {
        ok: false,
        state: 'invalid',
        source: resolved.source,
        error: error.message,
        code: error.code
      };
    }
    throw error;
  }
}

/**
 * Reads the Dart API token from the configured resolver chain.
 * Cached in memory for the lifetime of the process.
 * @returns {string} The bearer token.
 */
function getToken() {
  if (_cachedToken) return _cachedToken;
  const resolved = resolveToken();
  _cachedToken = resolved.token;
  return _cachedToken;
}

// ---------------------------------------------------------------------------
// Core request handler
// ---------------------------------------------------------------------------

/**
 * Makes an HTTPS request to the Dart API.
 * Retries on 429 (rate limit) and 5xx errors up to 3 times.
 * Throws on 401/403 with a message about the token.
 *
 * @param {string} method   - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} endpoint - Path starting with / (e.g. '/config')
 * @param {Object} [payload] - Request body (will be JSON-encoded)
 * @returns {Promise<Object|null>} Parsed JSON response, or null for 204.
 */
function request(method, endpoint, payload) {
  return _requestWithRetry(method, endpoint, payload, 0);
}

/**
 * Refuses Dart mutations unless the configured token belongs to the Mythos user.
 * Read operations may still run with any operator-approved session.
 * @returns {Promise<void>}
 */
async function ensureWriteIdentity() {
  if (_writeIdentityVerified) return;
  const config = await request('GET', '/config');
  const result = verifyDartIdentity(config);
  if (!result.ok) {
    throw new Error('Refusing Dart write. ' + result.reason);
  }
  _writeIdentityVerified = true;
}

/**
 * Internal retry wrapper.
 * @param {string} method
 * @param {string} endpoint
 * @param {Object|undefined} payload
 * @param {number} attempt
 * @returns {Promise<Object|null>}
 */
function _requestWithRetry(method, endpoint, payload, attempt) {
  return new Promise(function(resolve, reject) {
    const token = getToken();
    const url = new URL(BASE_URL + endpoint);
    const body = payload ? JSON.stringify(payload) : null;

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };

    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(options, function(res) {
      let raw = '';
      res.on('data', function(chunk) { raw += chunk; });
      res.on('end', function() {
        const status = res.statusCode;

        // Auth errors — no retry
        if (status === 401 || status === 403) {
          return reject(createCredentialError(
            'DART_TOKEN_INVALID',
            'Dart API auth error (' + status + ') on ' + method + ' ' + endpoint +
            '. The configured token was read successfully but Dart rejected it.',
            { status, method, endpoint }
          ));
        }

        // Rate limit — retry with backoff
        if (status === 429) {
          if (attempt >= 3) {
            return reject(new Error('Dart API rate limit (429) after 3 retries on ' + method + ' ' + endpoint));
          }
          const delay = Math.pow(2, attempt) * 1000;
          setTimeout(function() {
            _requestWithRetry(method, endpoint, payload, attempt + 1).then(resolve, reject);
          }, delay);
          return;
        }

        // Server errors — retry
        if (status >= 500) {
          if (attempt >= 3) {
            return reject(new Error('Dart API server error (' + status + ') after 3 retries on ' + method + ' ' + endpoint));
          }
          const delay = Math.pow(2, attempt) * 500;
          setTimeout(function() {
            _requestWithRetry(method, endpoint, payload, attempt + 1).then(resolve, reject);
          }, delay);
          return;
        }

        // Other 4xx — fail immediately
        if (status >= 400) {
          return reject(new Error('Dart API error (' + status + ') on ' + method + ' ' + endpoint + ': ' + raw));
        }

        // Success
        if (!raw || status === 204) return resolve(null);
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error('Dart API: failed to parse JSON response from ' + method + ' ' + endpoint));
        }
      });
    });

    req.on('error', function(e) {
      reject(new Error('Dart API request error on ' + method + ' ' + endpoint + ': ' + e.message));
    });

    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

/**
 * GET /config — returns workspace config (dartboards, statuses, assignees, tags).
 * @returns {Promise<Object>}
 */
function getConfig() {
  return request('GET', '/config');
}

/**
 * GET /tasks/list — list tasks with optional filters.
 * @param {string} dartboard  - Dartboard name (e.g. 'Landing Pad/Tasks')
 * @param {Object} [opts]
 * @param {boolean} [opts.is_completed=false]
 * @param {number}  [opts.limit=50]
 * @param {number}  [opts.offset] - Pagination offset (confirmed live Dart API
 *   contract — see `/tasks/list` offset-based paging used by
 *   `dart-api.js request()` callers historically, e.g.
 *   `_dev/archive/2026-05/analysis/dart-board-inventory__20260506T2102Z.md`:
 *   "Pagination resolved (offset-based via `dart-api.js request()`)"). Forward
 *   it verbatim so a second/third page request is genuinely distinct from
 *   page 1 — this was previously silently dropped, making every "next page"
 *   request from a caller like `findExistingParent` identical to page 1.
 * @param {string}  [opts.assignee] - Filter by assignee name
 * @param {string}  [opts.status] - Filter by status
 * @param {string}  [opts.type] - Filter by task type
 * @returns {Promise<Object>}
 */
function listTasks(dartboard, opts) {
  const params = new URLSearchParams();
  if (dartboard) params.set('dartboard', dartboard);
  // Disable workspace defaults so we get all tasks, not just filtered views
  params.set('no_defaults', 'true');
  const o = opts || {};
  if (o.is_completed !== undefined) params.set('is_completed', String(o.is_completed));
  if (o.limit !== undefined) params.set('limit', String(o.limit));
  if (o.offset !== undefined) params.set('offset', String(o.offset));
  if (o.assignee) params.set('assignee', o.assignee);
  if (o.status) params.set('status', o.status);
  if (o.type) params.set('type', o.type);
  const qs = params.toString();
  return request('GET', '/tasks/list' + (qs ? '?' + qs : ''));
}

/**
 * GET /tasks/<id> — get a single task by ID.
 * @param {string} id
 * @returns {Promise<Object>}
 */
function getTask(id) {
  return request('GET', '/tasks/' + id);
}

/**
 * POST /tasks — create a new task.
 * @param {Object} item - Task fields (title, dartboard, status, assignee, tags, etc.)
 * @returns {Promise<Object>}
 */
async function createTask(item) {
  await ensureWriteIdentity();
  return request('POST', '/tasks', { item: item });
}

/**
 * PUT /tasks/<id> — update an existing task.
 * The id must also be present in the item object.
 * @param {string} id
 * @param {Object} item - Updated task fields (must include id)
 * @returns {Promise<Object>}
 */
async function updateTask(id, item) {
  await ensureWriteIdentity();
  return request('PUT', '/tasks/' + id, { item: item });
}

/**
 * DELETE /tasks/<id> — delete a task.
 * @param {string} id
 * @returns {Promise<null>}
 */
async function deleteTask(id) {
  await ensureWriteIdentity();
  return request('DELETE', '/tasks/' + id);
}

/**
 * POST /comments — add a comment to a task.
 * @param {string} taskId
 * @param {string} text
 * @returns {Promise<Object>}
 */
async function addComment(taskId, text) {
  await ensureWriteIdentity();
  return request('POST', '/comments', { item: { taskId: taskId, text: text } });
}

/**
 * GET /comments/list — list comments for a task.
 * @param {string} taskId
 * @returns {Promise<Object>}
 */
function listComments(taskId) {
  const params = new URLSearchParams();
  params.set('task_id', taskId);
  params.set('no_defaults', 'true');
  return request('GET', '/comments/list?' + params.toString());
}

// ---------------------------------------------------------------------------
// B1 (plan-approval-surface) — comment AUTHOR identity surface.
//
// The plan-approval gate must prove a cited approval comment was authored by the
// operator's Dart identity, NOT by the Mythos agent's Dart identity. listComments
// returns the raw Dart payload but does not normalize the author duid/name/email,
// so the verifier (tools/planning/lib/operator-approval-verify.js) could not
// confirm authorship. These helpers surface a stable, author-bearing shape.
//
// PURE normalization helpers (extractCommentList / normalizeComment) are exported
// so the verifier + unit tests can exercise authorship logic with NO live Dart.
// ---------------------------------------------------------------------------

/**
 * Normalize the various shapes the Dart comments payload can take into a plain
 * array of raw comment objects. Pure — no I/O. Tolerant of { results: [] }
 * (the live /comments/list shape, per tools/dart-integration/inbox.js),
 * { comments: [] }, { items: [] }, or a bare array.
 *
 * @param {*} response
 * @returns {Array<Object>}
 */
function extractCommentList(response) {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  if (Array.isArray(response.results)) return response.results;
  if (Array.isArray(response.comments)) return response.comments;
  if (Array.isArray(response.items)) return response.items;
  return [];
}

function _firstString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Normalize one raw Dart comment into a stable author-bearing shape. Pure.
 * The Dart public API has shipped the author under several field names over
 * time (author as a string name, or an object, or authorDuid/author_duid);
 * this reads all of them so the verifier can match the operator identity by
 * whichever field is present (duid preferred, then email, then name).
 *
 * @param {Object} raw
 * @returns {{commentId:string|null, authorDuid:string|null, authorName:string|null, authorEmail:string|null, text:string, createdAt:string|null, raw:Object}|null}
 */
function normalizeComment(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const authorObj = raw.author && typeof raw.author === 'object' ? raw.author : null;
  const userObj = raw.user && typeof raw.user === 'object' ? raw.user : null;

  const authorDuid = _firstString(
    raw.authorDuid, raw.author_duid, raw.authorId, raw.author_id,
    authorObj && (authorObj.duid || authorObj.id),
    userObj && (userObj.duid || userObj.id)
  );
  const authorName = _firstString(
    typeof raw.author === 'string' ? raw.author : null,
    raw.authorName, raw.author_name,
    authorObj && authorObj.name,
    typeof raw.user === 'string' ? raw.user : null,
    userObj && userObj.name
  );
  const authorEmail = _firstString(
    raw.authorEmail, raw.author_email,
    authorObj && authorObj.email,
    userObj && userObj.email
  );

  return {
    commentId: _firstString(raw.id, raw.duid, raw.commentId, raw.comment_id),
    authorDuid: authorDuid || null,
    authorName: authorName || null,
    authorEmail: authorEmail || null,
    text: _firstString(raw.text, raw.message, raw.body) || '',
    createdAt: _firstString(raw.createdAt, raw.created_at, raw.published, raw.publishedAt) || null,
    raw: raw
  };
}

/**
 * B1: list a task's comments with author identity surfaced (normalized).
 * @param {string} taskId
 * @param {{listComments?:Function}} [opts] - inject a lister for unit tests (no network).
 * @returns {Promise<Array<Object>>}
 */
async function listCommentAuthors(taskId, opts = {}) {
  const lister = (opts && opts.listComments) || listComments;
  const resp = await lister(taskId);
  return extractCommentList(resp).map(normalizeComment).filter(Boolean);
}

/**
 * B1: resolve a single comment's normalized author identity by comment id.
 * Returns null when the cited comment is not present on the task (a forged
 * operator_stamp pointing at a non-existent comment must therefore FAIL verify).
 * @param {string} taskId
 * @param {string} commentId
 * @param {{listComments?:Function}} [opts] - inject a lister for unit tests (no network).
 * @returns {Promise<Object|null>}
 */
async function getCommentAuthor(taskId, commentId, opts = {}) {
  const list = await listCommentAuthors(taskId, opts);
  const id = String(commentId);
  return list.find((c) => String(c.commentId) === id) || null;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  DartCredentialError,
  DART_KEYCHAIN_ACCOUNT,
  DART_KEYCHAIN_SERVICE,
  DART_OP_FIELDS,
  DART_OP_ITEM,
  DART_OP_VAULT,
  DART_TOKEN_FIELD_CONFIG,
  KEYCHAIN_VERIFY_COMMAND,
  KEYCHAIN_SEED_COMMAND,
  createCredentialError,
  getToken,
  ensureWriteIdentity,
  probeAuthState,
  request,
  resolveToken,
  getConfig,
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  addComment,
  listComments,
  // B1 (plan-approval-surface) — comment author identity surface.
  extractCommentList,
  normalizeComment,
  listCommentAuthors,
  getCommentAuthor,
};

// ---------------------------------------------------------------------------
// Self-test (node lib/dart-api.js)
// ---------------------------------------------------------------------------

if (require.main === module) {
  (async function() {
    console.log('--- Dart API self-test ---\n');

    // 1. Load token
    console.log('Loading token from Keychain...');
    const token = getToken();
    console.log('Token loaded (' + token.length + ' chars)\n');

    // 2. Get workspace config
    console.log('Fetching /config...');
    const config = await getConfig();
    const dartboards = (config && config.dartboards) ? config.dartboards : [];
    console.log('Dartboards (' + dartboards.length + '):');
    dartboards.forEach(function(db) { console.log('  - ' + db); });
    console.log();

    // 3. List Landing Pad tasks
    const landingPad = 'Landing Pad/Tasks';
    console.log('Listing tasks on "' + landingPad + '"...');
    const result = await listTasks(landingPad, { is_completed: false, limit: 20 });
    const tasks = (result && result.results) ? result.results : (Array.isArray(result) ? result : []);
    console.log('Tasks (' + tasks.length + '):');
    tasks.forEach(function(t) {
      console.log('  [' + (t.status || '?') + '] ' + t.title + ' (' + t.id + ')');
    });

    console.log('\n--- done ---');
  })().catch(function(err) {
    console.error('Self-test failed:', err.message);
    process.exit(1);
  });
}
