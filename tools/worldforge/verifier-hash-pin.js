'use strict';

/**
 * verifier-hash-pin.js — Layer-1 hash-pin + required-sections enforcement for
 * the readiness-gate tools in this package.
 *
 *   1. checkPinned(toolPath)              — recompute sha256, compare to the pinned
 *                                           value; PASS on match, FAIL-drift on
 *                                           mismatch, REFUSED on unknown tool.
 *   2. checkRequiredSections(report, tool) — the verifier's report MUST enumerate
 *                                           every required section (with >= min_checks
 *                                           checks each). Any missing/short section is
 *                                           FAIL, never a silent "not applicable".
 *                                           Fail-closed: if the verifier that produced
 *                                           the report is itself hash-drifted, its
 *                                           output is REFUSED (not consumed).
 *
 * This lib does not arm or wire into any live gate on its own. It only reads
 * the pin manifest and hashes files on disk. Nothing here executes or
 * activates a world-spec.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MANIFEST_PATH = path.join(__dirname, 'verifier-hash-pin.example.json');

/** Load the pin manifest (from disk unless an override object/path is supplied). */
function loadManifest(opts = {}) {
  if (opts.manifest && typeof opts.manifest === 'object') return opts.manifest;
  const manifestPath = opts.manifestPath || DEFAULT_MANIFEST_PATH;
  const raw = fs.readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw);
}

/** Recompute the sha256 of a file on disk (hex). */
function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * checkPinned(toolPath, opts) -> verdict
 *
 * Recompute the on-disk sha256 of toolPath and compare it to the pinned value.
 * Fail-closed:
 *   - unknown tool (not in manifest) -> FAIL/refused (reason: not_pinned)
 *   - missing file                   -> FAIL/refused (reason: tool_missing)
 *   - hash mismatch                  -> FAIL/refused (reason: hash_drift)
 *   - hash match                     -> PASS
 */
function checkPinned(toolPath, opts = {}) {
  const manifest = loadManifest(opts);
  const key = path.basename(toolPath);
  const pinned = manifest.pinned_tools && manifest.pinned_tools[key];

  if (!pinned || !pinned.sha256) {
    return {
      ok: false,
      verdict: 'FAIL',
      refused: true,
      reason: 'not_pinned',
      tool: key,
      detail: 'Tool is not present in the Layer-1 pin manifest; fail-closed refuses to trust it.',
    };
  }

  if (!fs.existsSync(toolPath)) {
    return {
      ok: false,
      verdict: 'FAIL',
      refused: true,
      reason: 'tool_missing',
      tool: key,
      pinned_sha256: pinned.sha256,
      detail: 'Pinned tool not found on disk.',
    };
  }

  const actual = sha256File(toolPath);
  if (actual !== pinned.sha256) {
    return {
      ok: false,
      verdict: 'FAIL',
      refused: true,
      reason: 'hash_drift',
      tool: key,
      pinned_sha256: pinned.sha256,
      actual_sha256: actual,
      detail: 'On-disk sha256 does not match the pinned hash; the verifier is drifted/tampered and its output MUST NOT be consumed.',
    };
  }

  return {
    ok: true,
    verdict: 'PASS',
    refused: false,
    reason: 'hash_match',
    tool: key,
    pinned_sha256: pinned.sha256,
    actual_sha256: actual,
  };
}

/** Extract the section namespace (substring before the first ':') from a check id. */
function sectionOf(checkId) {
  if (typeof checkId !== 'string') return null;
  const idx = checkId.indexOf(':');
  return idx === -1 ? checkId : checkId.slice(0, idx);
}

/**
 * checkRequiredSections(verifierReport, toolPath, opts) -> verdict
 *
 * The verifier report's checks[] must enumerate every required section with at
 * least min_checks checks. Fail-closed:
 *   - if the producing verifier (toolPath) is hash-drifted -> REFUSED, sections
 *     are NOT evaluated (its output cannot be trusted at all).
 *   - a required section absent from the report -> FAIL (missing_section),
 *     NEVER silently "not applicable".
 *   - a required section present but below min_checks -> FAIL (short_section).
 *   - all required sections present and adequate -> PASS.
 *
 * verifierReport may be the parsed output object (with a `checks` array) or a
 * path to a JSON file containing it.
 */
function checkRequiredSections(verifierReport, toolPath, opts = {}) {
  const manifest = loadManifest(opts);

  // Fail-closed gate: refuse to consume the output of a drifted verifier.
  if (toolPath) {
    const pin = checkPinned(toolPath, opts);
    if (!pin.ok) {
      return {
        ok: false,
        verdict: 'FAIL',
        refused: true,
        consumed: false,
        reason: 'verifier_refused_' + pin.reason,
        tool: pin.tool,
        pin,
        detail: 'Verifier failed hash-pin check; its report is refused and required-sections are NOT evaluated.',
      };
    }
  }

  let report = verifierReport;
  if (typeof verifierReport === 'string') {
    report = JSON.parse(fs.readFileSync(verifierReport, 'utf8'));
  }

  const checks = Array.isArray(report && report.checks) ? report.checks : [];
  const counts = {};
  for (const c of checks) {
    const s = sectionOf(c && c.id);
    if (s) counts[s] = (counts[s] || 0) + 1;
  }

  const required = (manifest.required_sections && manifest.required_sections.sections) || [];
  const sectionResults = [];
  const failures = [];

  for (const spec of required) {
    const name = spec.section;
    const min = spec.min_checks || 1;
    const found = counts[name] || 0;
    let status;
    if (found === 0) {
      status = 'missing_section';
      failures.push({ section: name, reason: 'missing_section', found, min_checks: min });
    } else if (found < min) {
      status = 'short_section';
      failures.push({ section: name, reason: 'short_section', found, min_checks: min });
    } else {
      status = 'ok';
    }
    sectionResults.push({ section: name, status, found, min_checks: min });
  }

  const ok = failures.length === 0;
  return {
    ok,
    verdict: ok ? 'PASS' : 'FAIL',
    refused: false,
    consumed: true,
    reason: ok ? 'all_required_sections_present' : 'required_sections_incomplete',
    tool: toolPath ? path.basename(toolPath) : null,
    section_results: sectionResults,
    failures,
  };
}

module.exports = {
  loadManifest,
  sha256File,
  checkPinned,
  checkRequiredSections,
  sectionOf,
  DEFAULT_MANIFEST_PATH,
};
