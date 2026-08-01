#!/usr/bin/env node

/**
 * Bundle Validator CLI
 *
 * Validates a developer handoff bundle for structural completeness,
 * schema conformance, cross-reference integrity, count consistency,
 * changelog presence, and content completeness.
 *
 * Usage:
 *   node tools/bundle/validate-handoff-bundle.js --bundle <path> [--json] [--warn-only]
 *
 * Exit 0 = all checks pass
 * Exit 1 = at least one FAIL
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { validate, loadSchemas } from './lib/schema-validator.js';
import { crossRefPaths } from './lib/path-cross-ref.js';
import { countQuestions } from './lib/question-counter.js';

// ---------------------------------------------------------------------------
// Resolve __dirname for ESM
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const bundlePath = getArg('--bundle');
const jsonOutput = args.includes('--json');
const warnOnly = args.includes('--warn-only');

if (!bundlePath) {
  console.error('Usage: node validate-handoff-bundle.js --bundle <path> [--json] [--warn-only]');
  process.exit(2);
}

const bundleDir = path.resolve(bundlePath);

if (!fs.existsSync(bundleDir) || !fs.statSync(bundleDir).isDirectory()) {
  console.error(`Error: bundle path does not exist or is not a directory: ${bundleDir}`);
  process.exit(2);
}

const bundleId = path.basename(bundleDir);

// ---------------------------------------------------------------------------
// Helper: safe JSON read
// ---------------------------------------------------------------------------
function readJsonSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function readTextSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

function fileExists(rel) {
  return fs.existsSync(path.join(bundleDir, rel));
}

function dirExists(rel) {
  const p = path.join(bundleDir, rel);
  return fs.existsSync(p) && fs.statSync(p).isDirectory();
}

function dirIsEmpty(rel) {
  const p = path.join(bundleDir, rel);
  if (!fs.existsSync(p)) return true;
  try {
    return fs.readdirSync(p).length === 0;
  } catch {
    return true;
  }
}

function isInsideBundle(absPath) {
  const relative = path.relative(bundleDir, absPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function collectBundleEntries(rootDir) {
  const entries = [];

  function walk(currentDir, relativeDir = '') {
    for (const dirent of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const relPath = path.posix.join(relativeDir, dirent.name);
      entries.push(dirent.isDirectory() ? `${relPath}/` : relPath);
      if (dirent.isDirectory()) {
        walk(path.join(currentDir, dirent.name), relPath);
      }
    }
  }

  walk(rootDir);
  return entries;
}

const bundleEntries = collectBundleEntries(bundleDir);

function normalizeReferencedPath(ref) {
  if (typeof ref !== 'string') return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;

  const fileMatch = trimmed.match(/^(.+\.(?:json|md|csv))(?:[:#].*)?$/);
  if (fileMatch) return fileMatch[1];

  return trimmed;
}

function looksLikeBundleReference(ref) {
  if (typeof ref !== 'string') return false;
  const trimmed = ref.trim();
  if (!trimmed) return false;
  if (path.isAbsolute(trimmed)) return true;
  if (trimmed.startsWith('../') || trimmed.startsWith('./')) return true;

  const literalRefs = new Set([
    'For_Recipient.md',
    'QUESTIONS_FOR_DEVELOPER.md',
    'INDEX.md',
    'INDEX.json',
    'LLM_MANIFEST.json',
    'SUMMARY.json',
    'AGENTS.md',
    'CLAUDE.md',
    '.cursorrules',
  ]);
  if (literalRefs.has(trimmed)) return true;

  return ['raw/', 'reports/', 'evidence/', 'llm/'].some(prefix => trimmed.startsWith(prefix));
}

function globToRegExp(globPattern) {
  const escaped = globPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

function bundleReferenceExists(ref) {
  const normalized = normalizeReferencedPath(ref);
  if (!normalized) {
    return { exists: false, normalized: ref, reason: 'invalid reference' };
  }

  if (path.isAbsolute(normalized)) {
    if (!isInsideBundle(normalized)) {
      return { exists: false, normalized, reason: 'absolute path points outside the bundle' };
    }
    return { exists: fs.existsSync(normalized), normalized };
  }

  const abs = path.resolve(bundleDir, normalized);
  if (!isInsideBundle(abs)) {
    return { exists: false, normalized, reason: 'relative path escapes the bundle' };
  }

  if (normalized.includes('*')) {
    const pattern = globToRegExp(normalized);
    const exists = bundleEntries.some(entry => pattern.test(entry));
    return { exists, normalized, reason: exists ? undefined : 'glob matched no bundle entries' };
  }

  return { exists: fs.existsSync(abs), normalized };
}

function extractCodeSpanBundleRefs(text) {
  const refs = [];
  const matches = text?.matchAll(/`([^`\n]+)`/g) || [];
  for (const match of matches) {
    const ref = normalizeReferencedPath(match[1]);
    if (looksLikeBundleReference(ref)) refs.push(ref);
  }
  return refs;
}

function validateDocReferences(fileName, text) {
  for (const ref of extractCodeSpanBundleRefs(text)) {
    const result = bundleReferenceExists(ref);
    const detail = result.exists ? undefined : result.reason || `Referenced path not found: ${ref}`;
    check('CROSS_REF', `${fileName} references ${result.normalized} within bundle`, result.exists ? 'PASS' : 'FAIL', detail);
  }
}

// ---------------------------------------------------------------------------
// Detect bundle version
// ---------------------------------------------------------------------------
const manifestJson = readJsonSafe(path.join(bundleDir, 'LLM_MANIFEST.json'));
const bundleVersion = manifestJson?.bundle_version || '3.0';
const isV2 = bundleVersion.startsWith('2.');

// ---------------------------------------------------------------------------
// Check collector
// ---------------------------------------------------------------------------
const checks = [];

function check(category, name, result, detail) {
  let finalResult = result;
  if (warnOnly && finalResult === 'FAIL') finalResult = 'WARN';
  checks.push({ category, name, result: finalResult, ...(detail ? { detail } : {}) });
}

// ---------------------------------------------------------------------------
// Category 1: STRUCTURAL
// ---------------------------------------------------------------------------
const STRUCTURAL_FILES_FAIL = [
  'For_Recipient.md',
  'QUESTIONS_FOR_DEVELOPER.md',
  'INDEX.md',
  'INDEX.json',
  'LLM_MANIFEST.json',
  'SUMMARY.json',
];
const STRUCTURAL_DIRS_FAIL = [
  'reports',
  'raw',
  'evidence',
];
const STRUCTURAL_LLM_FAIL = [
  'llm/LLM_MANIFEST.json',
  'llm/AGENTS.md',
  'llm/CLAUDE.md',
];
const STRUCTURAL_LLM_WARN = [
  'llm/.cursorrules',
  'llm/prompts',
];
const STRUCTURAL_ROOT_WARN = [
  'AGENTS.md',
  'CLAUDE.md',
  '.cursorrules',
];

for (const f of STRUCTURAL_FILES_FAIL) {
  const exists = fileExists(f);
  let level = exists ? 'PASS' : 'FAIL';
  // v2.0 downgrades
  if (!exists && isV2 && (f === 'SUMMARY.json')) level = 'WARN';
  check('STRUCTURAL', `${f} exists`, level);
}

for (const d of STRUCTURAL_DIRS_FAIL) {
  check('STRUCTURAL', `${d}/ directory exists`, dirExists(d) ? 'PASS' : 'FAIL');
}

// llm/ directory itself
check('STRUCTURAL', 'llm/ directory exists', dirExists('llm') ? 'PASS' : 'FAIL');

for (const f of STRUCTURAL_LLM_FAIL) {
  const isDir = f === 'llm/prompts';
  const exists = isDir ? dirExists(f) : fileExists(f);
  check('STRUCTURAL', `${f} exists`, exists ? 'PASS' : 'FAIL');
}

for (const f of STRUCTURAL_LLM_WARN) {
  const isDir = f === 'llm/prompts';
  const exists = isDir ? dirExists(f) : fileExists(f);
  // v3: these are required; v2: optional (WARN)
  const missingLevel = isV2 ? 'WARN' : 'FAIL';
  check('STRUCTURAL', `${f} exists`, exists ? 'PASS' : missingLevel, exists ? undefined : `${f} missing${isV2 ? ' (optional)' : ''}`);
}

for (const f of STRUCTURAL_ROOT_WARN) {
  const exists = fileExists(f);
  // v3: these are required; v2: optional (WARN)
  const missingLevel = isV2 ? 'WARN' : 'FAIL';
  check('STRUCTURAL', `${f} (root) exists`, exists ? 'PASS' : missingLevel, exists ? undefined : `${f} (root) missing${isV2 ? ' (optional)' : ''}`);
}

// ---------------------------------------------------------------------------
// Category 2: PROMPTS
// ---------------------------------------------------------------------------
// Use manifest's required_prompts as primary source; fall back to hardcoded baseline
// when manifest doesn't declare any. This ensures validation follows the generator contract.
const PROMPT_FILES_BASELINE = [
  'llm/prompts/13_PAYLOAD_DEEP_ANALYSIS_AND_{DEVELOPER_NAME}_HANDOFF.md',
  'llm/prompts/16_CHANGELOG_CAPTURE_FROM_DEV.md',
];
const requiredPromptFiles = new Set();
const manifestPrompts = manifestJson?.required_prompts;
if (Array.isArray(manifestPrompts) && manifestPrompts.length > 0) {
  for (const promptPath of manifestPrompts) {
    if (typeof promptPath === 'string' && promptPath.trim()) {
      requiredPromptFiles.add(promptPath);
    }
  }
} else {
  for (const f of PROMPT_FILES_BASELINE) {
    requiredPromptFiles.add(f);
  }
}

for (const f of requiredPromptFiles) {
  const exists = fileExists(f);
  // v3: required prompt copies must be present; v2: optional (WARN)
  const missingLevel = isV2 ? 'WARN' : 'FAIL';
  check('PROMPTS', `${f} exists`, exists ? 'PASS' : missingLevel, exists ? undefined : `Prompt copy missing${isV2 ? ' (optional)' : ''}`);
}

// ---------------------------------------------------------------------------
// Category 3: SCHEMA
// ---------------------------------------------------------------------------
const schemas = loadSchemas(path.join(__dirname, 'schemas'));

// LLM_MANIFEST.json
if (manifestJson) {
  const llmSchema = schemas.get('llm-manifest.schema.json');
  if (llmSchema) {
    const errs = validate(manifestJson, llmSchema);
    if (errs.length === 0) {
      check('SCHEMA', 'LLM_MANIFEST.json valid', 'PASS');
    } else {
      for (const e of errs) {
        check('SCHEMA', 'LLM_MANIFEST.json valid', 'FAIL', `${e.path} — ${e.message}`);
      }
    }
  }
} else if (fileExists('LLM_MANIFEST.json')) {
  check('SCHEMA', 'LLM_MANIFEST.json valid', 'FAIL', 'Failed to parse as JSON');
}

// SUMMARY.json
const summaryJson = readJsonSafe(path.join(bundleDir, 'SUMMARY.json'));
if (summaryJson) {
  const summarySchema = schemas.get('summary.schema.json');
  if (summarySchema) {
    const errs = validate(summaryJson, summarySchema);
    if (errs.length === 0) {
      check('SCHEMA', 'SUMMARY.json valid', 'PASS');
    } else {
      for (const e of errs) {
        const level = isV2 ? 'WARN' : 'FAIL';
        check('SCHEMA', 'SUMMARY.json valid', level, `${e.path} — ${e.message}`);
      }
    }
  }
} else if (fileExists('SUMMARY.json')) {
  const level = isV2 ? 'WARN' : 'FAIL';
  check('SCHEMA', 'SUMMARY.json valid', level, 'Failed to parse as JSON');
}

// INDEX.json
const indexJson = readJsonSafe(path.join(bundleDir, 'INDEX.json'));
if (indexJson) {
  const indexSchema = schemas.get('index.schema.json');
  if (indexSchema) {
    const errs = validate(indexJson, indexSchema);
    if (errs.length === 0) {
      check('SCHEMA', 'INDEX.json valid', 'PASS');
    } else {
      for (const e of errs) {
        check('SCHEMA', 'INDEX.json valid', 'FAIL', `${e.path} — ${e.message}`);
      }
    }
  }
}

// llm/LLM_MANIFEST.json should match root
const llmManifestCopy = readJsonSafe(path.join(bundleDir, 'llm', 'LLM_MANIFEST.json'));
if (manifestJson && llmManifestCopy) {
  const rootStr = JSON.stringify(manifestJson);
  const copyStr = JSON.stringify(llmManifestCopy);
  if (rootStr === copyStr) {
    check('SCHEMA', 'llm/LLM_MANIFEST.json matches root', 'PASS');
  } else {
    // v3: root and llm/ manifests must match exactly; v2: WARN only
    const level = isV2 ? 'WARN' : 'FAIL';
    check('SCHEMA', 'llm/LLM_MANIFEST.json matches root', level, 'llm/LLM_MANIFEST.json differs from root LLM_MANIFEST.json');
  }
}

// llm/LLM_MANIFEST.json exists but is invalid JSON
if (!llmManifestCopy && fileExists('llm/LLM_MANIFEST.json')) {
  const level = isV2 ? 'WARN' : 'FAIL';
  check('SCHEMA', 'llm/LLM_MANIFEST.json valid JSON', level, 'llm/LLM_MANIFEST.json exists but is not valid JSON');
}

// ---------------------------------------------------------------------------
// Category 4: CROSS_REF
// ---------------------------------------------------------------------------
if (indexJson && manifestJson) {
  const refs = crossRefPaths(bundleDir, indexJson, manifestJson);
  for (const ref of refs) {
    if (ref.exists) {
      check('CROSS_REF', `${ref.path} exists`, 'PASS');
    } else {
      check('CROSS_REF', `${ref.path} exists`, 'FAIL', `Referenced in ${ref.referenced_in}`);
    }
  }

  // WARN for evidence directories that exist but are empty
  if (Array.isArray(indexJson.runs)) {
    for (const run of indexJson.runs) {
      if (run.evidence_dir) {
        const absDir = path.resolve(bundleDir, run.evidence_dir);
        if (fs.existsSync(absDir) && fs.statSync(absDir).isDirectory()) {
          if (fs.readdirSync(absDir).length === 0) {
            check('CROSS_REF', `${run.evidence_dir} non-empty`, 'WARN', 'Evidence directory is empty');
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Category 5: COUNT_CONSISTENCY
// ---------------------------------------------------------------------------

// Q-### count vs manifest.open_questions_count
const questionsPath = path.join(bundleDir, 'QUESTIONS_FOR_DEVELOPER.md');
if (manifestJson && fs.existsSync(questionsPath)) {
  const { count: actualQCount } = countQuestions(questionsPath);
  const declaredCount = manifestJson.open_questions_count;
  if (typeof declaredCount === 'number') {
    if (actualQCount === declaredCount) {
      check('COUNT_CONSISTENCY', 'open_questions_count matches Q-### count', 'PASS');
    } else {
      check('COUNT_CONSISTENCY', 'open_questions_count matches Q-### count', 'FAIL',
        `LLM_MANIFEST declares ${declaredCount}, found ${actualQCount} Q-### IDs`);
    }
  }
}

// runs[] count: manifest vs index
if (manifestJson && indexJson) {
  const mCount = Array.isArray(manifestJson.runs) ? manifestJson.runs.length : 0;
  const iCount = Array.isArray(indexJson.runs) ? indexJson.runs.length : 0;
  if (mCount === iCount) {
    check('COUNT_CONSISTENCY', 'LLM_MANIFEST runs count == INDEX runs count', 'PASS');
  } else {
    check('COUNT_CONSISTENCY', 'LLM_MANIFEST runs count == INDEX runs count', 'FAIL',
      `LLM_MANIFEST: ${mCount}, INDEX: ${iCount}`);
  }
}

// runs[] count: summary vs manifest
if (summaryJson && manifestJson) {
  const sCount = Array.isArray(summaryJson.runs) ? summaryJson.runs.length : 0;
  const mCount = Array.isArray(manifestJson.runs) ? manifestJson.runs.length : 0;
  if (sCount === mCount) {
    check('COUNT_CONSISTENCY', 'SUMMARY runs count == LLM_MANIFEST runs count', 'PASS');
  } else {
    check('COUNT_CONSISTENCY', 'SUMMARY runs count == LLM_MANIFEST runs count', 'FAIL',
      `SUMMARY: ${sCount}, LLM_MANIFEST: ${mCount}`);
  }
}

// open_questions count: summary vs manifest
if (summaryJson && manifestJson) {
  const sqCount = Array.isArray(summaryJson.open_questions) ? summaryJson.open_questions.length : 0;
  const mqCount = typeof manifestJson.open_questions_count === 'number' ? manifestJson.open_questions_count : 0;
  if (sqCount === mqCount) {
    check('COUNT_CONSISTENCY', 'SUMMARY open_questions count == LLM_MANIFEST open_questions_count', 'PASS');
  } else {
    const oqLevel = isV2 ? 'WARN' : 'FAIL';
    check('COUNT_CONSISTENCY', 'SUMMARY open_questions count == LLM_MANIFEST open_questions_count', oqLevel,
      `SUMMARY: ${sqCount}, LLM_MANIFEST: ${mqCount}`);
  }
}

// ---------------------------------------------------------------------------
// Category 6: CHANGELOG
// ---------------------------------------------------------------------------
if (manifestJson) {
  if (manifestJson.changelog_status === 'PRESENT') {
    const clExists = fileExists('raw/dev_changelog.md');
    if (clExists) {
      check('CHANGELOG', 'raw/dev_changelog.md exists (status=PRESENT)', 'PASS');
    } else {
      check('CHANGELOG', 'raw/dev_changelog.md exists (status=PRESENT)', 'FAIL',
        'changelog_status is PRESENT but raw/dev_changelog.md not found');
    }
  } else if (manifestJson.changelog_status === 'ABSENT') {
    check('CHANGELOG', 'changelog_status is ABSENT', 'WARN', 'No developer changelog included (informational)');
  }
}

// changelog checklist schema
const checklistPath = path.join(bundleDir, 'raw', 'dev_changelog.checklist.json');
const checklistJson = readJsonSafe(checklistPath);
if (checklistJson) {
  const clSchema = schemas.get('changelog-checklist.schema.json');
  if (clSchema) {
    const errs = validate(checklistJson, clSchema);
    if (errs.length === 0) {
      check('CHANGELOG', 'raw/dev_changelog.checklist.json valid', 'PASS');
    } else {
      for (const e of errs) {
        check('CHANGELOG', 'raw/dev_changelog.checklist.json valid', 'WARN',
          `${e.path} — ${e.message}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Category 7: MANAGED_MARKERS
// ---------------------------------------------------------------------------

/**
 * Validate MANAGED section marker integrity in a file.
 * Checks for: mismatched START/END pairs, orphaned markers, and duplicates.
 */
function validateManagedMarkers(text, fileName) {
  if (!text) return;
  const startPattern = /<!-- MANAGED:([A-Z_]+):START -->/g;
  const endPattern = /<!-- MANAGED:([A-Z_]+):END -->/g;

  const starts = new Map();
  const ends = new Map();
  let m;

  while ((m = startPattern.exec(text)) !== null) {
    const name = m[1];
    starts.set(name, (starts.get(name) || 0) + 1);
  }
  while ((m = endPattern.exec(text)) !== null) {
    const name = m[1];
    ends.set(name, (ends.get(name) || 0) + 1);
  }

  // Collect all section names
  const allNames = new Set([...starts.keys(), ...ends.keys()]);

  if (allNames.size === 0) {
    // No managed markers at all — that's fine (legacy or fully hand-authored)
    return;
  }

  for (const name of allNames) {
    const startCount = starts.get(name) || 0;
    const endCount = ends.get(name) || 0;

    if (startCount > 1) {
      check('MANAGED_MARKERS', `${fileName} MANAGED:${name} unique START`, 'FAIL',
        `Found ${startCount} START markers for MANAGED:${name} (expected 1)`);
    } else if (startCount === 0) {
      check('MANAGED_MARKERS', `${fileName} MANAGED:${name} has START`, 'FAIL',
        `Found END marker for MANAGED:${name} but no matching START`);
    }

    if (endCount > 1) {
      check('MANAGED_MARKERS', `${fileName} MANAGED:${name} unique END`, 'FAIL',
        `Found ${endCount} END markers for MANAGED:${name} (expected 1)`);
    } else if (endCount === 0) {
      check('MANAGED_MARKERS', `${fileName} MANAGED:${name} has END`, 'FAIL',
        `Found START marker for MANAGED:${name} but no matching END`);
    }

    if (startCount === 1 && endCount === 1) {
      // Check ordering: START must come before END
      const startIdx = text.indexOf(`<!-- MANAGED:${name}:START -->`);
      const endIdx = text.indexOf(`<!-- MANAGED:${name}:END -->`);
      if (startIdx > endIdx) {
        check('MANAGED_MARKERS', `${fileName} MANAGED:${name} ordered`, 'FAIL',
          `END marker appears before START marker for MANAGED:${name}`);
      } else {
        check('MANAGED_MARKERS', `${fileName} MANAGED:${name} well-formed`, 'PASS');
      }
    }
  }
}

// Run marker validation on key files
const forAllenTextForMarkers = readTextSafe(path.join(bundleDir, 'For_Recipient.md'));
validateManagedMarkers(forAllenTextForMarkers, 'For_Recipient.md');

const questionsTextForMarkers = readTextSafe(path.join(bundleDir, 'QUESTIONS_FOR_DEVELOPER.md'));
validateManagedMarkers(questionsTextForMarkers, 'QUESTIONS_FOR_DEVELOPER.md');

// ---------------------------------------------------------------------------
// Category 8: CONTENT_COMPLETENESS
// ---------------------------------------------------------------------------

// <!-- LLM: markers
const forAllenText = readTextSafe(path.join(bundleDir, 'For_Recipient.md'));
if (forAllenText !== null) {
  const hasMarkers = /<!--\s*LLM:/i.test(forAllenText);
  const level = hasMarkers ? (isV2 ? 'WARN' : 'FAIL') : 'PASS';
  check('CONTENT_COMPLETENESS', 'For_Recipient.md has no <!-- LLM: markers', level,
    hasMarkers ? 'Contains unfilled LLM placeholder markers' : undefined);
  validateDocReferences('For_Recipient.md', forAllenText);
}

const questionsText = readTextSafe(path.join(bundleDir, 'QUESTIONS_FOR_DEVELOPER.md'));
if (questionsText !== null) {
  const hasMarkers = /<!--\s*LLM:/i.test(questionsText);
  const level = hasMarkers ? (isV2 ? 'WARN' : 'FAIL') : 'PASS';
  check('CONTENT_COMPLETENESS', 'QUESTIONS_FOR_DEVELOPER.md has no <!-- LLM: markers', level,
    hasMarkers ? 'Contains unfilled LLM placeholder markers' : undefined);
  validateDocReferences('QUESTIONS_FOR_DEVELOPER.md', questionsText);
}

const indexMdText = readTextSafe(path.join(bundleDir, 'INDEX.md'));
if (indexMdText !== null) {
  validateDocReferences('INDEX.md', indexMdText);
}

// SUMMARY.json status != draft
if (summaryJson) {
  const isDraft = summaryJson.status === 'draft';
  const level = isDraft ? (isV2 ? 'WARN' : 'FAIL') : 'PASS';
  check('CONTENT_COMPLETENESS', 'SUMMARY.json status != draft', level,
    isDraft ? 'SUMMARY.json still has status="draft"' : undefined);

  if (Array.isArray(summaryJson.open_questions)) {
    for (const question of summaryJson.open_questions) {
      if (!question?.evidence_path) continue;
      const result = bundleReferenceExists(question.evidence_path);
      const detail = result.exists ? undefined : result.reason || `Referenced path not found: ${question.evidence_path}`;
      check(
        'CROSS_REF',
        `SUMMARY.json open_questions ${question.id || '(unknown)'} evidence path ${result.normalized} exists`,
        result.exists ? 'PASS' : 'FAIL',
        detail
      );
    }
  }

  if (summaryJson.evidence_paths && typeof summaryJson.evidence_paths === 'object') {
    for (const [key, ref] of Object.entries(summaryJson.evidence_paths)) {
      if (typeof ref !== 'string' || !looksLikeBundleReference(ref)) continue;
      const result = bundleReferenceExists(ref);
      const detail = result.exists ? undefined : result.reason || `Referenced path not found: ${ref}`;
      check(
        'CROSS_REF',
        `SUMMARY.json evidence_paths.${key} ${result.normalized} exists`,
        result.exists ? 'PASS' : 'FAIL',
        detail
      );
    }
  }
}

const contentManifest = readJsonSafe(path.join(bundleDir, 'content-manifest.json'));
if (contentManifest && summaryJson?.status === 'complete') {
  const pending = Array.isArray(contentManifest.files_needing_content)
    ? contentManifest.files_needing_content.length
    : 0;
  check(
    'CONTENT_COMPLETENESS',
    'content-manifest.json is empty when SUMMARY.json status=complete',
    pending === 0 ? 'PASS' : 'FAIL',
    pending === 0 ? undefined : `Found ${pending} file(s) still listed in files_needing_content`
  );
}

// reports/ not empty
if (dirExists('reports')) {
  const empty = dirIsEmpty('reports');
  check('CONTENT_COMPLETENESS', 'reports/ is non-empty', empty ? 'FAIL' : 'PASS',
    empty ? 'reports/ directory exists but is empty' : undefined);
}

// key_issues empty arrays warning
if (manifestJson && Array.isArray(manifestJson.runs)) {
  const emptyIssues = manifestJson.runs.filter(
    r => Array.isArray(r.key_issues) && r.key_issues.length === 0
  );
  if (emptyIssues.length > 0) {
    check('CONTENT_COMPLETENESS', 'LLM_MANIFEST runs have key_issues populated', 'WARN',
      `${emptyIssues.length} run(s) have empty key_issues arrays`);
  } else if (manifestJson.runs.length > 0) {
    check('CONTENT_COMPLETENESS', 'LLM_MANIFEST runs have key_issues populated', 'PASS');
  }
}

// ---------------------------------------------------------------------------
// v2.0 informational note
// ---------------------------------------------------------------------------
if (isV2) {
  check('STRUCTURAL', 'Bundle version note', 'WARN',
    'Bundle is v2.0; some v3.0 checks downgraded to WARN');
}

// ---------------------------------------------------------------------------
// Tally results
// ---------------------------------------------------------------------------
const counts = { pass: 0, fail: 0, warn: 0 };
for (const c of checks) {
  if (c.result === 'PASS') counts.pass++;
  else if (c.result === 'FAIL') counts.fail++;
  else if (c.result === 'WARN') counts.warn++;
}

const overallResult = counts.fail > 0 ? 'FAIL' : 'PASS';

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
if (jsonOutput) {
  const output = {
    bundle_id: bundleId,
    bundle_dir: bundleDir,
    result: overallResult,
    counts,
    checks,
  };
  console.log(JSON.stringify(output, null, 2));
} else {
  const sep = '='.repeat(51);
  console.log('');
  console.log(sep);
  console.log(`Bundle Validation: ${bundleId}`);
  console.log(sep);
  console.log('');

  // Group by category
  const categories = [];
  const catMap = new Map();
  for (const c of checks) {
    if (!catMap.has(c.category)) {
      catMap.set(c.category, []);
      categories.push(c.category);
    }
    catMap.get(c.category).push(c);
  }

  for (const cat of categories) {
    console.log(cat);
    for (const c of catMap.get(cat)) {
      const icon = c.result === 'PASS' ? '\u2713 PASS' : c.result === 'FAIL' ? '\u2717 FAIL' : '\u26A0 WARN';
      const prefix = c.result === 'PASS' ? '  \u2713 PASS' : c.result === 'FAIL' ? '  \u2717 FAIL' : '  \u26A0 WARN';
      const detail = c.detail ? `: ${c.detail}` : '';
      console.log(`${prefix}  ${c.name}${detail}`);
    }
    console.log('');
  }

  console.log(sep);
  console.log(`Result: ${overallResult} (${counts.pass} pass, ${counts.fail} fail, ${counts.warn} warn)`);
  console.log(sep);
  console.log('');
}

process.exit(overallResult === 'FAIL' ? 1 : 0);
