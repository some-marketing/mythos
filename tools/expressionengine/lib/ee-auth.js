'use strict';

/**
 * ee-auth.js — EE CP credential resolver + CP login session manager.
 *
 * S2: Credential resolution (env → 1Password → error)
 * S3: CP login (POST credentials → capture session cookie → GET entry-edit page
 *     → extract XID token)
 *
 * Resolution order for credentials:
 *   1. Env vars EE_URL, EE_USERNAME, EE_PASSWORD (CI / operator override)
 *   2. 1Password via service-account token (OP_SERVICE_ACCOUNT_TOKEN env OR macOS Keychain:
 *      service=op-service-account-automation, account=mythos) with HOME-isolation so the
 *      desktop op-daemon is bypassed — same pattern as tools/notify/twilio-creds.js.
 *   3. 1Password via ambient op session (desktop-app auth already active) — no token
 *      required; uses the operator's interactive `op` session as-is. This path is tried
 *      only when no service-account token is available.
 *   4. Clear error with actionable message if all paths fail.
 *
 * CREDENTIAL DISCIPLINE — HARD RULES:
 *   - The password is NEVER written to stdout, stderr, any log file, any env-export,
 *     or any disk file. It lives only as a JavaScript object property in process memory.
 *   - resolveEECreds() returns { url, username, password }. Callers MUST NOT log
 *     or serialize the password field. The README documents this prohibition.
 *   - The session cookie returned by login() is held only in process memory for the
 *     tool's lifetime. It is never persisted to disk.
 *
 * No external npm dependencies — Node.js built-ins only.
 */

const https   = require('https');
const http    = require('http');
const { execSync } = require('child_process');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const { URL } = require('url');

// ─── 1Password config ────────────────────────────────────────────────────────
const OP_ITEM    = 'EE CP - <your-site-nickname>';
// OP_VAULT is intentionally NOT used in op item get calls — the item is resolved
// by name across all vaults the authenticated session can see (it lives in "Personal",
// not "Employee"). Passing --vault would cause the lookup to fail on any session that
// can't see the named vault, including service-account tokens scoped to other vaults.
const OP_TIMEOUT = 20000; // ms

// ─── field label patterns for 1Password item ─────────────────────────────────
// EE 1P items tend to use varied label casing; match case-insensitively.
const LABEL_PATTERNS = {
  url:      /^(url|website|site\s*url|cp\s*url|admin\s*url)$/i,
  username: /^(username|user|login|email)$/i,
  password: /^(password|pass|secret|credential)$/i,
};

// ─── Resolve op service-account token (same pattern as twilio-creds.js) ──────
function resolveOpServiceToken() {
  if (process.env.OP_SERVICE_ACCOUNT_TOKEN) return process.env.OP_SERVICE_ACCOUNT_TOKEN;
  const acct = 'mythos';
  const candidates = [
    'op-service-account-automation',
    'op-service-account-sam',
    'op-service-account',
  ];
  for (const svc of candidates) {
    try {
      const t = execSync(
        `security find-generic-password -w -s ${svc} -a ${acct}`,
        { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
      if (t) return t;
    } catch {
      // try next candidate
    }
  }
  return null;
}

// ─── Fetch 1Password item fields ─────────────────────────────────────────────

/**
 * Fetch the 1Password item using a service-account token (with HOME isolation).
 * Returns { fields, urls } on success, null on any failure.
 * Only called when a service-account token is actually available.
 *
 * --reveal is required so that concealed fields (password) are returned with
 * their values rather than being redacted. The value travels op → subprocess
 * pipe → process memory only — never to stdout/stderr/logs/disk.
 */
function opGetWithToken(token) {
  let cleanHome = null;
  // Isolate from desktop-app CLI integration. A service-account token alongside
  // a configured desktop account + op-daemon socket causes `op` to hang waiting
  // for desktop approval. Pointing HOME at an empty dir removes the desktop
  // config so op uses ONLY the service-account token. (Pattern from twilio-creds.js)
  try { cleanHome = fs.mkdtempSync(path.join(os.tmpdir(), 'op-sa-')); } catch { cleanHome = null; }
  const env = Object.assign({}, process.env, { OP_SERVICE_ACCOUNT_TOKEN: token });
  if (cleanHome) env.HOME = cleanHome;

  try {
    // No --vault flag: resolve by item name across all vaults the token can see.
    // --reveal: return concealed field values (password) rather than redacting them.
    const raw = execSync(
      `op item get "${OP_ITEM}" --format json --reveal`,
      { encoding: 'utf8', timeout: OP_TIMEOUT, stdio: ['pipe', 'pipe', 'ignore'], env }
    );
    const item = JSON.parse(raw);
    return { fields: item.fields || [], urls: item.urls || [] };
  } catch {
    return null;
  } finally {
    if (cleanHome) {
      try { fs.rmSync(cleanHome, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

/**
 * Fetch the 1Password item using the ambient desktop op session (no token needed).
 * Used as a fallback when no service-account token is available. Does NOT apply
 * HOME isolation — it relies on the operator's existing interactive op session.
 * Returns { fields, urls } on success, null on any failure (not signed in, timeout, etc).
 *
 * --reveal: return concealed field values (password) rather than redacting them.
 * The value travels op → subprocess pipe → process memory only.
 */
function opGetAmbient() {
  try {
    // No --vault flag: resolve by item name across all vaults the desktop session can see.
    // --reveal: return concealed field values (password) rather than redacting them.
    const raw = execSync(
      `op item get "${OP_ITEM}" --format json --reveal`,
      { encoding: 'utf8', timeout: OP_TIMEOUT, stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const item = JSON.parse(raw);
    return { fields: item.fields || [], urls: item.urls || [] };
  } catch {
    return null; // op not signed in, timed out, item not found
  }
}

function matchField(fields, pattern) {
  if (!fields) return null;
  const f = fields.find(f => f.label && pattern.test(f.label) && f.value);
  return f ? f.value : null;
}

// ─── S2: Credential resolver ──────────────────────────────────────────────────

/**
 * Resolve EE CP credentials.
 * Returns { url, username, password, _source } — all strings.
 * Throws with a clear message if password cannot be resolved.
 *
 * Resolution order:
 *   1. Env vars EE_URL + EE_USERNAME + EE_PASSWORD (all three required)
 *   2. 1Password via service-account token (Keychain or OP_SERVICE_ACCOUNT_TOKEN env)
 *      with HOME isolation — used only when a token is actually available.
 *   3. 1Password via ambient op desktop session — no token required; relies on the
 *      operator's existing interactive op auth. Only tried when step 2 has no token.
 *   4. Error with actionable hints.
 *
 * CALLER RULE: never log or serialize the returned password field.
 *
 * @param {object} [_inject] — optional test seam: { resolveToken, getWithToken, getAmbient }
 *   Each is a function that replaces the corresponding internal step.
 *   Not part of the public API — only for unit tests.
 */
function resolveEECreds(_inject) {
  const _resolveToken  = (_inject && _inject.resolveToken)  || resolveOpServiceToken;
  const _getWithToken  = (_inject && _inject.getWithToken)  || opGetWithToken;
  const _getAmbient    = (_inject && _inject.getAmbient)    || opGetAmbient;

  // 1. Env override (CI / operator) — all three must be set to take this path
  const envUrl      = process.env.EE_URL      || null;
  const envUsername = process.env.EE_USERNAME  || null;
  const envPassword = process.env.EE_PASSWORD  || null;

  if (envUrl && envUsername && envPassword) {
    return { url: envUrl, username: envUsername, password: envPassword, _source: 'env' };
  }

  // ── URL resolver: env override → item.urls primary href → null ──────────────
  //
  // The CP URL lives in the item's top-level .urls array (not in .fields).
  // We take the first entry whose href starts with https, then normalise away any
  // stale `return=...` or other query parameters that EE sometimes appends in the
  // stored URL — keeping only the base path up to and including `?/cp/login` (or
  // just the pathname if no CP suffix is present).
  function resolveUrlFromItem(urls) {
    if (envUrl) return envUrl;
    if (!urls || !urls.length) return null;
    // Prefer the primary (href) of the first https entry; fall back to any entry
    const entry = urls.find(u => u.href && u.href.startsWith('https://'))
                || urls.find(u => u.href);
    if (!entry || !entry.href) return null;
    const raw = entry.href;
    // Normalise: strip query params that are not the EE CP routing suffix.
    // EE CP routing is encoded as `?/cp/...` — preserve that suffix if present,
    // otherwise strip all query params (they may be stale return/redirect values).
    try {
      const u = new URL(raw);
      if (u.search && u.search.startsWith('?/cp/')) {
        // Keep only the first segment: ?/cp/login (not deeper paths or extra params)
        const cpSuffix = u.search.split('&')[0]; // e.g. ?/cp/login
        return `${u.protocol}//${u.host}${u.pathname}${cpSuffix}`;
      }
      // No CP routing suffix — return just origin + pathname (drop all query params)
      return `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
      return raw; // unparsable — use as-is
    }
  }

  // Helper: extract url/username/password from an op item result object.
  // item = { fields: [...], urls: [...] } as returned by opGetWithToken/opGetAmbient.
  function extractFromItem(item, source) {
    const { fields, urls } = item;
    const url      = resolveUrlFromItem(urls);
    const username = envUsername || matchField(fields, LABEL_PATTERNS.username) || null;
    const password = envPassword || matchField(fields, LABEL_PATTERNS.password) || null;
    if (!password) return null;
    if (!url)      throw new Error('EE CP URL not found in env or 1Password .urls. Set EE_URL or add a URL to the 1Password item.');
    if (!username) throw new Error('EE CP username not found in env or 1Password. Set EE_USERNAME or add a "username" field to the 1Password item.');
    return { url, username, password, _source: source };
  }

  // 2. 1Password via service-account token (with HOME isolation).
  //    ANY failure (null return OR throw) cascades to step 3 — do not propagate.
  const token = _resolveToken();
  if (token) {
    let item = null;
    try {
      item = _getWithToken(token);
    } catch {
      // Token path failed (e.g. vault access denied) — fall through to ambient.
    }
    if (item) {
      const creds = extractFromItem(item, '1password-service-account');
      if (creds) return creds;
    }
    // item null/empty or no password extracted — fall through to ambient.
  }

  // 3. 1Password via ambient desktop op session (no token required).
  //    Tried unconditionally: both when no token was found AND when the token
  //    path found a token but failed to retrieve the item (e.g. vault not in scope).
  let ambientItem = null;
  try {
    ambientItem = _getAmbient();
  } catch {
    // ambient op not available — fall through to error.
  }
  if (ambientItem) {
    const creds = extractFromItem(ambientItem, '1password-ambient');
    if (creds) return creds;
  }

  // 4. All paths exhausted — print hints to stderr then throw.
  const hints = [
    'Set EE_URL + EE_USERNAME + EE_PASSWORD env vars, OR',
    `Ensure the 1Password item "${OP_ITEM}" has url/username/password fields and is accessible via:`,
    `  a) a service-account token (op-service-account-automation in Keychain), OR`,
    `  b) the desktop op app signed in (run: op item get "${OP_ITEM}" --format json)`,
  ];
  const msg = `EE CP credentials could not be resolved.\n${hints.join('\n')}`;
  process.stderr.write(msg + '\n');
  throw new Error(msg);
}

// ─── S3: CP login + session cookie + XID extraction ──────────────────────────

// ─── Cookie jar (Domain/Path/Secure/expiry-aware) ────────────────────────────

/**
 * Parse a single Set-Cookie header string into a structured cookie object.
 * Returns null if the header is malformed or has no name.
 */
function parseSetCookieHeader(hdr, requestUrl) {
  const parts  = hdr.split(';').map(s => s.trim());
  const pair   = parts[0];
  const eqIdx  = pair.indexOf('=');
  if (eqIdx <= 0) return null;

  const name  = pair.slice(0, eqIdx).trim();
  const value = pair.slice(eqIdx + 1).trim();
  if (!name) return null;

  const cookie = { name, value, domain: null, path: '/', secure: false, expires: null };

  for (let i = 1; i < parts.length; i++) {
    const attr   = parts[i];
    const attrEq = attr.indexOf('=');
    const aKey   = (attrEq >= 0 ? attr.slice(0, attrEq) : attr).trim().toLowerCase();
    const aVal   = attrEq >= 0 ? attr.slice(attrEq + 1).trim() : '';

    if (aKey === 'domain') {
      // Strip leading dot per RFC 6265
      cookie.domain = aVal.replace(/^\./, '').toLowerCase();
    } else if (aKey === 'path') {
      cookie.path = aVal || '/';
    } else if (aKey === 'secure') {
      cookie.secure = true;
    } else if (aKey === 'expires') {
      try { cookie.expires = new Date(aVal); } catch { /* ignore bad dates */ }
    } else if (aKey === 'max-age') {
      const maxAge = parseInt(aVal, 10);
      if (!isNaN(maxAge)) {
        if (maxAge <= 0) {
          // Max-Age=0 means delete the cookie
          cookie.expires = new Date(0);
        } else {
          cookie.expires = new Date(Date.now() + maxAge * 1000);
        }
      }
    }
  }

  // Default domain to the request host when no Domain attribute is present
  if (!cookie.domain && requestUrl) {
    try { cookie.domain = new URL(requestUrl).hostname.toLowerCase(); } catch { /* ignore */ }
  }

  return cookie;
}

/**
 * Store a parsed cookie into the jar.
 * The jar is a Map keyed by "domain|path|name" for scope uniqueness.
 * Expired cookies (Max-Age=0 or past Expires) are removed from the jar.
 */
function storeCookie(jar, cookie) {
  const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
  if (cookie.expires && cookie.expires.getTime() <= Date.now()) {
    jar.delete(key); // deletion semantics
  } else {
    jar.set(key, cookie);
  }
}

/**
 * Select cookies from the jar that match a given request URL.
 * Implements Domain suffix match, Path prefix match, and Secure flag.
 *
 * Path matching follows RFC 6265 §5.1.4: a cookie path matches a request path
 * when the cookie path is a prefix of the request path, where "prefix" means:
 *   - exact match, OR
 *   - request path starts with cookie path + "/" (handles cookie Path=/foo matching /foo/bar)
 *   - special case: cookie Path="/" always matches (the "/" case skips the "/" + "/" check)
 *
 * Note: a cookie with Path=/admin.php/ (trailing slash) must still match
 * a request to /admin.php — handled by stripping a trailing slash from cookie.path
 * before the prefix check (EE sometimes issues cookies with Path=/admin.php/).
 */
function selectCookies(jar, requestUrl) {
  let reqHost, reqPath, reqSecure;
  try {
    const u  = new URL(requestUrl);
    reqHost  = u.hostname.toLowerCase();
    reqPath  = u.pathname || '/';
    reqSecure = u.protocol === 'https:';
  } catch {
    return [];
  }

  const now     = Date.now();
  const matched = [];

  for (const cookie of jar.values()) {
    // Expiry check
    if (cookie.expires && cookie.expires.getTime() <= now) continue;
    // Secure flag: only send over HTTPS
    if (cookie.secure && !reqSecure) continue;
    // Domain match: exact or suffix (cookie.domain is a suffix of reqHost)
    const domainOk = reqHost === cookie.domain ||
                     reqHost.endsWith('.' + cookie.domain);
    if (!domainOk) continue;
    // Path match: RFC 6265 §5.1.4 prefix semantics.
    //   - Exact match: reqPath === cookie.path
    //   - cookie.path ends with "/": reqPath starts with cookie.path
    //     (covers Path=/ matching /admin.php, and Path=/admin.php/ matching /admin.php)
    //   - cookie.path does NOT end with "/": reqPath starts with cookie.path + "/"
    //     (covers Path=/admin.php matching /admin.php/subpath but NOT /admin-other.php)
    //
    // The trailing-slash variant (EE may issue Path=/admin.php/) is handled by the
    // second branch: "/admin.php".startsWith("/admin.php/") = false, BUT we also
    // strip the trailing slash and check reqPath === normalised cookie path so that
    // Path=/admin.php/ matches the exact /admin.php request path.
    const cPathNorm = (cookie.path.length > 1 && cookie.path.endsWith('/'))
      ? cookie.path.slice(0, -1)   // /admin.php/ → /admin.php for exact-match check
      : cookie.path;
    const pathOk = reqPath === cookie.path ||
                   reqPath === cPathNorm ||
                   (cookie.path.endsWith('/') ? reqPath.startsWith(cookie.path) : reqPath.startsWith(cookie.path + '/'));
    if (!pathOk) continue;
    matched.push(cookie);
  }

  return matched;
}

/**
 * Build a Cookie header string from matched cookies.
 */
function buildCookieHeader(cookies) {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

/**
 * Derive the full request URL string from request options.
 */
function optsToUrl(options) {
  const proto = options.protocol || 'https:';
  const host  = options.hostname;
  const port  = options.port;
  const path  = options.path || '/';
  const portSuffix = port && String(port) !== (proto === 'https:' ? '443' : '80')
    ? `:${port}` : '';
  return `${proto}//${host}${portSuffix}${path}`;
}

/**
 * Derive origin (protocol + host + port) from a URL string.
 * Returns null on parse error.
 */
function originOf(urlStr) {
  try {
    const u = new URL(urlStr);
    const defaultPort = u.protocol === 'https:' ? '443' : '80';
    const port = u.port || defaultPort;
    return `${u.protocol}//${u.hostname}:${port}`;
  } catch {
    return null;
  }
}

/**
 * Make an HTTP/HTTPS request. Returns { statusCode, headers, body }.
 *
 * Security model:
 *   - Same-origin redirects only: cross-origin redirects are rejected.
 *   - On 301/302/303 after a POST, the redirect is followed as a GET (POST body dropped).
 *   - On 307/308 after a POST the redirect is only followed if same-origin; POST body
 *     is NOT forwarded (credentials must not be re-sent to a redirect target).
 *   - Cookie header is built from the scoped jar (Domain/Path/Secure-aware) at each hop;
 *     the raw Cookie header from options is never forwarded to a different origin.
 *
 * @param {object}      options       — node http/https request options
 * @param {string|null} postData      — URL-encoded body string (or null)
 * @param {Map}         cookieJar     — structured cookie jar (Map of parsed cookie objects)
 * @param {number}      maxRedirects  — remaining redirect budget
 * @param {string|null} originUrl     — the CP origin to enforce on redirects (set on first call)
 */
function request(options, postData, cookieJar, maxRedirects, originUrl) {
  maxRedirects = maxRedirects === undefined ? 5 : maxRedirects;

  // Build the full URL for this hop (used for cookie scoping + origin check)
  const thisUrl = optsToUrl(options);
  if (!originUrl) originUrl = thisUrl;

  // Inject only the cookies that match this request's URL
  const matchedCookies = selectCookies(cookieJar, thisUrl);
  if (matchedCookies.length > 0) {
    options = Object.assign({}, options, {
      headers: Object.assign({}, options.headers, { Cookie: buildCookieHeader(matchedCookies) }),
    });
  } else {
    // Remove any stale Cookie header from the options clone to avoid forwarding raw values
    options = Object.assign({}, options, { headers: Object.assign({}, options.headers) });
    delete options.headers['Cookie'];
  }

  return new Promise((resolve, reject) => {
    const lib = options.protocol === 'http:' ? http : https;

    const req = lib.request(options, (res) => {
      // Accumulate Set-Cookie headers into caller's cookie jar (scope-aware)
      const setCookieHdrs = [].concat(res.headers['set-cookie'] || []);
      for (const hdr of setCookieHdrs) {
        const parsed = parseSetCookieHeader(hdr, thisUrl);
        if (parsed) storeCookie(cookieJar, parsed);
      }

      if ([301, 302, 303, 307, 308].includes(res.statusCode) && maxRedirects > 0) {
        const location = res.headers.location;
        if (!location) { reject(new Error(`Redirect ${res.statusCode} with no Location`)); return; }
        // Drain response body before following redirect
        res.resume();

        const base = `${options.protocol}//${options.hostname}${options.port ? ':' + options.port : ''}`;
        const nextUrl = new URL(location, base);
        const nextUrlStr = nextUrl.toString();

        // Same-origin enforcement: reject cross-origin redirects
        const nextOrigin = originOf(nextUrlStr);
        const myOrigin   = originOf(originUrl);
        if (nextOrigin !== myOrigin) {
          reject(new Error(
            `Cross-origin redirect blocked: ${res.statusCode} to ${nextUrlStr} ` +
            `(origin ${nextOrigin} differs from CP origin ${myOrigin}). ` +
            'Refusing to follow to prevent credential leak.'
          ));
          return;
        }

        // 301/302/303 after POST → downgrade to GET (drop credentials body)
        // 307/308 after POST → GET as well (never re-POST credentials to a redirect target)
        const nextMethod = options.method === 'POST' ? 'GET' : options.method;
        const nextPost   = nextMethod === 'GET' ? null : postData;

        const nextHeaders = Object.assign({}, options.headers);
        // Strip credential-bearing headers from redirect options; cookie injection
        // happens fresh on the next call via the scoped jar.
        delete nextHeaders['Cookie'];
        if (nextMethod === 'GET') {
          delete nextHeaders['Content-Type'];
          delete nextHeaders['Content-Length'];
        }

        const nextOpts = {
          protocol: nextUrl.protocol,
          hostname: nextUrl.hostname,
          port:     nextUrl.port || (nextUrl.protocol === 'https:' ? 443 : 80),
          path:     nextUrl.pathname + nextUrl.search,
          method:   nextMethod,
          headers:  nextHeaders,
        };
        request(nextOpts, nextPost, cookieJar, maxRedirects - 1, originUrl).then(resolve).catch(reject);
        return;
      }

      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

/**
 * URL-encode a plain object into application/x-www-form-urlencoded body.
 */
function urlEncode(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Extract a named hidden input value from an HTML string.
 * Returns the value string or null.
 */
function extractInputValue(html, name) {
  // Match <input ... name="XID" ... value="..." ...> in any order
  const re = new RegExp(
    `<input[^>]*name=["']${name}["'][^>]*value=["']([^"']*)["']`,
    'i'
  );
  let m = re.exec(html);
  if (m) return m[1];

  // Also try value before name
  const re2 = new RegExp(
    `<input[^>]*value=["']([^"']*)["'][^>]*name=["']${name}["']`,
    'i'
  );
  m = re2.exec(html);
  return m ? m[1] : null;
}

/**
 * Parse the EE CP login URL into request options.
 * EE CP login endpoint is admin.php?/cp/login (GET) and admin.php (POST).
 */
function parseCpUrl(rawUrl) {
  // Normalise: strip the query suffix EE sometimes shows in docs
  // The login form action is typically just /admin.php
  const u = new URL(rawUrl);
  return {
    protocol: u.protocol,
    hostname: u.hostname,
    port:     u.port || (u.protocol === 'https:' ? 443 : 80),
    loginPath: u.pathname.replace(/\?.*$/, ''), // e.g. /admin.php
    basePath:  u.pathname.replace(/\/[^/]+$/, '') || '/',
    baseUrl:   `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`,
  };
}

/**
 * Extract the first <form> whose action matches the login authenticate endpoint,
 * or the first <form> on the page if no authenticate action is found.
 * Returns { action, hiddenFields } where:
 *   action       — the form's action attribute string (may be relative)
 *   hiddenFields — object of { name: value } for all hidden inputs in the form
 * Returns null if no form is found.
 */
function extractLoginForm(html) {
  // Match the first <form ...> block (non-greedy)
  const formRe = /<form([^>]*)>([\s\S]*?)<\/form>/i;
  const m = formRe.exec(html);
  if (!m) return null;

  const attrStr  = m[1];
  const formBody = m[2];

  // Read the action attribute
  const actionM = /action=["']([^"']*)["']/i.exec(attrStr);
  const action   = actionM ? actionM[1] : '';

  // Extract all hidden inputs from this form
  const hiddenFields = {};
  const hiddenRe = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  let hm;
  while ((hm = hiddenRe.exec(formBody)) !== null) {
    const tag   = hm[0];
    const nameM = /name=["']([^"']+)["']/.exec(tag);
    const valM  = /value=["']([^"']*)["']/.exec(tag);
    if (nameM && valM) hiddenFields[nameM[1]] = valM[1];
  }

  return { action, hiddenFields };
}

/**
 * Resolve a form action URL (possibly relative) against a base URL.
 * Returns the full URL string ready for parseCpUrl / request().
 */
function resolveFormAction(action, baseUrl) {
  if (!action) return baseUrl;
  try {
    // new URL(action, base) handles relative URLs correctly
    return new URL(action, baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

/**
 * S3a: Login to EE CP. Returns { cookies, loginUrl } where cookies is the
 * accumulated session cookie jar after a successful login.
 *
 * EE 7 login flow (form-scoped):
 *   GET  admin.php?/cp/login
 *   → locate the login <form>, read its action + all hidden inputs
 *   POST to the form's action URL (e.g. admin.php?/cp/login/authenticate)
 *   Fields: all hidden inputs from the form (return_path, after, csrf_token, …)
 *          + username + password + submit
 *
 * This is intentionally form-driven rather than hardcoded so that EE version
 * differences in endpoint paths and token field names are handled automatically.
 *
 * @param {object} creds  — { url, username, password } from resolveEECreds()
 * @returns {Promise<{ cookies: Map, loginUrl: object }>}
 */
async function loginToCP(creds) {
  const loginUrl = parseCpUrl(creds.url);
  // Use a structured Map jar (Domain/Path/Secure/expiry-aware)
  const cookies  = new Map();

  // Step 1: GET the login page to pick up the login form + session seed cookie
  const loginPagePath = loginUrl.loginPath + '?/cp/login';
  const getOpts = {
    protocol: loginUrl.protocol,
    hostname: loginUrl.hostname,
    port:     loginUrl.port,
    path:     loginPagePath,
    method:   'GET',
    headers:  {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  };
  const getResp = await request(getOpts, null, cookies, 5);
  if (getResp.statusCode >= 500) {
    throw new Error(`EE CP login page returned HTTP ${getResp.statusCode}. Check the CP URL.`);
  }

  // Step 2: Extract the login form — action URL + all hidden inputs
  const loginForm = extractLoginForm(getResp.body);
  if (!loginForm) {
    throw new Error(
      'Could not locate a login <form> on the EE CP login page. ' +
      'The CP URL may be wrong, or EE returned an unexpected page. Try --debug-html.'
    );
  }

  // Resolve the form's action to an absolute URL, then into request options.
  // EE 7 form action: "admin.php?/cp/login/authenticate" (relative to CP base)
  const postActionUrl = resolveFormAction(
    loginForm.action,
    `${loginUrl.baseUrl}${loginUrl.loginPath}`
  );
  const postActionParsed = parseCpUrl(postActionUrl);

  // Build POST payload: all hidden inputs from the form + credentials + submit.
  // The token (csrf_token or XID) is captured as-is from the form's hidden fields;
  // we do NOT rename it. Username/password are added under their standard names.
  // password is held in process memory only — never logged.
  const postPayload = Object.assign({}, loginForm.hiddenFields, {
    username: creds.username,
    password: creds.password,
    submit:   'submit',
  });
  const formData = urlEncode(postPayload);

  const postOpts = {
    protocol: postActionParsed.protocol,
    hostname: postActionParsed.hostname,
    port:     postActionParsed.port,
    path:     postActionParsed.loginPath + (postActionUrl.includes('?') ? '?' + postActionUrl.split('?')[1] : ''),
    method:   'POST',
    headers:  {
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(formData),
      'User-Agent':     'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer':        `${loginUrl.baseUrl}${loginPagePath}`,
      'Origin':         loginUrl.baseUrl,
      'Accept':         'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  };

  const postResp = await request(postOpts, formData, cookies, 5);

  // ── Verbose debug: cookie jar contents after GET ─────────────────────────────
  // Emit ALL cookie NAMES in the jar (never values) to stderr so a live run shows
  // definitively which cookies were captured from the login-page GET.
  {
    const jarNames = [...cookies.values()].map(c => c.name);
    process.stderr.write(
      `LOGIN-DEBUG: cookies-in-jar-after-GET (${jarNames.length}): [${jarNames.join(', ')}]\n`
    );
  }

  // ── Verbose debug: cookies selected for the authenticate POST ────────────────
  // Select the cookies that WILL be sent on the POST so we can verify exp_csrf_token
  // is included before we even make the request.  Values are never emitted.
  const postAuthUrl = `${postActionParsed.protocol}//${postActionParsed.hostname}` +
    (postActionParsed.port && String(postActionParsed.port) !== (postActionParsed.protocol === 'https:' ? '443' : '80') ? `:${postActionParsed.port}` : '') +
    postActionParsed.loginPath + (postActionUrl.includes('?') ? '?' + postActionUrl.split('?')[1] : '');
  {
    const selectedForPost = selectCookies(cookies, postAuthUrl);
    const selectedNames   = selectedForPost.map(c => c.name);
    process.stderr.write(
      `LOGIN-DEBUG: cookies-sent-on-POST (${selectedNames.length}): [${selectedNames.join(', ')}]\n`
    );
  }

  // ── Verbose debug: POST field names (never values) ───────────────────────────
  {
    const postFieldNames = Object.keys(postPayload);
    process.stderr.write(
      `LOGIN-DEBUG: post-field-names (${postFieldNames.length}): [${postFieldNames.join(', ')}]\n`
    );
  }

  // ── Login-failure diagnostic ──────────────────────────────────────────────────
  // When login appears to have failed, inspect the POST response to distinguish
  // between: (a) bad/stale credentials (EE error message in body), (b) a
  // csrf/session-cookie mechanics failure (bare login form returned, no error),
  // and (c) unknown failures. Emits a one-line verdict to stderr (REDACTED —
  // never prints credential values, cookie values, or token values).
  function emitLoginDiag(resp, cookieJar, csrfTokenExtracted) {
    const body    = resp.body || '';
    const headers = resp.headers || {};

    // HTTP status + redirect presence
    const status   = resp.statusCode;
    const hasRedir = !!(headers['location']);

    // EE auth-error signatures (bad credentials)
    const authErrorPatterns = [
      /invalid\s+username\s+or\s+password/i,
      /the\s+username\s+and\s+password\s+you\s+entered/i,
      /invalid_login/i,
      /incorrect\s+password/i,
      /log\s*in\s+failed/i,
      /wrong\s+password/i,
      /credentials\s+(are\s+)?incorrect/i,
      // EE alert/issue block class names that wrap auth errors
      /class=["'][^"']*\b(alert|error|issue|notice)\b[^"']*["'][^>]*>/i,
    ];
    const hasAuthError = authErrorPatterns.some(re => re.test(body));

    // Bare-form indicator: login form present but no EE error text
    const hasPasswordField = /name=["']password["']/i.test(body);
    const hasCsrfInForm    = /name=["']csrf_token["']/i.test(body);

    // All cookie names currently in the jar (names only, never values).
    // Previously this only counted session-named cookies which was misleading —
    // exp_csrf_token / exp_last_visit / exp_last_activity don't match /session|sess/
    // and would show as 0, hiding whether the CSRF cookie was actually stored.
    const allJarNames = [...cookieJar.values()].map(c => c.name);

    // CSRF token: was one extracted from the GET login page?
    const csrfPresent = !!(csrfTokenExtracted);

    // Classify
    let verdict, evidence;
    if (hasAuthError) {
      verdict  = 'stale-password';
      evidence = `HTTP ${status}, redirect=${hasRedir}, auth-error-signature=true, form-present=${hasPasswordField}`;
    } else if (hasPasswordField && !hasAuthError) {
      verdict  = 'csrf/cookie-mechanics';
      evidence = `HTTP ${status}, redirect=${hasRedir}, bare-login-form=true, csrf-in-form=${hasCsrfInForm}, ` +
        `cookies-in-jar=${allJarNames.length} [${allJarNames.join(',')}], csrf-extracted-from-GET=${csrfPresent}`;
    } else {
      verdict  = 'unknown';
      evidence = `HTTP ${status}, redirect=${hasRedir}, auth-error-sig=${hasAuthError}, ` +
        `password-field=${hasPasswordField}, cookies-in-jar=${allJarNames.length} [${allJarNames.join(',')}]`;
    }

    process.stderr.write(
      `LOGIN-DIAG: likely ${verdict} — ${evidence}\n`
    );
  }

  // Extract the csrf_token that was POSTed (for diag reporting — value is NOT logged)
  const csrfTokenWasPresent = !!loginForm.hiddenFields['csrf_token'];

  // Successful login: EE redirects to CP dashboard (302 + location containing /cp/)
  // After redirect-following, we should land on a CP page (200)
  if (postResp.statusCode >= 400) {
    emitLoginDiag(postResp, cookies, csrfTokenWasPresent);
    throw new Error(`EE CP login failed: HTTP ${postResp.statusCode}. Check username/password.`);
  }
  // Check for login failure indicators in body
  if (/incorrect\s+password|log\s*in\s+failed|invalid\s+username|wrong\s+password/i.test(postResp.body)) {
    emitLoginDiag(postResp, cookies, csrfTokenWasPresent);
    throw new Error('EE CP login rejected: credentials incorrect or account locked.');
  }
  // Check we actually ended up in the CP (not bounced back to login page)
  if (/name="password"/i.test(postResp.body)) {
    emitLoginDiag(postResp, cookies, csrfTokenWasPresent);
    throw new Error('EE CP login did not redirect to dashboard — still on login page. Credentials may be wrong.');
  }

  return { cookies, loginUrl };
}

/**
 * S3b: GET an EE CP entry-edit page and extract its XID token.
 *
 * @param {object} loginUrl  — parsed CP URL object from loginToCP()
 * @param {object} cookies   — session cookie jar from loginToCP()
 * @param {number} entryId   — EE entry ID to edit
 * @param {number} channelId — EE channel ID the entry belongs to
 * @returns {Promise<{ xid: string, body: string }>}
 */
async function getEntryEditPage(loginUrl, cookies, entryId, channelId) {
  // EE 6/7 entry-edit URL: /admin.php?/cp/publish/edit/entry/{entry_id}
  // Some EE installs add channel_id as a query param
  const editPath = `${loginUrl.loginPath}?/cp/publish/edit/entry/${entryId}`;
  const getOpts = {
    protocol: loginUrl.protocol,
    hostname: loginUrl.hostname,
    port:     loginUrl.port,
    path:     editPath,
    method:   'GET',
    headers:  {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer':    `${loginUrl.baseUrl}${loginUrl.loginPath}?/cp/`,
    },
  };

  const resp = await request(getOpts, null, cookies, 5);
  if (resp.statusCode >= 400) {
    throw new Error(`EE entry-edit page returned HTTP ${resp.statusCode} for entry ${entryId}.`);
  }
  if (/name="password"/i.test(resp.body)) {
    throw new Error('EE session expired or invalid — bounced back to login page. Re-run the tool to re-authenticate.');
  }

  const xid = extractInputValue(resp.body, 'XID')
           || extractInputValue(resp.body, 'csrf_token');
  if (!xid) {
    throw new Error(
      `Could not extract XID token from entry-edit page for entry ${entryId}. ` +
      'EE CP form structure may differ from expected. Check the raw HTML in debug mode (--debug-html).'
    );
  }

  return { xid, body: resp.body };
}

/**
 * Decode HTML entities in a string to their character equivalents.
 * Handles the subset produced by HTML attribute and textarea content encoding:
 * &amp; &lt; &gt; &quot; &#39; and numeric references &#N; / &#xN;
 */
function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g,         (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

/**
 * Extract the current value of a named field from the EE entry-edit page HTML.
 * Works for standard <textarea name="field_id_N"> and <input name="field_id_N">.
 *
 * HTML entities in the raw attribute/textarea content are decoded so callers
 * receive the logical string value (e.g. "&" not "&amp;"). This is the value
 * as the browser would present it — use it for find/replace comparisons.
 *
 * Returns null if the field is not found (caller should warn).
 */
function extractFieldValue(html, fieldName) {
  // textarea
  const taRe = new RegExp(
    `<textarea[^>]*name=["']${fieldName}["'][^>]*>([\\s\\S]*?)<\\/textarea>`,
    'i'
  );
  let m = taRe.exec(html);
  if (m) return decodeHtmlEntities(m[1]);

  // input value
  const raw = extractInputValue(html, fieldName);
  return raw !== null ? decodeHtmlEntities(raw) : null;
}

module.exports = {
  resolveEECreds,
  loginToCP,
  getEntryEditPage,
  extractFieldValue,
  extractInputValue,
  decodeHtmlEntities,
  urlEncode,
  request,
  parseCpUrl,
  // exported for unit tests
  _matchField:              matchField,
  _resolveOpServiceToken:   resolveOpServiceToken,
  _opGetWithToken:          opGetWithToken,
  _opGetAmbient:            opGetAmbient,
  _parseSetCookieHeader:    parseSetCookieHeader,
  _storeCookie:             storeCookie,
  _selectCookies:           selectCookies,
  _buildCookieHeader:       buildCookieHeader,
  _originOf:                originOf,
  _extractLoginForm:        extractLoginForm,
  _resolveFormAction:       resolveFormAction,
};
