#!/usr/bin/env node
/**
 * verify-report-claims.cjs — Validates an audit report's claims against disk.
 *
 * Uses the VerificationSignal/1.0 contract via shared signal library.
 *
 * Checks:
 *   1. Every "file:line" citation points to a real file with valid line range
 *   2. Every "MISSING: path" claim is confirmed (file truly missing)
 *   3. Required report sections are present
 *   4. Inventory counts match disk
 *   5. No stale contradictions (claims MISSING but file exists)
 *
 * Usage: node verify-report-claims.cjs <report-file> [project-root] [--output=path]
 *
 * Exit code 0 = PASS/WARN, 1 = FAIL
 */

const fs = require('fs');
const path = require('path');
const { createSignal, addCheck, writeSignal, printSummary, printJsonOutput } = require('./lib/signal.cjs');
const checks = require('./lib/checks.cjs');
const { resolveContainedPath } = require('../reconciliation/lib/evidence-binding.cjs');
const { sha256 } = require('../reconciliation/lib/normalized-content-hash.cjs');

function verifyClaimManifest(manifest, projectRoot) {
  if (process.env.REPORT_CLAIM_MANIFEST_V1 === '0') {
    return { schema: 'ReportClaimVerdict/1.0', state: 'disabled', semantic_status: 'unverified', claims: [], authority: 'structural_only', can_rewrite_report: false };
  }
  const reportBoundary = resolveContainedPath(projectRoot, manifest && manifest.report_path);
  if (reportBoundary.state !== 'contained') {
    return { schema: 'ReportClaimVerdict/1.0', state: reportBoundary.state === 'out_of_bounds' ? 'out_of_bounds' : 'missing', semantic_status: 'unverified', claims: [], authority: 'structural_only', can_rewrite_report: false };
  }
  const claims = [];
  for (const claim of Array.isArray(manifest && manifest.claims) ? manifest.claims : []) {
    const resolved = resolveContainedPath(projectRoot, claim.path, { allow_missing: true });
    let state = 'missing';
    let reason = resolved.reason || resolved.state;
    if (claim.type === 'path_missing') {
      state = resolved.state === 'missing' ? 'structural_pass' : resolved.state === 'contained' ? 'stale' : 'out_of_bounds';
      reason = state === 'structural_pass' ? 'path_is_missing' : 'missing_claim_not_confirmed';
    } else if (resolved.state !== 'contained') {
      state = resolved.state === 'out_of_bounds' ? 'out_of_bounds' : 'missing';
    } else if (claim.type === 'citation_exists') {
      if (!claim.expected_sha256) {
        state = 'unsupported_query'; reason = 'citation_requires_expected_sha256';
      } else {
        const bytes = fs.readFileSync(resolved.path);
        if (sha256(bytes) !== claim.expected_sha256) {
          state = 'stale'; reason = 'citation_content_hash_changed';
        } else if (claim.line && claim.line > bytes.toString('utf8').split('\n').length) {
          state = 'stale'; reason = 'citation_line_out_of_range';
        } else {
          state = 'structural_pass'; reason = 'citation_path_hash_and_line_valid';
        }
      }
    } else if (claim.type === 'file_count') {
      if (!claim.filename || /[*?\[\]{}]/.test(claim.filename) || !Number.isInteger(claim.expected_count) || !fs.statSync(resolved.path).isDirectory()) {
        state = 'unsupported_query'; reason = 'file_count_requires_bounded_directory_exact_filename_and_count';
      } else {
        const count = fs.readdirSync(resolved.path, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name === claim.filename).length;
        state = count === claim.expected_count ? 'structural_pass' : 'stale';
        reason = `observed_count_${count}`;
      }
    } else {
      state = 'unsupported_query'; reason = 'claim_type_unsupported';
    }
    claims.push({ id: String(claim.id || ''), state, reason, semantic_status: state === 'structural_pass' ? 'requires_model_review' : 'unverified' });
  }
  const state = claims.every((claim) => claim.state === 'structural_pass') ? 'structural_pass'
    : claims.some((claim) => claim.state === 'out_of_bounds') ? 'out_of_bounds'
      : claims.some((claim) => claim.state === 'unsupported_query') ? 'unsupported_query'
        : claims.some((claim) => claim.state === 'stale') ? 'stale' : 'missing';
  return { schema: 'ReportClaimVerdict/1.0', state, semantic_status: state === 'structural_pass' ? 'requires_model_review' : 'unverified', claims, authority: 'structural_only', can_rewrite_report: false };
}

const positionalArgs = process.argv.slice(2).filter(a => !a.startsWith('--'));
const reportPath = positionalArgs[0];
const projectRoot = positionalArgs[1] || process.cwd();
const outputArg = process.argv.find(a => a.startsWith('--output='));
const defaultOut = path.join(__dirname, '..', '..', '_dev', 'reports', 'signals', 'verify-report-claims.signal.json');
const outputPath = outputArg ? outputArg.split('=')[1] : defaultOut;
const claimManifestArg = process.argv.find(a => a.startsWith('--claim-manifest='));

if (claimManifestArg) {
  const manifestPath = claimManifestArg.slice('--claim-manifest='.length);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    console.error(`Claim manifest is not valid JSON: ${error.message}`);
    process.exit(2);
  }
  const Ajv2020 = require('ajv/dist/2020');
  const manifestSchema = JSON.parse(fs.readFileSync(path.join(__dirname, 'schemas', 'report-claim-manifest.schema.json'), 'utf8'));
  const validateManifest = new Ajv2020({ strict: false }).compile(manifestSchema);
  if (!validateManifest(manifest)) {
    console.error(`Claim manifest schema invalid: ${JSON.stringify(validateManifest.errors)}`);
    process.exit(2);
  }
  const claimProjectRoot = positionalArgs[0] || process.cwd();
  const verdict = verifyClaimManifest(manifest, claimProjectRoot);
  if (outputArg) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(verdict, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  process.exit(verdict.state === 'structural_pass' || verdict.state === 'disabled' ? 0 : 1);
}

if (!reportPath) {
  console.error('Usage: node verify-report-claims.cjs <report-file> [project-root] [--output=path]');
  process.exit(2);
}

if (!fs.existsSync(reportPath)) {
  console.error(`Report file not found: ${reportPath}`);
  process.exit(2);
}

const reportContent = fs.readFileSync(reportPath, 'utf8');
const signal = createSignal('verify-report-claims', `audit report: ${path.basename(reportPath)}`);

// ─── Check 1: Verify file:line citations ────────────────────────────────────

const fileLineRegex = /`([^`\s]+\.[a-z]{1,4}):(\d+)`/g;
const lineRefRegex = /([^\s`]+\.[a-z]{1,4}),?\s*lines?\s*(\d+)/gi;
const citedFiles = new Set();
let match;

while ((match = fileLineRegex.exec(reportContent)) !== null) {
  const filePath = match[1];
  const lineNum = parseInt(match[2]);
  const fullPath = path.join(projectRoot, filePath);
  const exists = fs.existsSync(fullPath);
  citedFiles.add(filePath);

  addCheck(signal, {
    id: `citation.${filePath.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 60)}.L${lineNum}`,
    category: 'citations', severity: 'critical',
    message: `Citation exists: ${filePath}:${lineNum}`,
    status: exists ? 'PASS' : 'FAIL',
    evidence: fullPath,
    detail: exists ? `File exists (line ${lineNum} cited)` : 'STALE CITATION: File does not exist',
    fix_hint: exists ? undefined : `File ${filePath} no longer exists. Update or remove the citation.`
  });

  if (exists && lineNum > 0) {
    const content = fs.readFileSync(fullPath, 'utf8');
    const lineCount = content.split('\n').length;
    addCheck(signal, {
      id: `citation_range.${filePath.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50)}.L${lineNum}`,
      category: 'citations', severity: 'warning',
      message: `Line ${lineNum} in range for ${filePath}`,
      status: lineNum <= lineCount ? 'PASS' : 'WARN',
      detail: `Line ${lineNum} of ${lineCount}`,
      fix_hint: lineNum > lineCount ? `Line ${lineNum} exceeds file length (${lineCount} lines). Update citation.` : undefined
    });
  }
}

// Additional "line NN" style references
while ((match = lineRefRegex.exec(reportContent)) !== null) {
  const filePath = match[1];
  const lineNum = parseInt(match[2]);
  if (filePath.startsWith('http')) continue;
  if (citedFiles.has(filePath)) continue;
  citedFiles.add(filePath);

  const fullPath = path.join(projectRoot, filePath);
  const exists = fs.existsSync(fullPath);
  addCheck(signal, {
    id: `citation_lineref.${filePath.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 60)}`,
    category: 'citations', severity: 'critical',
    message: `Line-ref citation exists: ${filePath} line ${lineNum}`,
    status: exists ? 'PASS' : 'FAIL',
    evidence: fullPath,
    fix_hint: exists ? undefined : `File ${filePath} not found. Update or remove citation.`
  });
}

// ─── Check 2: Verify MISSING claims ────────────────────────────────────────

const missingRegex = /MISSING:\s*`?([^`\n(]+)`?\s*\(?/g;
while ((match = missingRegex.exec(reportContent)) !== null) {
  const filePath = match[1].trim();
  if (filePath.startsWith('http')) continue;
  const fullPath = path.join(projectRoot, filePath);
  const isTrulyMissing = !fs.existsSync(fullPath);

  addCheck(signal, {
    id: `missing_claim.${filePath.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 60)}`,
    category: 'missing_claims', severity: 'critical',
    message: `MISSING claim verified: ${filePath}`,
    status: isTrulyMissing ? 'PASS' : 'FAIL',
    detail: isTrulyMissing ? 'Confirmed missing' : `FALSE POSITIVE: File actually exists at ${fullPath}`,
    fix_hint: isTrulyMissing ? undefined : `Report claims "${filePath}" is MISSING but it exists. Update the report.`
  });
}

// ─── Check 3: Required report sections ──────────────────────────────────────

const REQUIRED_SECTIONS = [
  'Assessment',
  'Critical Issues',
  'Recommendation',
  'Inventory',
  'Requirements Coverage',
  'Next Step'
];

for (const section of REQUIRED_SECTIONS) {
  addCheck(signal, checks.fileContains(reportPath, section, {
    id: `section.${section.replace(/\s+/g, '_').toLowerCase()}`,
    category: 'structure', severity: 'warning',
    message: `Report has "${section}" section`
  }));
}

// ─── Check 4: Inventory counts (disk spot-check) ───────────────────────────

function countFiles(baseDir, filename) {
  let count = 0;
  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '_template' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === filename) count++;
        else if (filename === '*.md' && entry.name.endsWith('.md')) count++;
      }
    } catch {}
  }
  walk(baseDir);
  return count;
}

const frameworkSkillCount = countFiles(path.join(projectRoot, '.claude', 'skills', 'framework'), 'SKILL.md');
const frameworkCmdCount = countFiles(path.join(projectRoot, '.claude', 'commands', 'framework'), '*.md');
const frameworkAgentCount = countFiles(path.join(projectRoot, '.claude', 'agents', 'framework'), '*.md');

addCheck(signal, {
  id: 'inventory.skills_present', category: 'inventory', severity: 'critical',
  message: `Framework skills found on disk`,
  status: frameworkSkillCount > 0 ? 'PASS' : 'FAIL',
  detail: `${frameworkSkillCount} SKILL.md files in .claude/skills/framework/`,
  fix_hint: frameworkSkillCount === 0 ? 'No skills found — verify .claude/skills/framework/ exists' : undefined
});

addCheck(signal, {
  id: 'inventory.commands_present', category: 'inventory', severity: 'critical',
  message: `Framework commands found on disk`,
  status: frameworkCmdCount > 0 ? 'PASS' : 'FAIL',
  detail: `${frameworkCmdCount} .md files in .claude/commands/framework/`,
  fix_hint: frameworkCmdCount === 0 ? 'No commands found — verify .claude/commands/framework/ exists' : undefined
});

addCheck(signal, {
  id: 'inventory.agents_present', category: 'inventory', severity: 'critical',
  message: `Framework agents found on disk`,
  status: frameworkAgentCount > 0 ? 'PASS' : 'FAIL',
  detail: `${frameworkAgentCount} .md files in .claude/agents/framework/`,
  fix_hint: frameworkAgentCount === 0 ? 'No agents found — verify .claude/agents/framework/ exists' : undefined
});

// ─── Check 5: Citation count sanity ─────────────────────────────────────────

addCheck(signal, {
  id: 'sanity.has_citations', category: 'sanity', severity: 'warning',
  message: `Report contains file citations`,
  status: citedFiles.size > 0 ? 'PASS' : 'WARN',
  detail: `${citedFiles.size} unique files cited`
});

// ─── Finalize and Output ──────────────────────────────────────────────────

if (!printJsonOutput(signal)) {
  writeSignal(signal, outputPath);
  printSummary(signal);
  console.log(`\nSignal: ${outputPath}`);
}

process.exit(signal.gate_decision.proceed ? 0 : 1);
