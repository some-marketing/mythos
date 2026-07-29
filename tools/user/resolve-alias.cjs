'use strict';

/**
 * Mythos alias resolver — MythosAliasRegistry/1.0.
 *
 * resolveAlias(domain, name, opts) -> { id, source, status } | null
 *
 *   domain : one of 'commands' | 'frameworks' | 'skills' | 'tools'.
 *            Maps to the registry's top-level keys:
 *              commands   -> aliases
 *              frameworks -> framework_aliases
 *              skills     -> skill_aliases
 *              tools      -> tool_aliases
 *   name   : the alias spelling. Normalized to lowercase-kebab; lookup is
 *            case-insensitive.
 *   returns: { id: <resolves_to>, source: 'canonical' | 'user', status } when the
 *            alias resolves; null when it is unknown or 'inactive'.
 *
 * Precedence is DOMAIN-QUALIFIED: within the requested domain, the canonical
 * registry wins over the user overlay (a canonical spelling shadows a user
 * spelling of the same name in the same domain). Duplicate spellings ACROSS
 * domains are legal and independent. Resolution is single-hop: resolves_to is
 * returned verbatim, never re-resolved.
 *
 * The user overlay is read from $MYTHOS_HOME/aliases.yaml (external, never
 * generated or tracked). A malformed overlay file is warned-about (by path) and
 * ignored; a malformed entry is warned-about (by key) and skipped. Membrane rule:
 * warnings name keys and locations only, never the resolved values.
 *
 * opts (all optional):
 *   registryPath : path to the canonical command-aliases.yaml
 *                  (default: the shipped canonical registry).
 *   mythosHome   : user home dir holding aliases.yaml
 *                  (default: process.env.MYTHOS_HOME).
 *   onWarn       : function(message) sink for warnings (default: console.warn).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DOMAIN_KEYS = {
  commands: 'aliases',
  frameworks: 'framework_aliases',
  skills: 'skill_aliases',
  tools: 'tool_aliases',
};

const DOMAIN_TOKENS = Object.keys(DOMAIN_KEYS);

// Statuses that yield a resolved id. 'inactive' is known but does not resolve.
const RESOLVING_STATUSES = new Set(['primary', 'cross-alias', 'compatibility', 'deprecated']);
const KNOWN_STATUSES = new Set([...RESOLVING_STATUSES, 'inactive']);

const DEFAULT_REGISTRY_PATH = path.join(
  __dirname, '..', '..', 'instructions', 'canonical', 'command-aliases.yaml'
);

/**
 * Resolve the Mirror home the same way init-mirror.cjs and inject-mirror.cjs do:
 * $MYTHOS_HOME when set, otherwise ~/.mythos. `env` and `homedir` are injectable
 * for tests; they default to process.env and os.homedir().
 */
function resolveMythosHome(opts) {
  const options = opts || {};
  const env = options.env || process.env;
  if (env.MYTHOS_HOME) return env.MYTHOS_HOME;
  const home = options.homedir || os.homedir();
  return path.join(home, '.mythos');
}

function normalizeName(name) {
  return String(name == null ? '' : name)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')   // spaces / underscores -> hyphen
    .replace(/-+/g, '-')       // collapse runs of hyphens
    .replace(/^-+|-+$/g, '');  // trim leading/trailing hyphens
}

function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Parse a multi-domain alias registry into
 *   { aliases: {name: {resolves_to, status}}, framework_aliases: {...}, ... }.
 * Accepts the JSON-compatible form and the commented-YAML form used in the
 * canonical layer. Only the four known domain keys are collected; anything else
 * at column 0 (e.g. `version:`) is ignored.
 */
function parseRegistry(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return {};
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const key of Object.values(DOMAIN_KEYS)) {
        if (obj[key] && typeof obj[key] === 'object') out[key] = obj[key];
      }
      return out;
    }
  } catch (_) {
    /* fall through to the line parser */
  }
  return parseSimpleMultiDomainYaml(trimmed);
}

function parseSimpleMultiDomainYaml(raw) {
  const domainKeySet = new Set(Object.values(DOMAIN_KEYS));
  const domains = {};
  let currentDomain = null;
  let currentAlias = null;
  for (const line of raw.split('\n')) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const match = trimmedLine.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = stripQuotes(match[2].trim());
    if (indent === 0) {
      currentDomain = domainKeySet.has(key) ? key : null;
      currentAlias = null;
    } else if (currentDomain && indent <= 2) {
      currentAlias = key;
      domains[currentDomain] = domains[currentDomain] || {};
      domains[currentDomain][currentAlias] = {};
    } else if (currentDomain && currentAlias) {
      domains[currentDomain][currentAlias][key] = value;
    }
  }
  return domains;
}

/** Build a normalized index { normName: { resolves_to, status, rawKey } } for one domain. */
function indexDomain(domainMap, onWarn, sourceLabel) {
  const index = {};
  if (!domainMap) return index;
  for (const [rawKey, entry] of Object.entries(domainMap)) {
    const norm = normalizeName(rawKey);
    if (!norm) continue;
    const resolves_to = entry && entry.resolves_to;
    const status = entry && entry.status;
    if (sourceLabel === 'user' && (!resolves_to || !KNOWN_STATUSES.has(status))) {
      // Membrane: name the key only, never the value.
      onWarn(`[mythos:alias] ignoring malformed overlay entry '${rawKey}'`);
      continue;
    }
    index[norm] = { resolves_to, status, rawKey };
  }
  return index;
}

function loadCanonicalDomain(registryPath, registryKey, onWarn) {
  if (!registryPath || !fs.existsSync(registryPath)) return {};
  let raw;
  try {
    raw = fs.readFileSync(registryPath, 'utf8');
  } catch (_) {
    return {};
  }
  const parsed = parseRegistry(raw);
  return indexDomain(parsed[registryKey], onWarn, 'canonical');
}

function loadUserDomain(mythosHome, registryKey, onWarn) {
  if (!mythosHome) return {};
  const overlayPath = path.join(mythosHome, 'aliases.yaml');
  if (!fs.existsSync(overlayPath)) return {};
  let raw;
  try {
    raw = fs.readFileSync(overlayPath, 'utf8');
  } catch (_) {
    // Location only, never contents.
    onWarn(`[mythos:alias] ignoring unreadable overlay file: ${overlayPath}`);
    return {};
  }
  let parsed;
  try {
    parsed = parseRegistry(raw);
  } catch (_) {
    onWarn(`[mythos:alias] ignoring malformed overlay file: ${overlayPath}`);
    return {};
  }
  // Non-empty content that yields no recognized domain is a malformed file:
  // warn by location (never contents) and ignore the whole file.
  const hasAnyDomain = Object.values(DOMAIN_KEYS).some((k) => parsed[k]);
  const hasMeaningfulContent = raw
    .split('\n')
    .some((l) => l.trim() && !l.trim().startsWith('#'));
  if (!hasAnyDomain && hasMeaningfulContent) {
    onWarn(`[mythos:alias] ignoring malformed overlay file: ${overlayPath}`);
    return {};
  }
  return indexDomain(parsed[registryKey], onWarn, 'user');
}

function resolveFromIndex(index, norm, source, onWarn) {
  const entry = index[norm];
  if (!entry) return null;
  if (!KNOWN_STATUSES.has(entry.status)) {
    onWarn(`[mythos:alias] '${entry.rawKey}' has unknown status; not resolving`);
    return null;
  }
  if (entry.status === 'inactive') {
    return null;
  }
  if (entry.status === 'deprecated') {
    onWarn(`[mythos:alias] '${entry.rawKey}' is deprecated`);
  }
  return { id: entry.resolves_to, source, status: entry.status };
}

function resolveAlias(domain, name, opts) {
  const options = opts || {};
  const onWarn = typeof options.onWarn === 'function'
    ? options.onWarn
    : (msg) => console.warn(msg);

  const registryKey = DOMAIN_KEYS[domain];
  if (!registryKey) {
    throw new Error(
      `resolveAlias: unknown domain '${domain}'. Expected one of: ${DOMAIN_TOKENS.join(', ')}`
    );
  }

  const norm = normalizeName(name);
  if (!norm) return null;

  const registryPath = options.registryPath || DEFAULT_REGISTRY_PATH;
  // An explicit mythosHome (even undefined) is honored verbatim for tests; when
  // omitted, fall back to the shared $MYTHOS_HOME || ~/.mythos default.
  const mythosHome = Object.prototype.hasOwnProperty.call(options, 'mythosHome')
    ? options.mythosHome
    : resolveMythosHome({ env: options.env, homedir: options.homedir });

  // Canonical-before-user, within this domain. A canonical spelling shadows a
  // user spelling of the same name (even when canonical is 'inactive').
  const canonicalIndex = loadCanonicalDomain(registryPath, registryKey, onWarn);
  if (Object.prototype.hasOwnProperty.call(canonicalIndex, norm)) {
    return resolveFromIndex(canonicalIndex, norm, 'canonical', onWarn);
  }

  const userIndex = loadUserDomain(mythosHome, registryKey, onWarn);
  if (Object.prototype.hasOwnProperty.call(userIndex, norm)) {
    return resolveFromIndex(userIndex, norm, 'user', onWarn);
  }

  return null;
}

module.exports = {
  resolveAlias,
  resolveMythosHome,
  normalizeName,
  DOMAIN_TOKENS,
  DOMAIN_KEYS,
};
