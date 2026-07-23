/**
 * Autonomy S1 Classifier: Outbound Network Egress Detector
 * Path: tools/kernel/lib/detect-network-egress.cjs
 *
 * Performs static regex scanning on commands and script contents to detect network operations.
 * Incorporates Codex-Bridge review hardening (comment stripping, size caps, loopback exemption).
 */

const fsMod = require('fs');
const pathMod = require('path');

const MAX_SCAN_SIZE_BYTES = 1 * 1024 * 1024; // 1MB limit to prevent freezes (Codex recommendation)

// Outbound Executables signature regex
const OUTBOUND_EXECUTABLES_REGEX = /\b(curl|wget|ssh|nc|telnet|ping|scp)\b/i;

// Language Imports signature regex (JS, Python, Shell)
const NETWORK_IMPORTS_REGEX = /\b(http|https|fetch|node-fetch|axios|requests|urllib|httpx|socket)\b/i;

// External (Non-Loopback) URL regex
const EXTERNAL_URL_REGEX = /https?:\/\/(?!localhost|127\.0\.0\.1|\[::1\])[a-zA-Z0-9-._~:/?#[\]@!$&'()*+,;=]+/i;

/**
 * Strips comments from script content based on file extension to avoid comment-based false-positives.
 * @param {string} text Raw script file text
 * @param {string} ext File extension (e.g. '.js', '.py', '.sh')
 * @returns {string} Text with comments removed
 */
function stripComments(text, ext) {
  if (!text) return '';
  const normalizedExt = String(ext || '').toLowerCase();

  if (['.js', '.cjs', '.ts'].includes(normalizedExt)) {
    // Strip multi-line /* ... */ comments
    let cleaned = text.replace(/\/\*[\s\S]*?\*\//g, '');
    // Strip single-line // ... comments (excluding http:// and https:// URLs via negative lookbehind)
    cleaned = cleaned.replace(/(?<!https?:)\/\/.*$/gm, '');
    return cleaned;
  }

  if (['.py', '.sh'].includes(normalizedExt)) {
    // Strip # ... comments (simple regex, ignoring inline vs line-start since it's robust enough for static scanning)
    // Avoid stripping URLs (e.g. http://foo.com/#bar)
    return text.split('\n').map(line => {
      const hashIndex = line.indexOf('#');
      if (hashIndex === -1) return line;
      
      // Heuristic: check if '#' is inside a string or URL
      const preceding = line.substring(0, hashIndex);
      if (preceding.includes('http://') || preceding.includes('https://')) {
        return line; // keep line (URL fragment)
      }
      
      // Simple quote parity check to see if '#' is in a string
      const singleQuotes = (preceding.match(/'/g) || []).length;
      const doubleQuotes = (preceding.match(/"/g) || []).length;
      if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) {
        return line; // keep line (likely inside string)
      }

      return preceding; // strip comment part
    }).join('\n');
  }

  return text;
}

/**
 * Parses a command string to resolve local script paths.
 * Robust split-based token parsing to avoid word-boundary pitfalls on absolute paths.
 * @param {string} command Shell command string
 * @returns {Array<string>} Array of absolute or relative file paths detected
 */
function resolveScriptPaths(command) {
  if (!command) return [];
  const paths = [];

  // Split command by spaces, quotes, or pipes to extract raw arguments
  const parts = command.split(/[\s'"|&;()<>]+/);
  for (const part of parts) {
    // Check if the part ends with .js, .cjs, .sh, .py (and contains no spaces or quotes)
    if (/\.(js|cjs|sh|py)$/i.test(part)) {
      const cleanPath = part.trim();
      if (cleanPath && !paths.includes(cleanPath)) {
        paths.push(cleanPath);
      }
    }
  }

  return paths;
}

/**
 * Static Analysis: Detect outbound network egress signatures inside command or file body.
 * @param {string} command Shell command string
 * @param {object} [fs] Node fs module override (optional)
 * @param {object} [path] Node path module override (optional)
 * @returns {object} { hasEgress: boolean, reason?: string, matches?: string[] }
 */
function detectNetworkEgress(command, fs = fsMod, path = pathMod) {
  if (!command || typeof command !== 'string') {
    return { hasEgress: false };
  }

  // 1. Scan the top-level command string first
  if (OUTBOUND_EXECUTABLES_REGEX.test(command)) {
    const match = command.match(OUTBOUND_EXECUTABLES_REGEX)[0];
    return { hasEgress: true, reason: `Outbound executable detected in command: "${match}"`, matches: [match] };
  }

  if (EXTERNAL_URL_REGEX.test(command)) {
    const match = command.match(EXTERNAL_URL_REGEX)[0];
    return { hasEgress: true, reason: `External URL literal detected in command: "${match}"`, matches: [match] };
  }

  // 2. Resolve script targets in arguments and read their contents
  const scriptPaths = resolveScriptPaths(command);
  for (const sp of scriptPaths) {
    try {
      if (!fs.existsSync(sp)) continue;

      const stat = fs.statSync(sp);
      if (!stat.isFile() || stat.size > MAX_SCAN_SIZE_BYTES) {
        // Skip giant files or directories to prevent frozen event loop
        continue;
      }

      const ext = path.extname(sp);
      const rawBody = fs.readFileSync(sp, 'utf8');

      // Strip comments to minimize false positives (Codex recommendation)
      const cleanBody = stripComments(rawBody, ext);

      // Perform signature scans on cleaned script body
      if (OUTBOUND_EXECUTABLES_REGEX.test(cleanBody)) {
        const match = cleanBody.match(OUTBOUND_EXECUTABLES_REGEX)[0];
        return { hasEgress: true, reason: `Outbound executable "${match}" inside script file: "${sp}"`, matches: [match] };
      }

      if (NETWORK_IMPORTS_REGEX.test(cleanBody)) {
        const match = cleanBody.match(NETWORK_IMPORTS_REGEX)[0];
        return { hasEgress: true, reason: `Network library import/API "${match}" inside script file: "${sp}"`, matches: [match] };
      }

      if (EXTERNAL_URL_REGEX.test(cleanBody)) {
        const match = cleanBody.match(EXTERNAL_URL_REGEX)[0];
        return { hasEgress: true, reason: `External URL "${match}" inside script file: "${sp}"`, matches: [match] };
      }
    } catch (err) {
      // Fail-closed/Warning: if script is unreadable or fails to resolve, log but continue (best-effort)
      console.warn(`[NetworkEgressDetector] Warning reading script "${sp}": ${err.message}`);
    }
  }

  return { hasEgress: false };
}

module.exports = {
  detectNetworkEgress,
  stripComments,
  resolveScriptPaths
};
