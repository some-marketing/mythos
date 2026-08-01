#!/usr/bin/env node
/**
 * generate-handoff-bundle.js
 *
 * Assembles a handoff bundle from a structured bundle-input.json manifest.
 * Creates the full directory tree, copies evidence/artifacts, writes skeleton
 * files, and outputs a content-manifest.json telling the LLM what needs content.
 *
 * Usage:
 *   node tools/bundle/generate-handoff-bundle.js --input bundle-input.json [--output-dir path]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { readJsonSafe, writeJSON, writeText, mkdirp } from './lib/fs.js';
import { validateWithFile } from './lib/schema-validator.js';
import { isoCompact, bundleDirName, bundleSubDirs, canonicalReportName, deepAnalysisName, evidenceDirName, rawPayloadName, rawCsvName } from './lib/bundle-paths.js';
import { safeCp, copyEvidence, copyRawInputs } from './lib/copy-artifacts.js';
import { copyPrompts } from './lib/copy-prompts.js';
import { writeHarnessFiles } from './lib/generate-harness.js';
import { generateIndexJson, generateIndexMd } from './lib/generate-indexes.js';
import { generateManifest } from './lib/generate-manifest.js';
import { generateSummary } from './lib/generate-summary.js';
import { recipientSkeleton } from './templates/recipient-skeleton.js';
import { questionsSkeleton } from './templates/questions-skeleton.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMAS_DIR = path.join(__dirname, 'schemas');
const RECIPIENT_APPEND_BLOCK = 'BUNDLE_APPEND_MANAGED_BLOCK:FOR_{DEVELOPER_NAME}';
const QUESTIONS_APPEND_BLOCK = 'BUNDLE_APPEND_MANAGED_BLOCK:QUESTIONS';

// ── Argument parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '-h' || k === '--help') { a.help = true; continue; }
    if (k.startsWith('--')) {
      const eq = k.indexOf('=');
      if (eq !== -1) {
        a[k.slice(2, eq)] = k.slice(eq + 1);
        continue;
      }
      const key = k.slice(2);
      const val = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      a[key] = val;
    }
  }
  return a;
}

function printHelp() {
  console.log(`
generate-handoff-bundle.js — Assemble a dev handoff bundle from a manifest.

Usage:
  node tools/bundle/generate-handoff-bundle.js --input bundle-input.json [--output-dir path]

Options:
  --input <path>       Required. Path to bundle-input.json manifest.
  --output-dir <path>  Optional. Parent directory for the bundle. Defaults to playwright_phased_runner/dev_handoff/.
  -h, --help           Show this help.

Modes:
  create  — Build a new bundle from scratch.
  append  — Add runs to an existing bundle (requires existing_bundle_path in input).

Output:
  Prints BUNDLE_DIR=<path> and CONTENT_MANIFEST=<path> on success.
`.trim());
}

function die(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// ── Main ────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv);
if (args.help) { printHelp(); process.exit(0); }

const inputPath = args.input || args['input-file'];
if (!inputPath) die('--input <path> is required. Use -h for help.');

const resolvedInput = path.resolve(inputPath);
if (!fs.existsSync(resolvedInput)) die(`Input file not found: ${resolvedInput}`);

const input = readJsonSafe(resolvedInput);
if (!input) die(`Failed to parse input file: ${resolvedInput}`);

// Validate input against schema
const schemaPath = path.join(SCHEMAS_DIR, 'bundle-input.schema.json');
const validationErrors = validateWithFile(input, schemaPath);
if (validationErrors.length > 0) {
  console.error('Input validation errors:');
  for (const err of validationErrors) {
    console.error(`  ${err.path || '/'}: ${err.message}`);
  }
  process.exit(1);
}

const projectRoot = path.resolve(input.project_root || process.cwd());

if (input.mode === 'create') {
  runCreate(input, projectRoot);
} else if (input.mode === 'append') {
  runAppend(input, projectRoot);
} else {
  die(`Unknown mode: ${input.mode}`);
}

// ── CREATE mode ─────────────────────────────────────────────────────────────

function runCreate(input, projectRoot) {
  const createdAt = new Date().toISOString();
  const ts = isoCompact(new Date(createdAt));
  const bundleId = bundleDirName(input.recipient, ts);
  const bundleRuns = input.runs.map(run => normalizeInputRun(run, indexRunEntryForAppend(run, ts)));

  const outputParent = args['output-dir']
    ? path.resolve(args['output-dir'])
    : path.join(projectRoot, 'playwright_phased_runner', 'dev_handoff');

  const bundleDir = path.join(outputParent, bundleId);
  if (fs.existsSync(bundleDir)) die(`Bundle directory already exists: ${bundleDir}`);

  // Create directory tree
  const dirs = bundleSubDirs(bundleDir);
  for (const d of Object.values(dirs)) {
    mkdirp(d);
  }

  // 1. Copy evidence per run
  for (const run of input.runs) {
    if (run.evidence_dir) {
      const evDest = path.join(dirs.evidence, evidenceDirName(run.form_id, run.run_id));
      copyEvidence(run.evidence_dir, evDest);
    }
  }

  // 2. Copy raw inputs per run
  for (const run of input.runs) {
    copyRawInputs(run, dirs.raw);
  }

  // 3. Copy changelog if present
  if (input.changelog?.status === 'PRESENT' && input.changelog.path) {
    const changelogSrc = path.resolve(projectRoot, input.changelog.path);
    safeCp(changelogSrc, path.join(dirs.raw, 'dev_changelog.md'));
  }

  // 4. Copy stakeholder answers if present
  if (input.stakeholder_gate?.triggered && input.stakeholder_gate.answers_content) {
    writeText(
      path.join(dirs.raw, 'stakeholder_answers.md'),
      input.stakeholder_gate.answers_content
    );
  }

  // 5. Copy prompts to llm/prompts/
  copyPrompts(projectRoot, dirs.llmPrompts);

  // 6. Write harness files
  writeHarnessFiles(bundleDir, bundleId, input.runs, input.scope);

  // 7. Generate and write LLM_MANIFEST.json (root + llm/ copy)
  const manifest = generateManifest(input, bundleId, createdAt);
  writeJSON(path.join(bundleDir, 'LLM_MANIFEST.json'), manifest);
  writeJSON(path.join(dirs.llm, 'LLM_MANIFEST.json'), manifest);

  // 8. Generate and write INDEX.json
  const indexExtra = {};
  if (input.changelog?.status === 'PRESENT') indexExtra.dev_changelog = 'raw/dev_changelog.md';
  if (input.stakeholder_gate?.triggered) indexExtra.stakeholder_answers = 'raw/stakeholder_answers.md';
  const indexJson = generateIndexJson(bundleId, createdAt, input.scope, input.runs, indexExtra);
  writeJSON(path.join(bundleDir, 'INDEX.json'), indexJson);

  // 9. Generate and write INDEX.md
  const indexMd = generateIndexMd(bundleId, createdAt, input.scope, bundleRuns);
  writeText(path.join(bundleDir, 'INDEX.md'), indexMd);

  // 10. Generate and write SUMMARY.json
  const summary = generateSummary(bundleId, createdAt, input.runs);
  writeJSON(path.join(bundleDir, 'SUMMARY.json'), summary);

  // 11. Write skeleton markdown files
  const changelogStatus = input.changelog?.status || 'ABSENT';
  const forAllen = recipientSkeleton(bundleId, input.scope, bundleRuns, changelogStatus, createdAt);
  writeText(path.join(bundleDir, 'For_Recipient.md'), forAllen);

  const questions = questionsSkeleton(bundleId, input.runs);
  writeText(path.join(bundleDir, 'QUESTIONS_FOR_DEVELOPER.md'), questions);

  // 12. Create empty report skeletons
  for (const run of input.runs) {
    const reportName = canonicalReportName(run.form_id, run.run_id, run.env, ts);
    writeText(path.join(dirs.reports, reportName), `# ${reportName}\n\n<!-- LLM: Write canonical payload report here -->\n`);

    const analysisName = deepAnalysisName(run.form_id, run.run_id);
    writeText(path.join(dirs.reports, analysisName), `# ${analysisName}\n\n<!-- LLM: Write deep analysis here -->\n`);
  }

  // 13. Write content-manifest.json
  const contentManifest = buildContentManifest(bundleDir, bundleId, ts, input.runs);
  writeJSON(path.join(bundleDir, 'content-manifest.json'), contentManifest);

  // Output
  console.log(`BUNDLE_DIR=${bundleDir}`);
  console.log(`CONTENT_MANIFEST=${path.join(bundleDir, 'content-manifest.json')}`);
}

// ── APPEND mode ─────────────────────────────────────────────────────────────

function runAppend(input, projectRoot) {
  const bundleDir = path.resolve(input.existing_bundle_path);
  if (!fs.existsSync(bundleDir)) die(`Existing bundle not found: ${bundleDir}`);

  const dirs = bundleSubDirs(bundleDir);
  const createdAt = new Date().toISOString();
  const ts = isoCompact(new Date(createdAt));

  mkdirp(dirs.raw);
  mkdirp(dirs.reports);
  mkdirp(dirs.evidence);
  mkdirp(dirs.llm);
  mkdirp(dirs.llmPrompts);

  // 1. Read existing bundle metadata (needed for dedup before copying artifacts)
  const existingIndexPath = path.join(bundleDir, 'INDEX.json');
  const existingIndex = readJsonSafe(existingIndexPath);
  if (!existingIndex) {
    die(`Append mode requires a parseable INDEX.json at ${existingIndexPath}`);
  }

  const existingManifestPath = path.join(bundleDir, 'LLM_MANIFEST.json');
  const existingManifest = readJsonSafe(existingManifestPath);
  if (!existingManifest) {
    die(`Append mode requires a parseable LLM_MANIFEST.json at ${existingManifestPath}`);
  }

  const bundleId = existingIndex.bundle_id || path.basename(bundleDir);
  const originalCreatedAt = existingIndex.created_at || createdAt;

  // 2. Deduplicate: skip runs whose key (form_id::run_id::env) already exists
  const existingRunKeys = new Set((existingIndex.runs || []).map(r => runKey(r)));
  const genuinelyNewRuns = [];
  for (const run of input.runs) {
    const key = runKey(run);
    if (existingRunKeys.has(key)) {
      console.error(`Warning: run ${key} already exists in bundle, skipping duplicate`);
    } else {
      genuinelyNewRuns.push(run);
    }
  }

  // 3. Copy evidence for genuinely new runs
  for (const run of genuinelyNewRuns) {
    if (run.evidence_dir) {
      const evDest = path.join(dirs.evidence, evidenceDirName(run.form_id, run.run_id));
      if (fs.existsSync(evDest) && !input.overwrite_policy) {
        console.error(`Warning: evidence dir exists, skipping (use overwrite_policy=true to overwrite): ${evDest}`);
        continue;
      }
      copyEvidence(run.evidence_dir, evDest);
    }
  }

  // 4. Copy raw inputs for genuinely new runs
  for (const run of genuinelyNewRuns) {
    copyRawInputs(run, dirs.raw);
  }

  // 5. Copy changelog if present in this append input
  if (input.changelog?.status === 'PRESENT' && input.changelog.path) {
    const changelogSrc = path.resolve(projectRoot, input.changelog.path);
    safeCp(changelogSrc, path.join(dirs.raw, 'dev_changelog.md'));
  }

  // 6. Copy stakeholder answers if present in this append input
  if (input.stakeholder_gate?.triggered && input.stakeholder_gate.answers_content) {
    writeText(
      path.join(dirs.raw, 'stakeholder_answers.md'),
      input.stakeholder_gate.answers_content
    );
  }

  // 7. Build merged runs list (existing + genuinely new) for regeneration
  const existingManifestRuns = new Map((existingManifest.runs || []).map(r => [runKey(r), r]));
  const existingRuns = existingIndex.runs || [];
  const newRunEntries = genuinelyNewRuns.map(r => indexRunEntryForAppend(r, ts));
  const allIndexRuns = [...existingRuns, ...newRunEntries];
  const allRunDescriptors = [
    ...existingRuns.map(r => normalizeExistingRun(r, existingManifestRuns.get(runKey(r)))),
    ...genuinelyNewRuns.map((r, index) => normalizeInputRun(r, newRunEntries[index])),
  ];
  const updatedScope = input.scope || existingManifest.scope || existingIndex.scope;

  // 8. Refresh v3 harness artifacts so append mode leaves a self-consistent bundle.
  copyPrompts(projectRoot, dirs.llmPrompts);
  writeHarnessFiles(bundleDir, bundleId, allRunDescriptors, updatedScope);

  // 9. Update INDEX.json using deterministic machine-owned sections while preserving
  // existing path references for historical runs.
  const indexExtra = {};
  if (input.changelog?.status === 'PRESENT' || existingIndex.raw_artifacts?.dev_changelog) {
    indexExtra.dev_changelog = 'raw/dev_changelog.md';
  }
  if ((input.stakeholder_gate?.triggered) || existingIndex.raw_artifacts?.stakeholder_answers) {
    indexExtra.stakeholder_answers = 'raw/stakeholder_answers.md';
  }
  const refreshedIndex = {
    ...existingIndex,
    bundle_id: bundleId,
    created_at: originalCreatedAt,
    scope: updatedScope,
    runs: allIndexRuns,
    summary_documents: {
      recipient: 'For_Recipient.md',
      questions: 'QUESTIONS_FOR_DEVELOPER.md',
      index_md: 'INDEX.md',
      index_json: 'INDEX.json',
    },
    raw_artifacts: mergeRawArtifacts(existingIndex.raw_artifacts, genuinelyNewRuns, indexExtra),
    llm_harness: {
      manifest: 'LLM_MANIFEST.json',
      agents: 'llm/AGENTS.md',
      claude: 'llm/CLAUDE.md',
    },
  };
  writeJSON(existingIndexPath, refreshedIndex);

  // 10. Update LLM_MANIFEST.json (root + llm/) while preserving authored content.
  const refreshedManifest = mergeManifest(existingManifest, genuinelyNewRuns, updatedScope, input);
  writeJSON(existingManifestPath, refreshedManifest);
  writeJSON(path.join(dirs.llm, 'LLM_MANIFEST.json'), refreshedManifest);

  // 11. Update SUMMARY.json, preserving existing high-signal authored content.
  const existingSummaryPath = path.join(bundleDir, 'SUMMARY.json');
  const existingSummary = readJsonSafe(existingSummaryPath);
  const refreshedSummary = mergeSummary(
    generateSummary(bundleId, originalCreatedAt, allRunDescriptors),
    existingSummary,
    genuinelyNewRuns,
    createdAt
  );
  writeJSON(existingSummaryPath, refreshedSummary);

  // 12. Regenerate INDEX.md from all runs (deterministic)
  const indexMd = generateIndexMd(bundleId, originalCreatedAt, updatedScope, allRunDescriptors);
  writeText(path.join(bundleDir, 'INDEX.md'), indexMd);

  // 13. Update content-bearing markdown without clobbering authored sections.
  const changelogStatus = refreshedManifest.changelog_status || input.changelog?.status || 'ABSENT';
  const existingRecipientText = safeReadText(path.join(bundleDir, 'For_Recipient.md'));
  writeText(
    path.join(bundleDir, 'For_Recipient.md'),
    updateRecipientAfterAppend(
      existingRecipientText,
      bundleId,
      updatedScope,
      allRunDescriptors,
      changelogStatus,
      originalCreatedAt
    )
  );

  const existingQuestionsText = safeReadText(path.join(bundleDir, 'QUESTIONS_FOR_DEVELOPER.md'));
  writeText(
    path.join(bundleDir, 'QUESTIONS_FOR_DEVELOPER.md'),
    updateQuestionsAfterAppend(existingQuestionsText, bundleId, allRunDescriptors)
  );

  // 14. Create empty report skeletons for genuinely new runs
  for (const run of genuinelyNewRuns) {
    const reportName = canonicalReportName(run.form_id, run.run_id, run.env, ts);
    writeText(path.join(dirs.reports, reportName), `# ${reportName}\n\n<!-- LLM: Write canonical payload report here -->\n`);

    const analysisName = deepAnalysisName(run.form_id, run.run_id);
    writeText(path.join(dirs.reports, analysisName), `# ${analysisName}\n\n<!-- LLM: Write deep analysis here -->\n`);
  }

  // 15. Write content-manifest.json for genuinely new runs only
  const contentManifest = buildContentManifest(bundleDir, bundleId, ts, genuinelyNewRuns);
  writeJSON(path.join(bundleDir, 'content-manifest.json'), contentManifest);

  console.log(`BUNDLE_DIR=${bundleDir}`);
  console.log(`CONTENT_MANIFEST=${path.join(bundleDir, 'content-manifest.json')}`);
}

function runKey(run) {
  return `${run.form_id}::${run.run_id}::${run.env}`;
}

function indexRunEntryForAppend(run, ts) {
  return {
    form_id: run.form_id,
    testcase: run.testcase_id,
    run_id: run.run_id,
    env: run.env,
    crm_table: run.crm_table || 'crd99_crmstagings',
    canonical_report: `reports/${canonicalReportName(run.form_id, run.run_id, run.env, ts)}`,
    deep_analysis: `reports/${deepAnalysisName(run.form_id, run.run_id)}`,
    sent_payload: `raw/${rawPayloadName(run.form_id, run.run_id, 'sent_payload', run.env)}`,
    expected_payload: `raw/${rawPayloadName(run.form_id, run.run_id, 'expected_payload', run.env)}`,
    evidence_dir: `evidence/${evidenceDirName(run.form_id, run.run_id)}/`,
  };
}

function normalizeExistingRun(indexRun, manifestRun) {
  return {
    form_id: indexRun.form_id,
    testcase_id: indexRun.testcase || manifestRun?.testcase || null,
    run_id: indexRun.run_id,
    env: indexRun.env,
    crm_table: indexRun.crm_table || manifestRun?.crm_table || 'crd99_crmstagings',
    form_type: manifestRun?.form_type || null,
    canonical_report: indexRun.canonical_report || null,
    deep_analysis: indexRun.deep_analysis || null,
    sent_payload: indexRun.sent_payload || null,
    expected_payload: indexRun.expected_payload || null,
    evidence_dir: indexRun.evidence_dir || null,
  };
}

function normalizeInputRun(run, indexRun) {
  return {
    form_id: run.form_id,
    testcase_id: run.testcase_id,
    run_id: run.run_id,
    env: run.env,
    crm_table: run.crm_table || 'crd99_crmstagings',
    form_type: run.form_type || null,
    canonical_report: indexRun?.canonical_report || null,
    deep_analysis: indexRun?.deep_analysis || null,
    sent_payload: indexRun?.sent_payload || null,
    expected_payload: indexRun?.expected_payload || null,
    evidence_dir: indexRun?.evidence_dir || null,
  };
}

function mergeRawArtifacts(existingRawArtifacts = {}, runs, extra = {}) {
  const merged = {
    sent_payloads: [...(existingRawArtifacts.sent_payloads || [])],
    expected_payloads: [...(existingRawArtifacts.expected_payloads || [])],
    crm_exports: [...(existingRawArtifacts.crm_exports || [])],
    wpforms_exports: [...(existingRawArtifacts.wpforms_exports || [])],
  };
  if (extra.stakeholder_answers || existingRawArtifacts.stakeholder_answers) {
    merged.stakeholder_answers = extra.stakeholder_answers || existingRawArtifacts.stakeholder_answers;
  }
  if (extra.dev_changelog || existingRawArtifacts.dev_changelog) {
    merged.dev_changelog = extra.dev_changelog || existingRawArtifacts.dev_changelog;
  }

  for (const run of runs) {
    pushUnique(merged.sent_payloads, `raw/${rawPayloadName(run.form_id, run.run_id, 'sent_payload', run.env)}`);
    pushUnique(merged.expected_payloads, `raw/${rawPayloadName(run.form_id, run.run_id, 'expected_payload', run.env)}`);
    if (run.crm_csv_path) {
      pushUnique(merged.crm_exports, `raw/${rawCsvName(run.form_id, run.run_id, 'crm_export')}`);
    }
    if (run.wpforms_csv_path) {
      pushUnique(merged.wpforms_exports, `raw/${rawCsvName(run.form_id, run.run_id, 'wpforms_export')}`);
    }
  }

  return merged;
}

function mergeManifest(existingManifest, newRuns, updatedScope, input) {
  const manifest = structuredClone(existingManifest);
  const mergedRuns = [...(manifest.runs || [])];

  for (const run of newRuns) {
    mergedRuns.push({
      form_id: run.form_id,
      testcase: run.testcase_id,
      run_id: run.run_id,
      env: run.env,
      crm_table: run.crm_table || 'crd99_crmstagings',
      form_type: run.form_type || null,
      t_score: null,
      lead_type_in_payload: null,
      key_issues: [],
    });
  }

  manifest.scope = updatedScope;
  manifest.runs = mergedRuns;

  // Update changelog metadata if provided in this append
  if (input?.changelog) {
    if (input.changelog.status) manifest.changelog_status = input.changelog.status;
    if (input.changelog.path) manifest.canonical_changelog_path = input.changelog.path;
    if (input.changelog.note) manifest.changelog_note = input.changelog.note;
  }

  // Update stakeholder gate metadata if provided in this append
  if (input?.stakeholder_gate) {
    manifest.stakeholder_gate = {
      triggered: input.stakeholder_gate.triggered,
      items_total: input.stakeholder_gate.items_total || manifest.stakeholder_gate?.items_total || 0,
      items_answered: input.stakeholder_gate.items_answered || manifest.stakeholder_gate?.items_answered || 0,
      items_categorized_issue: input.stakeholder_gate.items_categorized_issue || manifest.stakeholder_gate?.items_categorized_issue || 0,
      items_categorized_note: input.stakeholder_gate.items_categorized_note || manifest.stakeholder_gate?.items_categorized_note || 0,
    };
    if (input.stakeholder_gate.triggered) {
      manifest.stakeholder_gate.answers_file = 'raw/stakeholder_answers.md';
    }
  }

  return manifest;
}

function mergeSummary(baseSummary, existingSummary, newRuns, updatedAt) {
  const merged = structuredClone(baseSummary);

  if (existingSummary) {
    merged.status = existingSummary.status || merged.status;
    merged.created_at = existingSummary.created_at || merged.created_at;
    merged.key_findings = structuredClone(existingSummary.key_findings || []);
    merged.open_questions = structuredClone(existingSummary.open_questions || []);
    merged.known_issues = structuredClone(existingSummary.known_issues || []);
    if (existingSummary.evidence_paths && typeof existingSummary.evidence_paths === 'object') {
      merged.evidence_paths = structuredClone(existingSummary.evidence_paths);
    }

    const existingRuns = new Map(((existingSummary.runs || []).map(r => [runKey(r), r])));
    merged.runs = merged.runs.map(run => {
      const existing = existingRuns.get(runKey(run));
      return existing ? structuredClone(existing) : run;
    });
  }

  for (const run of newRuns) {
    const key = runKey(run);
    if (!merged.runs.some(existing => runKey(existing) === key)) {
      merged.runs.push({
        testcase: run.testcase_id,
        run_id: run.run_id,
        env: run.env,
        form_id: run.form_id,
        verdict: 'unknown',
      });
    }
  }

  merged.updated_at = updatedAt;
  return merged;
}

function safeReadText(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function hasLlmMarkers(text) {
  return /<!--\s*LLM:/i.test(text || '');
}

function hasManagedSections(text) {
  return /<!-- MANAGED:[A-Z_]+:START -->/.test(text || '');
}

function replaceManagedSection(text, name, content) {
  const start = `<!-- MANAGED:${name}:START -->`;
  const end = `<!-- MANAGED:${name}:END -->`;
  const block = `${start}\n${content}\n${end}`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'm');
  if (pattern.test(text)) {
    return text.replace(pattern, block);
  }
  return text;
}

function renderManagedMetadata(bundleId, scope, runCount, changelogStatus) {
  return [
    `**Bundle:** \`${bundleId}\``,
    `**Scope:** ${scope}`,
    `**Runs:** ${runCount}`,
    `**Changelog:** ${changelogStatus}`,
  ].join('\n');
}

function renderManagedRunIndex(runs, createdAt) {
  const ts = isoCompact(new Date(createdAt));
  const lines = [];
  for (const run of runs) {
    const reportPath = run.canonical_report || `reports/${canonicalReportName(run.form_id, run.run_id, run.env, ts)}`;
    const analysisPath = run.deep_analysis || `reports/${deepAnalysisName(run.form_id, run.run_id)}`;
    const evidencePath = run.evidence_dir || `evidence/${evidenceDirName(run.form_id, run.run_id)}/`;

    lines.push(`### ${run.form_id} / ${run.run_id} (Env ${run.env})`);
    lines.push('');
    lines.push(`- **Canonical report:** \`${reportPath}\``);
    lines.push(`- **Deep analysis:** \`${analysisPath}\``);
    lines.push(`- **Evidence:** \`${evidencePath}\``);
    lines.push('');
  }
  return lines.join('\n');
}

function renderManagedQuestionsMetadata(bundleId, runCount) {
  return [
    `**Bundle:** \`${bundleId}\``,
    `**Runs:** ${runCount}`,
  ].join('\n');
}

function replaceMetadataLine(text, label, value) {
  const line = `**${label}:** ${value}`;
  const pattern = new RegExp(`^\\*\\*${escapeRegExp(label)}:\\*\\*.*$`, 'm');
  if (pattern.test(text)) {
    return text.replace(pattern, line);
  }
  return text;
}

function updateRecipientAfterAppend(existingText, bundleId, scope, runs, changelogStatus, createdAt) {
  const skeleton = recipientSkeleton(bundleId, scope, runs, changelogStatus, createdAt);

  // Case 1: No existing text or still a skeleton (LLM markers present) → regenerate
  if (!existingText || hasLlmMarkers(existingText)) {
    return skeleton;
  }

  // Case 2: Has MANAGED section markers → update managed sections in-place
  if (hasManagedSections(existingText)) {
    let updated = existingText;
    updated = replaceManagedSection(updated, 'METADATA',
      renderManagedMetadata(bundleId, scope, runs.length, changelogStatus)
    );
    updated = replaceManagedSection(updated, 'RUN_INDEX',
      renderManagedRunIndex(runs, createdAt)
    );
    return updated.trimEnd() + '\n';
  }

  // Case 3: Legacy authored file (no managed markers) → metadata line replacement + trailing block
  let updated = existingText;
  updated = replaceMetadataLine(updated, 'Bundle', `\`${bundleId}\``);
  updated = replaceMetadataLine(updated, 'Scope', scope);
  updated = replaceMetadataLine(updated, 'Runs', `${runs.length}`);
  updated = replaceMetadataLine(updated, 'Changelog', changelogStatus);
  updated = upsertManagedBlock(
    updated,
    RECIPIENT_APPEND_BLOCK,
    renderRecipientAppendix(bundleId, scope, runs, changelogStatus, createdAt)
  );
  return updated.trimEnd() + '\n';
}

function updateQuestionsAfterAppend(existingText, bundleId, runs) {
  const skeleton = questionsSkeleton(bundleId, runs);

  // Case 1: No existing text or still a skeleton (LLM markers present) → regenerate
  if (!existingText || hasLlmMarkers(existingText)) {
    return skeleton;
  }

  // Case 2: Has MANAGED section markers → update managed sections in-place
  if (hasManagedSections(existingText)) {
    let updated = existingText;
    updated = replaceManagedSection(updated, 'METADATA',
      renderManagedQuestionsMetadata(bundleId, runs.length)
    );
    return updated.trimEnd() + '\n';
  }

  // Case 3: Legacy authored file (no managed markers) → trailing block
  return upsertManagedBlock(
    existingText,
    QUESTIONS_APPEND_BLOCK,
    renderQuestionsAppendix(bundleId, runs)
  ).trimEnd() + '\n';
}

function upsertManagedBlock(text, blockName, content) {
  const start = `<!-- ${blockName}:START -->`;
  const end = `<!-- ${blockName}:END -->`;
  const block = `${start}\n${content}\n${end}`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'm');

  if (pattern.test(text)) {
    return text.replace(pattern, block);
  }

  return `${text.trimEnd()}\n\n${block}\n`;
}

function renderRecipientAppendix(bundleId, scope, runs, changelogStatus, createdAt) {
  const lines = [];
  lines.push('## Machine-Managed Bundle Context');
  lines.push('');
  lines.push('This section is updated by append mode. Authored analysis above is preserved.');
  lines.push('');
  lines.push(`- Bundle: \`${bundleId}\``);
  lines.push(`- Scope: ${scope}`);
  lines.push(`- Runs: ${runs.length}`);
  lines.push(`- Changelog: ${changelogStatus}`);
  lines.push(`- Created: ${createdAt}`);
  lines.push('');
  lines.push('| Form ID | Testcase | Run | Env | Canonical report | Deep analysis | Evidence |');
  lines.push('|---------|----------|-----|-----|------------------|---------------|----------|');

  for (const run of runs) {
    lines.push(
      `| ${run.form_id} | ${run.testcase_id || ''} | ${run.run_id} | ${run.env} | ` +
      `\`${run.canonical_report || `reports/${canonicalReportName(run.form_id, run.run_id, run.env, isoCompact(new Date(createdAt)))}`}\` | ` +
      `\`${run.deep_analysis || `reports/${deepAnalysisName(run.form_id, run.run_id)}`}\` | ` +
      `\`${run.evidence_dir || `evidence/${evidenceDirName(run.form_id, run.run_id)}/`}\` |`
    );
  }

  return lines.join('\n');
}

function renderQuestionsAppendix(bundleId, runs) {
  const lines = [];
  lines.push('## Machine-Managed Bundle Context');
  lines.push('');
  lines.push('This section is updated by append mode. Authored questions above are preserved.');
  lines.push('');
  lines.push(`- Bundle: \`${bundleId}\``);
  lines.push(`- Runs: ${runs.length}`);
  lines.push('');
  lines.push('| Form ID | Testcase | Run | Env |');
  lines.push('|---------|----------|-----|-----|');

  for (const run of runs) {
    lines.push(`| ${run.form_id} | ${run.testcase_id || ''} | ${run.run_id} | ${run.env} |`);
  }

  return lines.join('\n');
}

function pushUnique(items, value) {
  if (!items.includes(value)) items.push(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Content manifest builder ────────────────────────────────────────────────

function buildContentManifest(bundleDir, bundleId, ts, runs) {
  const files = [];

  // Per-run reports
  for (const run of runs) {
    const reportName = canonicalReportName(run.form_id, run.run_id, run.env, ts);
    files.push({
      path: `reports/${reportName}`,
      type: 'canonical_report',
      run: { form_id: run.form_id, testcase_id: run.testcase_id, run_id: run.run_id, env: run.env },
    });

    const analysisName = deepAnalysisName(run.form_id, run.run_id);
    files.push({
      path: `reports/${analysisName}`,
      type: 'deep_analysis',
      run: { form_id: run.form_id, testcase_id: run.testcase_id, run_id: run.run_id, env: run.env },
    });
  }

  // Summary documents
  const markers = ['LLM:EXECUTIVE_SUMMARY'];
  for (const run of runs) {
    markers.push(`LLM:RUN_${run.form_id}`);
  }
  markers.push('LLM:CROSS_RUN_PATTERNS', 'LLM:OPEN_QUESTIONS', 'LLM:EVIDENCE_GUIDE');

  files.push({
    path: 'For_Recipient.md',
    type: 'summary',
    markers,
  });

  files.push({
    path: 'QUESTIONS_FOR_DEVELOPER.md',
    type: 'questions',
    markers: ['LLM:QUESTIONS'],
  });

  files.push({
    path: 'SUMMARY.json',
    type: 'summary_json',
    note: 'Update key_findings, open_questions, known_issues arrays',
  });

  files.push({
    path: 'LLM_MANIFEST.json',
    type: 'manifest',
    note: 'Update runs[].key_issues and open_questions_count',
  });

  return {
    bundle_dir: bundleDir,
    bundle_id: bundleId,
    created_at: new Date().toISOString(),
    files_needing_content: files,
  };
}
