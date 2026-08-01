'use strict';
//
// tools/mcp/delesign/lib/project-registry.js — local registry of Delesign projects
// we have created, used as a dup-guard for createProject.
//
// Registry file: _dev/state/delesign/created-projects.json
// Each entry: { projectId, client, title, briefSnippet (≤300 chars), createdAt }
//
// Exports:
//   readRegistry()                             → entry[] (or [] if file absent)
//   recordProject(projectId, client, brief)    → writes entry; returns entry
//   findNearDuplicate(client, brief, opts)     → { match: entry|null, similarity }
//
// Similarity is Jaccard over title+brief tokens (same helper as outbound-lint).
// Threshold: ≥ 0.8 → near-duplicate.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Similarity helpers (mirrored from outbound-lint; no cross-require to avoid
//    circular dependency) ───────────────────────────────────────────────────────

function tokenize(s) {
  return new Set((s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
}

function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const t of setA) { if (setB.has(t)) intersection++; }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Combine client + title + first 300 chars of description into one fingerprint
function briefFingerprint(client, brief) {
  const parts = [
    client || '',
    brief.title || '',
    (brief.description || brief.brief || '').slice(0, 300)
  ];
  return parts.join(' ');
}

// ── Registry path ─────────────────────────────────────────────────────────────

function repoRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch (_) {
    throw new Error('project-registry: cannot determine repo root');
  }
}

function registryPath() {
  return path.join(repoRoot(), '_dev/state/delesign/created-projects.json');
}

function readRegistry() {
  const p = registryPath();
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * recordProject(projectId, client, brief)
 * Appends a new entry to the registry after a successful createProject call.
 * Returns the written entry.
 */
function recordProject(projectId, client, brief) {
  const p = registryPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const entries = readRegistry();
  const descField = (brief.description || brief.brief || '');
  const entry = {
    projectId: String(projectId),
    client: client || '',
    title: brief.title || '',
    briefSnippet: descField.slice(0, 300),
    createdAt: new Date().toISOString()
  };
  entries.push(entry);
  fs.writeFileSync(p, JSON.stringify(entries, null, 2) + '\n', 'utf8');
  return entry;
}

/**
 * findNearDuplicate(client, brief, opts)
 * Returns the most similar existing entry and its similarity score.
 *   { match: entry | null, similarity: number }
 * opts.threshold (default 0.8) — similarity at or above this triggers a match.
 */
function findNearDuplicate(client, brief, opts = {}) {
  const threshold = opts.threshold !== undefined ? opts.threshold : 0.8;
  const entries = readRegistry();
  if (entries.length === 0) return { match: null, similarity: 0 };

  const candidateTokens = tokenize(briefFingerprint(client, brief));

  let bestMatch = null;
  let bestSim = 0;

  for (const entry of entries) {
    const entryFingerprint = briefFingerprint(entry.client, {
      title: entry.title,
      description: entry.briefSnippet
    });
    const entryTokens = tokenize(entryFingerprint);
    const sim = jaccard(candidateTokens, entryTokens);
    if (sim > bestSim) {
      bestSim = sim;
      bestMatch = entry;
    }
  }

  return {
    match: bestSim >= threshold ? bestMatch : null,
    similarity: bestSim
  };
}

module.exports = { readRegistry, recordProject, findNearDuplicate };
