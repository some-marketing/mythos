#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { fileSha, matches, sha256, walk } = require('./lib.cjs');
const { PRIVATE_MEMORY_EXCLUSIONS } = require('./private-memory-policy.cjs');

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function posix(value) {
  return value.split(path.sep).join('/');
}
function operandTokens(command) {
  return String(command)
    .replace(/\$\{CLAUDE_PROJECT_DIR\}\/?/g, '')
    .replace(/\$CLAUDE_PROJECT_DIR\/?/g, '')
    .split(/&&|;|\|\||\s+/)
    .map(token => token.replace(/^["']|["'],?$/g, ''))
    .filter(token => /^[A-Za-z0-9_.][A-Za-z0-9_./*-]*\.(?:c?js|mjs|sh|ps1|py|json)$/.test(token));
}
function resolveLocalModule(root, from, specifier) {
  const base = path.resolve(root, path.dirname(from), specifier);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.cjs`,
    `${base}.mjs`,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.json`,
    path.join(base, 'index.js'),
    path.join(base, 'index.cjs'),
    path.join(base, 'index.mjs'),
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  const resolved = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  return resolved ? posix(path.relative(root, resolved)) : null;
}
function staticImports(text) {
  const found = [];
  let i = 0;
  const wordAt = (word) => text.startsWith(word, i)
    && !/[A-Za-z0-9_$]/.test(text[i - 1] || '')
    && !/[A-Za-z0-9_$]/.test(text[i + word.length] || '');
  const skipSpace = index => {
    while (/\s/.test(text[index] || '')) index += 1;
    return index;
  };
  const readString = index => {
    const quote = text[index];
    if (quote !== "'" && quote !== '"') return null;
    let value = '';
    for (let cursor = index + 1; cursor < text.length; cursor += 1) {
      if (text[cursor] === '\\') {
        value += text[cursor + 1] || '';
        cursor += 1;
      } else if (text[cursor] === quote) {
        return { value, end: cursor + 1 };
      } else {
        value += text[cursor];
      }
    }
    return null;
  };
  while (i < text.length) {
    if (text.startsWith('//', i)) {
      i = text.indexOf('\n', i + 2);
      if (i === -1) break;
      continue;
    }
    if (text.startsWith('/*', i)) {
      i = text.indexOf('*/', i + 2);
      if (i === -1) break;
      i += 2;
      continue;
    }
    if (text[i] === "'" || text[i] === '"' || text[i] === '`') {
      const quote = text[i++];
      while (i < text.length) {
        if (text[i] === '\\') i += 2;
        else if (text[i++] === quote) break;
      }
      continue;
    }
    if (wordAt('require') || wordAt('import')) {
      const word = wordAt('require') ? 'require' : 'import';
      let cursor = skipSpace(i + word.length);
      if (text[cursor] === '(') cursor = skipSpace(cursor + 1);
      const parsed = readString(cursor);
      if (parsed) found.push(parsed.value);
      i = parsed ? parsed.end : i + word.length;
      continue;
    }
    if (wordAt('from')) {
      const parsed = readString(skipSpace(i + 4));
      if (parsed) found.push(parsed.value);
      i = parsed ? parsed.end : i + 4;
      continue;
    }
    i += 1;
  }
  return found;
}
function resolveRepoReference(root, from, reference, candidates = [reference]) {
  const normalize = value => String(value)
    .replace(/^\$\{(?:MYTHOS_HOME|CLAUDE_PROJECT_DIR|PROJECT_ROOT|ROOT)\}\//, '')
    .replace(/^\$(?:MYTHOS_HOME|CLAUDE_PROJECT_DIR|PROJECT_ROOT|ROOT)\//, '')
    .replace(/^\$\{?SELF_DIR\}?\//, '');
  const portable = normalize(reference);
  const repositorySuffix = portable.match(/(?:^|\/)((?:tools|_dev)\/.+)$/)?.[1];
  if (!portable || (portable.startsWith('/') && !repositorySuffix) || (portable.includes('$') && !repositorySuffix)) return null;
  const normalizedCandidates = repositorySuffix ? [repositorySuffix] : candidates.map(normalize);
  const options = [
    ...normalizedCandidates.map(candidate => path.resolve(root, path.dirname(from), candidate)),
    ...normalizedCandidates.map(candidate => path.resolve(root, candidate)),
  ];
  const resolved = options.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  return resolved ? posix(path.relative(root, resolved)) : null;
}
function pythonImports(root, from, text) {
  const found = [];
  for (const match of text.matchAll(/^\s*from\s+(\.+[A-Za-z0-9_.]*)\s+import\s+/gm)) {
    const specifier = match[1];
    const leading = specifier.match(/^\.+/)[0].length;
    const modulePath = specifier.slice(leading).replaceAll('.', '/');
    let base = path.dirname(from);
    for (let i = 1; i < leading; i += 1) base = path.dirname(base);
    const absoluteBase = path.resolve(root, base, modulePath);
    const resolved = [`${absoluteBase}.py`, path.join(absoluteBase, '__init__.py')]
      .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    const target = resolved ? posix(path.relative(root, resolved)) : null;
    found.push({ specifier, target });
  }
  return found;
}
function shellSources(root, from, text) {
  const found = [];
  for (const match of text.matchAll(/^\s*(?:source|\.)\s+["']?([^"'\s;]+)["']?/gm)) {
    const specifier = match[1];
    const target = resolveRepoReference(root, from, specifier);
    found.push({ specifier, target, required: Boolean(target) || !specifier.includes('$') });
  }
  return found;
}
function schemaReferences(root, from, text) {
  const found = [];
  for (const match of text.matchAll(/[A-Za-z0-9_./-]+\.schema\.json/g)) {
    const specifier = match[0];
    if (specifier === path.basename(from) || specifier === from) continue;
    const target = resolveRepoReference(root, from, specifier);
    if (target) found.push({ specifier, target });
  }
  return found;
}
function commandAliasTarget(text) {
  const patterns = [
    /^>\s*Authority:\s*`([^`]+)`/m,
    /^\s*Run\s+`\/([^`]+)`/m,
    /Follow\s+`\.claude\/commands\/([^`/]+)\.md`/m,
    /description:\s*(?:Compatibility |Cross-|Plain-id |Legacy )?alias[^/\n]*\/([A-Za-z0-9_-]+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].replace(/^\//, '');
  }
  return null;
}
function fileNode(root, relative) {
  const absolute = path.join(root, relative);
  return {
    id: `file:${relative}`,
    type: 'file',
    path: relative,
    sha256: fileSha(absolute),
    mode: fs.statSync(absolute).mode & 0o777,
  };
}

function main() {
  const args = process.argv.slice(2);
  const root = path.resolve(option(args, '--root') || path.join(__dirname, '..', '..'));
  const output = path.resolve(option(args, '--output') || path.join(root, 'parity/wiring-graph.json'));
  const relativeOutput = posix(path.relative(root, output));
  const files = walk(root, relative => (
    relative === relativeOutput
    || relative === 'parity/baseline.json'
    || relative === 'parity/reconciliation-ledger.json'
    || matches(relative, PRIVATE_MEMORY_EXCLUSIONS)
    || relative.startsWith('node_modules/')
    || relative === '.git'
    || relative.startsWith('.git/')
    || relative.startsWith('_dev/state/')
    || relative.startsWith('_dev/reports/')
  ));
  const fileSet = new Set(files);
  const nodes = files.map(relative => fileNode(root, relative));
  const edges = [];
  const edgeIdsSeen = new Set();
  const directoryNodes = new Set();
  const addNode = node => nodes.push(node);
  const addEdge = (type, from, target, metadata = {}) => {
    let targetId = null;
    if (target) {
      const absolute = path.join(root, target);
      if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
        targetId = `directory:${target}`;
        if (!directoryNodes.has(target)) {
          directoryNodes.add(target);
          addNode({ id: targetId, type: 'directory', path: target });
        }
      } else {
        targetId = `file:${target}`;
      }
    }
    const id = sha256(`${type}\0${from}\0${target || '<unresolved>'}\0${JSON.stringify(metadata)}`);
    if (edgeIdsSeen.has(id)) return;
    edgeIdsSeen.add(id);
    edges.push({
      id,
      type,
      from,
      to: targetId,
      target,
      required: metadata.required !== false,
      ...metadata,
    });
  };

  for (const relative of files) {
    let type = null;
    let name = null;
    if (/^\.claude\/commands\/[^/]+\.md$/.test(relative)) {
      type = 'command-definition';
      name = path.basename(relative, '.md');
    } else if (/^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(relative)) {
      type = 'skill-definition';
      name = relative.split('/')[2];
    } else if (/^\.claude\/agents\/[^/]+\.md$/.test(relative)) {
      type = 'agent-definition';
      name = path.basename(relative, '.md');
    } else if (/(?:^|\/)install[^/]*\.(?:sh|cjs|js|ps1)$/.test(relative)) {
      type = 'installer-definition';
      name = relative;
    } else if (/\.schema\.json$/.test(relative)) {
      type = 'schema-definition';
      name = relative;
    }
    if (type) {
      const id = `${type}:${name}`;
      addNode({ id, type, name });
      addEdge(`${type}-file`, id, relative, { declared_target: relative });
      if (type === 'command-definition') {
        const authority = commandAliasTarget(fs.readFileSync(path.join(root, relative), 'utf8'));
        if (authority && authority !== name) {
          const target = `.claude/commands/${authority}.md`;
          addEdge('command-alias-authority', id, fileSet.has(target) ? target : null, {
            declared_target: target,
            authority,
          });
        }
      }
    }
  }

  const packageJson = readJson(path.join(root, 'package.json'));
  for (const [name, command] of Object.entries(packageJson.scripts || {}).sort()) {
    const id = `package-script:${name}`;
    addNode({ id, type: 'package-script', name, command_sha256: sha256(command) });
    for (const operand of operandTokens(command)) {
      if (operand.includes('*')) continue;
      const runtimeGenerated = /^_dev\/(?:state|config)\//.test(operand)
        || operand === 'parity/reconciliation-ledger.json';
      addEdge('package-script-target', id, fileSet.has(operand) ? operand : null, {
        declared_target: operand,
        required: !runtimeGenerated,
        resolution: runtimeGenerated && !fileSet.has(operand) ? 'runtime-generated-or-local-binding' : 'tracked',
      });
    }
  }

  const settingsPath = '.claude/settings.json';
  if (fileSet.has(settingsPath)) {
    const settings = readJson(path.join(root, settingsPath));
    for (const [event, groups] of Object.entries(settings.hooks || {})) {
      for (const group of groups || []) {
        for (const hook of group.hooks || []) {
          for (const operand of operandTokens(hook.command || '')) {
            const id = `hook:${event}:${edges.length}`;
            addNode({ id, type: 'hook', event, command_sha256: sha256(hook.command || '') });
            addEdge('hook-target', id, fileSet.has(operand) ? operand : null, { declared_target: operand, event });
          }
        }
      }
    }
  }

  const systemPath = 'instructions/canonical/system.yaml';
  if (fileSet.has(systemPath)) {
    const system = readJson(path.join(root, systemPath));
    for (const framework of system.frameworks || []) {
      const id = `framework:${framework.id}`;
      addNode({ id, type: 'framework-registration', name: framework.id });
      addEdge('framework-manifest', id, fileSet.has(framework.manifest) ? framework.manifest : null, { declared_target: framework.manifest });
      addEdge('framework-guardrails', id, fileSet.has(framework.guardrails) ? framework.guardrails : null, { declared_target: framework.guardrails });
    }
    for (const agent of system.agents || []) {
      const id = `agent:${agent.id}`;
      const target = `.claude/agents/${agent.id}.md`;
      addNode({ id, type: 'agent-registration', name: agent.id });
      addEdge('agent-definition', id, fileSet.has(target) ? target : null, { declared_target: target });
    }
    for (const operation of system.operations || []) {
      const id = `operation:${operation.id}`;
      const command = `.claude/commands/${operation.id}.md`;
      const canonical = `instructions/canonical/commands/${operation.id}.yaml`;
      addNode({ id, type: 'operation-registration', name: operation.id, mode: operation.mode });
      addEdge('operation-command', id, fileSet.has(command) ? command : null, { declared_target: command });
      addEdge('operation-canonical', id, fileSet.has(canonical) ? canonical : null, { declared_target: canonical });
    }
  }

  const aliasPath = 'instructions/canonical/command-aliases.yaml';
  if (fileSet.has(aliasPath)) {
    const registry = readJson(path.join(root, aliasPath));
    for (const alias of registry.aliases || []) {
      const id = `alias:${alias.id}`;
      const targetName = alias.execution_target || alias.target || alias.authority_source;
      const target = `.claude/commands/${targetName}.md`;
      addNode({ id, type: 'command-alias', name: alias.id, authority: alias.authority_source || targetName });
      addEdge('alias-resolution', id, fileSet.has(target) ? target : null, { declared_target: target });
    }
  }

  const manifestPath = '.claude/project-claude.yml';
  if (fileSet.has(manifestPath)) {
    const text = fs.readFileSync(path.join(root, manifestPath), 'utf8');
    for (const match of text.matchAll(/^\s*-\s+path:\s+(.+?)\s*$/gm)) {
      const declared = match[1].trim();
      const normalized = declared.endsWith('/') ? declared.slice(0, -1) : declared;
      const target = fs.existsSync(path.join(root, normalized))
        ? normalized
        : fileSet.has(`${normalized}/SKILL.md`) ? `${normalized}/SKILL.md` : null;
      const id = `manifest-path:${normalized}`;
      addNode({ id, type: 'manifest-registration', declared_target: normalized });
      addEdge('manifest-target', id, target, { declared_target: normalized });
    }
  }

  const launchdPath = 'tools/launchd/services.json';
  if (fileSet.has(launchdPath)) {
    for (const service of readJson(path.join(root, launchdPath)).services || []) {
      const id = `launchd:${service.id}`;
      addNode({ id, type: 'launchd-service', name: service.id, binding: service.binding });
      addEdge('launchd-runner', id, fileSet.has(service.runner) ? service.runner : null, { declared_target: service.runner });
    }
  }

  for (const relative of files.filter(file => /\.(?:c?js|mjs|ts|tsx)$/.test(file))) {
    const text = fs.readFileSync(path.join(root, relative), 'utf8');
    for (const specifier of staticImports(text)) {
      if (!specifier.startsWith('.') || specifier.startsWith('.../')) continue;
      const target = resolveLocalModule(root, relative, specifier);
      addEdge('static-import', `file:${relative}`, target, { specifier });
    }
  }
  for (const relative of files.filter(file => /\.py$/.test(file))) {
    const text = fs.readFileSync(path.join(root, relative), 'utf8');
    for (const { specifier, target } of pythonImports(root, relative, text)) {
      addEdge('python-import', `file:${relative}`, target, { specifier });
    }
  }
  for (const relative of files.filter(file => /\.sh$/.test(file))) {
    const text = fs.readFileSync(path.join(root, relative), 'utf8');
    for (const { specifier, target, required } of shellSources(root, relative, text)) {
      addEdge('shell-source', `file:${relative}`, target, {
        specifier,
        required,
        resolution: required ? 'tracked' : 'runtime-local-binding',
      });
    }
  }
  for (const relative of files.filter(file => /\.plist$/.test(file))) {
    const text = fs.readFileSync(path.join(root, relative), 'utf8');
    for (const match of text.matchAll(/<string>([^<]+\.(?:sh|c?js|mjs|ts|py))<\/string>/g)) {
      const specifier = match[1];
      const target = specifier.includes('$') ? null : resolveRepoReference(root, relative, specifier);
      addEdge('plist-program-argument', `file:${relative}`, target, { specifier });
    }
  }
  for (const relative of files.filter(file => /\.(?:json|ya?ml|md|c?js|mjs|ts|tsx|py|sh)$/.test(file))) {
    const text = fs.readFileSync(path.join(root, relative), 'utf8');
    for (const { specifier, target } of schemaReferences(root, relative, text)) {
      addEdge('schema-consumer', `file:${relative}`, target, { specifier });
    }
  }

  const mcpRoots = files
    .filter(file => /^tools\/mcp\/[^/]+\/server\.(?:js|cjs|mjs)$/.test(file))
    .sort();
  for (const server of mcpRoots) {
    const adapter = server.split('/')[2];
    const id = `mcp:${adapter}`;
    addNode({ id, type: 'mcp-adapter', name: adapter });
    addEdge('mcp-server', id, server, { declared_target: server });
  }

  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => a.id.localeCompare(b.id));
  const unresolved = edges.filter(edge => edge.required && !edge.target);
  const graph = {
    schema: 'MythosWiringGraph/1.0',
    root: '.',
    nodes,
    edges,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      unresolved: unresolved.length,
    },
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(graph, null, 2) + '\n');
  process.stdout.write(JSON.stringify(graph.counts) + '\n');
  if (unresolved.length) {
    for (const edge of unresolved.slice(0, 100)) {
      console.error(`UNRESOLVED ${edge.type} ${edge.from} -> ${edge.declared_target || edge.specifier}`);
    }
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 2;
}
