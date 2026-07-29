'use strict';

/**
 * Output Contract — Structural Validation Library
 *
 * SCOPE: This module performs STRUCTURAL validation only (Tier 1).
 * It checks file existence, directory layout, JSON schema conformance,
 * naming patterns, cross-reference integrity, and count consistency.
 *
 * It does NOT and CANNOT assess content quality, business correctness,
 * reasoning depth, or semantic completeness. Those concerns require
 * LLM-driven semantic review (Tier 2), handled by the output-reviewer
 * agent (.claude/agents/output-reviewer.md).
 *
 * A "ready: true" result from this module means the output STRUCTURE
 * is valid. It says nothing about whether the output CONTENT is good.
 */

const path = require('path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { exists, isDir, isFile, readJson, listFiles, listFilesRecursive } = require('./fs');
const { loadSchema, validateRequiredFields } = require('./models');

/**
 * Load an output contract from a framework manifest.
 * Returns output_contract_v2 if present, else wraps output_contract in compatibility mode.
 */
function loadOutputContract(manifestPath) {
  const manifest = readJson(manifestPath);
  const findings = [];

  if (manifest.output_contract_v2) {
    validateRequiredFields(manifest.output_contract_v2, loadSchema('output-contract-v2.schema.json'), 'output_contract_v2');
    return { contract: manifest.output_contract_v2, compatibility: false, findings };
  }

  if (manifest.output_contract) {
    const v1 = manifest.output_contract;
    const wrapped = {
      directories: Array.isArray(v1.directories)
        ? v1.directories.map((d) => ({ path: d, required: false, description: '' }))
        : [],
      artifacts: Array.isArray(v1.artifacts)
        ? v1.artifacts.map((a) => ({ name: a, required: false }))
        : [],
      bundle_types: []
    };
    findings.push({
      severity: 'info',
      code: 'V1_COMPAT',
      message: 'Using output_contract v1 in compatibility mode. Add output_contract_v2 for typed enforcement.',
      path: manifestPath
    });
    return { contract: wrapped, compatibility: true, findings };
  }

  findings.push({
    severity: 'info',
    code: 'NO_CONTRACT',
    message: 'No output contract found in manifest.',
    path: manifestPath
  });
  return { contract: { directories: [], artifacts: [], bundle_types: [] }, compatibility: true, findings };
}

/**
 * Resolve an output schema from {frameworkRoot}/schemas/output/{schemaRef}.
 */
function resolveOutputSchema(frameworkRoot, schemaRef) {
  const schemaPath = path.join(frameworkRoot, 'schemas', 'output', schemaRef);
  if (!exists(schemaPath)) {
    return null;
  }
  return readJson(schemaPath);
}

/**
 * Glob-like matching using minimatch-style patterns.
 * Supports only basic * wildcards (no ** or ?).
 */
function simpleGlob(baseDir, pattern) {
  const allFiles = listFilesRecursive(baseDir);
  const regex = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '{{GLOBSTAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/\{\{GLOBSTAR\}\}/g, '.*') +
      '$'
  );
  return allFiles.filter((f) => regex.test(f));
}

/**
 * Check directories and glob-matched artifacts exist under outputRoot.
 */
function inspectOutputDir(outputRoot, contract) {
  const findings = [];

  for (const dir of contract.directories || []) {
    const dirPath = path.join(outputRoot, dir.path);
    if (!exists(dirPath) || !isDir(dirPath)) {
      findings.push({
        severity: dir.required ? 'blocker' : 'warning',
        code: 'DIR_MISSING',
        message: `Directory not found: ${dir.path}`,
        path: dirPath
      });
    }
  }

  for (const artifact of contract.artifacts || []) {
    if (!artifact.path_pattern) continue;
    const matches = simpleGlob(outputRoot, artifact.path_pattern);
    if (matches.length === 0) {
      findings.push({
        severity: artifact.required ? 'blocker' : 'warning',
        code: 'ARTIFACT_MISSING',
        message: `No files matching pattern: ${artifact.path_pattern}`,
        path: outputRoot
      });
    }
  }

  return findings;
}

/**
 * Inspect a single bundle against its bundle_type definition.
 */
function inspectBundle(bundleRoot, bundleType, frameworkRoot) {
  const findings = [];

  // Check required files
  for (const file of bundleType.required_files || []) {
    const filePath = path.join(bundleRoot, file);
    if (!exists(filePath) || !isFile(filePath)) {
      findings.push({
        severity: 'blocker',
        code: 'BUNDLE_FILE_MISSING',
        message: `Required bundle file missing: ${file}`,
        path: filePath
      });
    }
  }

  // Check required file patterns
  for (const pattern of bundleType.required_file_patterns || []) {
    const matches = simpleGlob(bundleRoot, pattern);
    if (matches.length === 0) {
      findings.push({
        severity: 'blocker',
        code: 'BUNDLE_PATTERN_MISSING',
        message: `No files matching required pattern: ${pattern}`,
        path: bundleRoot
      });
    }
  }

  // Check required directories
  for (const dir of bundleType.required_directories || []) {
    const dirPath = path.join(bundleRoot, dir);
    if (!exists(dirPath) || !isDir(dirPath)) {
      findings.push({
        severity: 'blocker',
        code: 'BUNDLE_DIR_MISSING',
        message: `Required bundle directory missing: ${dir}`,
        path: dirPath
      });
    }
  }

  // Validate JSON artifacts against file_schemas
  for (const [fileName, schemaRef] of Object.entries(bundleType.file_schemas || {})) {
    const filePath = path.join(bundleRoot, fileName);
    if (!exists(filePath) || !isFile(filePath)) continue; // already reported as missing

    let content;
    try {
      content = readJson(filePath);
    } catch (err) {
      findings.push({
        severity: 'blocker',
        code: 'BUNDLE_FILE_INVALID_JSON',
        message: `${fileName} is not valid JSON: ${err.message}`,
        path: filePath
      });
      continue;
    }

    const schema = resolveOutputSchema(frameworkRoot, schemaRef);
    if (!schema) {
      findings.push({
        severity: 'warning',
        code: 'SCHEMA_NOT_FOUND',
        message: `Output schema not found: ${schemaRef}`,
        path: path.join(frameworkRoot, 'schemas', 'output', schemaRef)
      });
      continue;
    }

    try {
      validateRequiredFields(content, schema, fileName);
    } catch (err) {
      findings.push({
        severity: 'blocker',
        code: 'BUNDLE_SCHEMA_FAIL',
        message: `${fileName} schema validation failed: ${err.message}`,
        path: filePath
      });
    }
  }

  // Run consistency checks if bundle has the key files
  const consistencyFindings = checkBundleConsistency(bundleRoot, frameworkRoot);
  findings.push(...consistencyFindings);

  return findings;
}

/**
 * Cross-artifact consistency checks within a bundle.
 */
function checkBundleConsistency(bundleRoot, frameworkRoot) {
  const findings = [];

  // Load manifest and index if they exist
  const manifestPath = path.join(bundleRoot, 'LLM_MANIFEST.json');
  const indexPath = path.join(bundleRoot, 'INDEX.json');

  let manifest = null;
  let index = null;

  if (isFile(manifestPath)) {
    try {
      manifest = readJson(manifestPath);
    } catch {
      // Already reported by schema validation
    }
  }

  if (isFile(indexPath)) {
    try {
      index = readJson(indexPath);
    } catch {
      // Already reported by schema validation
    }
  }

  // 1. Referenced paths exist — check LLM_MANIFEST.json paths
  if (manifest) {
    const pathFields = [];
    if (manifest.canonical_changelog_path) pathFields.push(manifest.canonical_changelog_path);
    if (Array.isArray(manifest.entry_points)) {
      for (const ep of manifest.entry_points) {
        if (typeof ep === 'string') pathFields.push(ep);
        else if (ep && ep.path) pathFields.push(ep.path);
      }
    }
    for (const ref of pathFields) {
      const refPath = path.join(bundleRoot, ref);
      if (!exists(refPath)) {
        findings.push({
          severity: 'blocker',
          code: 'BROKEN_PATH_REF',
          message: `Referenced path in LLM_MANIFEST.json does not exist: ${ref}`,
          path: refPath
        });
      }
    }
  }

  // 2. Run counts match — info only
  if (manifest && index) {
    const manifestRunCount = Array.isArray(manifest.runs) ? manifest.runs.length : 0;
    const indexArtifactCount = Array.isArray(index.artifacts) ? index.artifacts.length : 0;
    const reportsDir = path.join(bundleRoot, 'reports');
    const reportFiles = exists(reportsDir) ? listFiles(reportsDir).filter((f) => f.endsWith('.md')) : [];

    if (manifestRunCount > 0 && reportFiles.length > 0 && manifestRunCount !== reportFiles.length) {
      findings.push({
        severity: 'info',
        code: 'RUN_COUNT_MISMATCH',
        message: `LLM_MANIFEST.json declares ${manifestRunCount} run(s) but reports/ contains ${reportFiles.length} report file(s).`,
        path: bundleRoot
      });
    }
  }

  // 3. Question counts match — info only
  const questionsPath = path.join(bundleRoot, 'QUESTIONS_FOR_DEVELOPER.md');
  const forFiles = exists(bundleRoot)
    ? listFiles(bundleRoot).filter((f) => f.startsWith('For_') && f.endsWith('.md'))
    : [];

  if (isFile(questionsPath) && forFiles.length > 0) {
    // Just note if both exist — counting questions requires parsing markdown
    // which is fragile. Info-level only.
  }

  // 4. Changelog consistency — blocker
  if (manifest && manifest.changelog_status === 'PRESENT') {
    const changelogPath = path.join(bundleRoot, 'raw', 'dev_changelog.md');
    if (!exists(changelogPath)) {
      findings.push({
        severity: 'blocker',
        code: 'CHANGELOG_MISSING',
        message: 'LLM_MANIFEST.json declares changelog_status: "PRESENT" but raw/dev_changelog.md does not exist.',
        path: changelogPath
      });
    }
  }

  // 5. Required harness files — info
  const llmDir = path.join(bundleRoot, 'llm');
  if (isDir(llmDir)) {
    const llmManifest = path.join(llmDir, 'LLM_MANIFEST.json');
    const llmAgents = path.join(llmDir, 'AGENTS.md');
    if (!isFile(llmManifest)) {
      findings.push({
        severity: 'info',
        code: 'HARNESS_MISSING',
        message: 'llm/LLM_MANIFEST.json not found in harness directory.',
        path: llmManifest
      });
    }
    if (!isFile(llmAgents)) {
      findings.push({
        severity: 'info',
        code: 'HARNESS_MISSING',
        message: 'llm/AGENTS.md not found in harness directory.',
        path: llmAgents
      });
    }

    // Check llm/prompts/ is not empty
    const promptsDir = path.join(llmDir, 'prompts');
    if (isDir(promptsDir)) {
      const promptFiles = listFiles(promptsDir);
      if (promptFiles.length === 0) {
        findings.push({
          severity: 'info',
          code: 'HARNESS_PROMPTS_EMPTY',
          message: 'llm/prompts/ directory exists but contains no files.',
          path: promptsDir
        });
      }
    }
  }

  // 6. Report pairs — info
  if (manifest && Array.isArray(manifest.runs)) {
    const reportsDir = path.join(bundleRoot, 'reports');
    if (isDir(reportsDir)) {
      const reportFiles = listFiles(reportsDir);
      for (const run of manifest.runs) {
        const runId = run.run_id || run.id || '';
        if (!runId) continue;
        const hasCanonical = reportFiles.some((f) => f.includes(runId) && f.includes('PROCESSED_PAYLOAD'));
        const hasDeep = reportFiles.some((f) => f.includes(runId) && f.includes('deep_analysis'));
        if (hasCanonical && !hasDeep) {
          findings.push({
            severity: 'info',
            code: 'REPORT_PAIR_INCOMPLETE',
            message: `Run ${runId} has a canonical payload report but no deep analysis report.`,
            path: reportsDir
          });
        }
      }
    }
  }

  // 7. Open-first references — info
  for (const forFile of forFiles) {
    const forPath = path.join(bundleRoot, forFile);
    try {
      const content = require('fs').readFileSync(forPath, 'utf8');
      if (!content.includes('QUESTIONS_FOR_DEVELOPER') && isFile(questionsPath)) {
        findings.push({
          severity: 'info',
          code: 'FOR_FILE_MISSING_REF',
          message: `${forFile} does not reference QUESTIONS_FOR_DEVELOPER.md.`,
          path: forPath
        });
      }
    } catch {
      // Skip if unreadable
    }
  }

  return findings;
}

/**
 * Combined inspection: directories + artifacts + all matching bundle_types.
 */
function inspectOutputs(outputRoot, contract, frameworkRoot) {
  const findings = [];

  // Inspect directories and loose artifacts
  findings.push(...inspectOutputDir(outputRoot, contract));

  // Inspect each bundle_type
  for (const bundleType of contract.bundle_types || []) {
    const matches = simpleGlob(outputRoot, bundleType.path_pattern);
    if (matches.length === 0) {
      // Bundle directories won't appear as files in listFilesRecursive.
      // Check for matching directories directly.
      const parentDir = path.dirname(bundleType.path_pattern);
      const dirPattern = path.basename(bundleType.path_pattern);
      const searchDir = path.join(outputRoot, parentDir);
      const dirRegex = new RegExp(
        '^' +
          dirPattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*') +
          '$'
      );
      if (isDir(searchDir)) {
        const subdirs = require('fs')
          .readdirSync(searchDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && dirRegex.test(d.name))
          .map((d) => d.name);

        if (subdirs.length === 0) {
          // No matching bundles found — not a blocker, bundles may not exist yet
          findings.push({
            severity: 'info',
            code: 'NO_BUNDLES_FOUND',
            message: `No bundles matching pattern: ${bundleType.path_pattern}`,
            path: searchDir
          });
        } else {
          for (const subdir of subdirs) {
            const bundleRoot = path.join(searchDir, subdir);
            findings.push(...inspectBundle(bundleRoot, bundleType, frameworkRoot));
          }
        }
      }
    } else {
      // Matched files — unlikely for bundle dirs, but handle anyway
      for (const match of matches) {
        const bundleRoot = path.join(outputRoot, path.dirname(match));
        findings.push(...inspectBundle(bundleRoot, bundleType, frameworkRoot));
      }
    }
  }

  return findings;
}

/**
 * Centralized completion check.
 */
function computeOutputReadiness(findings) {
  const blockers = findings.filter((f) => f.severity === 'blocker');
  const warnings = findings.filter((f) => f.severity === 'warning');
  return {
    ready: blockers.length === 0,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    blockers,
    warnings,
    findings
  };
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function validateOutputBoundary(outputRoot, contract, stageReceipt = null) {
  if (process.env.OUTPUT_CONTRACT_V2_BOUNDARY === '0') {
    return {
      schema: 'FrameworkOutputBoundaryVerdict/1.0',
      structural_state: 'legacy',
      semantic_acceptance: 'not_evaluated',
      operator_acceptance: 'not_evaluated',
      findings: []
    };
  }

  const findings = [];
  const receiptArtifacts = new Map((stageReceipt && Array.isArray(stageReceipt.artifacts) ? stageReceipt.artifacts : [])
    .map((artifact) => [String(artifact.path || '').replaceAll(path.sep, '/'), artifact]));

  for (const artifact of contract.artifacts || []) {
    if (!artifact.path_pattern) continue;
    const matches = simpleGlob(outputRoot, artifact.path_pattern);
    for (const relativePath of matches) {
      const normalizedPath = relativePath.replaceAll(path.sep, '/');
      const receipt = receiptArtifacts.get(normalizedPath);
      const actualSha256 = fileSha256(path.join(outputRoot, relativePath));
      if (artifact.hash_required) {
        if (!receipt || typeof receipt.sha256 !== 'string') {
          findings.push({ severity: 'blocker', code: 'ARTIFACT_DIGEST_RECEIPT_MISSING', message: `Digest receipt missing: ${normalizedPath}`, path: normalizedPath });
        } else if (receipt.sha256 !== actualSha256) {
          findings.push({ severity: 'blocker', code: 'ARTIFACT_DIGEST_MISMATCH', message: `Computed digest does not match receipt: ${normalizedPath}`, path: normalizedPath });
        }
      }
      if (artifact.producer_stage) {
        const observedProducer = receipt && receipt.producer_stage || stageReceipt && stageReceipt.producer_stage;
        if (observedProducer !== artifact.producer_stage) {
          findings.push({ severity: 'blocker', code: 'ARTIFACT_PRODUCER_MISMATCH', message: `Producer stage mismatch: ${normalizedPath}`, path: normalizedPath });
        }
      }
    }
  }

  return {
    schema: 'FrameworkOutputBoundaryVerdict/1.0',
    structural_state: findings.some((finding) => finding.severity === 'blocker') ? 'blocked' : 'pass',
    semantic_acceptance: 'not_evaluated',
    operator_acceptance: 'not_evaluated',
    findings
  };
}

module.exports = {
  loadOutputContract,
  resolveOutputSchema,
  inspectOutputDir,
  inspectBundle,
  inspectOutputs,
  checkBundleConsistency,
  computeOutputReadiness,
  validateOutputBoundary
};
