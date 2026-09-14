#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CAPABILITY_TIERS = new Set(['BLOCKING', 'ADVISORY', 'ABSENT', 'UNKNOWN']);
const SAFE_REVIEW_STATES = new Set(['reviewed_safe']);
const SAFE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function posix(value) {
  return value.split(path.sep).join('/');
}

function relative(root, value) {
  return posix(path.relative(root, value));
}

function validateSlugId(value, label) {
  const id = String(value || '').trim();
  if (!SAFE_ID_PATTERN.test(id)) throw new Error(`Invalid ${label}: ${JSON.stringify(id)}`);
  return id;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function walk(root, predicate = () => true) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (predicate(absolute)) found.push(absolute);
    }
  };
  visit(root);
  return found.sort();
}

function parseArgs(argv) {
  const options = { apply: false, check: false, root: PROJECT_ROOT };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--apply') options.apply = true;
    else if (token === '--check') options.check = true;
    else if (token === '--root') options.root = path.resolve(argv[++index] || '');
    else if (token === '--target-dir') options.targetDir = path.resolve(argv[++index] || '');
    else if (token === '--candidate-dir') options.candidateDir = path.resolve(argv[++index] || '');
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (options.apply && options.check) throw new Error('--apply and --check are mutually exclusive');
  return options;
}

function loadProjectionConfig(root) {
  const adapterPath = path.join(root, 'instructions', 'adapters', 'codex.yaml');
  const adapter = readJson(adapterPath);
  const config = adapter.skill_projection;
  if (!config || config.schema !== 'CodexSkillProjectionConfig/1.0') {
    throw new Error(`Missing Codex skill projection contract in ${adapterPath}`);
  }
  const requiredFamilies = ['canonical_commands', 'direct_system_skills', 'aliases', 'framework_helpers'];
  for (const family of requiredFamilies) {
    if (!config.families || !config.families[family]) throw new Error(`Projection family missing: ${family}`);
  }
  return { adapter, adapterPath, config };
}

function parseFrontmatter(text, sourcePath = '<memory>') {
  if (!text.startsWith('---\n')) return { ok: false, error: 'missing frontmatter opener', sourcePath };
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return { ok: false, error: 'missing frontmatter closer', sourcePath };
  const raw = text.slice(4, end);
  const body = text.slice(end + 5);
  const metadata = {};
  const lines = raw.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) {
      if (!lines[index].trim()) continue;
      return { ok: false, error: `malformed frontmatter at line ${index + 1}`, sourcePath };
    }
    const key = match[1];
    let value = (match[2] || '').trim();
    if (value === '>' || value === '|') {
      const chunks = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) chunks.push(lines[++index].trim());
      value = chunks.join(value === '>' ? ' ' : '\n');
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    metadata[key] = value;
  }
  if (!metadata.name || !metadata.description) return { ok: false, error: 'frontmatter requires name and description', sourcePath };
  return { ok: true, metadata, body, sourcePath };
}

function normalizeDirectSkill(text, targetName, aliases = []) {
  const parsed = parseFrontmatter(text);
  if (!parsed.ok) return parsed;
  const aliasSuffix = aliases.length ? ` Aliases: ${aliases.map((id) => `/${id}`).join(', ')}.` : '';
  return {
    ok: true,
    content: `---\nname: ${targetName}\ndescription: ${JSON.stringify(`${parsed.metadata.description}${aliasSuffix}`)}\n---\n${parsed.body}`
  };
}

function loadHandlerIds(root, config) {
  const handlerPath = path.join(root, config.handler_registry);
  delete require.cache[require.resolve(handlerPath)];
  const runtime = require(handlerPath);
  if (!runtime.HANDLERS || typeof runtime.HANDLERS !== 'object') throw new Error(`HANDLERS export missing: ${handlerPath}`);
  return new Set(Object.keys(runtime.HANDLERS));
}

function loadCanonicalCommands(root, config) {
  const sourceRoot = path.join(root, config.families.canonical_commands.source_root);
  const commands = new Map();
  for (const sourcePath of walk(sourceRoot, (file) => file.endsWith('.yaml'))) {
    const filenameId = validateSlugId(path.basename(sourcePath, '.yaml'), 'canonical command filename');
    let spec;
    try {
      spec = readJson(sourcePath);
    } catch (error) {
      commands.set(filenameId, { malformed: error.message, sourcePath, filenameId });
      continue;
    }
    const declaredId = spec.id == null ? filenameId : String(spec.id).trim();
    const malformed = !SAFE_ID_PATTERN.test(declaredId)
      ? `invalid canonical id: ${JSON.stringify(declaredId)}`
      : declaredId !== filenameId
        ? `canonical id mismatch: filename ${JSON.stringify(filenameId)} declares ${JSON.stringify(declaredId)}`
        : null;
    commands.set(filenameId, { spec, sourcePath, filenameId, declaredId, malformed });
  }
  return commands;
}

function directNameFromSource(source) {
  return path.basename(path.dirname(source));
}

function resolvedPath(value) {
  const suffix = [];
  let cursor = path.resolve(value);
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const base = fs.existsSync(cursor) ? fs.realpathSync(cursor) : cursor;
  return path.resolve(base, ...suffix);
}

function isWithin(parent, child) {
  const relation = path.relative(parent, child);
  return relation !== '' && relation !== '..' && !relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation);
}

function safeOutputPath(root, ...segments) {
  const safeRoot = resolvedPath(root);
  const output = resolvedPath(path.resolve(root, ...segments));
  if (!isWithin(safeRoot, output)) throw new Error(`Unsafe output path outside intended root: ${output}`);
  return output;
}

function validateCandidateDir(root, targetRoot, candidateDir, configuredCandidateRoot) {
  const realRoot = resolvedPath(root);
  const realTarget = resolvedPath(targetRoot);
  const realCandidate = resolvedPath(candidateDir);
  const realConfigured = resolvedPath(configuredCandidateRoot);
  if (!isWithin(realRoot, realCandidate)) throw new Error(`Unsafe candidate directory outside repository: ${candidateDir}`);
  if (realCandidate !== realConfigured && !isWithin(realConfigured, realCandidate)) {
    throw new Error(`Unsafe candidate directory outside configured projection root: ${candidateDir}`);
  }
  if (realCandidate === realTarget || isWithin(realTarget, realCandidate) || isWithin(realCandidate, realTarget)) {
    throw new Error(`Unsafe candidate directory overlaps target skills: ${candidateDir}`);
  }
  return realCandidate;
}

function clearGeneratedProjectionArtifacts(candidateDir) {
  const safeRoot = resolvedPath(candidateDir);
  for (const child of ['candidates', 'receipts']) {
    const generated = path.join(candidateDir, child);
    if (!fs.existsSync(generated)) continue;
    const resolvedGenerated = resolvedPath(generated);
    if (!isWithin(safeRoot, resolvedGenerated)) throw new Error(`Unsafe generated artifact deletion outside candidate root: ${generated}`);
    fs.rmSync(resolvedGenerated, { recursive: true });
  }
  const index = path.join(candidateDir, 'projection-index.json');
  if (fs.existsSync(index)) {
    const resolvedIndex = resolvedPath(index);
    if (!isWithin(safeRoot, resolvedIndex)) throw new Error(`Unsafe generated artifact deletion outside candidate root: ${index}`);
    fs.rmSync(resolvedIndex);
  }
}

function resolveAliases(root, config, commands, directNames, registryOverride) {
  const registryPath = path.join(root, config.alias_registry);
  const registry = registryOverride || readJson(registryPath);
  const rows = Array.isArray(registry.aliases) ? registry.aliases : [];
  const aliases = new Map();
  for (const row of rows) {
    if (!row || !row.id) continue;
    const id = validateSlugId(row.id, 'alias id');
    const target = String(row.execution_target || row.target || '').trim();
    if (target) validateSlugId(target, `target for alias ${id}`);
    if (aliases.has(id)) throw new Error(`Duplicate alias id: ${id}`);
    aliases.set(id, { ...row, id });
  }
  const results = [];

  function resolve(id, trail = []) {
    if (trail.includes(id)) return { ok: false, reason: 'alias_cycle', trail: [...trail, id] };
    const row = aliases.get(id);
    if (!row) {
      if (commands.has(id) || directNames.has(id)) return { ok: true, terminal: id, trail: [...trail, id] };
      return { ok: false, reason: 'nonterminal_alias', trail: [...trail, id] };
    }
    const next = String(row.execution_target || row.target || '').trim();
    if (!next) return { ok: false, reason: 'nonterminal_alias', trail: [...trail, id] };
    if (next === id && (commands.has(id) || directNames.has(id))) return { ok: true, terminal: id, trail: [...trail, id] };
    return resolve(next, [...trail, id]);
  }

  for (const row of aliases.values()) {
    const resolved = resolve(row.id);
    results.push({ alias: row, ...resolved });
  }
  return results;
}

function aliasesByTerminal(aliasResults) {
  const map = new Map();
  for (const result of aliasResults) {
    if (!result.ok || result.alias.id === result.terminal) continue;
    if (!map.has(result.terminal)) map.set(result.terminal, []);
    map.get(result.terminal).push(String(result.alias.id));
  }
  for (const values of map.values()) values.sort();
  return map;
}

function renderCanonicalSkill(commandId, spec, capabilityTier, override, aliases = []) {
  const aliasText = aliases.length ? ` Aliases resolved at generation time: ${aliases.map((id) => `/${id}`).join(', ')}.` : '';
  const execution = override && override.codex_execution
    ? override.codex_execution
    : capabilityTier === 'BLOCKING'
      ? `Run \`node tools/commands/mythos-command-runner.cjs\` with one positional command string formed from \`/${commandId}\` followed by the user's actual invocation arguments. With no arguments, pass exactly \`/${commandId}\`. Never pass placeholder text in place of the user's arguments. The exported HANDLERS registry is the evidence for deterministic execution.`
      : `Read the canonical command at execution time and carry out its workflow with Codex capabilities. This projection is ${capabilityTier}; availability of this skill is not a blocking runtime mechanism.`;
  return `---\nname: source-command-${commandId}\ndescription: ${JSON.stringify(`${spec.description || `Canonical /${commandId} command.`}${aliasText}`)}\n---\n\n# /${commandId}\n\nCanonical authority: \`instructions/canonical/commands/${commandId}.yaml\`. Read that file at execution time; this projection never copies or overrides its behavioral body.\n\nCapability tier: **${capabilityTier}**.\n\n${execution}\n`;
}

function frameworkIdentity(root, sourcePath) {
  const rel = relative(root, sourcePath);
  const match = rel.match(/^frameworks\/([^/]+)\/([^/]+)\/\.claude\/skills\/(.+)\/SKILL\.md$/);
  if (!match) return null;
  const [, service, framework, skillPath] = match;
  const fullSlug = ['guild', service, framework, ...skillPath.split('/')].join('-').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  const slug = fullSlug.length <= 64 ? fullSlug : `${fullSlug.slice(0, 55).replace(/-+$/, '')}-${sha256(fullSlug).slice(0, 8)}`;
  return { service, framework, skillPath, slug, rel };
}

function renderFrameworkSkill(text, identity) {
  const parsed = parseFrontmatter(text, identity.rel);
  if (!parsed.ok) return parsed;
  const lineage = `Framework lineage: \`frameworks/${identity.service}/${identity.framework}\`. Read its \`manifest.json\` and \`guardrails.md\` before execution. Source helper: \`${identity.rel}\`.`;
  return {
    ok: true,
    content: `---\nname: ${identity.slug}\ndescription: ${JSON.stringify(parsed.metadata.description.replace(/[<>]/g, (value) => value === '<' ? '(' : ')'))}\n---\n\n${lineage}\n\n${parsed.body}`
  };
}

function bundledResources(sourcePath) {
  const sourceDir = path.dirname(sourcePath);
  const files = walk(sourceDir, (file) => {
    if (file === sourcePath) return false;
    let cursor = path.dirname(file);
    while (cursor !== sourceDir && isWithin(sourceDir, cursor)) {
      if (fs.existsSync(path.join(cursor, 'SKILL.md'))) return false;
      cursor = path.dirname(cursor);
    }
    return true;
  });
  return files.map((file) => {
    const metadata = fs.lstatSync(file);
    if (metadata.isSymbolicLink()) throw new Error(`Refusing symbolic-link bundled resource: ${relative(sourceDir, file)}`);
    if (!metadata.isFile()) throw new Error(`Refusing non-file bundled resource: ${relative(sourceDir, file)}`);
    return {
      sourcePath: file,
      relativePath: relative(sourceDir, file),
      bytes: fs.readFileSync(file),
      mode: metadata.mode & 0o777
    };
  });
}

function containsPrivateAbsolutePath(bytes) {
  return /(?:^|[\s('"`])\/(?:Users|home)\/[^/\s]+\//m.test(String(bytes));
}

function receiptBase(config, sourcePath, sourceBytes, kind, capabilityTier, reviewState, targetPath) {
  return {
    generator_id: config.generator_id,
    source_relative_path: sourcePath,
    source_sha256: sourceBytes == null ? null : sha256(sourceBytes),
    projection_kind: kind,
    capability_tier: capabilityTier,
    semantic_review_state: reviewState,
    target_exact_path: targetPath,
    collision_state: 'clear',
    application_status: 'candidate'
  };
}

function attachPackageEvidence(receipt, sourceBytes, resources) {
  const resourceManifest = resources
    .map((resource) => ({ path: posix(resource.relativePath), sha256: sha256(resource.bytes), mode: resource.mode.toString(8).padStart(4, '0') }))
    .sort((a, b) => a.path.localeCompare(b.path));
  receipt.resource_manifest = resourceManifest;
  receipt.package_sha256 = sha256(Buffer.from(JSON.stringify({
    source_sha256: sha256(sourceBytes),
    resources: resourceManifest
  })));
}

function redactRejectedPackage(receipt) {
  receipt.source_sha256 = null;
  receipt.resource_manifest = [];
  receipt.package_sha256 = null;
}

function buildCandidates(options = {}) {
  const root = options.root || PROJECT_ROOT;
  const { adapter, config } = loadProjectionConfig(root);
  const targetRoot = options.targetDir || path.join(root, config.target_root);
  const handlers = options.handlerIds || loadHandlerIds(root, config);
  const commands = loadCanonicalCommands(root, config);
  const directSources = config.families.direct_system_skills.sources;
  const directNames = new Set(directSources.map(directNameFromSource));
  const aliasResults = resolveAliases(root, config, commands, directNames, options.aliasRegistry);
  const terminalAliases = aliasesByTerminal(aliasResults);
  const candidates = [];

  for (const [id, command] of commands) {
    const sourceRel = relative(root, command.sourcePath);
    const targetRel = posix(path.join(config.target_root, `source-command-${id}`, 'SKILL.md'));
    if (command.malformed || !command.spec || command.spec.id !== id) {
      candidates.push({ id: `command-${id}`, content: null, resources: [], receipt: { ...receiptBase(config, sourceRel, fs.readFileSync(command.sourcePath), 'canonical_command', 'UNKNOWN', 'malformed', targetRel), application_status: 'blocked_malformed', detail: command.malformed || 'canonical id mismatch' } });
      continue;
    }
    const override = config.command_overrides[id];
    const tier = override && override.capability_tier
      ? override.capability_tier
      : handlers.has(id) ? 'BLOCKING' : 'ADVISORY';
    const reviewState = (override && override.semantic_review_state) || config.families.canonical_commands.semantic_review_state;
    const sourceBytes = fs.readFileSync(command.sourcePath);
    const content = renderCanonicalSkill(id, command.spec, tier, override, terminalAliases.get(id) || []);
    const forbidden = (override && override.forbidden_source_fragments) || [];
    const leakedHarnessText = forbidden.some((fragment) => content.includes(fragment));
    const receipt = receiptBase(config, sourceRel, sourceBytes, 'canonical_command', tier, reviewState, targetRel);
    if (!CAPABILITY_TIERS.has(tier) || leakedHarnessText) {
      receipt.capability_tier = 'UNKNOWN';
      receipt.semantic_review_state = leakedHarnessText ? 'harness_specific_rejected' : 'malformed';
      receipt.application_status = 'blocked';
    }
    candidates.push({ id: `command-${id}`, content, resources: [], receipt, targetRoot });
  }

  for (const sourceRel of directSources) {
    const sourcePath = path.join(root, sourceRel);
    const name = directNameFromSource(sourceRel);
    const targetRel = posix(path.join(config.target_root, name, 'SKILL.md'));
    if (!fs.existsSync(sourcePath)) {
      candidates.push({ id: `direct-${name}`, content: null, resources: [], receipt: { ...receiptBase(config, sourceRel, null, 'direct_system_skill', 'ABSENT', 'missing_source', targetRel), application_status: 'blocked_missing_source' }, targetRoot });
      continue;
    }
    const sourceBytes = fs.readFileSync(sourcePath);
    const normalized = normalizeDirectSkill(String(sourceBytes), name, terminalAliases.get(name) || []);
    const resources = bundledResources(sourcePath);
    const privateLeak = containsPrivateAbsolutePath(sourceBytes) || resources.some((item) => containsPrivateAbsolutePath(item.bytes));
    const receipt = receiptBase(config, sourceRel, sourceBytes, 'direct_system_skill', normalized.ok ? 'ADVISORY' : 'UNKNOWN', config.families.direct_system_skills.semantic_review_state, targetRel);
    attachPackageEvidence(receipt, sourceBytes, resources);
    if (!normalized.ok || privateLeak) {
      receipt.capability_tier = 'UNKNOWN';
      receipt.semantic_review_state = privateLeak ? 'private_path_rejected' : 'malformed';
      receipt.application_status = 'blocked';
      receipt.detail = normalized.error || 'private absolute path detected';
    }
    if (privateLeak) redactRejectedPackage(receipt);
    candidates.push({ id: `direct-${name}`, content: privateLeak ? null : normalized.content || null, resources: privateLeak ? [] : resources, receipt, targetRoot });
  }

  const directCandidates = new Map(candidates
    .filter((candidate) => candidate.receipt.projection_kind === 'direct_system_skill')
    .map((candidate) => [candidate.id.replace(/^direct-/, ''), candidate]));
  const directDependencies = config.families.direct_system_skills.dependencies || {};
  for (const [name, dependencies] of Object.entries(directDependencies)) {
    validateSlugId(name, 'direct skill dependency owner');
    if (!Array.isArray(dependencies)) throw new Error(`Dependencies for direct skill ${name} must be an array`);
    const candidate = directCandidates.get(name);
    if (!candidate) throw new Error(`Dependency owner is not a configured direct skill: ${name}`);
    const missing = dependencies
      .map((dependency) => validateSlugId(dependency, `dependency for direct skill ${name}`))
      .filter((dependency) => !isApplicable(directCandidates.get(dependency) || {}));
    if (!missing.length) continue;
    candidate.content = null;
    candidate.resources = [];
    candidate.receipt.capability_tier = 'ABSENT';
    candidate.receipt.semantic_review_state = 'dependency_unavailable';
    candidate.receipt.application_status = 'blocked_dependency';
    candidate.receipt.detail = `required direct skill dependency unavailable: ${missing.join(', ')}`;
  }

  const frameworkRoot = path.join(root, 'frameworks');
  for (const sourcePath of walk(frameworkRoot, (file) => file.endsWith(`${path.sep}SKILL.md`) && file.includes(`${path.sep}.claude${path.sep}skills${path.sep}`))) {
    if (sourcePath.split(path.sep).includes('_template')) continue;
    const identity = frameworkIdentity(root, sourcePath);
    if (!identity) continue;
    const sourceBytes = fs.readFileSync(sourcePath);
    const rendered = renderFrameworkSkill(String(sourceBytes), identity);
    const targetRel = posix(path.join(config.target_root, identity.slug, 'SKILL.md'));
    const resources = bundledResources(sourcePath);
    const privateLeak = containsPrivateAbsolutePath(sourceBytes) || resources.some((item) => containsPrivateAbsolutePath(item.bytes));
    const receipt = receiptBase(config, identity.rel, sourceBytes, 'framework_helper', rendered.ok ? 'ADVISORY' : 'UNKNOWN', config.families.framework_helpers.semantic_review_state, targetRel);
    attachPackageEvidence(receipt, sourceBytes, resources);
    if (!rendered.ok || privateLeak) {
      receipt.capability_tier = 'UNKNOWN';
      receipt.semantic_review_state = privateLeak ? 'private_path_rejected' : 'malformed';
      receipt.application_status = 'blocked';
      receipt.detail = rendered.error || 'private absolute path detected';
    }
    if (privateLeak) redactRejectedPackage(receipt);
    candidates.push({ id: `framework-${identity.slug}`, content: privateLeak ? null : rendered.content || null, resources: privateLeak ? [] : resources, receipt, targetRoot });
  }

  for (const result of aliasResults) {
    const alias = result.alias;
    const terminal = result.ok ? result.terminal : null;
    const commandTarget = terminal && commands.has(terminal);
    const targetRel = terminal
      ? posix(path.join(config.target_root, commandTarget ? `source-command-${terminal}` : terminal, 'SKILL.md'))
      : posix(path.join(config.target_root, `unresolved-alias-${alias.id}`, 'SKILL.md'));
    const targetCandidate = candidates.find((candidate) => candidate.receipt.target_exact_path === targetRel);
    const targetAvailable = result.ok && isApplicable(targetCandidate || {});
    const tier = !result.ok ? 'UNKNOWN' : targetAvailable ? (handlers.has(terminal) ? 'BLOCKING' : 'ADVISORY') : 'ABSENT';
    const registryBytes = fs.existsSync(path.join(root, config.alias_registry))
      ? fs.readFileSync(path.join(root, config.alias_registry))
      : Buffer.from(JSON.stringify(options.aliasRegistry || {}));
    const reviewState = !result.ok
      ? 'unresolved'
      : targetAvailable ? config.families.aliases.semantic_review_state : 'target_unavailable';
    const receipt = receiptBase(config, relative(root, path.join(root, config.alias_registry)), registryBytes, 'alias_metadata', tier, reviewState, targetRel);
    receipt.application_status = !result.ok ? 'blocked' : targetAvailable ? 'metadata_candidate' : 'blocked_target_unavailable';
    if (!result.ok) receipt.detail = `${result.reason}: ${result.trail.join(' -> ')}`;
    else if (!targetAvailable) receipt.detail = 'resolved target is not an applicable Codex skill';
    candidates.push({ id: `alias-${alias.id}`, content: null, resources: [], receipt, targetRoot, aliasTerminal: terminal });
  }

  const byTarget = new Map();
  for (const candidate of candidates.filter((item) => item.content)) {
    const target = candidate.receipt.target_exact_path;
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push(candidate);
  }
  for (const colliding of byTarget.values()) {
    if (colliding.length < 2) continue;
    for (const candidate of colliding) {
      candidate.receipt.collision_state = 'collision';
      candidate.receipt.capability_tier = 'UNKNOWN';
      candidate.receipt.semantic_review_state = 'collision_rejected';
      candidate.receipt.application_status = 'blocked';
    }
  }

  return { adapter, config, candidates, targetRoot, handlers: [...handlers].sort() };
}

function writeCandidate(candidateDir, candidate) {
  validateSlugId(candidate.id, 'candidate id');
  const receiptPath = safeOutputPath(candidateDir, 'receipts', `${candidate.id}.json`);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(candidate.receipt, null, 2)}\n`);
  if (!candidate.content) return;
  const targetRel = candidate.receipt.target_exact_path.replace(/^\.agents\/skills\//, '');
  const skillPath = safeOutputPath(candidateDir, 'candidates', targetRel);
  fs.mkdirSync(path.dirname(skillPath), { recursive: true });
  fs.writeFileSync(skillPath, candidate.content);
  for (const resource of candidate.resources) {
    const resourcePath = safeOutputPath(path.dirname(skillPath), resource.relativePath);
    fs.mkdirSync(path.dirname(resourcePath), { recursive: true });
    fs.writeFileSync(resourcePath, resource.bytes);
    fs.chmodSync(resourcePath, resource.mode);
  }
}

function isApplicable(candidate) {
  return Boolean(candidate.content)
    && SAFE_REVIEW_STATES.has(candidate.receipt.semantic_review_state)
    && !['ABSENT', 'UNKNOWN'].includes(candidate.receipt.capability_tier)
    && candidate.receipt.collision_state === 'clear';
}

function expectedPackageFiles(candidate, targetRoot) {
  const suffix = candidate.receipt.target_exact_path.replace(/^\.agents\/skills\//, '');
  const skillPath = safeOutputPath(targetRoot, suffix);
  return [
    { filePath: skillPath, bytes: Buffer.from(candidate.content) },
    ...candidate.resources.map((resource) => ({
      filePath: safeOutputPath(path.dirname(skillPath), resource.relativePath),
      bytes: resource.bytes,
      mode: resource.mode
    }))
  ];
}

function packageAlignment(candidate, targetRoot) {
  const files = expectedPackageFiles(candidate, targetRoot);
  const missing = files.filter((item) => !fs.existsSync(item.filePath));
  const conflicting = files.filter((item) => fs.existsSync(item.filePath) && !fs.readFileSync(item.filePath).equals(item.bytes));
  const modeMismatches = files.filter((item) => fs.existsSync(item.filePath)
    && item.mode != null
    && (fs.statSync(item.filePath).mode & 0o777) !== item.mode);
  return { aligned: missing.length === 0 && conflicting.length === 0 && modeMismatches.length === 0, files, missing, conflicting, modeMismatches };
}

function applyCandidate(root, candidate, targetRoot) {
  if (!isApplicable(candidate)) return false;
  const alignment = packageAlignment(candidate, targetRoot);
  if (alignment.conflicting.length || alignment.modeMismatches.length) {
    candidate.receipt.application_status = 'blocked_existing_preserved';
    const conflicts = [...new Set([...alignment.conflicting, ...alignment.modeMismatches].map((item) => relative(root, item.filePath)))];
    candidate.receipt.detail = `conflicting existing package file(s): ${conflicts.join(', ')}`;
    return false;
  }
  if (alignment.aligned) {
    candidate.receipt.application_status = 'already_aligned';
    return false;
  }
  for (const item of alignment.missing) {
    fs.mkdirSync(path.dirname(item.filePath), { recursive: true });
    fs.writeFileSync(item.filePath, item.bytes);
    if (item.mode != null) fs.chmodSync(item.filePath, item.mode);
  }
  candidate.receipt.application_status = 'applied_additive';
  return true;
}

function sync(options = {}) {
  const root = options.root || PROJECT_ROOT;
  const built = buildCandidates(options);
  const candidateDir = options.candidateDir || path.join(root, built.config.candidate_root);
  const targetRoot = options.targetDir || path.join(root, built.config.target_root);
  const selected = options.includeCandidate
    ? built.candidates.filter(options.includeCandidate)
    : built.candidates;
  let drift = 0;
  let applied = 0;

  if (options.check) {
    for (const candidate of selected.filter(isApplicable)) {
      if (!packageAlignment(candidate, targetRoot).aligned) drift += 1;
    }
    return { ...built, allCandidates: built.candidates, candidates: selected, candidateDir, drift, applied };
  }

  const configuredCandidateRoot = path.join(root, built.config.candidate_root);
  const validatedCandidateDir = validateCandidateDir(root, targetRoot, candidateDir, configuredCandidateRoot);
  clearGeneratedProjectionArtifacts(validatedCandidateDir);
  fs.mkdirSync(validatedCandidateDir, { recursive: true });
  if (options.apply) {
    for (const candidate of selected) if (applyCandidate(root, candidate, targetRoot)) applied += 1;
    const appliedTerminals = new Set(selected.filter((item) => ['applied_additive', 'already_aligned'].includes(item.receipt.application_status)).map((item) => item.receipt.target_exact_path));
    for (const candidate of selected.filter((item) => item.receipt.projection_kind === 'alias_metadata' && item.receipt.application_status === 'metadata_candidate')) {
      if (appliedTerminals.has(candidate.receipt.target_exact_path)) {
        candidate.receipt.application_status = 'metadata_attached';
      } else {
        candidate.receipt.application_status = 'blocked_target_unavailable';
        candidate.receipt.capability_tier = 'ABSENT';
        candidate.receipt.semantic_review_state = 'target_unavailable';
        candidate.receipt.detail = 'resolved target is not an applied or aligned Codex skill';
      }
    }
  }
  for (const candidate of selected) writeCandidate(validatedCandidateDir, candidate);
  const index = {
    schema: 'CodexSkillProjectionIndex/1.0',
    generator_id: built.config.generator_id,
    handler_ids: built.handlers,
    counts: selected.reduce((acc, item) => {
      const key = `${item.receipt.projection_kind}:${item.receipt.capability_tier}:${item.receipt.semantic_review_state}:${item.receipt.application_status}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    receipts: selected.map((item) => `receipts/${item.id}.json`).sort()
  };
  fs.writeFileSync(path.join(validatedCandidateDir, 'projection-index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return { ...built, allCandidates: built.candidates, candidates: selected, candidateDir: validatedCandidateDir, drift, applied, index };
}

function main() {
  const options = parseArgs(process.argv);
  const result = sync(options);
  if (options.check) {
    if (result.drift) {
      process.stderr.write(`Codex skill projection drift: ${result.drift} reviewed-safe candidate(s) missing or changed\n`);
      process.exitCode = 1;
    } else process.stdout.write('Codex skill projections aligned\n');
    return;
  }
  process.stdout.write(`Codex skill candidates: ${result.candidates.length}; additive applications: ${result.applied}; receipts: ${result.candidateDir}\n`);
}

if (require.main === module) main();

module.exports = {
  CAPABILITY_TIERS,
  SAFE_REVIEW_STATES,
  aliasesByTerminal,
  buildCandidates,
  clearGeneratedProjectionArtifacts,
  containsPrivateAbsolutePath,
  frameworkIdentity,
  isApplicable,
  packageAlignment,
  loadProjectionConfig,
  normalizeDirectSkill,
  parseArgs,
  parseFrontmatter,
  renderCanonicalSkill,
  renderFrameworkSkill,
  resolveAliases,
  sync,
  validateCandidateDir
};
