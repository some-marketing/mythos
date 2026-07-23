'use strict';

/**
 * data-sensitivity-classifier.js
 *
 * S2 of glm-5.2-hosted-mind-bridge-registration-and-jurisdiction-gate.
 *
 * PURPOSE
 *   Deterministic, mechanically-evaluable classifier that takes a dispatch
 *   PAYLOAD (a string, or an object: a task / prompt / context bundle) and
 *   decides whether it carries SENSITIVE data that must never cross into a
 *   foreign (e.g. PRC-hosted) jurisdiction.
 *
 *   This module is standalone and side-effect-free. It classifies; it does
 *   NOT block, route, log, or call anything. The S3 jurisdiction-data-ban gate
 *   (a separate module) consumes `{ sensitive }` and is the surface that blocks
 *   a sensitive payload from reaching a PRC-hosted endpoint.
 *
 * THREAT MODEL — this classifier IS the new attack surface.
 *   The GLM-5.2 bridge (S1/S3) lets dispatch payloads reach a PRC-hosted mind.
 *   This classifier is the chokepoint that decides which payloads are too
 *   sensitive to send. A mis-classify-as-SAFE is therefore a cross-jurisdiction
 *   data leak — operator PII, client substrate, credentials, or unreleased
 *   strategy crossing a border that cannot be un-crossed. Hence:
 *     - FAIL-CLOSED: anything we cannot confidently classify (null / non-{string,
 *       object} / unrecognized shape, OR any predicate evaluation that throws)
 *       sets unknown=true AND sensitive=true. Unknown ⇒ sensitive ⇒ (downstream)
 *       blocked. A false-block is a recoverable annoyance; a false-send is an
 *       irreversible leak.
 *     - CONSERVATIVE: when a signal is plausible but uncertain, the predicate
 *       trips. Over-classification is safe; under-classification is the breach.
 *
 *   NO NL / LLM JUDGMENT. Every predicate is explicit token / regex / structural
 *   matching over the payload's flattened text and structure. The PREDICATES
 *   table below is the single auditable source of truth for what each predicate
 *   matches.
 *
 * PUBLIC API
 *   classifyPayloadSensitivity(payload, opts?) -> {
 *     sensitive: boolean,   // true iff ANY predicate trips (or unknown)
 *     unknown:   boolean,   // true iff payload could not be confidently classified
 *     tripped:   [{ predicate, evidence }],
 *   }
 *
 *   Per-predicate helpers (each unit-testable) are exported by name. Each takes a
 *   normalized payload context and returns { tripped, evidence? }:
 *     piiPredicate, credentialsPredicate, dotenvPredicate,
 *     liveServerLogsPredicate, privateClientSubstratePredicate,
 *     unreleasedClientStrategyPredicate.
 *
 *   PREDICATES — the documented, exported predicate table.
 */

// ---------------------------------------------------------------------------
// Low-level deterministic matchers (no NL, pure string/regex work).
// ---------------------------------------------------------------------------

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Does `text` contain `token`?
 *   - Alphanumeric single-word tokens use \b word boundaries (avoid "key"
 *     matching "keyboard").
 *   - Tokens with spaces / symbols use a plain (escaped) substring match.
 * Returns the matched token string for evidence, or null. `text` is assumed
 * already lowercased.
 */
function tokenHit(text, token) {
  if (!text) return null;
  const t = String(token).toLowerCase();
  let re;
  if (/^[a-z0-9]+$/.test(t)) {
    re = new RegExp('\\b' + escapeRegExp(t) + '\\b');
  } else {
    re = new RegExp(escapeRegExp(t));
  }
  return re.test(text) ? token : null;
}

/** First token in `tokens` that hits `text`, else null. */
function firstTokenHit(text, tokens) {
  for (const tok of tokens) {
    const hit = tokenHit(text, tok);
    if (hit) return hit;
  }
  return null;
}

/** First regex in `regexes` that matches `text`; returns {label, match} or null. */
function firstRegexHit(text, regexes) {
  if (!text) return null;
  for (const r of regexes) {
    const m = text.match(r.re);
    if (m) return { label: r.label, match: m[0] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Payload normalization.
//   We flatten the payload into a single lowercased text blob (for token/regex
//   predicates) AND retain a structural view (raw object) so structural
//   predicates can inspect keys/paths. `recognized` is false when the payload
//   has no classifiable shape at all (=> fail-closed unknown).
// ---------------------------------------------------------------------------

const MAX_DEPTH = 12; // guard against pathological / cyclic structures.

/**
 * Walk an arbitrary value collecting every string fragment (keys + values) into
 * `out`. Bounded by depth and a visited set (cycle-safe). Object KEYS are
 * collected too, because a key like "api_key" or a path "clients/{CLIENT_CODE}/..." is
 * itself a sensitivity signal.
 */
function collectStrings(value, out, depth, seen) {
  if (depth > MAX_DEPTH) return;
  if (value == null) return;
  const type = typeof value;
  if (type === 'string') {
    out.push(value);
    return;
  }
  if (type === 'number' || type === 'boolean' || type === 'bigint') {
    out.push(String(value));
    return;
  }
  if (type !== 'object') return; // function / symbol — ignore.
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out, depth + 1, seen);
    return;
  }
  for (const k of Object.keys(value)) {
    out.push(k); // the key name itself is signal.
    collectStrings(value[k], out, depth + 1, seen);
  }
}

/**
 * Normalize a raw payload into a deterministic context.
 *   { recognized, text, fragments, raw }
 * `recognized` is false for null/undefined or non-{string,object} payloads, OR
 * an object/string that yields no usable text fragments (empty/garbled).
 */
function normalizePayload(payload) {
  // Only strings and plain objects/arrays are classifiable shapes.
  if (payload == null) {
    return { recognized: false, text: '', fragments: [], raw: payload };
  }
  const type = typeof payload;
  if (type !== 'string' && type !== 'object') {
    // numbers/booleans/functions/symbols are not a dispatch payload shape.
    return { recognized: false, text: '', fragments: [], raw: payload };
  }

  const fragments = [];
  if (type === 'string') {
    const s = payload.trim();
    if (!s) return { recognized: false, text: '', fragments: [], raw: payload };
    fragments.push(payload);
  } else {
    collectStrings(payload, fragments, 0, new Set());
    if (fragments.length === 0) {
      // An object with no extractable strings/keys (e.g. {}) is garbled/empty
      // for our purposes => fail-closed unknown.
      return { recognized: false, text: '', fragments: [], raw: payload };
    }
  }

  const text = fragments.join('\n').toLowerCase();
  return { recognized: true, text, fragments, raw: payload };
}

// ---------------------------------------------------------------------------
// Token + regex tables (deterministic signals). Lowercase tokens.
//   Each predicate documents its own table section. Over-coverage is safe.
// ---------------------------------------------------------------------------

// --- pii ---
const PII_TOKENS = [
  'date of birth', 'd.o.b', 'dob', 'social security', 'social insurance',
  'home address', 'mailing address', 'street address', 'phone number',
  'cell number', 'mobile number', 'first name', 'last name', 'full name',
  'driver license', "driver's license", 'passport number',
];
const PII_REGEXES = [
  // Email address.
  { label: 'email-address', re: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/ },
  // North American phone: (902) 555-1234 / 902-555-1234 / 902.555.1234 / +1 902 555 1234
  { label: 'phone-number', re: /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/ },
  // International / E.164 (codex S2 review, MAJOR): +<country code><digits>, with
  // optional space/dot/dash/paren grouping. Matches +44 20 7946 0958, +442079460958,
  // +49 30 123456, etc. 7-17 total digits. Over-block is the safe direction.
  { label: 'intl-phone-e164', re: /\+\d{1,3}(?:[\s.()-]?\d){6,15}\b/ },
  // SIN / SSN-like 9-digit grouped: 123-45-6789 or 123 456 789.
  { label: 'sin-ssn-like', re: /\b\d{3}[\s-]\d{2,3}[\s-]\d{3,4}\b/ },
  // DOB-like ISO or slashed date.
  { label: 'dob-like-date', re: /\b(?:19|20)\d{2}[\/-](?:0?[1-9]|1[0-2])[\/-](?:0?[1-9]|[12]\d|3[01])\b/ },
  // Street address: "123 Main St", "45 Oak Avenue".
  { label: 'street-address', re: /\b\d{1,5}\s+[a-z][a-z.\s]{1,30}\b(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|crescent|cres|way)\b/ },
];

// --- credentials ---
const CRED_TOKENS = [
  'api key', 'apikey', 'api_key', 'secret key', 'secret_key', 'access token',
  'access_token', 'auth token', 'auth_token', 'authorization: bearer',
  'authorization:bearer', 'bearer ', 'client_secret', 'client secret',
  'private key', 'private_key', 'password', 'passwd', 'passphrase', 'secret',
  'credentials', 'oauth token', 'service account token', 'service_account',
  'session token', 'refresh_token', 'refresh token', 'x-api-key',
];
const CRED_REGEXES = [
  // PEM private key block.
  { label: 'pem-private-key', re: /-----begin (?:rsa |ec |openssh |dsa |pgp )?private key-----/ },
  // AWS access key id.
  { label: 'aws-access-key-id', re: /\bakia[0-9a-z]{16}\b/ },
  // GitHub token.
  { label: 'github-token', re: /\bgh[pousr]_[0-9a-z]{20,}\b/ },
  // Slack token.
  { label: 'slack-token', re: /\bxox[baprs]-[0-9a-z-]{10,}\b/ },
  // OpenAI / sk- style secret key.
  { label: 'sk-secret-key', re: /\bsk-[a-z0-9_-]{16,}\b/ },
  // Bearer header value.
  { label: 'bearer-header', re: /authorization\s*:\s*bearer\s+\S+/ },
  // JWT (three base64url segments).
  { label: 'jwt', re: /\beyj[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/ },
];

// --- dotenv ---
const DOTENV_TOKENS = [
  '.env', '.env.local', '.env.production', 'dotenv', 'process.env',
];
const DOTENV_REGEXES = [
  // A KEY=VALUE line whose key is secret-shaped and value is non-empty.
  // e.g. AWS_SECRET_ACCESS_KEY=xxxx, DB_PASSWORD=hunter2, API_TOKEN="abc".
  {
    label: 'secret-shaped-env-assignment',
    re: /(?:^|\n)\s*[a-z0-9_]*(?:secret|password|passwd|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|credential|auth)[a-z0-9_]*\s*=\s*['"]?\S+/i,
  },
];

// --- live_server_logs ---  (the codex-added predicate)
const LOG_TOKENS = [
  'stack trace', 'stacktrace', 'traceback', 'access.log', 'error.log',
  'syslog', 'journalctl', '/var/log/', 'nginx error', 'apache error',
  'segfault', 'segmentation fault', 'uncaught exception', 'unhandled rejection',
];
const LOG_REGEXES = [
  // Apache/nginx combined access log line: IP - - [date] "GET ..." 200 1234
  { label: 'access-log-line', re: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b.*\[[^\]]+\].*"(?:get|post|put|delete|head|patch)\s+\S+/ },
  // Syslog-style timestamped host line: "Jun 29 10:11:12 hostname service[123]:"
  { label: 'syslog-line', re: /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\S+\s+\S+\[\d+\]:/ },
  // Node/JS stack frame (codex S2 review, MINOR — narrowed): require an
  // error/exception/throw/rejection/traceback token within ~200 chars BEFORE the
  // "at <frame>:line:col" so an ordinary prose path citation ("see at foo/bar.js:10:5")
  // no longer false-blocks, while a real stack trace ("TypeError: ...\n  at handler
  // (/srv/app/index.js:42:13)") still trips.
  { label: 'js-stack-frame', re: /(?:error|exception|throw|rejection|traceback)[\s\S]{0,200}?(?:\n|^)\s+at\s+[^\n]*:\d+:\d+/i },
  // Python traceback frame: 'File "/srv/app.py", line 42, in handler'
  { label: 'python-traceback-frame', re: /file\s+"[^"]+\.py",\s+line\s+\d+,\s+in\s+\S+/ },
  // A log-file path (server/app log).
  { label: 'log-file-path', re: /\/(?:var\/log|srv|opt|app|home\/\w+)\/[\w./-]*\.log\b/ },
  // HTTP server error status with method context.
  { label: 'http-5xx-with-method', re: /"(?:get|post|put|delete|patch)\s+\S+\s+http\/\d(?:\.\d)?"\s+5\d{2}\b/ },
];

// --- private_client_substrate ---
const CLIENT_PATH_REGEXES = [
  // A reference to the private clients/** tree.
  { label: 'clients-path', re: /(?:^|[\s"'`(=:/])clients\/[a-z0-9_-]+\// },
];
const CLIENT_TOKENS = [
  'crm record', 'crm records', 'lead record', 'lead records', 'lead pipeline',
  'crmstagings', 'client credentials', 'client-internal', 'client internal',
  'client substrate', 'project.json', 'dealer email', 'customer record',
  'customer records', 'client contact list', 'client roster',
];

// --- unreleased_client_strategy ---
// DISJUNCTION (codex S2 review, BLOCKER): trip if EITHER a confidentiality/draft
// marker OR a strategy/commercial subject is present. The earlier conjunction
// let UNMARKED pricing/margin/rollout data classify SAFE and potentially egress
// to a PRC-hosted endpoint — over-block is the safe direction here, so either
// signal alone gates.
const STRATEGY_CONFIDENTIAL_MARKERS = [
  'confidential', 'internal only', 'internal-only', 'do not distribute',
  'do not share', 'not for distribution', 'draft', 'unpublished', 'unreleased',
  'embargo', 'embargoed', 'nda', 'under nda', 'proprietary', 'pre-release',
  'pre-launch', 'not yet public',
];
const STRATEGY_SUBJECT_NOUNS = [
  'pricing', 'price list', 'rate card', 'pricing strategy', 'margin', 'margins',
  'rollout', 'campaign strategy', 'go-to-market strategy', 'go-to-market',
  'go to market', 'media plan', 'media-buy plan', 'launch plan', 'roadmap',
  'forecast', 'forecasts', 'contract terms', 'deal terms', 'commercial terms',
  'quote', 'proposal',
];

// ---------------------------------------------------------------------------
// Per-predicate helpers. Each returns { tripped:boolean, evidence?:string }.
// Exported individually so each is unit-testable in isolation. Each takes the
// normalized payload context produced by normalizePayload().
// ---------------------------------------------------------------------------

function piiPredicate(ctx) {
  const tok = firstTokenHit(ctx.text, PII_TOKENS);
  if (tok) return { tripped: true, evidence: 'PII token: "' + tok + '"' };
  const rx = firstRegexHit(ctx.text, PII_REGEXES);
  if (rx) return { tripped: true, evidence: 'PII pattern [' + rx.label + ']: "' + rx.match + '"' };
  return { tripped: false };
}

function credentialsPredicate(ctx) {
  const rx = firstRegexHit(ctx.text, CRED_REGEXES);
  if (rx) return { tripped: true, evidence: 'credential pattern [' + rx.label + ']' };
  const tok = firstTokenHit(ctx.text, CRED_TOKENS);
  if (tok) return { tripped: true, evidence: 'credential token: "' + tok + '"' };
  return { tripped: false };
}

function dotenvPredicate(ctx) {
  const rx = firstRegexHit(ctx.text, DOTENV_REGEXES);
  if (rx) return { tripped: true, evidence: 'dotenv pattern [' + rx.label + ']: "' + rx.match.trim() + '"' };
  const tok = firstTokenHit(ctx.text, DOTENV_TOKENS);
  if (tok) return { tripped: true, evidence: 'dotenv reference: "' + tok + '"' };
  return { tripped: false };
}

function liveServerLogsPredicate(ctx) {
  const rx = firstRegexHit(ctx.text, LOG_REGEXES);
  if (rx) return { tripped: true, evidence: 'server-log pattern [' + rx.label + ']' };
  const tok = firstTokenHit(ctx.text, LOG_TOKENS);
  if (tok) return { tripped: true, evidence: 'server-log token: "' + tok + '"' };
  return { tripped: false };
}

function privateClientSubstratePredicate(ctx) {
  const rx = firstRegexHit(ctx.text, CLIENT_PATH_REGEXES);
  if (rx) return { tripped: true, evidence: 'private client path [' + rx.label + ']: "' + rx.match.trim() + '"' };
  const tok = firstTokenHit(ctx.text, CLIENT_TOKENS);
  if (tok) return { tripped: true, evidence: 'client-substrate token: "' + tok + '"' };
  return { tripped: false };
}

function unreleasedClientStrategyPredicate(ctx) {
  // DISJUNCTION (codex S2 review, BLOCKER): EITHER signal alone trips.
  const marker = firstTokenHit(ctx.text, STRATEGY_CONFIDENTIAL_MARKERS);
  const subject = firstTokenHit(ctx.text, STRATEGY_SUBJECT_NOUNS);
  if (!marker && !subject) return { tripped: false };
  const parts = [];
  if (marker) parts.push('confidentiality marker "' + marker + '"');
  if (subject) parts.push('strategy/commercial subject "' + subject + '"');
  return { tripped: true, evidence: parts.join(' / ') };
}

// ---------------------------------------------------------------------------
// The auditable predicate table — single exported source of truth.
//   `fn(ctx) -> { tripped, evidence? }`
// ---------------------------------------------------------------------------
const PREDICATES = [
  {
    name: 'pii',
    matches: 'name+contact patterns, email addresses, North-American AND international/E.164 (+<cc>) phone numbers, street addresses, SIN/SSN-like grouped 9-digit, DOB-like dates, and explicit PII labels (date of birth, social insurance, home address, passport/driver license).',
    fn: piiPredicate,
  },
  {
    name: 'credentials',
    matches: 'API keys, access/auth/session/refresh tokens, bearer & x-api-key headers, passwords/passphrases, PEM private keys, JWTs, and vendor key shapes (AWS AKIA, GitHub gh*_, Slack xox*-, OpenAI sk-).',
    fn: credentialsPredicate,
  },
  {
    name: 'dotenv',
    matches: '.env / .env.* file references, process.env / dotenv, and secret-shaped KEY=VALUE env assignments (KEY contains secret/password/token/api_key/access_key/private_key/client_secret/credential/auth with a non-empty value).',
    fn: dotenvPredicate,
  },
  {
    name: 'live_server_logs',
    matches: 'server/access/error log lines (nginx/apache access lines, syslog/journalctl lines), JS/Python stack frames & tracebacks, log-file paths (/var/log, *.log), and HTTP 5xx-with-method lines. [codex-added predicate]',
    fn: liveServerLogsPredicate,
  },
  {
    name: 'private_client_substrate',
    matches: 'references into the private clients/** tree (clients/<CODE>/...), project.json, and client-internal data tokens (CRM/lead records, crmstagings, dealer/customer records, client credentials).',
    fn: privateClientSubstratePredicate,
  },
  {
    name: 'unreleased_client_strategy',
    matches: 'DISJUNCTION (over-block is the safe direction): a confidentiality/draft marker (confidential, internal-only, draft, unpublished, unreleased, embargo, NDA, proprietary, pre-launch) OR a strategy/commercial subject (pricing, price list, rate card, margin, rollout, campaign/go-to-market/pricing strategy, media plan, launch plan, roadmap, forecast, contract/deal/commercial terms, quote, proposal). Either signal alone trips.',
    fn: unreleasedClientStrategyPredicate,
  },
];

// Sentinel predicate name used when a payload cannot be confidently classified.
const UNKNOWN_PREDICATE = 'classifier_cannot_classify';

// ---------------------------------------------------------------------------
// Public entrypoint.
// ---------------------------------------------------------------------------

/**
 * classifyPayloadSensitivity — the public entrypoint. FAIL-CLOSED.
 *
 * @param {string|object} payload  dispatch task / prompt / context bundle.
 * @param {object}        [opts]   reserved for future tuning; currently unused.
 * @returns {{ sensitive:boolean, unknown:boolean, tripped:{predicate:string,evidence:string}[] }}
 */
function classifyPayloadSensitivity(payload, opts) {
  void opts; // reserved.

  let ctx;
  try {
    ctx = normalizePayload(payload);
  } catch (err) {
    // Normalization itself blew up (e.g. exotic proxy) => fail-closed.
    return {
      sensitive: true,
      unknown: true,
      tripped: [{
        predicate: UNKNOWN_PREDICATE,
        evidence: 'payload normalization threw: ' + (err && err.message ? err.message : String(err)),
      }],
    };
  }

  if (!ctx.recognized) {
    return {
      sensitive: true,
      unknown: true,
      tripped: [{
        predicate: UNKNOWN_PREDICATE,
        evidence: 'payload is null / not a {string,object} / empty / garbled (no classifiable text) — fail-closed',
      }],
    };
  }

  const tripped = [];
  let unknown = false;

  for (const p of PREDICATES) {
    let res;
    try {
      res = p.fn(ctx);
    } catch (err) {
      // A predicate that throws is itself unclassifiable => fail-closed.
      unknown = true;
      tripped.push({
        predicate: UNKNOWN_PREDICATE,
        evidence: 'predicate "' + p.name + '" threw: ' + (err && err.message ? err.message : String(err)),
      });
      continue;
    }
    if (res && res.tripped) {
      tripped.push({ predicate: p.name, evidence: res.evidence || 'tripped' });
    }
  }

  // sensitive = true iff ANY predicate trips OR we hit an unknown condition.
  const sensitive = tripped.length > 0 || unknown;
  return { sensitive, unknown, tripped };
}

module.exports = {
  // Public entrypoint.
  classifyPayloadSensitivity,
  // Auditable predicate table + sentinel.
  PREDICATES,
  UNKNOWN_PREDICATE,
  // Per-predicate helpers (each independently testable).
  piiPredicate,
  credentialsPredicate,
  dotenvPredicate,
  liveServerLogsPredicate,
  privateClientSubstratePredicate,
  unreleasedClientStrategyPredicate,
  // Internals exposed for white-box tests.
  normalizePayload,
  collectStrings,
  tokenHit,
  firstTokenHit,
  firstRegexHit,
  // Token/regex tables (auditable).
  PII_TOKENS, PII_REGEXES,
  CRED_TOKENS, CRED_REGEXES,
  DOTENV_TOKENS, DOTENV_REGEXES,
  LOG_TOKENS, LOG_REGEXES,
  CLIENT_PATH_REGEXES, CLIENT_TOKENS,
  STRATEGY_CONFIDENTIAL_MARKERS, STRATEGY_SUBJECT_NOUNS,
};
