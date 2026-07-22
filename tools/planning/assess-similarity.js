#!/usr/bin/env node
'use strict';

/**
 * assess-similarity.js — Core similarity engine for task-driven operational planning.
 *
 * Accepts a task description, reads all framework manifests from system.yaml,
 * scores each framework against the task using field-based matching, and returns
 * a ranked JSON result.
 *
 * Usage:
 *   node tools/planning/assess-similarity.js --task "description" [--client CODE] [--project ID] [--json]
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SYSTEM_YAML_PATH = path.join(PROJECT_ROOT, 'instructions', 'canonical', 'system.yaml');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Parse system.yaml — it is stored as JSON despite the .yaml extension.
 */
function loadSystemConfig() {
  const raw = safeReadJson(SYSTEM_YAML_PATH);
  if (!raw || !Array.isArray(raw.frameworks)) {
    console.error('ERROR: Could not load system.yaml or frameworks array missing.');
    process.exit(1);
  }
  return raw;
}

/**
 * Tokenize a string into normalized lowercase words for keyword matching.
 * Strips punctuation, splits on whitespace and common delimiters.
 */
function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, ' ')
    .split(/[\s\-_]+/)
    .filter(w => w.length > 2);
}

/**
 * Compute Jaccard-style overlap between two token sets.
 * Returns a value between 0 and 1.
 */
function tokenOverlap(tokensA, tokensB) {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Count how many tokens from source appear in target.
 * Returns ratio of matched source tokens.
 */
function containmentScore(sourceTokens, targetTokens) {
  if (sourceTokens.length === 0) return 0;
  const targetSet = new Set(targetTokens);
  let hits = 0;
  for (const t of sourceTokens) {
    if (targetSet.has(t)) hits++;
  }
  return hits / sourceTokens.length;
}

// ---------------------------------------------------------------------------
// Domain classification
// ---------------------------------------------------------------------------

const DOMAIN_KEYWORDS = {
  wordpress: ['wordpress', 'wp', 'site', 'page', 'plugin', 'theme', 'gutenberg', 'livecanvas', 'css', 'html', 'web', 'design', 'mockup', 'layout', 'seo', 'blog', 'content'],
  deliverables: ['presentation', 'slide', 'deck', 'document', 'report', 'deliverable', 'scope', 'version', 'reconciliation', 'audit', 'review', 'pptx', 'docx'],
  'project-management': ['task', 'project', 'dart', 'board', 'sprint', 'feedback', 'stakeholder', 'planning', 'collaboration', 'tracking', 'status'],
  meta: ['execution', 'normalization', 'framework', 'system', 'pipeline', 'process', 'workflow', 'automation']
};

function classifyTaskDomain(taskTokens) {
  const scores = {};
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    const kwSet = new Set(keywords);
    let hits = 0;
    for (const t of taskTokens) {
      if (kwSet.has(t)) hits++;
    }
    scores[domain] = hits;
  }
  return scores;
}

// ---------------------------------------------------------------------------
// Write-need detection
// ---------------------------------------------------------------------------

const WRITE_INDICATORS = ['create', 'build', 'write', 'generate', 'produce', 'implement', 'fix', 'patch', 'update', 'modify', 'scaffold', 'deploy', 'publish', 'edit', 'change', 'add'];
const READ_INDICATORS = ['review', 'audit', 'check', 'inspect', 'verify', 'analyze', 'compare', 'assess', 'evaluate', 'report', 'list', 'status', 'findings'];

function detectWriteNeed(taskTokens) {
  const writeHits = taskTokens.filter(t => WRITE_INDICATORS.includes(t)).length;
  const readHits = taskTokens.filter(t => READ_INDICATORS.includes(t)).length;
  if (writeHits > readHits) return 'write';
  if (readHits > writeHits) return 'read';
  return 'mixed';
}

// ---------------------------------------------------------------------------
// Workflow-pattern broadening
// ---------------------------------------------------------------------------

const WORKFLOW_PATTERNS = [
  {
    tag: 'tracking-event-validation',
    all: [['tracking', 'gtm', 'ga4', 'analytics', 'event', 'events'], ['verify', 'validate', 'test', 'audit', 'review', 'check']]
  },
  {
    tag: 'form-submission-testing',
    all: [['form', 'forms', 'wpform', 'wpforms', 'lead'], ['submit', 'submission', 'submissions', 'payload', 'crm']]
  },
  {
    tag: 'crm-payload-validation',
    all: [['crm', 'lead', 'payload', 'pipeline'], ['validate', 'verify', 'test', 'audit', 'field', 'fields']]
  },
  {
    tag: 'browser-functional-test',
    all: [['browser', 'playwright', 'site', 'page', 'form'], ['test', 'qa', 'verify', 'validate']]
  },
  {
    tag: 'visual-design-comparison',
    all: [['design', 'mockup', 'screenshot', 'visual'], ['compare', 'validate', 'review', 'match']]
  },
  {
    tag: 'scope-source-reconciliation',
    all: [['scope', 'proposal', 'source', 'inventory'], ['verify', 'reconcile', 'compare', 'count']]
  },
  {
    tag: 'document-version-diff',
    all: [['version', 'versions', 'draft', 'document'], ['diff', 'compare', 'reconcile', 'contradiction', 'contradictions']]
  },
  {
    tag: 'task-board-collaboration',
    all: [['dart', 'task', 'board', 'card'], ['plan', 'collaborate', 'writeback', 'subtask']]
  },
  {
    tag: 'framework-runtime-normalization',
    all: [['framework', 'harness', 'runtime', 'command'], ['normalize', 'standardize', 'wire', 'implement', 'hook']]
  },
  {
    tag: 'ad-creative-iteration',
    all: [['ad', 'creative', 'copy', 'variant'], ['iterate', 'test', 'scale', 'generate']]
  },
  {
    tag: 'paid-media-campaign-management',
    all: [['campaign', 'budget', 'ads', 'ad'], ['manage', 'optimize', 'pace', 'launch']]
  },
  {
    tag: 'seo-crawl-validation',
    all: [['seo', 'crawl', 'metadata', 'schema'], ['validate', 'audit', 'check', 'verify']]
  },
  {
    tag: 'wordpress-content-editing',
    all: [['wordpress', 'wp', 'page', 'content'], ['edit', 'update', 'publish', 'change']]
  },
  {
    tag: 'video-editing-workflow',
    all: [['video', 'transcript', 'subtitle', 'render'], ['edit', 'cut', 'grade', 'export']]
  }
];

function inferTaskPatterns(taskDescription, taskTokens = tokenize(taskDescription)) {
  const tokenSet = new Set(taskTokens);
  const inferred = [];

  for (const pattern of WORKFLOW_PATTERNS) {
    const matched = pattern.all.every(group => group.some(token => tokenSet.has(token)));
    if (matched) inferred.push(pattern.tag);
  }

  return unique(inferred);
}

function normalizeManifestPatterns(manifest) {
  return Array.isArray(manifest.patterns)
    ? unique(manifest.patterns.map(pattern => String(pattern).trim()).filter(Boolean))
    : [];
}

function patternOverlap(taskPatterns, manifestPatterns) {
  if (taskPatterns.length === 0 || manifestPatterns.length === 0) {
    return { score: 0, matched: [] };
  }
  const manifestSet = new Set(manifestPatterns);
  const matched = taskPatterns.filter(pattern => manifestSet.has(pattern));
  return {
    score: matched.length / taskPatterns.length,
    matched
  };
}

function buildBroadeningRecommendation(results, patternMatches) {
  const top = results[0] || null;
  const topScore = top ? top.match_score : 0;
  const scoredIds = new Set(results.slice(0, 3).map(result => result.framework_id));
  const broadenedMatches = patternMatches
    .filter(match => match.matched_patterns.length > 0)
    .filter(match => !scoredIds.has(match.framework_id))
    .slice(0, 5);

  const thinEvidence = topScore < 40;
  const partialEvidence = topScore < 55 && broadenedMatches.length > 0;
  const triggered = thinEvidence || partialEvidence;

  let reason = 'Top framework evidence is strong enough; no broadening recommended.';
  if (thinEvidence) {
    reason = 'Top framework score is below 40, so workflow-pattern matches should be inspected before accepting no-match.';
  } else if (partialEvidence) {
    reason = 'Top framework score is partial and distinct workflow-pattern matches exist outside the top scored matches.';
  }

  return {
    triggered,
    reason,
    top_score: topScore,
    matches: triggered ? broadenedMatches : []
  };
}

// ---------------------------------------------------------------------------
// Trust tier classification
// ---------------------------------------------------------------------------

function classifyTrustTier(matchScore) {
  if (matchScore >= 70) return 'hardened';
  if (matchScore >= 40) return 'applicable-with-gaps';
  if (matchScore >= 20) return 'partial-coverage';
  return 'no-match';
}

// ---------------------------------------------------------------------------
// Mode compatibility
// ---------------------------------------------------------------------------

const WRITE_MODES = ['PATCH_ALLOWED', 'COORDINATOR', 'RUN_ONLY'];
const READ_MODES = ['FINDINGS_ONLY', 'REVIEW_ONLY', 'REPO_HYGIENE'];

function scoreModeCompatibility(frameworkModes, writeNeed) {
  if (!Array.isArray(frameworkModes) || frameworkModes.length === 0) return 0;

  if (writeNeed === 'write') {
    const hasWriteMode = frameworkModes.some(m => WRITE_MODES.includes(m));
    return hasWriteMode ? 1.0 : 0.3;
  }
  if (writeNeed === 'read') {
    const hasReadMode = frameworkModes.some(m => READ_MODES.includes(m));
    return hasReadMode ? 1.0 : 0.5;
  }
  // mixed — any mode is fine
  return 0.8;
}

function getApplicableModes(frameworkModes, writeNeed) {
  if (!Array.isArray(frameworkModes)) return [];
  if (writeNeed === 'write') {
    const writeModes = frameworkModes.filter(m => WRITE_MODES.includes(m));
    return writeModes.length > 0 ? writeModes : frameworkModes;
  }
  if (writeNeed === 'read') {
    const readModes = frameworkModes.filter(m => READ_MODES.includes(m));
    return readModes.length > 0 ? readModes : frameworkModes;
  }
  return frameworkModes;
}

// ---------------------------------------------------------------------------
// Framework text extraction
// ---------------------------------------------------------------------------

function extractFrameworkText(manifest) {
  const parts = [];

  if (manifest.description) parts.push(manifest.description);

  // Input contract
  if (manifest.input_contract) {
    const inputs = [
      ...(manifest.input_contract.required || []),
      ...(manifest.input_contract.optional || [])
    ];
    for (const inp of inputs) {
      if (inp.name) parts.push(inp.name);
      if (inp.description) parts.push(inp.description);
    }
  }

  // Output contract
  if (manifest.output_contract) {
    if (Array.isArray(manifest.output_contract.directories)) {
      parts.push(...manifest.output_contract.directories);
    }
    if (Array.isArray(manifest.output_contract.artifacts)) {
      for (const a of manifest.output_contract.artifacts) {
        parts.push(typeof a === 'string' ? a : (a.name || ''));
      }
    }
  }

  // Prompt chain phase names
  if (manifest.prompt_chain) {
    parts.push(...Object.keys(manifest.prompt_chain));
    for (const prompts of Object.values(manifest.prompt_chain)) {
      if (Array.isArray(prompts)) parts.push(...prompts);
    }
  }

  // Service category and framework name
  if (manifest.service_category) parts.push(manifest.service_category);
  if (manifest.framework_name) parts.push(manifest.framework_name);

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score a single framework against the task.
 *
 * Scoring weights:
 *   - Description keyword overlap: 30%
 *   - Input/output/chain keyword overlap: 20%
 *   - Domain match: 20%
 *   - Mode compatibility: 15%
 *   - Workflow-pattern overlap: 15%
 */
function scoreFramework(manifest, frameworkId, taskTokens, taskDomainScores, writeNeed, taskPatterns) {
  const descTokens = tokenize(manifest.description || '');
  const fullText = extractFrameworkText(manifest);
  const fullTokens = tokenize(fullText);
  const manifestPatterns = normalizeManifestPatterns(manifest);
  const patterns = patternOverlap(taskPatterns, manifestPatterns);

  // 1. Description overlap (30%)
  const descScore = containmentScore(taskTokens, descTokens);

  // 2. Full-text overlap (20%)
  const fullScore = containmentScore(taskTokens, fullTokens);

  // 3. Domain match (20%)
  const serviceDomain = manifest.service_category || frameworkId.split('/')[0];
  const domainHits = taskDomainScores[serviceDomain] || 0;
  const maxDomainHits = Math.max(1, ...Object.values(taskDomainScores));
  const domainScore = domainHits / maxDomainHits;

  // 4. Mode compatibility (15%)
  const modeScore = scoreModeCompatibility(manifest.execution_modes, writeNeed);

  // 5. Workflow-pattern overlap (15%)
  const patternScore = patterns.score;

  const raw = manifestPatterns.length > 0
    ? (descScore * 0.30) + (fullScore * 0.20) + (domainScore * 0.20) + (modeScore * 0.15) + (patternScore * 0.15)
    : (descScore * 0.35) + (fullScore * 0.25) + (domainScore * 0.25) + (modeScore * 0.15);
  const matchScore = Math.round(raw * 100);

  // Build rationale
  const rationaleFragments = [];
  if (descScore > 0) rationaleFragments.push(`description overlap ${Math.round(descScore * 100)}%`);
  if (fullScore > 0) rationaleFragments.push(`contract/chain overlap ${Math.round(fullScore * 100)}%`);
  if (domainScore > 0) rationaleFragments.push(`domain match (${serviceDomain})`);
  if (modeScore > 0.5) rationaleFragments.push(`compatible execution modes`);
  if (patterns.matched.length > 0) rationaleFragments.push(`workflow patterns: ${patterns.matched.join(', ')}`);

  // Identify gaps
  const gaps = [];
  if (descScore < 0.2) gaps.push('Low description relevance — task may be outside framework scope');
  if (modeScore < 0.5) {
    if (writeNeed === 'write') gaps.push('Framework lacks write-capable execution modes');
    if (writeNeed === 'read') gaps.push('Framework lacks read-only execution modes');
  }
  if (manifest.mcp_requirements && manifest.mcp_requirements.length > 0) {
    gaps.push(`Requires MCP: ${manifest.mcp_requirements.join(', ')}`);
  }
  if (domainScore < 0.3) gaps.push(`Domain mismatch — framework serves ${serviceDomain}`);

  return {
    framework_id: frameworkId,
    match_score: matchScore,
    match_rationale: rationaleFragments.length > 0
      ? rationaleFragments.join('; ')
      : 'No significant keyword overlap detected',
    gaps,
    applicable_modes: getApplicableModes(manifest.execution_modes, writeNeed),
    trust_notes: classifyTrustTier(matchScore),
    pattern_matches: patterns.matched,
    _detail: {
      description_score: Math.round(descScore * 100),
      fulltext_score: Math.round(fullScore * 100),
      domain_score: Math.round(domainScore * 100),
      mode_score: Math.round(modeScore * 100),
      pattern_score: Math.round(patternScore * 100),
      manifest_patterns: manifestPatterns,
      prompt_count: manifest.prompt_count || 0
    }
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function assessSimilarity(taskDescription, clientCode, projectId) {
  const system = loadSystemConfig();
  const taskTokens = tokenize(taskDescription);
  const taskDomainScores = classifyTaskDomain(taskTokens);
  const writeNeed = detectWriteNeed(taskTokens);
  const taskPatterns = inferTaskPatterns(taskDescription, taskTokens);

  const results = [];
  const patternMatches = [];

  for (const fw of system.frameworks) {
    const manifestPath = path.join(PROJECT_ROOT, fw.manifest);
    const manifest = safeReadJson(manifestPath);

    if (!manifest) {
      results.push({
        framework_id: fw.id,
        match_score: 0,
        match_rationale: 'Could not load manifest',
        gaps: ['Manifest file missing or unreadable'],
        applicable_modes: [],
        trust_notes: 'no-match',
        _detail: null
      });
      continue;
    }

    const scored = scoreFramework(manifest, fw.id, taskTokens, taskDomainScores, writeNeed, taskPatterns);
    results.push(scored);
    if (scored.pattern_matches.length > 0) {
      patternMatches.push({
        framework_id: fw.id,
        matched_patterns: scored.pattern_matches,
        pattern_score: scored._detail.pattern_score,
        match_score: scored.match_score,
        trust_notes: scored.trust_notes
      });
    }
  }

  // Sort by match_score descending
  results.sort((a, b) => b.match_score - a.match_score);
  patternMatches.sort((a, b) => {
    if (b.pattern_score !== a.pattern_score) return b.pattern_score - a.pattern_score;
    return b.match_score - a.match_score;
  });

  return {
    assessed_at: new Date().toISOString(),
    task_description: taskDescription,
    client_code: clientCode || null,
    project_id: projectId || null,
    write_need: writeNeed,
    domain_signals: taskDomainScores,
    task_patterns: taskPatterns,
    framework_count: results.length,
    results,
    pattern_matches: patternMatches,
    broadening_recommendation: buildBroadeningRecommendation(results, patternMatches),
    // S4 composable-framework-substrate: component-granularity matches
    // surface ALONGSIDE framework results, never replacing them — both
    // granularities always shown; the threshold never decides what the
    // planner sees (convene 20260611T190347Z, grounding tension #1).
    component_matches: componentMatches(taskDescription)
  };
}

function componentMatches(taskDescription, top = 8) {
  try {
    const { buildMatcher } = require('../retrieval/component-match.cjs');
    return buildMatcher().match(taskDescription, top);
  } catch (err) {
    // Component substrate must never break framework-level planning.
    return [{ error: `component matcher unavailable: ${err.message}` }];
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { task: null, client: null, project: null, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--task' && argv[i + 1]) {
      args.task = argv[++i];
    } else if (argv[i] === '--client' && argv[i + 1]) {
      args.client = argv[++i];
    } else if (argv[i] === '--project' && argv[i + 1]) {
      args.project = argv[++i];
    } else if (argv[i] === '--json') {
      args.json = true;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      args.help = true;
    }
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`Usage: node tools/planning/assess-similarity.js --task "description" [--client CODE] [--project ID] [--json]

Scores all registered Mythos frameworks against a task description using
field-based keyword matching, mode compatibility, and domain classification.

Options:
  --task    Task description (required)
  --client  Client code (optional)
  --project Project ID (optional)
  --json    Output raw JSON (default: formatted summary)
  --help    Show this help`);
    process.exit(0);
  }

  if (!args.task) {
    console.error('ERROR: --task is required. Use --help for usage.');
    process.exit(1);
  }

  const result = assessSimilarity(args.task, args.client, args.project);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\nTask: ${result.task_description}`);
    console.log(`Write need: ${result.write_need}`);
    console.log(`Frameworks assessed: ${result.framework_count}\n`);
    console.log('Ranked Results:');
    console.log('─'.repeat(70));

    for (const r of result.results) {
      const tier = r.trust_notes.toUpperCase();
      console.log(`  ${String(r.match_score).padStart(3)}  ${r.framework_id}`);
      console.log(`       Trust: ${tier}`);
      console.log(`       Rationale: ${r.match_rationale}`);
      if (r.gaps.length > 0) {
        console.log(`       Gaps: ${r.gaps.join('; ')}`);
      }
      console.log(`       Modes: ${r.applicable_modes.join(', ')}`);
      console.log('');
    }
  }

  process.exit(0);
}

// ---------------------------------------------------------------------------
// Exports (for programmatic use)
// ---------------------------------------------------------------------------

module.exports = {
  assessSimilarity,
  tokenize,
  tokenOverlap,
  containmentScore,
  classifyTaskDomain,
  detectWriteNeed,
  classifyTrustTier,
  inferTaskPatterns
};
