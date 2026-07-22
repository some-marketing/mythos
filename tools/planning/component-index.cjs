#!/usr/bin/env node
'use strict';

/**
 * component-index.cjs — a composable-framework-substrate indexer.
 *
 * Deterministic, read-only walker over frameworks/<service>/<name>/manifest.json
 * plus frameworks/_shared/blocks/. Emits one node per component — prompt,
 * schema, helper, skill, command, agent, guardrail block — so retrieval can
 * see transferable skills ACROSS frameworks instead of re-deriving
 * connections via inference every session (operator resolution 2026-06-11,
 * convene 20260611T190347Z).
 *
 * CONVENE-A1 (binding): every node carries lineage — parent manifest +
 * guardrails refs, preconditions (input_contract keys), evidence obligations
 * (output_contract keys), execution modes. Components are RETRIEVAL units,
 * never detached execution authority; a consumer composing from this index
 * must pull the lineage baggage with the node.
 *
 * Determinism: nodes sorted by id; corpus anchor is the newest source mtime
 * (no wall-clock), matching the dreaming-system convention so rebuilds with
 * unchanged sources are byte-identical.
 *
 * Usage:
 *   node tools/planning/component-index.cjs --json          # corpus to stdout
 *   node tools/planning/component-index.cjs --out <path>    # write corpus file
 *   node tools/planning/component-index.cjs                 # summary line
 */

const fs = require('fs');
const path = require('path');
const { listAllTaskPlans } = require('./lib/resolve-task-plan.js');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CODE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts']);

function safeJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function rel(p) {
  return path.relative(PROJECT_ROOT, p);
}

function mtimeOf(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readPackage(projectRoot) {
  return safeJson(path.join(projectRoot, 'package.json')) || {};
}

/** First markdown heading or first non-empty line, as a cheap description. */
function fileDescription(filePath, max = 200) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('---')) continue;
      return t.replace(/^#+\s*/, '').slice(0, max);
    }
  } catch {
    // unreadable file — description stays empty, node still indexed by path
  }
  return '';
}

/** CONVENE-A1 lineage block, shared by every node of one framework. */
/**
 * Contracts come as {required:[{name,...}], optional:[...]} in most manifests,
 * but a few use flat dicts. Extract the actual field names either way;
 * optional entries are suffixed '?'.
 */
function contractFields(contract) {
  if (!contract || typeof contract !== 'object') return [];
  const entryName = (e) => (typeof e === 'string'
    ? e
    : (e && (e.name || e.path || e.path_pattern || e.file || e.id)) || '');
  const names = (list, suffix = '') => (Array.isArray(list) ? list : [])
    .map(entryName).filter(Boolean).map((n) => n + suffix);
  if (Array.isArray(contract.required) || Array.isArray(contract.optional)) {
    return [...names(contract.required), ...names(contract.optional, '?')].sort();
  }
  // v2-style contracts: wrapper sections (artifacts/directories/bundle_types…)
  // each holding arrays of named entries. Surface the actual obligations
  // (run.meta.json, runs/, …), with '?' on entries marked required:false —
  // wrapper keys alone are generic tokens that starve the idf matcher
  // (Codex S1 review, MAJOR).
  const out = [];
  for (const section of Object.values(contract)) {
    if (!Array.isArray(section)) continue;
    for (const e of section) {
      const n = entryName(e);
      if (n) out.push(n + (e && e.required === false ? '?' : ''));
    }
  }
  return out.length ? [...new Set(out)].sort() : Object.keys(contract).sort();
}

function buildLineage(frameworkDir, manifest) {
  const guardrails = path.join(frameworkDir, 'guardrails.md');
  return {
    manifest: rel(path.join(frameworkDir, 'manifest.json')),
    guardrails: fs.existsSync(guardrails) ? rel(guardrails) : '',
    preconditions: contractFields(manifest.input_contract),
    evidence_obligations: contractFields(
      manifest.output_contract_v2 || manifest.output_contract
    ),
    execution_modes: Array.isArray(manifest.execution_modes)
      ? [...manifest.execution_modes].sort()
      : []
  };
}

/**
 * S2: component tags live in the manifest under component_tags, keyed
 * "<kind>::<name>", with the kernel tag fields (similarity_tags, domain
 * [string per kernel-artifact-tag-schema], surfaces, related_artifacts) plus
 * transfer_notes. Empty defaults keep the corpus shape uniform pre-backfill.
 */
const EMPTY_TAGS = Object.freeze({
  similarity_tags: [],
  domain: '',
  surfaces: [],
  related_artifacts: [],
  transfer_notes: ''
});

function tagsFor(manifest, kind, name) {
  const block = manifest && manifest.component_tags;
  const entry = block && typeof block === 'object' ? block[`${kind}::${name}`] : null;
  if (!entry || typeof entry !== 'object') return { ...EMPTY_TAGS };
  return {
    similarity_tags: Array.isArray(entry.similarity_tags) ? [...entry.similarity_tags].sort() : [],
    domain: typeof entry.domain === 'string' ? entry.domain : '',
    surfaces: Array.isArray(entry.surfaces) ? [...entry.surfaces].sort() : [],
    related_artifacts: Array.isArray(entry.related_artifacts) ? [...entry.related_artifacts].sort() : [],
    transfer_notes: typeof entry.transfer_notes === 'string' ? entry.transfer_notes : ''
  };
}

function node(frameworkId, kind, name, filePath, description, lineage, tags) {
  return {
    id: `${frameworkId}::${kind}::${name}`,
    framework_id: frameworkId,
    kind,
    name,
    path: filePath,
    description: description || '',
    tags: tags || { ...EMPTY_TAGS },
    lineage
  };
}

function discoveryLineage(sourcePath, extra = {}) {
  return {
    manifest: '',
    guardrails: '',
    preconditions: [],
    evidence_obligations: [],
    execution_modes: [],
    authority: 'retrieval_context_only',
    source: sourcePath,
    ...extra
  };
}

function discoveryNode(kind, name, filePath, description, extraLineage) {
  return node('system', kind, name, filePath, description,
    discoveryLineage(filePath, extraLineage), { ...EMPTY_TAGS });
}

function listSkillFiles(projectRoot) {
  const root = path.join(projectRoot, '.claude', 'skills');
  const found = [];
  function walk(dir) {
    for (const entry of listDir(dir)) {
      const p = path.join(dir, entry);
      if (entry === 'node_modules' || entry === '.git') continue;
      if (isDirectory(p)) walk(p);
      else if (entry === 'SKILL.md') found.push(p);
    }
  }
  if (isDirectory(root)) walk(root);
  return found.sort();
}

function listReusableCodeFiles(projectRoot) {
  const toolsRoot = path.join(projectRoot, 'tools');
  const found = [];
  for (const group of listDir(toolsRoot)) {
    const groupDir = path.join(toolsRoot, group);
    if (!isDirectory(groupDir)) continue;
    const libDir = path.join(groupDir, 'lib');
    if (!isDirectory(libDir)) continue;
    for (const entry of listDir(libDir)) {
      const p = path.join(libDir, entry);
      if (!isFile(p)) continue;
      if (CODE_EXTENSIONS.has(path.extname(entry))) found.push(p);
    }
  }
  return found.sort();
}

function npmToolEntries(projectRoot) {
  const pkg = readPackage(projectRoot);
  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const entries = [];
  for (const [name, command] of Object.entries(scripts)) {
    const match = /^node\s+(tools\/[^\s]+)/.exec(String(command));
    if (!match) continue;
    const p = path.join(projectRoot, match[1]);
    if (!isFile(p)) continue;
    entries.push({ name, command, path: p });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function indexSystemDiscovery(projectRoot, sources) {
  const nodes = [];
  const packageJson = path.join(projectRoot, 'package.json');
  if (isFile(packageJson)) sources.push(packageJson);

  for (const entry of npmToolEntries(projectRoot)) {
    sources.push(entry.path);
    nodes.push(discoveryNode('system_tool', entry.name, rel(entry.path),
      fileDescription(entry.path) || entry.command, {
        npm_script: entry.name,
        command: entry.command
      }));
  }

  const commandsDir = path.join(projectRoot, 'instructions', 'canonical', 'commands');
  for (const file of listDir(commandsDir).filter((n) => n.endsWith('.yaml'))) {
    const p = path.join(commandsDir, file);
    const spec = safeJson(p);
    sources.push(p);
    const name = (spec && spec.id) || file.replace(/\.yaml$/, '');
    nodes.push(discoveryNode('system_command', name, rel(p),
      (spec && (spec.description || spec.objective)) || fileDescription(p), {
        mode: spec && spec.mode ? spec.mode : '',
        slash_command: `/${name}`
      }));
  }

  for (const p of listSkillFiles(projectRoot)) {
    sources.push(p);
    const name = rel(path.dirname(p)).replace(/^\.claude\/skills\//, '');
    nodes.push(discoveryNode('system_skill', name, rel(p), fileDescription(p), {
      skill_root: rel(path.dirname(p))
    }));
  }

  for (const p of listReusableCodeFiles(projectRoot)) {
    sources.push(p);
    const name = rel(p).replace(/^tools\//, '').replace(/\.[^.]+$/, '');
    nodes.push(discoveryNode('reusable_code', name, rel(p), fileDescription(p), {
      code_surface: 'tools-lib'
    }));
  }

  for (const plan of listAllTaskPlans(projectRoot)) {
    if (!isFile(plan.jsonPath)) continue;
    const doc = safeJson(plan.jsonPath);
    sources.push(plan.jsonPath);
    if (isFile(plan.markdownPath)) sources.push(plan.markdownPath);
    const name = (doc && (doc.task_id || doc.id)) || plan.taskId;
    const description = doc && (doc.task_summary || doc.description || doc.title);
    nodes.push(discoveryNode('task_plan', name, rel(plan.jsonPath), description || fileDescription(plan.jsonPath), {
      scope_type: (doc && doc.scope_type) || plan.scopeType,
      client_code: plan.clientCode || '',
      approval_status: doc && doc.approval && doc.approval.status ? doc.approval.status : ''
    }));
  }

  return nodes;
}

/** Prompt names declared in the manifest chain (dict-of-phases or list). */
function declaredPrompts(manifest) {
  const out = new Map(); // name -> phase
  const chain = manifest.prompt_chain;
  if (chain && typeof chain === 'object' && !Array.isArray(chain)) {
    for (const [phase, names] of Object.entries(chain)) {
      for (const n of Array.isArray(names) ? names : []) out.set(String(n), phase);
    }
  }
  for (const entry of Array.isArray(manifest.prompts) ? manifest.prompts : []) {
    const raw = typeof entry === 'string'
      ? entry
      : (entry && (entry.name || entry.file || entry.id)) || '';
    const n = String(raw).replace(/^prompts\//, '').replace(/\.md$/, '');
    if (n && !out.has(n)) out.set(n, '');
  }
  return out;
}

function indexFramework(frameworkDir, sources) {
  const manifest = safeJson(path.join(frameworkDir, 'manifest.json'));
  if (!manifest) return [];
  sources.push(path.join(frameworkDir, 'manifest.json'));
  const guardrailsPath = path.join(frameworkDir, 'guardrails.md');
  if (fs.existsSync(guardrailsPath)) sources.push(guardrailsPath);
  const frameworkId = `${path.basename(path.dirname(frameworkDir))}/${path.basename(frameworkDir)}`;
  const lineage = buildLineage(frameworkDir, manifest);
  const nodes = [];

  // Prompts: disk is truth for paths; manifest chain adds phase context.
  const prompts = declaredPrompts(manifest);
  const promptsDir = path.join(frameworkDir, 'prompts');
  for (const f of listDir(promptsDir).filter((n) => n.endsWith('.md'))) {
    const name = f.replace(/\.md$/, '');
    const p = path.join(promptsDir, f);
    sources.push(p);
    const phase = prompts.get(name) || '';
    const desc = fileDescription(p);
    nodes.push(node(frameworkId, 'prompt', name, rel(p),
      phase ? `[${phase}] ${desc}` : desc, lineage));
    prompts.delete(name);
  }
  // Declared in manifest but missing on disk — index anyway (drift visible).
  for (const [name, phase] of prompts) {
    nodes.push(node(frameworkId, 'prompt', name, '',
      `[${phase || 'declared'}] DECLARED IN MANIFEST, NOT FOUND ON DISK`, lineage));
  }

  // Schemas, including one level of nesting (schemas/output/*.schema.json
  // exists in presentation-review, design-mockup-validation, qa — Codex S1
  // review, MAJOR).
  const schemasDir = path.join(frameworkDir, 'schemas');
  const schemaFiles = [];
  for (const entry of listDir(schemasDir)) {
    const p = path.join(schemasDir, entry);
    if (entry.endsWith('.json')) schemaFiles.push([entry, p]);
    else if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      for (const f of listDir(p).filter((n) => n.endsWith('.json'))) {
        schemaFiles.push([`${entry}/${f}`, path.join(p, f)]);
      }
    }
  }
  for (const [name, p] of schemaFiles) {
    sources.push(p);
    const doc = safeJson(p);
    nodes.push(node(frameworkId, 'schema', name.replace(/\.schema\.json$|\.json$/, ''), rel(p),
      (doc && (doc.description || doc.title)) || '', lineage));
  }

  for (const f of listDir(path.join(frameworkDir, 'helpers'))) {
    const p = path.join(frameworkDir, 'helpers', f);
    if (!fs.statSync(p).isFile()) continue;
    sources.push(p);
    nodes.push(node(frameworkId, 'helper', f.replace(/\.[^.]+$/, ''), rel(p),
      fileDescription(p), lineage));
  }

  for (const s of Array.isArray(manifest.skills) ? manifest.skills : []) {
    const name = String(s).replace(/\/SKILL\.md$/, '');
    const base = manifest.skills_path
      ? path.join(PROJECT_ROOT, manifest.skills_path, String(s))
      : path.join(frameworkDir, 'skills', String(s));
    const exists = fs.existsSync(base);
    if (exists) sources.push(base);
    nodes.push(node(frameworkId, 'skill', name,
      exists ? rel(base) : '',
      exists ? fileDescription(base) : '', lineage));
  }

  // Commands/agents resolve through their declared paths so nodes carry a
  // real file + description instead of a bare name (Codex S1 review, MINOR).
  const resolveDeclared = (kind, items, declaredPath, candidates) => {
    for (const item of Array.isArray(items) ? items : []) {
      const name = String(item);
      let found = '';
      const bases = declaredPath ? [path.join(PROJECT_ROOT, declaredPath)] : [];
      for (const base of bases) {
        for (const c of candidates(name)) {
          const p = path.join(base, c);
          if (fs.existsSync(p)) { found = p; break; }
        }
        if (found) break;
      }
      if (found) sources.push(found);
      nodes.push(node(frameworkId, kind, name,
        found ? rel(found) : '',
        found ? fileDescription(found) : '', lineage));
    }
  };
  resolveDeclared('command', manifest.commands, manifest.commands_path,
    (n) => [`${n}.md`, n]);
  resolveDeclared('agent', manifest.agents, manifest.agents_path,
    (n) => [`${n}.md`, n]);

  // Skeleton artifacts (google-ads-account-optimization): reusable templates
  // declared as a name->path dict — a framework otherwise absent from the
  // corpus (Codex S1 review, MAJOR).
  const skeleton = manifest.skeleton_artifacts;
  if (skeleton && typeof skeleton === 'object' && !Array.isArray(skeleton)) {
    for (const [name, relPath] of Object.entries(skeleton)) {
      const p = path.join(frameworkDir, String(relPath));
      const exists = fs.existsSync(p);
      if (exists) sources.push(p);
      nodes.push(node(frameworkId, 'artifact-template', name,
        exists ? rel(p) : '',
        exists ? fileDescription(p) : '', lineage));
    }
  }

  // S2: attach manifest-declared component tags to their nodes.
  for (const nd of nodes) {
    nd.tags = tagsFor(manifest, nd.kind, nd.name);
  }
  return nodes;
}

function buildComponentIndex(projectRoot = PROJECT_ROOT) {
  const sources = [];
  const nodes = [];
  const frameworksRoot = path.join(projectRoot, 'frameworks');

  for (const service of listDir(frameworksRoot)) {
    if (service.startsWith('_')) continue;
    const serviceDir = path.join(frameworksRoot, service);
    for (const name of listDir(serviceDir)) {
      const dir = path.join(serviceDir, name);
      if (fs.existsSync(path.join(dir, 'manifest.json'))) {
        nodes.push(...indexFramework(dir, sources));
      }
    }
  }

  // Shared guardrail blocks: cross-framework by construction. _shared has no
  // manifest, so its tags live in a sidecar (frameworks/_shared/
  // component-tags.json) — a minimal manifest there would risk other tooling
  // discovering _shared as a framework.
  const blocksDir = path.join(frameworksRoot, '_shared', 'blocks');
  const sharedSidecar = path.join(frameworksRoot, '_shared', 'component-tags.json');
  const sharedTags = { component_tags: (safeJson(sharedSidecar) || {}).component_tags || safeJson(sharedSidecar) || {} };
  if (fs.existsSync(sharedSidecar)) sources.push(sharedSidecar);
  for (const f of listDir(blocksDir).filter((n) => n.endsWith('.md'))) {
    const p = path.join(blocksDir, f);
    sources.push(p);
    const name = f.replace(/\.md$/, '');
    nodes.push(node('_shared', 'guardrail-block', name, rel(p),
      fileDescription(p), {
        manifest: '',
        guardrails: rel(p),
        preconditions: [],
        evidence_obligations: [],
        execution_modes: []
      }, tagsFor(sharedTags, 'guardrail-block', name)));
  }

  nodes.push(...indexSystemDiscovery(projectRoot, sources));

  // Byte-ordinal compare — locale-independent across machines.
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const anchor = Math.max(0, ...sources.map(mtimeOf));
  return {
    schema: 'ComponentIndex/1.0',
    corpus_anchor: anchor ? new Date(anchor).toISOString() : '',
    framework_count: new Set(nodes.map((n) => n.framework_id)).size,
    node_count: nodes.length,
    kinds: [...new Set(nodes.map((n) => n.kind))].sort(),
    nodes
  };
}

function main() {
  const args = process.argv.slice(2);
  const index = buildComponentIndex();
  const outFlag = args.indexOf('--out');
  if (outFlag !== -1 && args[outFlag + 1]) {
    const out = path.resolve(args[outFlag + 1]);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(index, null, 2) + '\n');
    process.stdout.write(`component-index: ${index.node_count} nodes from ${index.framework_count} frameworks -> ${rel(out)}\n`);
  } else if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(index, null, 2) + '\n');
  } else {
    process.stdout.write(`component-index: ${index.node_count} nodes, ${index.framework_count} frameworks, kinds: ${index.kinds.join(', ')}\n`);
  }
}

if (require.main === module) main();

module.exports = { buildComponentIndex };
