#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CACHE_SCHEMA = 'ImproveThisCache/1.0';
const CACHE_DIR = '.improve-this';
const CACHE_FILES = [
  'README.md',
  'repo-map.md',
  'commands.md',
  'conventions.md',
  'testing.md',
  'risks.md'
];

// Static allowlist by design. Do not replace this with directory walking.
const SOURCE_ALLOWLIST = [
  { path: 'AGENTS.md', critical: true, sections: ['README.md', 'repo-map.md', 'conventions.md', 'risks.md'] },
  { path: 'package.json', critical: true, sections: ['commands.md', 'testing.md'] },
  { path: 'instructions/canonical/guardrails.md', critical: true, sections: ['conventions.md', 'risks.md'] },
  { path: 'instructions/canonical/commands/owl.yaml', critical: true, sections: ['commands.md', 'conventions.md'] },
  { path: 'instructions/canonical/commands/plan-task.yaml', critical: true, sections: ['commands.md', 'conventions.md'] },
  { path: 'instructions/canonical/commands/review-task-plan.yaml', critical: true, sections: ['commands.md', 'testing.md'] },
  { path: 'instructions/canonical/commands/run-plan.yaml', critical: true, sections: ['commands.md', 'testing.md'] },
  { path: 'instructions/canonical/commands/follow-signal.yaml', critical: true, sections: ['commands.md', 'risks.md'] },
  { path: '.claude/skills/prompt-refinement/SKILL.md', critical: true, sections: ['README.md', 'conventions.md', 'risks.md'] },
  { path: 'tools/context/repo-awareness.cjs', critical: true, sections: ['repo-map.md', 'testing.md'] }
];

const SOURCE_AUTHORITY_ORDER = [
  'direct operator instruction',
  'AGENTS.md runtime guidance',
  'canonical command specs under instructions/canonical/commands/',
  'instructions/canonical/guardrails.md',
  'actual package scripts in package.json',
  'prompt-refinement skill policy',
  'repo-awareness source and snapshots',
  '.improve-this derived cache'
];

const FORBIDDEN_PATH_PATTERNS = [
  /^\.env(?:\.|$)/,
  /^clients\//,
  /^secrets\//,
  /^Mythos-memories\//,
  /^_dev\/research\/taylor-philosophy\//,
  /^_dev\/state\/private\//
];

function relPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function assertAllowedSource(sourcePath) {
  const rel = relPath(sourcePath);
  for (const pattern of FORBIDDEN_PATH_PATTERNS) {
    if (pattern.test(rel)) {
      throw new Error(`Refusing forbidden source path: ${rel}`);
    }
  }
  if (!SOURCE_ALLOWLIST.some((entry) => entry.path === rel)) {
    throw new Error(`Refusing non-allowlisted source path: ${rel}`);
  }
  return rel;
}

function sha256(buffer) {
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function readSource(projectRoot, entry) {
  const rel = assertAllowedSource(entry.path);
  const fullPath = path.join(projectRoot, rel);
  let buffer;
  let stat;
  try {
    buffer = fs.readFileSync(fullPath);
    stat = fs.statSync(fullPath);
  } catch (err) {
    return {
      path: rel,
      critical: Boolean(entry.critical),
      exists: false,
      error: err && err.code ? err.code : String(err && err.message ? err.message : err),
      sections: entry.sections
    };
  }
  return {
    path: rel,
    critical: Boolean(entry.critical),
    exists: true,
    hash: sha256(buffer),
    size_bytes: buffer.length,
    mtime: stat.mtime.toISOString(),
    mtime_ms: Math.trunc(stat.mtimeMs),
    sections: entry.sections,
    text: buffer.toString('utf8')
  };
}

function loadSources(projectRoot) {
  const sources = SOURCE_ALLOWLIST.map((entry) => readSource(projectRoot, entry));
  const missingCritical = sources.filter((source) => source.critical && !source.exists);
  return { sources, missingCritical };
}

function scriptGroups(packageJsonText) {
  let scripts = {};
  try {
    const parsed = JSON.parse(packageJsonText || '{}');
    scripts = parsed && parsed.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : {};
  } catch {
    scripts = {};
  }

  const groups = [
    { title: 'repo awareness', prefix: 'context:' },
    { title: 'planning', prefix: 'plans:' },
    { title: 'verification', prefix: 'verify' },
    { title: 'tests', prefix: 'test' },
    { title: 'managed runtime', prefix: 'codex:' },
    { title: 'signals', prefix: 'signals:' },
    { title: 'framework lifecycle', prefix: 'workspace:' }
  ];
  return groups.map((group) => ({
    title: group.title,
    scripts: Object.keys(scripts)
      .filter((name) => name === group.prefix || name.startsWith(group.prefix))
      .sort()
      .map((name) => ({ name, command: scripts[name] }))
  })).filter((group) => group.scripts.length > 0);
}

function findSource(sources, sourcePath) {
  return sources.find((source) => source.path === sourcePath) || null;
}

function countManagedCommands(agentsText) {
  const match = String(agentsText || '').match(/Implemented managed commands:\s*([^\n]+)/);
  if (!match) return null;
  return match[1].split(',').map((item) => item.trim()).filter(Boolean).length;
}

function markdownList(items) {
  if (!items || items.length === 0) return '- (none)';
  return items.map((item) => `- ${item}`).join('\n');
}

function renderReadme(generatedAt) {
  return `# improve-this knowledgebase

generated_at: ${generatedAt}
schema: ${CACHE_SCHEMA}
confidence: medium

## load order
- Always validate \`.improve-this/freshness.json\` first.
- Treat every file here as advisory derived context.
- Direct human-operator instructions, canonical command specs, source files, task plans, amendments, reviews, and signals override this cache.
- For slash-style Mythos operations, resolve behavior through \`instructions/canonical/commands/<command>.yaml\`.

## file guide
- \`repo-map.md\`: architecture, authority surfaces, and task map.
- \`commands.md\`: install, lint, test, verify, runtime, and cache-refresh commands.
- \`conventions.md\`: Mythos policies, actor contracts, and file-boundary rules.
- \`testing.md\`: targeted verification routes and cache-specific test expectations.
- \`risks.md\`: privacy, stale-cache, and authority risks to re-check.

## maintenance
- Refresh manually with \`npm run context:improve-this:refresh\`.
- Startup and shutdown may report cache state, but v1 must not silently rewrite this directory.
- Do not store credentials, PII, client-private details, private-memory contents, or long source excerpts.
`;
}

function renderRepoMap(sources) {
  const agents = findSource(sources, 'AGENTS.md');
  const commandCount = countManagedCommands(agents && agents.text);
  return `# Repo Map

## identity
- Mythos is a filesystem-based LLM operating system for reusable client-work frameworks.
- Reusable workflows live under \`frameworks/\`; client/project execution lives under \`clients/{client_code}/\`.
- Canonical instruction policy lives in \`instructions/canonical/\`; harness-specific surfaces are generated or mirrored from canonical behavior.

## primary authority surfaces
${markdownList(SOURCE_AUTHORITY_ORDER)}

## core runtime areas
- \`instructions/canonical/commands/\`: slash-style operation contracts and execution modes.
- \`tools/codex/\`: managed Codex runtime, launcher, and hook emulation.
- \`tools/context/\`: repo-awareness snapshots, actor awareness packets, and this cache generator.
- \`tools/signals/\`: coordination signals, bridge dispatch, follow-signal authorization, and next-step surfaces.
- \`tools/planning/\`: task-plan validation, review, repair, and visibility tooling.
- \`.improve-this/\`: generated advisory cache; never a source of truth.

## current generated facts
- Managed command count from \`AGENTS.md\`: ${commandCount == null ? 'unknown' : commandCount}.
- Cache source files tracked in freshness metadata: ${sources.filter((source) => source.exists).length}.
- Missing allowlisted sources: ${sources.filter((source) => !source.exists).length}.
`;
}

function renderCommands(sources) {
  const pkg = findSource(sources, 'package.json');
  const groups = scriptGroups(pkg && pkg.text);
  const renderedGroups = groups.map((group) => {
    const rows = group.scripts.map((script) => `- \`npm run ${script.name}\` -> \`${script.command}\``).join('\n');
    return `## ${group.title}\n${rows}`;
  }).join('\n\n');
  return `# Commands

## cache refresh
- Manual refresh: \`npm run context:improve-this:refresh\`.
- Check without writing: \`npm run context:improve-this:check\`.
- Repo-awareness snapshot: \`npm run context:repo-awareness -- --source manual-improve-this-refresh --json\`.

${renderedGroups || '## package scripts\n- No package scripts could be parsed.'}

## caveats
- Some scripts touch local state under \`_dev/\` or external systems; prefer dry-run/check modes unless the task authorizes live action.
- Do not run destructive commands without explicit human-operator approval.
`;
}

function renderConventions() {
  return `# Conventions

## authority
- Generated cache content is advisory and must lose conflicts against direct operator instruction, canonical command specs, source files, task plans, reviews, signals, and actual code.
- Slash-style operation names are shorthand. Resolve behavior through \`instructions/canonical/commands/<command>.yaml\`.
- Do not edit generated harness surfaces when the canonical source is the true target.

## actor continuity
- Actor invocations should carry Current State, Question / Work, and Desired State.
- Actor returns should include resulting state, changed files, commands/tests/smokes/reviews, blockers, gate owner, and parent impact.
- A producer should not validate its own acceptance-grade outcome for substantial work.

## cache discipline
- Refresh through the manual generator, not hand-edited cache prose.
- Startup/reporting paths may classify the cache as missing, partial, fresh, aging, or stale; v1 startup must not write cache files.
- If \`freshness.json\` is missing, stale, partial, or source hashes mismatch, verify against source truth before relying on this cache.
`;
}

function renderTesting() {
  return `# Testing

## cache-specific checks
- Generator tests: \`node --test tools/context/__tests__/improve-this-cache.test.cjs\`.
- Repo-awareness tests: \`node --test tools/context/__tests__/repo-awareness.test.cjs\`.
- Focused cache suite: \`node --test tools/context/__tests__/improve-this-cache.test.cjs tools/context/__tests__/repo-awareness.test.cjs\`.

## expected behavior
- Missing critical source artifacts cause the generator to exit non-zero without writing \`.improve-this\`.
- Startup/repo-awareness initialization reports cache state but does not create or rewrite \`.improve-this\`.
- Source hash mismatches downgrade cache status to \`stale\`.
- Privacy boundaries are enforced by a static source allowlist and forbidden path patterns.

## broader routes
- Planning changes: \`npm run test:planning\`.
- Lifecycle or hook changes: \`npm run test:lifecycle\`.
- System confidence: \`npm run verify\`.
`;
}

function renderRisks() {
  return `# Risks

## shadow authority
- The highest risk is treating \`.improve-this\` as truth after canonical sources changed.
- Always check \`freshness.json\` and source hash status before relying on cache content.

## privacy
- The generator must not read \`.env\`, \`clients/\`, \`secrets/\`, \`Mythos-memories/\`, or private local grounding substrates.
- Do not summarize client-specific facts, credentials, API keys, tokens, PII, or private-memory contents into this cache.

## startup writes
- V1 startup may validate and report cache state only.
- Silent automatic writes on boot require a later approved plan.

## stale assumptions
- Background processes can update repo state during a session.
- The working tree may be dirty from unrelated workstreams; isolate current-task changes before reporting.
`;
}

function buildFreshness(projectRoot, generatedAt, sources) {
  const sourceMap = {};
  for (const source of sources) {
    const entry = {
      critical: source.critical,
      exists: source.exists,
      sections: source.sections
    };
    if (source.exists) {
      entry.hash = source.hash;
      entry.mtime = source.mtime;
      entry.mtime_ms = source.mtime_ms;
      entry.size_bytes = source.size_bytes;
    } else {
      entry.error = source.error;
    }
    sourceMap[source.path] = entry;
  }
  return {
    schema: CACHE_SCHEMA,
    version: 1,
    generated_at: generatedAt,
    updated_at: generatedAt,
    repo_root: projectRoot,
    source_authority_order: SOURCE_AUTHORITY_ORDER,
    source_allowlist: SOURCE_ALLOWLIST.map((entry) => ({
      path: entry.path,
      critical: entry.critical,
      sections: entry.sections
    })),
    forbidden_path_patterns: FORBIDDEN_PATH_PATTERNS.map((pattern) => pattern.source),
    sources: sourceMap,
    key_files: sourceMap,
    knowledgebase_files: Object.fromEntries(CACHE_FILES.map((name) => [name, { updated_at: generatedAt }]))
  };
}

function buildCache(projectRoot, opts = {}) {
  const generatedAt = opts.generatedAt || new Date().toISOString();
  const { sources, missingCritical } = loadSources(projectRoot);
  if (missingCritical.length > 0) {
    return {
      ok: false,
      generated_at: generatedAt,
      errors: missingCritical.map((source) => `Missing critical source: ${source.path} (${source.error || 'missing'})`),
      missing_critical: missingCritical.map((source) => source.path),
      files: {},
      freshness: buildFreshness(projectRoot, generatedAt, sources)
    };
  }

  const files = {
    'README.md': renderReadme(generatedAt),
    'repo-map.md': renderRepoMap(sources),
    'commands.md': renderCommands(sources),
    'conventions.md': renderConventions(),
    'testing.md': renderTesting(),
    'risks.md': renderRisks()
  };
  return {
    ok: true,
    generated_at: generatedAt,
    errors: [],
    missing_critical: [],
    files,
    freshness: buildFreshness(projectRoot, generatedAt, sources)
  };
}

function writeCache(projectRoot, opts = {}) {
  const cache = buildCache(projectRoot, opts);
  if (!cache.ok) return cache;
  const dir = path.join(projectRoot, CACHE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(cache.files)) {
    fs.writeFileSync(path.join(dir, name), body, 'utf8');
  }
  fs.writeFileSync(path.join(dir, 'freshness.json'), `${JSON.stringify(cache.freshness, null, 2)}\n`, 'utf8');
  return {
    ...cache,
    paths: [...Object.keys(cache.files), 'freshness.json'].map((name) => `${CACHE_DIR}/${name}`)
  };
}

function assessSourceFreshness(projectRoot, freshness) {
  const recorded = freshness && (freshness.sources || freshness.key_files);
  if (!recorded || typeof recorded !== 'object') {
    return { checked: false, mismatches: [], missing: [] };
  }
  const mismatches = [];
  const missing = [];
  for (const entry of SOURCE_ALLOWLIST) {
    const rel = entry.path;
    const previous = recorded[rel];
    if (!previous || previous.exists === false) {
      if (entry.critical) missing.push(rel);
      continue;
    }
    const fullPath = path.join(projectRoot, rel);
    let buffer;
    try {
      buffer = fs.readFileSync(fullPath);
    } catch {
      missing.push(rel);
      continue;
    }
    const currentHash = sha256(buffer);
    if (previous.hash && previous.hash !== currentHash) {
      mismatches.push(rel);
    }
  }
  return { checked: true, mismatches, missing };
}

function parseArgs(argv) {
  const out = { root: process.cwd(), json: false, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--root') {
      out.root = next || out.root;
      i += 1;
    } else if (arg === '--json') {
      out.json = true;
    } else if (arg === '--check') {
      out.check = true;
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(args.root);
  const result = args.check ? buildCache(projectRoot) : writeCache(projectRoot);
  const payload = {
    ok: result.ok,
    generated_at: result.generated_at,
    errors: result.errors,
    missing_critical: result.missing_critical,
    paths: result.paths || []
  };
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(`${args.check ? 'IMPROVE-THIS CHECK' : 'IMPROVE-THIS REFRESH'}: ok (${CACHE_FILES.length} files)\n`);
  } else {
    process.stderr.write(`IMPROVE-THIS ${args.check ? 'CHECK' : 'REFRESH'}: blocked\n${result.errors.join('\n')}\n`);
  }
  process.exitCode = result.ok ? 0 : 2;
}

if (require.main === module) main();

module.exports = {
  CACHE_FILES,
  CACHE_SCHEMA,
  SOURCE_ALLOWLIST,
  SOURCE_AUTHORITY_ORDER,
  assertAllowedSource,
  assessSourceFreshness,
  buildCache,
  parseArgs,
  writeCache
};
