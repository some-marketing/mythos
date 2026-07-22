'use strict';
//
// tools/security/elevenlabs-keys/lib.cjs
//
// Pure, cwd-independent logic for ElevenLabs workload-key provisioning.
//
// ┌────────────────────────────────────────────────────────────────────────┐
// │ SECRET-HANDLING CONTRACT                                                │
// │ This module NEVER puts a raw key value into a shell command, a process  │
// │ argv, a log line, or a file on disk. The only place a raw key is        │
// │ permitted is:                                                           │
// │   (1) the JSON item-template string handed to `op item create ... -`    │
// │       over STDIN (never argv), built by `buildOpItemTemplate`; and      │
// │   (2) the `xi-api-key` HTTP header used by `validate` probes.           │
// │ Callers must read the key from process.stdin, never from argv.          │
// └────────────────────────────────────────────────────────────────────────┘
//
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DESTINATION_VAULT = 'Automation';

// ─── Admin scopes: NEVER on any workload key ────────────────────────────────
// SINGLE SOURCE OF TRUTH: the human dashboard labels. Every label is run
// through ONE normalizer (`collapseToken`) to produce the canonical collapsed
// token the scanner compares against. This closes the bypass where a collapsed
// dashboard label (e.g. "Group/Workspace Members" -> "group_workspace_members")
// had no matching entry in the forbidden set. Add a dashboard admin label here
// and both the forbidden set and the readable-alias map pick it up.
// (`normalizeToken`/`collapseToken` are function declarations — hoisted — so
// they are callable at module-eval time here.)
const ADMIN_SCOPE_LABELS = [
  'Workspace:Write',
  'Service Accounts',
  'Workspace Members',
  'Group Members',
  'Group/Workspace Members',
  'ToS Accept',
  'Terms of Service Accept',
  'User:Write',
  'Ads Engine',
  'Webhooks'
];

// Canonical collapsed admin tokens. `allBareTokens` collapses every manifest
// scope through the same `collapseToken` path, so membership is exact.
const FORBIDDEN_ADMIN_SCOPES = new Set(ADMIN_SCOPE_LABELS.map((l) => collapseToken(l)));

// Human-facing aliases -> collapsed admin token (readable messages + a record
// of which dashboard label produced which forbidden token). Keyed by the
// space-normalized label so a lookup by either label form resolves.
const ADMIN_ALIASES = Object.fromEntries(
  ADMIN_SCOPE_LABELS.map((l) => [normalizeToken(l), collapseToken(l)])
);

// ─── Capability isolation rules ─────────────────────────────────────────────
// Certain capabilities may live on exactly ONE profile — this is the
// structural enforcement of the operator's "never share a key" rules.
//   capability id  ->  the ONLY profile allowed to carry it
const ISOLATED_CAPABILITIES = {
  'voices:write': 'voice-cloning-mgmt',        // synthetic-identity control (Voices:Write)
  voice_generation: 'voice-cloning-mgmt',      // creates synthetic voices
  'eleven_agents:write': 'agent-phone-prod'    // conversational-agent config
};

// ─── Fail-closed scope allow-lists (per section) ────────────────────────────
// A forbidden-list catches KNOWN-bad admin tokens; it silently accepts unknown
// or misspelled scopes and API-surface drift. Fail-closed requires an explicit
// ALLOW-list: any access/read/write token not in the canonical ElevenLabs
// workload-capability set below is REJECTED. These are the tokens the manifest
// uses plus the optionals its comments document (history read, forced_alignment,
// pronunciation_dictionaries write). Admin scopes are deliberately absent — they
// are handled by FORBIDDEN_ADMIN_SCOPES (defense in depth). Tokens are compared
// in `normalizeToken` form (lowercase, whitespace -> '_').
const ALLOWED_ACCESS_SCOPES = new Set([
  'text_to_speech',
  'speech_to_text',
  'voice_generation',
  'audio_isolation',
  'music_generation',
  'sound_effects',
  'forced_alignment'
]);
const ALLOWED_READ_SCOPES = new Set([
  'voices',
  'pronunciation_dictionaries',
  'history',
  'models',
  'user'
]);
const ALLOWED_WRITE_SCOPES = new Set([
  'voices',
  'pronunciation_dictionaries',
  'eleven_agents'
]);
const ALLOWED_SCOPES_BY_SECTION = {
  access: ALLOWED_ACCESS_SCOPES,
  read: ALLOWED_READ_SCOPES,
  write: ALLOWED_WRITE_SCOPES
};

/**
 * Normalize a raw scope token: lowercase, collapse separators to '_'.
 * "Workspace:Write" -> "workspace:write" (kept ':' for section-qualified caps),
 * but for admin matching we also compare the fully-collapsed form.
 * @param {string} tok
 */
function normalizeToken(tok) {
  return String(tok).trim().toLowerCase().replace(/\s+/g, '_');
}

/** Fully collapse a token for admin comparison ("workspace:write"->"workspace_write"). */
function collapseToken(tok) {
  return normalizeToken(tok).replace(/[:/]/g, '_');
}

/**
 * Flatten a profile's scopes into canonical capability ids.
 *   access token       -> "<token>"                (e.g. "text_to_speech")
 *   read token         -> "<token>:read"           (e.g. "voices:read")
 *   write token        -> "<token>:write"          (e.g. "voices:write")
 * @param {object} profile
 * @returns {string[]}
 */
function capabilityIds(profile) {
  const s = profile.scopes || {};
  const out = [];
  for (const t of s.access || []) out.push(normalizeToken(t));
  for (const t of s.read || []) out.push(`${normalizeToken(t)}:read`);
  for (const t of s.write || []) out.push(`${normalizeToken(t)}:write`);
  return out;
}

/** All bare tokens across every section (for admin membership testing). */
function allBareTokens(profile) {
  const s = profile.scopes || {};
  return []
    .concat(s.access || [], s.read || [], s.write || [])
    .map(collapseToken);
}

// ─── Minimal, purpose-built YAML reader ─────────────────────────────────────
// js-yaml is NOT a repo dependency (see tools/verify/manifest-schema-sweep.cjs).
// This parser handles ONLY the constrained shape of the key manifest:
//   - 2-space block indentation
//   - `key: value` scalars (string / integer / boolean)
//   - `key:` opening a nested block map or block list
//   - block list items `- scalar` and `- key: value`
//   - inline flow lists `[a, b, c]`
//   - `# ...` line comments and quoted scalars
// It is deliberately strict: `loadManifest` re-validates the parsed structure
// against the expected schema, so any parse ambiguity surfaces as a schema
// error rather than silent misbehavior. (Design note flagged for review.)
function parseYaml(text) {
  const rawLines = text.split(/\r?\n/);
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const stripped = stripComment(rawLines[i]);
    if (stripped.trim() === '') continue;
    lines.push({ indent: countIndent(stripped), content: stripped.trim(), n: i + 1 });
  }
  let idx = 0;

  function parseBlock(minIndent) {
    // Decide: list or map based on first line at this indent.
    if (idx >= lines.length) return null;
    const first = lines[idx];
    if (first.indent < minIndent) return null;
    if (first.content.startsWith('- ') || first.content === '-') {
      return parseList(first.indent);
    }
    return parseMap(first.indent);
  }

  function parseMap(indent) {
    const map = {};
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.indent < indent) break;
      if (line.indent > indent) throw new Error(`yaml: unexpected indent at line ${line.n}`);
      if (line.content.startsWith('- ')) break;
      const m = line.content.match(/^([^:]+):(.*)$/);
      if (!m) throw new Error(`yaml: expected "key: value" at line ${line.n}: ${line.content}`);
      const key = m[1].trim();
      const rest = m[2].trim();
      idx++;
      if (rest === '') {
        // nested block (map or list) at deeper indent, or null
        const next = lines[idx];
        if (next && next.indent > indent) {
          map[key] = parseBlock(next.indent);
        } else {
          map[key] = null;
        }
      } else {
        map[key] = parseScalarOrFlow(rest, line.n);
      }
    }
    return map;
  }

  function parseList(indent) {
    const arr = [];
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.indent < indent) break;
      if (line.indent > indent) throw new Error(`yaml: unexpected indent at line ${line.n}`);
      if (!line.content.startsWith('-')) break;
      const after = line.content.slice(1).trim();
      if (after === '') {
        idx++;
        arr.push(parseBlock(indent + 2));
      } else if (/^[^:\s][^:]*:(\s|$)/.test(after) || /^[^:]+:(.*)$/.test(after)) {
        // "- key: value" — treat the item as a map whose first pair is inline.
        // Rewrite this line as a map line at indent+2 and parse a map.
        line.content = after;
        line.indent = indent + 2;
        arr.push(parseMap(indent + 2));
      } else {
        idx++;
        arr.push(parseScalarOrFlow(after, line.n));
      }
    }
    return arr;
  }

  const result = parseBlock(0);
  return result === null ? {} : result;
}

function stripComment(line) {
  // Remove a trailing/`# ...` comment not inside quotes. Manifest uses no
  // quoted '#', so a simple scan is safe here.
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) {
      // require preceding whitespace or start-of-line to count as comment
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i);
    }
  }
  return line;
}

function countIndent(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

function parseScalarOrFlow(raw, lineNo) {
  const v = raw.trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((x) => parseScalar(x.trim(), lineNo));
  }
  return parseScalar(v, lineNo);
}

function parseScalar(v, _lineNo) {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  return v;
}

// ─── Manifest load + schema validation ──────────────────────────────────────

const VALID_PROFILE_KEYS = new Set([
  'profile', 'vault_path', 'trust_boundary', 'purpose', 'status', 'scopes',
  'quota_credit_refresh', 'quota_credit_limit', 'ip_restricted',
  'auto_disable_if_leaked', 'rotation_days', 'used_by'
]);

/**
 * Load and schema-validate the YAML manifest. Throws on structural problems.
 * Does NOT enforce the security invariants — call `assertManifestSafe` for that.
 * @param {string} manifestPath
 */
function loadManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  return parseManifest(raw);
}

/** Parse + schema-validate from an in-memory YAML string (testable). */
function parseManifest(rawYaml) {
  const m = parseYaml(rawYaml);
  if (!m || typeof m !== 'object') throw new Error('manifest: not a mapping');
  if (!Array.isArray(m.profiles)) throw new Error('manifest: missing "profiles" array');
  const seenNames = new Set();
  const seenPaths = new Set();
  for (const p of m.profiles) {
    if (!p || typeof p !== 'object') throw new Error('manifest: a profile is not a mapping');
    for (const k of Object.keys(p)) {
      if (!VALID_PROFILE_KEYS.has(k)) throw new Error(`manifest: unknown profile key "${k}"`);
    }
    for (const req of ['profile', 'vault_path', 'trust_boundary', 'scopes', 'rotation_days']) {
      if (p[req] === undefined || p[req] === null) {
        throw new Error(`manifest: profile "${p.profile || '?'}" missing "${req}"`);
      }
    }
    if (seenNames.has(p.profile)) throw new Error(`manifest: duplicate profile "${p.profile}"`);
    seenNames.add(p.profile);
    if (seenPaths.has(p.vault_path)) throw new Error(`manifest: duplicate vault_path "${p.vault_path}"`);
    seenPaths.add(p.vault_path);
    const s = p.scopes || {};
    for (const sect of ['access', 'read', 'write']) {
      if (s[sect] !== undefined && s[sect] !== null && !Array.isArray(s[sect])) {
        throw new Error(`manifest: profile "${p.profile}" scopes.${sect} must be a list`);
      }
    }
  }
  m.vault = m.vault || DESTINATION_VAULT;
  return m;
}

/** Is this profile provisioned (i.e. not explicitly not_provisioned)? */
function isProvisioned(profile) {
  return profile.status !== 'not_provisioned';
}

/** All PROVISIONED profiles (the ones the tool will act on). */
function provisionedProfiles(manifest) {
  return manifest.profiles.filter(isProvisioned);
}

/** Look up a profile by name. Returns undefined if absent. */
function getProfile(manifest, name) {
  return manifest.profiles.find((p) => p.profile === name);
}

// ─── Security invariants ────────────────────────────────────────────────────

/**
 * Assert every security invariant the manifest must satisfy. Returns a
 * findings list; throws only if `opts.throwOnFail` and any finding is a
 * violation. not_provisioned profiles are SKIPPED (they have no live key).
 * @param {object} manifest
 * @param {object} [opts]
 * @param {boolean} [opts.throwOnFail=true]
 * @returns {{ violations: string[], skipped: string[], ok: boolean }}
 */
function assertManifestSafe(manifest, opts = {}) {
  const throwOnFail = opts.throwOnFail !== false;
  const violations = [];
  const skipped = [];

  for (const p of manifest.profiles) {
    if (!isProvisioned(p)) {
      skipped.push(p.profile);
      continue;
    }

    // (1) No admin scopes anywhere. Every bare token is collapsed through the
    //     same normalizer used to build FORBIDDEN_ADMIN_SCOPES, so both the
    //     collapsed form ("group_workspace_members") and the dashboard label
    //     ("Group/Workspace Members") resolve to the same forbidden token.
    for (const bare of allBareTokens(p)) {
      if (FORBIDDEN_ADMIN_SCOPES.has(bare)) {
        violations.push(`ADMIN SCOPE on workload key: "${bare}" found on profile "${p.profile}"`);
      }
    }

    // (1b) Fail-closed: every scope token MUST be in the per-section allow-list.
    //      An unknown capability, a typo, or API-surface drift is rejected here
    //      rather than silently accepted. Tokens already flagged as admin above
    //      are skipped so a single dashboard-admin label produces one clear
    //      ADMIN violation, not a duplicate "unknown scope" line.
    const sp = p.scopes || {};
    for (const sect of ['access', 'read', 'write']) {
      const allowed = ALLOWED_SCOPES_BY_SECTION[sect];
      for (const raw of sp[sect] || []) {
        if (FORBIDDEN_ADMIN_SCOPES.has(collapseToken(raw))) continue; // reported as ADMIN
        if (!allowed.has(normalizeToken(raw))) {
          violations.push(`UNKNOWN SCOPE (fail-closed): "${raw}" in scopes.${sect} of profile "${p.profile}" is not an allowed ${sect} capability`);
        }
      }
    }

    // (2) hygiene invariants
    if (p.ip_restricted !== false) {
      violations.push(`profile "${p.profile}": ip_restricted must be false (dynamic runtime IPs)`);
    }
    if (p.auto_disable_if_leaked !== true) {
      violations.push(`profile "${p.profile}": auto_disable_if_leaked must be true`);
    }
    if (!(Number.isInteger(p.quota_credit_limit) && p.quota_credit_limit > 0)) {
      violations.push(`profile "${p.profile}": quota_credit_limit must be a positive integer (never Unlimited/null), got ${JSON.stringify(p.quota_credit_limit)}`);
    }
    if (!(Number.isInteger(p.rotation_days) && p.rotation_days > 0)) {
      violations.push(`profile "${p.profile}": rotation_days must be a positive integer`);
    }
  }

  // (3) Isolated capabilities live on exactly their one allowed profile.
  for (const [cap, ownerName] of Object.entries(ISOLATED_CAPABILITIES)) {
    for (const p of provisionedProfiles(manifest)) {
      if (capabilityIds(p).includes(cap) && p.profile !== ownerName) {
        violations.push(`ISOLATION BREACH: capability "${cap}" must be isolated to "${ownerName}" but appears on "${p.profile}"`);
      }
    }
  }

  // (4) Over-privilege: voice-cloning-mgmt must not carry text_to_speech.
  const cloning = getProfile(manifest, 'voice-cloning-mgmt');
  if (cloning && isProvisioned(cloning) && capabilityIds(cloning).includes('text_to_speech')) {
    violations.push('OVER-PRIVILEGE: "voice-cloning-mgmt" must NOT carry text_to_speech');
  }

  const result = { violations, skipped, ok: violations.length === 0 };
  if (!result.ok && throwOnFail) {
    throw new Error('manifest failed security invariants:\n  - ' + violations.join('\n  - '));
  }
  return result;
}

// ─── profile -> vault_path map (for app config) ─────────────────────────────

/**
 * Emit the profile->vault_path mapping for app-config consumption.
 * Includes provisioning status so consumers can skip not_provisioned keys.
 * NEVER contains a key value — only the vault reference.
 * @param {object} manifest
 */
function buildProfileMap(manifest) {
  const map = { vault: manifest.vault || DESTINATION_VAULT, profiles: {} };
  for (const p of manifest.profiles) {
    map.profiles[p.profile] = {
      vault_path: p.vault_path,
      op_reference: `op://${manifest.vault || DESTINATION_VAULT}/${p.vault_path}/credential`,
      trust_boundary: p.trust_boundary,
      provisioned: isProvisioned(p),
      rotation_days: p.rotation_days
    };
  }
  return map;
}

// ─── op item template (secret via STDIN, never argv) ────────────────────────

/**
 * Build the 1Password item-template JSON that will be piped to
 * `op item create --vault <vault> -` over STDIN. The raw key is placed in a
 * single `credential` concealed field; all other fields are non-secret
 * metadata. This template string is the ONLY sanctioned carrier of the raw
 * key besides the HTTP auth header — it must go to op's stdin, never argv.
 * @param {object} profile
 * @param {string} rawKey
 * @param {string} vault
 * @returns {string} JSON string
 */
function buildOpItemTemplate(profile, rawKey, vault) {
  if (!isProvisioned(profile)) {
    throw new Error(`refusing to build template for not_provisioned profile "${profile.profile}"`);
  }
  if (typeof rawKey !== 'string' || rawKey.length === 0) {
    throw new Error('refusing to build template: empty key');
  }
  const s = profile.scopes || {};
  const scopeSummary = JSON.stringify({
    access: s.access || [],
    read: s.read || [],
    write: s.write || []
  });
  const template = {
    title: profile.vault_path,
    category: 'API_CREDENTIAL',
    fields: [
      { id: 'credential', type: 'CONCEALED', label: 'credential', value: rawKey },
      { id: 'notesPlain', type: 'STRING', label: 'notesPlain', value: `ElevenLabs workload key. Managed by tools/security/elevenlabs-keys. Raw value lives ONLY here; app config references profile "${profile.profile}".` },
      { section: { id: 'meta' }, type: 'STRING', label: 'profile', value: profile.profile },
      { section: { id: 'meta' }, type: 'STRING', label: 'trust_boundary', value: String(profile.trust_boundary) },
      { section: { id: 'meta' }, type: 'STRING', label: 'scopes', value: scopeSummary },
      { section: { id: 'meta' }, type: 'STRING', label: 'rotation_days', value: String(profile.rotation_days) },
      { section: { id: 'meta' }, type: 'STRING', label: 'quota_credit_refresh', value: String(profile.quota_credit_refresh || 'monthly') },
      { section: { id: 'meta' }, type: 'STRING', label: 'quota_credit_limit', value: String(profile.quota_credit_limit) },
      { section: { id: 'meta' }, type: 'STRING', label: 'auto_disable_if_leaked', value: String(profile.auto_disable_if_leaked) },
      { section: { id: 'meta' }, type: 'STRING', label: 'ip_restricted', value: String(profile.ip_restricted) }
    ]
  };
  return JSON.stringify(template);
}

/**
 * The exact operator-run command (as an argv array + display string) that
 * stores a key WITHOUT the value ever touching argv or shell history. The key
 * is read from THIS tool's stdin. This is what `store` prints when `op` is not
 * authenticated in the current shell.
 * @param {string} profileName
 * @param {string} scriptRelPath  path to provision-key.js relative to repo root
 */
function operatorRunStoreCommand(profileName, scriptRelPath) {
  const argv = ['node', scriptRelPath, 'store', '--profile', profileName];
  return {
    argv,
    display: argv.join(' '),
    note: 'Run in a shell where `op` is signed in (interactive `op signin`) OR where OP_SERVICE_ACCOUNT_TOKEN (Automation-vault-scoped) is exported. Paste the raw key at the silent prompt; it is read from stdin and never appears in argv or shell history.'
  };
}

// ─── op runner (real + probe) ───────────────────────────────────────────────

const ALLOWED_OP_PREFIXES = [
  ['item', 'create'],
  ['item', 'get'],
  ['vault', 'list']
];
// Tokens that would surface a secret VALUE from op — hard-forbidden on reads.
const FORBIDDEN_READ_TOKENS = ['read', '--fields', '--field', '--reveal', '--otp'];

/**
 * Build the real `op` runner. `item create` receives its template via the
 * `input` option (stdin), NEVER argv. A short timeout keeps an unauthed
 * shell from hanging on an interactive prompt.
 * @param {object} [opts]
 */
function makeRealOpRunner(opts = {}) {
  const timeout = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 15000;
  return function realOpRunner(args, stdin) {
    if (!Array.isArray(args) || args.length < 2) {
      throw new Error(`elevenlabs-keys: refused empty op invocation: ${JSON.stringify(args)}`);
    }
    const prefixOk = ALLOWED_OP_PREFIXES.some((p) => p[0] === args[0] && p[1] === args[1]);
    if (!prefixOk) {
      throw new Error(`elevenlabs-keys: refused op subcommand "${args[0]} ${args[1]}"`);
    }
    // Guard reads from leaking a value; `item create` is a write and is exempt.
    if (!(args[0] === 'item' && args[1] === 'create')) {
      for (const tok of args) {
        if (FORBIDDEN_READ_TOKENS.includes(String(tok).toLowerCase())) {
          throw new Error(`elevenlabs-keys: refused value-read token "${tok}"`);
        }
      }
    }
    return execFileSync('op', args, {
      encoding: 'utf8',
      input: stdin === undefined ? undefined : stdin,
      stdio: stdin === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
      timeout,
      maxBuffer: 8 * 1024 * 1024
    });
  };
}

/** Is `op` usable right now? Single metadata-only `vault list`. */
function probeOpAvailable(opRunner) {
  try {
    opRunner(['vault', 'list', '--format', 'json']);
    return true;
  } catch (_e) {
    return false;
  }
}

// ─── validate: live scope check against the ElevenLabs API ──────────────────
//
// LIMITATION (confirmed in the plan doc): ElevenLabs exposes NO endpoint for a
// workload key to introspect its OWN granted scopes. The only scope-bearing
// endpoints (service-accounts/api-keys) require ADMIN scope, which no workload
// key holds. So `validate` is BEHAVIORAL:
//   - auth check: GET /v1/user must return 200 with a valid key.
//   - read-scope probes: side-effect-free GETs; 200 => scope present,
//     401 (missing_permissions) => absent.
//   - over-privilege probes (opt-in, `deep`): send a request that CANNOT
//     complete a mutation (empty/minimal body). A 401 missing_permissions means
//     the dangerous scope is ABSENT (good); a 422 means the scope is PRESENT
//     (over-privilege on a workload key) with nothing actually created. This
//     relies on ElevenLabs checking auth/permission BEFORE body validation.
//
// Probe endpoints are read-only GETs except the deep over-privilege checks.

const BASE_URL = 'https://api.elevenlabs.io';

// Read probes: map capability -> a safe GET whose 200 proves the scope.
const READ_PROBES = {
  text_to_speech: { method: 'GET', path: '/v1/models' },
  'voices:read': { method: 'GET', path: '/v1/voices' },
  'pronunciation_dictionaries:read': { method: 'GET', path: '/v1/pronunciation-dictionaries' }
};

// Deep over-privilege probes: capability -> a request that 401s without the
// scope and 422s (no mutation) with it. Used ONLY when deep=true.
const OVERPRIV_PROBES = {
  'voices:write': { method: 'POST', path: '/v1/voices/add', minimalBody: true },
  'eleven_agents:write': { method: 'POST', path: '/v1/convai/agents/create', minimalBody: true }
};

/**
 * Validate a live key against its profile. `httpFn(reqSpec)` -> { status, body }
 * is injected so tests never touch the network. The raw key is passed to
 * httpFn for the `xi-api-key` header ONLY; it is never logged or returned.
 * `httpFn` is a PRODUCTION-SHAPED adapter: it returns a Promise (the real CLI
 * adapter `httpElevenLabs` is Promise-returning). Every probe is awaited, so a
 * synchronous fake can no longer mask the async boundary. `await` on a plain
 * (non-Promise) value is still valid, but tests inject Promise-returning fakes
 * to match the real adapter shape.
 * @param {object} profile
 * @param {string} rawKey
 * @param {(req: object) => Promise<{status:number, json?:object}>} httpFn
 * @param {object} [opts]
 * @param {boolean} [opts.deep=false]  run over-privilege mutation-safe probes
 * @returns {Promise<{ ok:boolean, findings:string[], expected:string[], authed:boolean }>}
 */
async function validateKeyScopes(profile, rawKey, httpFn, opts = {}) {
  const deep = !!opts.deep;
  const findings = [];
  const expected = capabilityIds(profile);

  // auth
  const auth = await httpFn({ method: 'GET', path: '/v1/user', key: rawKey });
  const authed = auth.status === 200;
  if (!authed) {
    findings.push(`AUTH FAIL: GET /v1/user returned ${auth.status} (key invalid or revoked)`);
    return { ok: false, findings, expected, authed: false };
  }

  // (a) under-privilege: expected read scopes that are actually DENIED
  for (const cap of expected) {
    const probe = READ_PROBES[cap];
    if (!probe) continue; // no safe read probe for this capability
    const r = await httpFn({ method: probe.method, path: probe.path, key: rawKey });
    if (r.status === 401 || r.status === 403) {
      findings.push(`UNDER-PRIVILEGE: expected scope "${cap}" but ${probe.method} ${probe.path} => ${r.status}`);
    } else if (r.status !== 200) {
      findings.push(`INCONCLUSIVE: scope "${cap}" probe ${probe.method} ${probe.path} => ${r.status}`);
    }
  }

  // (b) over-privilege: dangerous scopes the profile should NOT have.
  //     Read-probe drift: a read scope present but NOT expected.
  for (const [cap, probe] of Object.entries(READ_PROBES)) {
    if (expected.includes(cap)) continue;
    const r = await httpFn({ method: probe.method, path: probe.path, key: rawKey });
    if (r.status === 200) {
      findings.push(`OVER-PRIVILEGE (read drift): scope "${cap}" is present but not in profile "${profile.profile}"`);
    }
  }

  if (deep) {
    for (const [cap, probe] of Object.entries(OVERPRIV_PROBES)) {
      if (expected.includes(cap)) continue; // profile is allowed this one
      const r = await httpFn({ method: probe.method, path: probe.path, key: rawKey, minimalBody: true });
      if (r.status === 401 || r.status === 403) {
        // scope absent — good, no action
      } else if (r.status === 422 || r.status === 400) {
        findings.push(`OVER-PRIVILEGE (DANGEROUS): scope "${cap}" appears PRESENT on workload key "${profile.profile}" (mutation-safe probe not rejected for permissions)`);
      } else if (r.status === 200 || r.status === 201) {
        findings.push(`CRITICAL: deep probe for "${cap}" returned ${r.status} — a mutation may have occurred; investigate immediately`);
      } else {
        findings.push(`INCONCLUSIVE: deep probe "${cap}" => ${r.status}`);
      }
    }
  }

  return { ok: findings.length === 0, findings, expected, authed: true };
}

module.exports = {
  DESTINATION_VAULT,
  FORBIDDEN_ADMIN_SCOPES,
  ADMIN_ALIASES,
  ADMIN_SCOPE_LABELS,
  ISOLATED_CAPABILITIES,
  ALLOWED_ACCESS_SCOPES,
  ALLOWED_READ_SCOPES,
  ALLOWED_WRITE_SCOPES,
  ALLOWED_SCOPES_BY_SECTION,
  BASE_URL,
  READ_PROBES,
  OVERPRIV_PROBES,
  normalizeToken,
  collapseToken,
  capabilityIds,
  allBareTokens,
  parseYaml,
  parseManifest,
  loadManifest,
  isProvisioned,
  provisionedProfiles,
  getProfile,
  assertManifestSafe,
  buildProfileMap,
  buildOpItemTemplate,
  operatorRunStoreCommand,
  makeRealOpRunner,
  probeOpAvailable,
  validateKeyScopes,
  _resolvePath: (p) => path.resolve(p)
};
