#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CAPABILITY_TIERS = new Set(['BLOCKING', 'ADVISORY', 'ABSENT', 'UNKNOWN']);
const SAFE_REVIEW_STATES = new Set(['reviewed_safe']);
const EXECUTION_MODES = new Set(['FINDINGS_ONLY', 'RUN_ONLY', 'REVIEW_ONLY', 'PATCH_ALLOWED', 'COORDINATOR', 'REPO_HYGIENE']);
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

function sanitizedJsonError(error) {
  const lineColumn = String(error && error.message).match(/line (\d+) column (\d+)/i);
  if (lineColumn) return `invalid JSON at line ${lineColumn[1]} column ${lineColumn[2]}`;
  const position = String(error && error.message).match(/position (\d+)/i);
  return position ? `invalid JSON at position ${position[1]}` : 'invalid JSON';
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
  const adapterPath = validateConfiguredSource(root, 'instructions/adapters/codex.yaml', 'Codex adapter');
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

function stripYamlInlineComment(value) {
  const text = String(value);
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (quote === '"' && character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '#' && (index === 0 || /\s/.test(text[index - 1]))) return text.slice(0, index).trimEnd();
  }
  return text;
}

function parseFrontmatter(text, sourcePath = '<memory>') {
  const normalizedText = String(text).replace(/\r\n?/g, '\n');
  if (!normalizedText.startsWith('---\n')) return { ok: false, error: 'missing frontmatter opener', sourcePath };
  const end = normalizedText.indexOf('\n---\n', 4);
  if (end < 0) return { ok: false, error: 'missing frontmatter closer', sourcePath };
  const raw = normalizedText.slice(4, end);
  const body = normalizedText.slice(end + 5);
  const metadata = {};
  const lines = raw.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) {
      if (!lines[index].trim()) continue;
      return { ok: false, error: `malformed frontmatter at line ${index + 1}`, sourcePath };
    }
    const key = match[1];
    let value = stripYamlInlineComment((match[2] || '').trim()).trim();
    if (value === '>' || value === '|') {
      const chunks = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) chunks.push(lines[++index].trim());
      value = chunks.join(value === '>' ? ' ' : '\n');
    } else if (!value && index + 1 < lines.length && /^\s+-\s+/.test(lines[index + 1])) {
      const items = [];
      while (index + 1 < lines.length) {
        const itemMatch = lines[index + 1].match(/^\s+-\s+(.+)$/);
        if (!itemMatch) break;
        index += 1;
        let item = stripYamlInlineComment(itemMatch[1].trim()).trim();
        if ((item.startsWith('"') && item.endsWith('"')) || (item.startsWith("'") && item.endsWith("'"))) {
          item = item.slice(1, -1);
        }
        items.push(item);
      }
      value = items;
    }
    if (key === 'allowed-tools' && typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      try {
        const items = JSON.parse(value);
        if (Array.isArray(items) && items.every((item) => typeof item === 'string')) value = items;
      } catch {
        // Leave non-JSON YAML flow syntax as a scalar; the projector will preserve it verbatim.
      }
    }
    if (typeof value === 'string' && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    metadata[key] = value;
  }
  if (typeof metadata.name !== 'string' || !metadata.name || typeof metadata.description !== 'string' || !metadata.description) {
    return { ok: false, error: 'frontmatter requires scalar name and description', sourcePath };
  }
  return { ok: true, metadata, body, sourcePath };
}

function normalizeDirectSkill(text, targetName, aliases = []) {
  const parsed = parseFrontmatter(text);
  if (!parsed.ok) return parsed;
  if (parsed.metadata.execution_mode != null
    && (typeof parsed.metadata.execution_mode !== 'string' || !EXECUTION_MODES.has(parsed.metadata.execution_mode))) {
    return { ok: false, error: 'frontmatter execution_mode must be one declared execution mode' };
  }
  const aliasSuffix = aliases.length ? ` Aliases: ${aliases.map((id) => `/${id}`).join(', ')}.` : '';
  const executionMetadata = projectionExecutionMetadata(parsed.metadata);
  const supportedFields = projectionSupportedFrontmatter(parsed.metadata);
  return {
    ok: true,
    content: `---\nname: ${targetName}\ndescription: ${JSON.stringify(`${parsed.metadata.description}${aliasSuffix}`)}\n${supportedFields}${executionMetadata}---\n${parsed.body}`
  };
}

function projectionSupportedFrontmatter(metadata) {
  const fields = ['license', 'allowed-tools'].filter((key) => metadata[key]);
  return fields.map((key) => `${key}: ${JSON.stringify(metadata[key])}\n`).join('');
}

function projectionExecutionMetadata(metadata) {
  const fields = ['execution_mode', 'trust_tier'].filter((key) => metadata[key]);
  if (!fields.length) return '';
  return `metadata:\n${fields.map((key) => `  ${key}: ${JSON.stringify(metadata[key])}`).join('\n')}\n`;
}

function loadHandlerIds(root, config) {
  const handlerPath = validateConfiguredSource(root, config.handler_registry, 'handler registry');
  delete require.cache[require.resolve(handlerPath)];
  const runtime = require(handlerPath);
  if (!runtime.HANDLERS || typeof runtime.HANDLERS !== 'object') throw new Error(`HANDLERS export missing: ${handlerPath}`);
  return new Set(Object.keys(runtime.HANDLERS));
}

function loadCanonicalCommands(root, config) {
  const sourceRoot = path.join(root, config.families.canonical_commands.source_root);
  const commands = new Map();
  validateSourceRoot(sourceRoot, 'canonical command', root);
  for (const sourcePath of walk(sourceRoot, (file) => file.endsWith('.yaml'))) {
    validateSourceFile(sourcePath, sourceRoot, 'canonical command', root);
    const sourceRel = relative(root, sourcePath);
    if (containsPrivateAbsolutePath(sourceRel) || containsCredentialMaterial(sourceRel)) {
      throw new Error('Refusing private or credential-bearing canonical command path');
    }
    const filenameId = validateSlugId(path.basename(sourcePath, '.yaml'), 'canonical command filename');
    const nested = path.dirname(relative(sourceRoot, sourcePath)) !== '.';
    let spec;
    let command;
    try {
      spec = readJson(sourcePath);
    } catch (error) {
      command = { malformed: sanitizedJsonError(error), sourcePath, filenameId };
    }
    if (!command) {
      const declaredId = spec.id == null ? filenameId : String(spec.id).trim();
      const malformed = !SAFE_ID_PATTERN.test(declaredId)
        ? `invalid canonical id for filename ${JSON.stringify(filenameId)}`
        : declaredId !== filenameId
          ? `canonical id mismatch for filename ${JSON.stringify(filenameId)}`
          : null;
      command = { spec, sourcePath, filenameId, declaredId, malformed };
    }
    if (`source-command-${filenameId}`.length > 64) {
      command.malformed = `canonical command projection name exceeds 64 characters for filename ${JSON.stringify(filenameId)}`;
    }
    if (nested) command.malformed = `nested canonical command path rejected for filename ${JSON.stringify(filenameId)}`;
    const existing = commands.get(filenameId);
    if (!existing) commands.set(filenameId, command);
    else commands.set(filenameId, { filenameId, duplicates: existing.duplicates ? [...existing.duplicates, command] : [existing, command] });
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

function validateSourceRoot(sourceRoot, label, projectRoot = PROJECT_ROOT) {
  const lexicalProjectRoot = path.resolve(projectRoot);
  const lexicalSourceRoot = path.resolve(sourceRoot);
  if (lexicalSourceRoot !== lexicalProjectRoot && !isWithin(lexicalProjectRoot, lexicalSourceRoot)) {
    throw new Error(`Refusing ${label} source root outside repository: ${sourceRoot}`);
  }
  let cursor = lexicalSourceRoot;
  while (cursor !== lexicalProjectRoot) {
    try {
      const rootMetadata = fs.lstatSync(cursor);
      if (rootMetadata.isSymbolicLink()) throw new Error(`Refusing symbolic-link ${label} source root: ${cursor}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    cursor = path.dirname(cursor);
  }
  const realProjectRoot = fs.realpathSync(lexicalProjectRoot);
  const realRoot = resolvedPath(lexicalSourceRoot);
  if (realRoot !== realProjectRoot && !isWithin(realProjectRoot, realRoot)) {
    throw new Error(`Refusing resolved ${label} source root outside repository: ${sourceRoot}`);
  }
  if (fs.existsSync(lexicalSourceRoot) && !fs.lstatSync(lexicalSourceRoot).isDirectory()) {
    throw new Error(`Refusing non-directory ${label} source root: ${sourceRoot}`);
  }
  return realRoot;
}

function validateSourceFile(sourcePath, sourceRoot, label, projectRoot = PROJECT_ROOT) {
  const realRoot = validateSourceRoot(sourceRoot, label, projectRoot);
  const metadata = fs.lstatSync(sourcePath);
  if (metadata.isSymbolicLink()) throw new Error(`Refusing symbolic-link ${label} source: ${relative(sourceRoot, sourcePath)}`);
  if (!metadata.isFile()) throw new Error(`Refusing non-file ${label} source: ${relative(sourceRoot, sourcePath)}`);
  const realSource = fs.realpathSync(sourcePath);
  if (!isWithin(realRoot, realSource)) throw new Error(`Refusing ${label} source outside declared root: ${sourcePath}`);
  return realSource;
}

function validateConfiguredSource(root, configuredPath, label) {
  const sourcePath = path.resolve(root, String(configuredPath || ''));
  if (!isWithin(path.resolve(root), sourcePath)) throw new Error(`Refusing ${label} outside repository`);
  validateSourceFile(sourcePath, root, label, root);
  return sourcePath;
}

function safeOutputPath(root, ...segments) {
  const lexicalRoot = path.resolve(root);
  const lexicalOutput = path.resolve(root, ...segments);
  if (!isWithin(lexicalRoot, lexicalOutput)) throw new Error(`Unsafe output path outside intended root: ${lexicalOutput}`);
  let cursor = lexicalRoot;
  for (const component of path.relative(lexicalRoot, lexicalOutput).split(path.sep)) {
    cursor = path.join(cursor, component);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Refusing symbolic-link destination component: ${cursor}`);
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    }
  }
  const safeRoot = resolvedPath(lexicalRoot);
  const output = resolvedPath(lexicalOutput);
  if (!isWithin(safeRoot, output)) throw new Error(`Unsafe output path outside intended root: ${output}`);
  return output;
}

function validateTargetRoot(root, targetRoot) {
  const lexicalRoot = path.resolve(root);
  const lexicalTarget = path.resolve(targetRoot);
  if (!isWithin(lexicalRoot, lexicalTarget)) throw new Error(`Unsafe target root outside repository: ${targetRoot}`);
  let cursor = lexicalTarget;
  while (cursor !== lexicalRoot) {
    try {
      const metadata = fs.lstatSync(cursor);
      if (metadata.isSymbolicLink()) throw new Error(`Refusing symbolic-link target root component: ${cursor}`);
      if (cursor === lexicalTarget && !metadata.isDirectory()) throw new Error(`Target root is not a directory: ${cursor}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    cursor = path.dirname(cursor);
  }
  const realRoot = fs.realpathSync(lexicalRoot);
  const realTarget = resolvedPath(lexicalTarget);
  if (!isWithin(realRoot, realTarget)) throw new Error(`Unsafe resolved target root outside repository: ${targetRoot}`);
  return realTarget;
}

function validateCandidateDir(root, targetRoot, candidateDir, configuredCandidateRoot) {
  const lexicalRoot = path.resolve(root);
  const lexicalCandidate = path.resolve(candidateDir);
  const lexicalConfigured = path.resolve(configuredCandidateRoot);
  if (!isWithin(lexicalRoot, lexicalConfigured)) throw new Error(`Unsafe configured candidate directory outside repository: ${configuredCandidateRoot}`);
  if (lexicalCandidate !== lexicalConfigured && !isWithin(lexicalConfigured, lexicalCandidate)) {
    throw new Error(`Unsafe candidate directory outside configured projection root: ${candidateDir}`);
  }
  let cursor = lexicalCandidate;
  while (cursor !== lexicalRoot) {
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Refusing symbolic-link candidate directory component: ${cursor}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    cursor = path.dirname(cursor);
  }
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
  const planned = [
    { generated: path.join(candidateDir, 'candidates'), recursive: true },
    { generated: path.join(candidateDir, 'receipts'), recursive: true },
    { generated: path.join(candidateDir, 'projection-index.json'), recursive: true }
  ];
  const validated = [];
  for (const item of planned) {
    const { generated } = item;
    let metadata;
    try {
      metadata = fs.lstatSync(generated);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (metadata.isSymbolicLink()) throw new Error(`Unsafe generated artifact symlink: ${generated}`);
    const resolvedGenerated = resolvedPath(generated);
    if (!isWithin(safeRoot, resolvedGenerated)) throw new Error(`Unsafe generated artifact deletion outside candidate root: ${generated}`);
    validated.push({ ...item, resolvedGenerated });
  }
  for (const { resolvedGenerated, recursive } of validated) {
    fs.rmSync(resolvedGenerated, { recursive });
  }
}

function resolveAliases(root, config, commands, directNames, registryOverride) {
  const registryPath = validateConfiguredSource(root, config.alias_registry, 'alias registry');
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

function aliasesByTerminal(aliasResults, canonicalCommands = new Map()) {
  const map = new Map();
  for (const result of aliasResults) {
    if (!result.ok || result.alias.id === result.terminal || canonicalCommands.has(result.alias.id)) continue;
    if (!map.has(result.terminal)) map.set(result.terminal, []);
    map.get(result.terminal).push(String(result.alias.id));
  }
  for (const values of map.values()) values.sort();
  return map;
}

function renderCanonicalSkill(commandId, spec, capabilityTier, override, aliases = []) {
  const aliasText = aliases.length ? ` Aliases resolved at generation time: ${aliases.map((id) => `/${id}`).join(', ')}.` : '';
  const description = `${spec.description || `Canonical /${commandId} command.`}${aliasText}`
    .replace(/[<>]/g, (value) => value === '<' ? '(' : ')');
  const execution = override && override.codex_execution
    ? override.codex_execution
    : capabilityTier === 'BLOCKING'
      ? `Run \`node tools/commands/mythos-command-runner.cjs\` with one positional command string formed from \`/${commandId}\` followed by the user's actual invocation arguments. With no arguments, pass exactly \`/${commandId}\`. Never pass placeholder text in place of the user's arguments. The exported HANDLERS registry is the evidence for deterministic execution.`
      : `Read the canonical command at execution time and carry out its workflow with Codex capabilities. This projection is ${capabilityTier}; availability of this skill is not a blocking runtime mechanism.`;
  return `---\nname: source-command-${commandId}\ndescription: ${JSON.stringify(description)}\n---\n\n# /${commandId}\n\nCanonical authority: \`instructions/canonical/commands/${commandId}.yaml\`. Read that file at execution time; this projection never copies or overrides its behavioral body.\n\nCapability tier: **${capabilityTier}**.\n\n${execution}\n`;
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
  const executionMetadata = projectionExecutionMetadata(parsed.metadata);
  const supportedFields = projectionSupportedFrontmatter(parsed.metadata);
  return {
    ok: true,
    content: `---\nname: ${identity.slug}\ndescription: ${JSON.stringify(parsed.metadata.description.replace(/[<>]/g, (value) => value === '<' ? '(' : ')'))}\n${supportedFields}${executionMetadata}---\n\n${lineage}\n\n${parsed.body}`
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
    const relativePath = relative(sourceDir, file);
    const metadata = fs.lstatSync(file);
    if (metadata.isSymbolicLink()) throw new Error(`Refusing symbolic-link bundled resource: ${relativePath}`);
    if (!metadata.isFile()) throw new Error(`Refusing non-file bundled resource: ${relativePath}`);
    if (isSensitiveResourcePath(relativePath)) throw new Error(`Refusing sensitive bundled resource: ${relativePath}`);
    if (containsCredentialMaterial(relativePath) || containsPrivateAbsolutePath(relativePath)) {
      throw new Error('Refusing private or credential-bearing bundled resource path');
    }
    const bytes = fs.readFileSync(file);
    if (containsCredentialMaterial(bytes)) throw new Error(`Refusing credential-bearing bundled resource: ${relativePath}`);
    return {
      sourcePath: file,
      relativePath,
      bytes,
      mode: metadata.mode & 0o777
    };
  });
}

function containsPrivateAbsolutePath(bytes) {
  const text = String(bytes);
  return /\/(?:Users|home)\/[^\\/\s"'`;,]+(?=$|[\\/\s"'`;,])/m.test(text)
    || /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/](?:Users|home)[\\/][^\\/\s"'`;,]+(?=$|[\\/\s"'`;,])/m.test(text)
    || /[\\/]{2}[^\\/\s]+[\\/](?:Users|home)[\\/][^\\/\s"'`;,]+(?=$|[\\/\s"'`;,])/m.test(text)
    || /\/root(?=$|[\\/\s"'`;,])/m.test(text);
}

function containsCredentialMaterial(bytes) {
  const text = String(bytes);
  return /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(text)
    || /(?:^|[^A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|(?:AKIA|ASIA)[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35})(?:$|[^A-Za-z0-9_-])/m.test(text)
    || /(?:^|[^A-Z0-9_])["']?(?:AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|GH_TOKEN|GITLAB_TOKEN|SLACK_BOT_TOKEN|GOOGLE_API_KEY|API[_-]?KEY|CLIENT[_-]?SECRET|PASSWORD|PASSWD|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|AUTH[_-]?TOKEN|SECRET|SECRET[_-]?KEY|PRIVATE[_-]?KEY)["']?\s*[:=]\s*["']?(?!(?:<|\$(?:\{|[A-Za-z_])|your[-_]|example|redacted|placeholder))[^\s"'`]+/im.test(text);
}

function isSensitiveResourcePath(relativePath) {
  const name = path.basename(relativePath).toLowerCase();
  return name === '.env'
    || name.startsWith('.env.')
    || ['.netrc', '.npmrc', 'credentials.json', 'secrets.json', 'id_rsa', 'id_ed25519'].includes(name)
    || ['.key', '.p12', '.pfx', '.pem'].some((extension) => name.endsWith(extension));
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
  const directSourceRoot = path.join(root, config.families.direct_system_skills.source_root || '.claude/skills');
  const directDescriptors = directSources.map((sourceRel) => {
    if (containsPrivateAbsolutePath(sourceRel) || containsCredentialMaterial(sourceRel)) {
      throw new Error('Refusing private or credential-bearing direct skill path');
    }
    return { sourceRel, name: validateSlugId(directNameFromSource(sourceRel), 'direct skill name') };
  });
  const directNames = new Set(directDescriptors.map(({ name }) => name));
  const aliasResults = resolveAliases(root, config, commands, directNames, options.aliasRegistry);
  const terminalAliases = aliasesByTerminal(aliasResults, commands);
  const typedAliasTerminals = new Map(aliasResults
    .filter((result) => result.ok && commands.has(result.alias.id))
    .map((result) => [result.alias.id, result.terminal]));
  const candidates = [];
  const aliasRegistryPath = validateConfiguredSource(root, config.alias_registry, 'alias registry');
  const aliasRegistryBytes = options.aliasRegistry
    ? Buffer.from(JSON.stringify(options.aliasRegistry))
    : fs.readFileSync(aliasRegistryPath);

  for (const [id, command] of commands) {
    const targetRel = posix(path.join(config.target_root, `source-command-${id}`, 'SKILL.md'));
    if (command.duplicates) {
      for (const duplicate of command.duplicates) {
        const sourceRel = relative(root, duplicate.sourcePath);
        candidates.push({
          id: `command-${id}`,
          content: null,
          resources: [],
          receipt: {
            ...receiptBase(config, sourceRel, fs.readFileSync(duplicate.sourcePath), 'canonical_command', 'UNKNOWN', 'duplicate_rejected', targetRel),
            application_status: 'blocked',
            detail: `duplicate canonical command filename ${JSON.stringify(id)}`
          },
          targetRoot
        });
      }
      continue;
    }
    const sourceRel = relative(root, command.sourcePath);
    if (command.malformed || !command.spec || command.spec.id !== id) {
      candidates.push({ id: `command-${id}`, content: null, resources: [], receipt: { ...receiptBase(config, sourceRel, fs.readFileSync(command.sourcePath), 'canonical_command', 'UNKNOWN', 'malformed', targetRel), application_status: 'blocked_malformed', detail: command.malformed || 'canonical id mismatch' } });
      continue;
    }
    const override = config.command_overrides[id];
    const executionTarget = typedAliasTerminals.get(id) || id;
    const tier = override && override.capability_tier
      ? override.capability_tier
      : handlers.has(executionTarget) ? 'BLOCKING' : 'ADVISORY';
    const reviewState = (override && override.semantic_review_state) || config.families.canonical_commands.semantic_review_state;
    const sourceBytes = fs.readFileSync(command.sourcePath);
    const content = renderCanonicalSkill(id, command.spec, tier, override, terminalAliases.get(id) || []);
    const forbidden = (override && override.forbidden_source_fragments) || [];
    const leakedHarnessText = forbidden.some((fragment) => content.includes(fragment));
    const privateLeak = containsPrivateAbsolutePath(content) || containsCredentialMaterial(content);
    const receipt = receiptBase(config, sourceRel, sourceBytes, 'canonical_command', tier, reviewState, targetRel);
    if (!CAPABILITY_TIERS.has(tier) || leakedHarnessText || privateLeak) {
      receipt.capability_tier = 'UNKNOWN';
      receipt.semantic_review_state = privateLeak ? 'private_path_rejected' : leakedHarnessText ? 'harness_specific_rejected' : 'malformed';
      receipt.application_status = 'blocked';
      if (privateLeak) {
        receipt.detail = 'private or credential content detected';
        redactRejectedPackage(receipt);
      }
    }
    candidates.push({ id: `command-${id}`, content: privateLeak ? null : content, resources: [], receipt, targetRoot });
  }

  for (const { sourceRel, name } of directDescriptors) {
    const sourcePath = path.join(root, sourceRel);
    const targetRel = posix(path.join(config.target_root, name, 'SKILL.md'));
    if (!fs.existsSync(sourcePath)) {
      candidates.push({ id: `direct-${name}`, content: null, resources: [], receipt: { ...receiptBase(config, sourceRel, null, 'direct_system_skill', 'ABSENT', 'missing_source', targetRel), application_status: 'blocked_missing_source' }, targetRoot });
      continue;
    }
    validateSourceFile(sourcePath, directSourceRoot, 'direct skill', root);
    const sourceBytes = fs.readFileSync(sourcePath);
    const normalized = name.length > 64
      ? { ok: false, error: 'direct skill projection name exceeds 64 characters' }
      : normalizeDirectSkill(String(sourceBytes), name, terminalAliases.get(name) || []);
    const resources = bundledResources(sourcePath);
    const privateLeak = containsPrivateAbsolutePath(sourceBytes) || containsCredentialMaterial(sourceBytes)
      || resources.some((item) => containsPrivateAbsolutePath(item.bytes) || containsCredentialMaterial(item.bytes));
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
  const validatedDependencies = [];
  for (const [name, dependencies] of Object.entries(directDependencies)) {
    validateSlugId(name, 'direct skill dependency owner');
    if (!Array.isArray(dependencies)) throw new Error(`Dependencies for direct skill ${name} must be an array`);
    const candidate = directCandidates.get(name);
    if (!candidate) throw new Error(`Dependency owner is not a configured direct skill: ${name}`);
    validatedDependencies.push({
      candidate,
      dependencies: dependencies.map((dependency) => validateSlugId(dependency, `dependency for direct skill ${name}`))
    });
  }
  let dependencyChanged;
  do {
    dependencyChanged = false;
    for (const { candidate, dependencies } of validatedDependencies) {
      if (!isApplicable(candidate)) continue;
      const missing = dependencies.filter((dependency) => !isApplicable(directCandidates.get(dependency) || {}));
      if (!missing.length) continue;
      candidate.content = null;
      candidate.resources = [];
      candidate.receipt.capability_tier = 'ABSENT';
      candidate.receipt.semantic_review_state = 'dependency_unavailable';
      candidate.receipt.application_status = 'blocked_dependency';
      candidate.receipt.detail = `required direct skill dependency unavailable: ${missing.join(', ')}`;
      dependencyChanged = true;
    }
  } while (dependencyChanged);

  const frameworkRoot = path.join(root, 'frameworks');
  validateSourceRoot(frameworkRoot, 'framework skill', root);
  for (const sourcePath of walk(frameworkRoot, (file) => file.endsWith(`${path.sep}SKILL.md`) && file.includes(`${path.sep}.claude${path.sep}skills${path.sep}`))) {
    if (sourcePath.split(path.sep).includes('_template')) continue;
    const identity = frameworkIdentity(root, sourcePath);
    if (!identity) continue;
    if (containsPrivateAbsolutePath(identity.rel) || containsCredentialMaterial(identity.rel)) {
      throw new Error('Refusing private or credential-bearing framework skill path');
    }
    validateSourceFile(sourcePath, frameworkRoot, 'framework skill', root);
    const sourceBytes = fs.readFileSync(sourcePath);
    const rendered = renderFrameworkSkill(String(sourceBytes), identity);
    const targetRel = posix(path.join(config.target_root, identity.slug, 'SKILL.md'));
    const resources = bundledResources(sourcePath);
    const privateLeak = containsPrivateAbsolutePath(sourceBytes) || containsCredentialMaterial(sourceBytes)
      || resources.some((item) => containsPrivateAbsolutePath(item.bytes) || containsCredentialMaterial(item.bytes));
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
    const typedCommandTarget = result.ok && commands.has(alias.id);
    const commandTarget = terminal && commands.has(terminal);
    const targetRel = terminal
      ? posix(path.join(config.target_root, typedCommandTarget ? `source-command-${alias.id}` : commandTarget ? `source-command-${terminal}` : terminal, 'SKILL.md'))
      : posix(path.join(config.target_root, `unresolved-alias-${alias.id}`, 'SKILL.md'));
    const targetCandidate = candidates.find((candidate) => candidate.receipt.target_exact_path === targetRel);
    const targetAvailable = result.ok && isApplicable(targetCandidate || {});
    const tier = !result.ok ? 'UNKNOWN' : targetAvailable ? targetCandidate.receipt.capability_tier : 'ABSENT';
    const reviewState = !result.ok
      ? 'unresolved'
      : targetAvailable ? config.families.aliases.semantic_review_state : 'target_unavailable';
    const receipt = receiptBase(config, relative(root, aliasRegistryPath), aliasRegistryBytes, 'alias_metadata', tier, reviewState, targetRel);
    receipt.application_status = !result.ok ? 'blocked' : targetAvailable ? 'metadata_candidate' : 'blocked_target_unavailable';
    if (!result.ok) receipt.detail = `${result.reason}: ${result.trail.join(' -> ')}`;
    else if (!targetAvailable) receipt.detail = 'resolved target is not an applicable Codex skill';
    candidates.push({ id: `alias-${alias.id}`, content: null, resources: [], receipt, targetRoot, aliasTerminal: terminal });
  }

  const byTarget = new Map();
  for (const candidate of candidates.filter((item) => item.receipt.projection_kind !== 'alias_metadata')) {
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
      candidate.id = `${candidate.id}-${sha256(candidate.receipt.source_relative_path).slice(0, 8)}`;
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
  const targetRel = stagedCandidateRelativePath(candidate);
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

function stagedCandidateRelativePath(candidate) {
  return candidate.receipt.collision_state === 'collision'
    ? path.join(candidate.id, 'SKILL.md')
    : candidate.receipt.target_exact_path.replace(/^\.agents\/skills\//, '');
}

function preflightCandidateStaging(candidateDir, candidates) {
  const outputs = new Set();
  const register = (filePath) => {
    if (outputs.has(filePath)) throw new Error(`Duplicate staged projection output: ${filePath}`);
    outputs.add(filePath);
  };
  for (const candidate of candidates) {
    validateSlugId(candidate.id, 'candidate id');
    register(safeOutputPath(candidateDir, 'receipts', `${candidate.id}.json`));
    if (!candidate.content) continue;
    const skillPath = safeOutputPath(candidateDir, 'candidates', stagedCandidateRelativePath(candidate));
    register(skillPath);
    for (const resource of candidate.resources) register(safeOutputPath(path.dirname(skillPath), resource.relativePath));
  }
  const indexPath = path.join(candidateDir, 'projection-index.json');
  try {
    if (fs.lstatSync(indexPath).isSymbolicLink()) throw new Error(`Unsafe generated artifact symlink: ${indexPath}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  register(safeOutputPath(candidateDir, 'projection-index.json'));
}

function isApplicable(candidate) {
  return Boolean(candidate.content)
    && SAFE_REVIEW_STATES.has(candidate.receipt.semantic_review_state)
    && !['ABSENT', 'UNKNOWN'].includes(candidate.receipt.capability_tier)
    && candidate.receipt.collision_state === 'clear';
}

function alignmentBlocksApplication(alignment) {
  return alignment.nonFiles.length || alignment.conflicting.length || alignment.modeMismatches.length || alignment.unexpected.length;
}

function blockApplicationDependencies(config, candidates, applicationPreflight) {
  const directCandidates = new Map(candidates
    .filter((candidate) => candidate.receipt.projection_kind === 'direct_system_skill')
    .map((candidate) => [candidate.id.replace(/^direct-/, ''), candidate]));
  const dependencies = config.families.direct_system_skills.dependencies || {};
  let changed;
  do {
    changed = false;
    for (const [name, required] of Object.entries(dependencies)) {
      const candidate = directCandidates.get(name);
      if (!candidate || !isApplicable(candidate)) continue;
      const unavailable = required.filter((dependency) => {
        const dependencyCandidate = directCandidates.get(dependency);
        if (!dependencyCandidate || !isApplicable(dependencyCandidate)) return true;
        const alignment = applicationPreflight.get(dependencyCandidate);
        return alignment ? Boolean(alignmentBlocksApplication(alignment)) : true;
      });
      if (!unavailable.length) continue;
      candidate.content = null;
      candidate.resources = [];
      candidate.receipt.capability_tier = 'ABSENT';
      candidate.receipt.semantic_review_state = 'dependency_unavailable';
      candidate.receipt.application_status = 'blocked_dependency';
      candidate.receipt.detail = `required direct skill dependency unavailable during application: ${unavailable.join(', ')}`;
      changed = true;
    }
  } while (changed);
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

function nestedNonDirectory(filePath, packageRoot) {
  let cursor = path.dirname(filePath);
  while (cursor !== packageRoot && isWithin(packageRoot, cursor)) {
    try {
      if (!fs.lstatSync(cursor).isDirectory()) return cursor;
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    }
    cursor = path.dirname(cursor);
  }
  return null;
}

function packageAlignment(candidate, targetRoot) {
  const files = expectedPackageFiles(candidate, targetRoot);
  const packageRoot = path.dirname(files[0].filePath);
  try {
    const packageMetadata = fs.lstatSync(packageRoot);
    if (!packageMetadata.isDirectory()) {
      return { aligned: false, files, missing: [], nonFiles: [{ filePath: packageRoot }], conflicting: [], modeMismatches: [], unexpected: [] };
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const expectedPaths = new Set(files.map((item) => path.resolve(item.filePath)));
  const withMetadata = files.map((item) => {
    try {
      return { item, metadata: fs.lstatSync(item.filePath) };
    } catch (error) {
      if (error.code === 'ENOENT') return { item, metadata: null };
      if (error.code === 'ENOTDIR') {
        const nonFilePath = nestedNonDirectory(item.filePath, packageRoot);
        if (nonFilePath) return { item, metadata: null, nonFilePath };
      }
      throw error;
    }
  });
  const missing = withMetadata.filter(({ metadata, nonFilePath }) => !metadata && !nonFilePath).map(({ item }) => item);
  const nonFiles = [...new Set([
    ...withMetadata.filter(({ metadata }) => metadata && !metadata.isFile()).map(({ item }) => item.filePath),
    ...withMetadata.filter(({ nonFilePath }) => nonFilePath).map(({ nonFilePath }) => nonFilePath)
  ])].map((filePath) => ({ filePath }));
  const regularFiles = withMetadata.filter(({ metadata }) => metadata && metadata.isFile()).map(({ item }) => item);
  const conflicting = regularFiles.filter((item) => !fs.readFileSync(item.filePath).equals(item.bytes));
  const modeMismatches = regularFiles.filter((item) => item.mode != null
    && (fs.statSync(item.filePath).mode & 0o777) !== item.mode);
  const unexpected = walk(packageRoot).filter((filePath) => !expectedPaths.has(path.resolve(filePath)));
  return {
    aligned: missing.length === 0 && nonFiles.length === 0 && conflicting.length === 0 && modeMismatches.length === 0 && unexpected.length === 0,
    files,
    missing,
    nonFiles,
    conflicting,
    modeMismatches,
    unexpected
  };
}

function packageRootHasArtifacts(packageRoot) {
  try {
    const metadata = fs.lstatSync(packageRoot);
    return !metadata.isDirectory() || fs.readdirSync(packageRoot).length > 0;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    if (error.code === 'ENOTDIR') return true;
    throw error;
  }
}

function blockedTargetInstalled(candidate, targetRoot) {
  if (candidate.receipt.projection_kind === 'alias_metadata' || isApplicable(candidate)) return false;
  const suffix = candidate.receipt.target_exact_path.replace(/^\.agents\/skills\//, '');
  const targetPath = safeOutputPath(targetRoot, suffix);
  const packageRoot = path.dirname(targetPath);
  return packageRootHasArtifacts(packageRoot);
}

function validateManagedTarget(value) {
  if (typeof value !== 'string' || !/^\.agents\/skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/.test(value)) {
    throw new Error(`Invalid managed target path: ${JSON.stringify(value)}`);
  }
  return value;
}

function loadManagedTargets(candidateDir, generatorId) {
  const managed = new Set();
  const ledgerPath = safeOutputPath(candidateDir, 'managed-targets.json');
  const hasLedger = fs.existsSync(ledgerPath);
  if (hasLedger) {
    const ledger = readJson(ledgerPath);
    if (ledger.schema !== 'CodexSkillManagedTargets/1.0' || ledger.generator_id !== generatorId || !Array.isArray(ledger.targets)) {
      throw new Error(`Invalid managed target ledger: ${ledgerPath}`);
    }
    for (const target of ledger.targets) managed.add(validateManagedTarget(target));
  }
  const receiptsDir = path.join(candidateDir, 'receipts');
  if (!fs.existsSync(receiptsDir)) return managed;
  const receiptMetadata = fs.lstatSync(receiptsDir);
  if (receiptMetadata.isSymbolicLink()) throw new Error(`Refusing symbolic-link projection receipts directory: ${receiptsDir}`);
  if (!receiptMetadata.isDirectory()) throw new Error(`Projection receipts path is not a directory: ${receiptsDir}`);
  for (const entry of fs.readdirSync(receiptsDir, { withFileTypes: true })) {
    if (!entry.name.endsWith('.json')) continue;
    if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic-link projection receipt: ${entry.name}`);
    if (!entry.isFile()) continue;
    let receipt;
    try {
      receipt = readJson(path.join(receiptsDir, entry.name));
    } catch {
      continue;
    }
    if (receipt.generator_id !== generatorId || receipt.projection_kind === 'alias_metadata') continue;
    if (['already_aligned', 'applied_additive'].includes(receipt.application_status)) {
      managed.add(validateManagedTarget(receipt.target_exact_path));
    }
  }
  return managed;
}

function normalizedApplicationStatus(receipt) {
  const status = receipt.application_status;
  if (receipt.projection_kind === 'alias_metadata'
    && !['ABSENT', 'UNKNOWN'].includes(receipt.capability_tier)
    && SAFE_REVIEW_STATES.has(receipt.semantic_review_state)
    && receipt.collision_state === 'clear') {
    return ['metadata_candidate', 'metadata_attached'].includes(status)
      ? 'available_alias_metadata'
      : `invalid:${status}`;
  }
  const applicable = receipt.projection_kind !== 'alias_metadata'
    && !['ABSENT', 'UNKNOWN'].includes(receipt.capability_tier)
    && SAFE_REVIEW_STATES.has(receipt.semantic_review_state)
    && receipt.collision_state === 'clear';
  if (applicable) {
    return ['candidate', 'already_aligned', 'applied_additive', 'blocked_existing_preserved'].includes(status)
      ? 'applicable_environment_state'
      : `invalid:${status}`;
  }
  return status;
}

function receiptEvidence(receipt) {
  const evidence = { ...receipt };
  if (receipt.application_status === 'blocked_existing_preserved') delete evidence.detail;
  evidence.application_status = normalizedApplicationStatus(receipt);
  return evidence;
}

function stagedEvidenceAligned(candidateDir, candidates, generatorId, handlers, managedTargets, options = {}) {
  const receiptsDir = safeOutputPath(candidateDir, 'receipts');
  const candidatesDir = safeOutputPath(candidateDir, 'candidates');
  const indexPath = safeOutputPath(candidateDir, 'projection-index.json');
  const ledgerPath = safeOutputPath(candidateDir, 'managed-targets.json');
  if (!fs.existsSync(receiptsDir) || !fs.existsSync(indexPath) || !fs.existsSync(ledgerPath)) return false;

  let ledger;
  try {
    const metadata = fs.lstatSync(ledgerPath);
    if (!metadata.isFile()) return false;
    ledger = readJson(ledgerPath);
  } catch {
    return false;
  }
  const managedList = [...managedTargets].sort();
  if (ledger.schema !== 'CodexSkillManagedTargets/1.0'
    || ledger.generator_id !== generatorId
    || JSON.stringify(ledger.targets) !== JSON.stringify(managedList)) return false;

  const expectedReceiptPaths = new Set(candidates.map((candidate) => safeOutputPath(receiptsDir, `${candidate.id}.json`)));
  const actualReceiptPaths = new Set(walk(receiptsDir));
  if ((!options.allowAdditionalEvidence && expectedReceiptPaths.size !== actualReceiptPaths.size)
    || [...expectedReceiptPaths].some((filePath) => !actualReceiptPaths.has(filePath))) return false;

  const actualReceipts = [];
  for (const candidate of candidates) {
    const receiptPath = safeOutputPath(receiptsDir, `${candidate.id}.json`);
    let actual;
    try {
      const metadata = fs.lstatSync(receiptPath);
      if (!metadata.isFile()) return false;
      actual = readJson(receiptPath);
    } catch {
      return false;
    }
    if (JSON.stringify(receiptEvidence(actual)) !== JSON.stringify(receiptEvidence(candidate.receipt))) return false;
    if (['already_aligned', 'applied_additive'].includes(actual.application_status)
      && actual.projection_kind !== 'alias_metadata'
      && !managedTargets.has(actual.target_exact_path)) return false;
    actualReceipts.push(actual);
  }

  const expectedCandidateFiles = new Map();
  for (const candidate of candidates.filter((item) => item.content)) {
    const skillPath = safeOutputPath(candidatesDir, stagedCandidateRelativePath(candidate));
    expectedCandidateFiles.set(skillPath, { bytes: Buffer.from(candidate.content), mode: null });
    for (const resource of candidate.resources) {
      expectedCandidateFiles.set(safeOutputPath(path.dirname(skillPath), resource.relativePath), { bytes: resource.bytes, mode: resource.mode });
    }
  }
  const actualCandidatePaths = new Set(walk(candidatesDir));
  if ((!options.allowAdditionalEvidence && expectedCandidateFiles.size !== actualCandidatePaths.size)
    || [...expectedCandidateFiles.keys()].some((filePath) => !actualCandidatePaths.has(filePath))) return false;
  for (const [filePath, expected] of expectedCandidateFiles) {
    const metadata = fs.lstatSync(filePath);
    if (!metadata.isFile() || !fs.readFileSync(filePath).equals(expected.bytes)) return false;
    if (expected.mode != null && (metadata.mode & 0o777) !== expected.mode) return false;
  }

  let index;
  try {
    index = readJson(indexPath);
  } catch {
    return false;
  }
  const expectedReceiptRefs = candidates.map((candidate) => `receipts/${candidate.id}.json`).sort();
  const actualCounts = actualReceipts.reduce((counts, receipt) => {
    const key = `${receipt.projection_kind}:${receipt.capability_tier}:${receipt.semantic_review_state}:${receipt.application_status}`;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const receiptsAligned = Array.isArray(index.receipts) && (options.allowAdditionalEvidence
    ? expectedReceiptRefs.every((receiptPath) => index.receipts.includes(receiptPath))
    : JSON.stringify(index.receipts) === JSON.stringify(expectedReceiptRefs));
  return index.schema === 'CodexSkillProjectionIndex/1.0'
    && index.generator_id === generatorId
    && JSON.stringify(index.handler_ids) === JSON.stringify(handlers)
    && receiptsAligned
    && index.managed_targets_sha256 === sha256(Buffer.from(JSON.stringify(managedList)))
    && (options.allowAdditionalEvidence || JSON.stringify(index.counts) === JSON.stringify(actualCounts));
}

function writeManagedTargets(candidateDir, generatorId, managed) {
  const ledgerPath = safeOutputPath(candidateDir, 'managed-targets.json');
  fs.writeFileSync(ledgerPath, `${JSON.stringify({
    schema: 'CodexSkillManagedTargets/1.0',
    generator_id: generatorId,
    targets: [...managed].sort()
  }, null, 2)}\n`);
}

function preflightManagedTargetCustody(candidateDir, generatorId, targets = []) {
  const managed = loadManagedTargets(candidateDir, generatorId);
  for (const target of targets) managed.add(validateManagedTarget(target));
  const indexPath = safeOutputPath(candidateDir, 'projection-index.json');
  let index = null;
  if (fs.existsSync(indexPath)) {
    index = readJson(indexPath);
    if (index.schema !== 'CodexSkillProjectionIndex/1.0' || index.generator_id !== generatorId) {
      throw new Error(`Invalid projection index for custody merge: ${indexPath}`);
    }
  }
  return { managed, index, indexPath };
}

function mergeManagedTargetCustody(candidateDir, generatorId, targets) {
  const { managed, index, indexPath } = preflightManagedTargetCustody(candidateDir, generatorId, targets);
  fs.mkdirSync(candidateDir, { recursive: true });
  writeManagedTargets(candidateDir, generatorId, managed);
  if (index) {
    index.managed_targets_sha256 = sha256(Buffer.from(JSON.stringify([...managed].sort())));
    fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  }
  return managed;
}

function orphanedManagedTargets(managedTargets, candidates, targetRoot) {
  const currentTargets = new Set(candidates
    .filter((candidate) => candidate.receipt.projection_kind !== 'alias_metadata')
    .map((candidate) => candidate.receipt.target_exact_path));
  const orphaned = new Set();
  for (const target of managedTargets) {
    if (currentTargets.has(target)) continue;
    const suffix = String(target || '').replace(/^\.agents\/skills\//, '');
    const targetPath = safeOutputPath(targetRoot, suffix);
    const packageRoot = path.dirname(targetPath);
    if (packageRootHasArtifacts(packageRoot)) orphaned.add(target);
  }
  return [...orphaned].sort();
}

function applyCandidate(root, candidate, targetRoot, preflightAlignment) {
  if (!isApplicable(candidate)) return false;
  const alignment = preflightAlignment || packageAlignment(candidate, targetRoot);
  if (alignment.nonFiles.length || alignment.conflicting.length || alignment.modeMismatches.length || alignment.unexpected.length) {
    candidate.receipt.application_status = 'blocked_existing_preserved';
    const conflicts = [...new Set([
      ...alignment.conflicting.map((item) => item.filePath),
      ...alignment.modeMismatches.map((item) => item.filePath),
      ...alignment.nonFiles.map((item) => item.filePath),
      ...alignment.unexpected
    ].map((filePath) => relative(root, filePath)))];
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
  const targetRoot = validateTargetRoot(root, options.targetDir || path.join(root, built.config.target_root));
  const selected = options.includeCandidate
    ? built.candidates.filter(options.includeCandidate)
    : built.candidates;
  let drift = 0;
  let applied = 0;
  const configuredCandidateRoot = path.join(root, built.config.candidate_root);
  const validatedCandidateDir = validateCandidateDir(root, targetRoot, candidateDir, configuredCandidateRoot);
  const managedTargets = loadManagedTargets(validatedCandidateDir, built.config.generator_id);
  preflightCandidateStaging(validatedCandidateDir, selected);
  const applicationPreflight = new Map();
  if (options.apply) {
    for (const candidate of selected.filter(isApplicable)) {
      applicationPreflight.set(candidate, packageAlignment(candidate, targetRoot));
    }
    blockApplicationDependencies(built.config, selected, applicationPreflight);
  }

  if (options.check) {
    const checked = options.checkCandidate ? selected.filter(options.checkCandidate) : selected;
    const checkedManagedTargets = options.checkManagedTarget
      ? new Set([...managedTargets].filter(options.checkManagedTarget))
      : managedTargets;
    for (const candidate of checked.filter(isApplicable)) {
      if (!packageAlignment(candidate, targetRoot).aligned) drift += 1;
    }
    for (const candidate of checked) {
      if (checkedManagedTargets.has(candidate.receipt.target_exact_path) && blockedTargetInstalled(candidate, targetRoot)) drift += 1;
    }
    drift += orphanedManagedTargets(checkedManagedTargets, checked, targetRoot).length;
    const evidenceCandidates = options.checkEvidenceCandidate ? selected.filter(options.checkEvidenceCandidate) : selected;
    if (!stagedEvidenceAligned(validatedCandidateDir, evidenceCandidates, built.config.generator_id, built.handlers, managedTargets, {
      allowAdditionalEvidence: Boolean(options.checkEvidenceCandidate)
    })) drift += 1;
    return { ...built, allCandidates: built.candidates, candidates: selected, candidateDir: validatedCandidateDir, drift, applied };
  }

  clearGeneratedProjectionArtifacts(validatedCandidateDir);
  fs.mkdirSync(validatedCandidateDir, { recursive: true });
  if (options.apply) {
    for (const candidate of selected) if (applyCandidate(root, candidate, targetRoot, applicationPreflight.get(candidate))) applied += 1;
    for (const candidate of selected.filter((item) => item.receipt.projection_kind !== 'alias_metadata'
      && ['applied_additive', 'already_aligned'].includes(item.receipt.application_status))) {
      managedTargets.add(validateManagedTarget(candidate.receipt.target_exact_path));
    }
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
  writeManagedTargets(validatedCandidateDir, built.config.generator_id, managedTargets);
  for (const candidate of selected) writeCandidate(validatedCandidateDir, candidate);
  const index = {
    schema: 'CodexSkillProjectionIndex/1.0',
    generator_id: built.config.generator_id,
    handler_ids: built.handlers,
    managed_targets_sha256: sha256(Buffer.from(JSON.stringify([...managedTargets].sort()))),
    counts: selected.reduce((acc, item) => {
      const key = `${item.receipt.projection_kind}:${item.receipt.capability_tier}:${item.receipt.semantic_review_state}:${item.receipt.application_status}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    receipts: selected.map((item) => `receipts/${item.id}.json`).sort()
  };
  const indexPath = safeOutputPath(validatedCandidateDir, 'projection-index.json');
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
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
  mergeManagedTargetCustody,
  normalizeDirectSkill,
  parseArgs,
  parseFrontmatter,
  preflightManagedTargetCustody,
  renderCanonicalSkill,
  renderFrameworkSkill,
  resolveAliases,
  sync,
  validateCandidateDir,
  validateTargetRoot
};
