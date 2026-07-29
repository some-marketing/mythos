'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const TAGS_PATH = path.join(PROJECT_ROOT, 'instructions', 'canonical', 'similarity-tags.json');
const METHODOLOGY_PATH = path.join(PROJECT_ROOT, 'instructions', 'canonical', 'framework-methodology-manifest.json');

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeTokens(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, ' ')
    .split(/[\s\-_]+/)
    .filter((word) => word.length > 2);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildTagSet(tags) {
  const axes = tags && tags.axes && typeof tags.axes === 'object' ? tags.axes : {};
  const result = {};
  for (const [axis, values] of Object.entries(axes)) {
    result[axis] = new Set(Array.isArray(values) ? values.map(normalizeId) : []);
  }
  return result;
}

function validateSimilarityTagObject(similarityTags, tagSet, basePath, errors, options = {}) {
  const allowLifecycleState = options.allowLifecycleState === true;

  if (!similarityTags || typeof similarityTags !== 'object' || Array.isArray(similarityTags)) {
    errors.push({ path: basePath, message: 'similarity_tags must be an object keyed by controlled tag axis.' });
    return;
  }

  for (const [axis, values] of Object.entries(similarityTags)) {
    if (axis === 'lifecycle_state' && !allowLifecycleState) {
      errors.push({
        path: `${basePath}/${axis}`,
        message: 'Framework-local similarity_tags must not declare lifecycle_state. Lifecycle belongs to canonical methodology records only.'
      });
      continue;
    }
    if (!tagSet[axis]) {
      errors.push({ path: `${basePath}/${axis}`, message: `Unknown similarity tag axis "${axis}".` });
      continue;
    }
    if (!Array.isArray(values)) {
      errors.push({ path: `${basePath}/${axis}`, message: `Similarity tag axis "${axis}" must be an array.` });
      continue;
    }
    for (const rawTag of values) {
      const tag = normalizeId(rawTag);
      if (!tagSet[axis].has(tag)) {
        errors.push({ path: `${basePath}/${axis}`, message: `Unknown ${axis} tag "${tag}".` });
      }
    }
  }
}

function loadSimilarityTags(projectRoot = PROJECT_ROOT) {
  return safeReadJson(path.join(projectRoot, 'instructions', 'canonical', 'similarity-tags.json'));
}

function loadMethodologyManifest(projectRoot = PROJECT_ROOT) {
  return safeReadJson(path.join(projectRoot, 'instructions', 'canonical', 'framework-methodology-manifest.json'));
}

function recordText(record) {
  const parts = [
    record.id,
    record.kind,
    record.title,
    record.summary
  ];

  const tags = record.similarity_tags || {};
  for (const values of Object.values(tags)) {
    if (Array.isArray(values)) parts.push(...values);
  }

  if (Array.isArray(record.reuse_constraints)) parts.push(...record.reuse_constraints);
  if (Array.isArray(record.source_refs)) {
    for (const ref of record.source_refs) {
      if (ref && typeof ref === 'object') {
        parts.push(ref.path, ref.label);
      }
    }
  }

  return parts.filter(Boolean).join(' ');
}

function validateMethodologyRecords(projectRoot = PROJECT_ROOT) {
  const tags = loadSimilarityTags(projectRoot);
  const manifest = loadMethodologyManifest(projectRoot);
  const errors = [];
  const warnings = [];

  if (!tags || !tags.axes) {
    errors.push({ path: '/similarity-tags', message: 'Could not load controlled similarity tag vocabulary.' });
    return { ok: false, errors, warnings, records: [] };
  }
  if (!manifest || !Array.isArray(manifest.records)) {
    errors.push({ path: '/framework-methodology-manifest/records', message: 'Could not load framework methodology records.' });
    return { ok: false, errors, warnings, records: [] };
  }

  const tagSet = buildTagSet(tags);
  const seenIds = new Set();

  for (let i = 0; i < manifest.records.length; i += 1) {
    const record = manifest.records[i] || {};
    const basePath = `/records/${i}`;
    const recordId = normalizeId(record.id);

    if (!recordId) {
      errors.push({ path: `${basePath}/id`, message: 'Methodology record must declare id.' });
    } else if (seenIds.has(recordId)) {
      errors.push({ path: `${basePath}/id`, message: `Duplicate methodology record id "${recordId}".` });
    } else {
      seenIds.add(recordId);
    }

    for (const key of ['kind', 'title', 'summary', 'lifecycle_state']) {
      if (!normalizeId(record[key])) {
        errors.push({ path: `${basePath}/${key}`, message: `Methodology record "${recordId || i}" must declare ${key}.` });
      }
    }

    const similarityTags = record.similarity_tags || {};
    if (!record.similarity_tags || typeof record.similarity_tags !== 'object' || Array.isArray(record.similarity_tags)) {
      errors.push({ path: `${basePath}/similarity_tags`, message: `Methodology record "${recordId || i}" must declare typed similarity_tags.` });
    } else {
      const populatedAxes = Object.values(similarityTags).filter((values) => Array.isArray(values) && values.length > 0);
      if (populatedAxes.length === 0) {
        errors.push({ path: `${basePath}/similarity_tags`, message: `Methodology record "${recordId || i}" must declare at least one typed similarity tag.` });
      }
    }

    validateSimilarityTagObject(similarityTags, tagSet, `${basePath}/similarity_tags`, errors, { allowLifecycleState: false });

    const lifecycle = normalizeId(record.lifecycle_state);
    if (lifecycle && tagSet.lifecycle_state && !tagSet.lifecycle_state.has(lifecycle)) {
      errors.push({ path: `${basePath}/lifecycle_state`, message: `Unknown lifecycle_state "${lifecycle}".` });
    }

    if (!Array.isArray(record.source_refs) || record.source_refs.length === 0) {
      errors.push({ path: `${basePath}/source_refs`, message: `Methodology record "${recordId || i}" must cite at least one source_ref.` });
    } else {
      for (let j = 0; j < record.source_refs.length; j += 1) {
        const sourceRef = record.source_refs[j] || {};
        const relPath = normalizeId(sourceRef.path);
        if (!relPath) {
          errors.push({ path: `${basePath}/source_refs/${j}/path`, message: 'source_ref.path is required.' });
          continue;
        }
        if (path.isAbsolute(relPath) || relPath.includes('..')) {
          errors.push({ path: `${basePath}/source_refs/${j}/path`, message: `source_ref.path must be repo-relative and non-traversing: "${relPath}".` });
          continue;
        }
        if (!fs.existsSync(path.join(projectRoot, relPath))) {
          errors.push({ path: `${basePath}/source_refs/${j}/path`, message: `source_ref.path does not exist: "${relPath}".` });
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    records: manifest.records
  };
}

function validateFrameworkMethodologyMetadata(manifest, projectRoot = PROJECT_ROOT, options = {}) {
  const tags = loadSimilarityTags(projectRoot);
  const methodology = validateMethodologyRecords(projectRoot);
  const errors = [];
  const warnings = [];
  const basePath = options.basePath || '';

  if (!manifest || typeof manifest !== 'object') {
    return {
      ok: false,
      errors: [{ path: basePath || '/', message: 'Manifest must be an object before methodology metadata can be validated.' }],
      warnings
    };
  }

  if (!tags || !tags.axes) {
    errors.push({ path: '/similarity-tags', message: 'Could not load controlled similarity tag vocabulary.' });
    return { ok: false, errors, warnings };
  }

  const tagSet = buildTagSet(tags);

  if (manifest.similarity_tags !== undefined) {
    validateSimilarityTagObject(manifest.similarity_tags, tagSet, `${basePath}/similarity_tags`, errors, {
      allowLifecycleState: false
    });
  }

  if (manifest.methodology_refs === undefined) {
    return { ok: errors.length === 0, errors, warnings };
  }

  if (!Array.isArray(manifest.methodology_refs)) {
    errors.push({ path: `${basePath}/methodology_refs`, message: 'methodology_refs must be an array when present.' });
    return { ok: false, errors, warnings };
  }

  if (!methodology.ok) {
    for (const error of methodology.errors) {
      errors.push({ path: `/methodology_registry${error.path || ''}`, message: error.message });
    }
    return { ok: false, errors, warnings };
  }

  const recordIds = new Set(methodology.records.map((record) => normalizeId(record.id)).filter(Boolean));
  const allowedRefKeys = new Set(['record_id', 'applies_to', 'notes', 'evidence_refs']);

  for (let i = 0; i < manifest.methodology_refs.length; i += 1) {
    const ref = manifest.methodology_refs[i] || {};
    const refPath = `${basePath}/methodology_refs/${i}`;
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
      errors.push({ path: refPath, message: 'methodology_refs entries must be objects.' });
      continue;
    }

    for (const key of Object.keys(ref)) {
      if (!allowedRefKeys.has(key)) {
        errors.push({
          path: `${refPath}/${key}`,
          message: `Unsupported methodology_refs field "${key}". Framework manifests may reference records, but must not copy canonical record fields or lifecycle state.`
        });
      }
    }

    const recordId = normalizeId(ref.record_id);
    if (!recordId) {
      errors.push({ path: `${refPath}/record_id`, message: 'methodology_refs entries must declare record_id.' });
    } else if (!recordIds.has(recordId)) {
      errors.push({ path: `${refPath}/record_id`, message: `Unknown methodology record "${recordId}".` });
    }

    if (ref.applies_to !== undefined && (!Array.isArray(ref.applies_to) || ref.applies_to.some((value) => !normalizeId(value)))) {
      errors.push({ path: `${refPath}/applies_to`, message: 'methodology_refs.applies_to must be an array of non-empty strings when present.' });
    }

    if (ref.notes !== undefined && !normalizeId(ref.notes)) {
      errors.push({ path: `${refPath}/notes`, message: 'methodology_refs.notes must be a non-empty string when present.' });
    }

    if (ref.evidence_refs !== undefined) {
      if (!Array.isArray(ref.evidence_refs)) {
        errors.push({ path: `${refPath}/evidence_refs`, message: 'methodology_refs.evidence_refs must be an array of repo-relative paths when present.' });
      } else {
        for (let j = 0; j < ref.evidence_refs.length; j += 1) {
          const relPath = normalizeId(ref.evidence_refs[j]);
          if (!relPath) {
            errors.push({ path: `${refPath}/evidence_refs/${j}`, message: 'evidence_refs entries must be non-empty strings.' });
            continue;
          }
          if (path.isAbsolute(relPath) || relPath.includes('..')) {
            errors.push({ path: `${refPath}/evidence_refs/${j}`, message: `evidence_refs entries must be repo-relative and non-traversing: "${relPath}".` });
            continue;
          }
          if (!fs.existsSync(path.join(projectRoot, relPath))) {
            errors.push({ path: `${refPath}/evidence_refs/${j}`, message: `evidence_ref does not exist: "${relPath}".` });
          }
          if (relPath.startsWith('clients/')) {
            errors.push({
              path: `${refPath}/evidence_refs/${j}`,
              message: `Methodology evidence_ref "${relPath}" is client-scoped. Framework manifests must not reference client-specific data.`
            });
          }
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function scoreMethodologyRecords(taskDescription, records) {
  const taskTokens = unique(normalizeTokens(taskDescription));
  const taskTokenSet = new Set(taskTokens);
  const matches = [];

  for (const record of records || []) {
    const tokens = unique(normalizeTokens(recordText(record)));
    if (tokens.length === 0 || taskTokens.length === 0) continue;

    const matchedTokens = tokens.filter((token) => taskTokenSet.has(token));
    const tags = record.similarity_tags || {};
    const matchedTags = {};
    const tagHits = [];

    for (const [axis, values] of Object.entries(tags)) {
      if (!Array.isArray(values)) continue;
      const axisHits = values.filter((tag) => normalizeTokens(tag).some((token) => taskTokenSet.has(token)));
      if (axisHits.length > 0) {
        matchedTags[axis] = axisHits;
        tagHits.push(...axisHits);
      }
    }

    const textScore = matchedTokens.length / Math.max(1, taskTokens.length);
    const tagScore = tagHits.length / Math.max(1, Object.values(tags).flat().length);
    const rawScore = (textScore * 0.7) + (tagScore * 0.3);
    const matchScore = Math.round(Math.min(1, rawScore) * 100);

    if (matchScore === 0) continue;

    matches.push({
      record_id: record.id,
      kind: record.kind,
      title: record.title,
      match_score: matchScore,
      matched_tokens: matchedTokens.slice(0, 12),
      matched_tags: matchedTags,
      source_refs: Array.isArray(record.source_refs) ? record.source_refs : [],
      reuse_constraints: Array.isArray(record.reuse_constraints) ? record.reuse_constraints : [],
      lifecycle_state: record.lifecycle_state || 'proposed'
    });
  }

  return matches
    .sort((a, b) => b.match_score - a.match_score || String(a.record_id).localeCompare(String(b.record_id)))
    .slice(0, 8);
}

module.exports = {
  METHODOLOGY_PATH,
  TAGS_PATH,
  loadMethodologyManifest,
  loadSimilarityTags,
  scoreMethodologyRecords,
  validateFrameworkMethodologyMetadata,
  validateMethodologyRecords
};
