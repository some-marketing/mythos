#!/usr/bin/env node
'use strict';

const path = require('path');
const { parseArgs } = require('./lib/args');
const { ensureDir, exists, readText, writeJson, writeText } = require('./lib/fs');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function help() {
  console.log(`
Scaffold a new client workspace.

Usage (external):
  node tools/workspace/scaffold-workspace.js --out <path> --client-code <CODE> --client-name "<Name>"

Usage (private operations):
  node tools/workspace/scaffold-workspace.js --internal --client-code <CODE>

Options:
  --out <path>            Workspace directory to create (external mode).
  --internal              Create workspace inside Mythos at clients/{CODE}/ (private ops mode).
  --client-code <CODE>    Required. Short code (e.g., CLIENTC).
  --client-name <Name>    Required for external mode. Inferred from client.json for internal mode.
`.trim());
}

const args = parseArgs(process.argv);
if (args.help || args.h) {
  help();
  process.exit(0);
}

const smosRoot = path.resolve(__dirname, '..', '..');
const isInternal = Boolean(args.internal);
const clientCode = args.client_code ? String(args.client_code).trim() : '';

if (!clientCode) die('Missing --client-code <CODE>');

let outDir;
let clientName = args.client_name ? String(args.client_name).trim() : '';

if (isInternal) {
  outDir = path.join(smosRoot, 'clients', clientCode);
  // Read existing client.json for name if not provided
  const rootClientJson = path.join(outDir, 'client.json');
  if (!clientName && exists(rootClientJson)) {
    try {
      const rootClient = JSON.parse(readText(rootClientJson));
      clientName = rootClient.name || '';
    } catch {}
  }
  if (!clientName) die('Missing --client-name (no client.json found to infer name)');
} else {
  outDir = args.out ? path.resolve(String(args.out)) : null;
  if (!outDir) die('Missing --out <path> (or use --internal for private operations)');
  if (!clientName) die('Missing --client-name "<Name>"');
}

if (exists(path.join(outDir, 'WORKSPACE_MANIFEST.json'))) {
  die(`Workspace already exists (WORKSPACE_MANIFEST.json found): ${outDir}`);
}

ensureDir(outDir);
ensureDir(path.join(outDir, 'config'));
ensureDir(path.join(outDir, 'framework_exports'));
ensureDir(path.join(outDir, 'projects'));
ensureDir(path.join(outDir, 'secrets', 'projects'));
ensureDir(path.join(outDir, 'shared', 'brand'));
ensureDir(path.join(outDir, 'shared', 'assets'));
ensureDir(path.join(outDir, 'shared', 'research'));

// External mode: create .gitignore, .env.example, secrets/README.md
// Internal mode: parent Mythos repo handles these
if (!isInternal) {
  const gitignore = [
    '# Secrets (never commit)',
    'secrets/*',
    '!secrets/README.md',
    '',
    '# Local env files (never commit)',
    '.env',
    '.env.*',
    '!.env.example',
    '',
    '# Node / temp',
    '**/node_modules/',
    '**/.tmp/',
    '**/.DS_Store',
    '',
    '# Playwright auth states can contain sensitive cookies',
    '**/playwright_phased_runner/auth_states/',
    '',
    '# HAR/network captures may contain sensitive tokens',
    '**/playwright_phased_runner/testcases/**/runs/**/network/'
  ].join('\n');
  writeText(path.join(outDir, '.gitignore'), `${gitignore}\n`);

  writeText(
    path.join(outDir, '.env.example'),
    [
      '# Example env file (DO NOT put secrets here in git)',
      '# Copy values into secrets/client.env and secrets/projects/<project>.env',
      '',
      '# Browser / MCP operator defaults',
      'TIMEZONE=UTC',
      '',
      '# Optional: external integrations (set in secrets/*.env, not here)',
      '# NOTION_TOKEN=',
      '# BROWSERSTACK_USERNAME=',
      '# BROWSERSTACK_ACCESS_KEY='
    ].join('\n') + '\n'
  );

  writeText(
    path.join(outDir, 'secrets', 'README.md'),
    [
      '# secrets/',
      '',
      'This folder is intentionally **gitignored**.',
      '',
      'Recommended files:',
      '- `secrets/client.env` — client-wide secrets (WordPress credentials, shared API tokens)',
      '- `secrets/projects/<project_name>.env` — per-project overrides',
      '',
      'Do not store real PII in secrets files. Prefer synthetic identities for testing.'
    ].join('\n') + '\n'
  );

  writeJson(path.join(outDir, 'config', 'client.json'), {
    client_code: clientCode,
    client_name: clientName,
    created_at: new Date().toISOString()
  });
} else {
  // Internal mode: create config/defaults.json only if it doesn't exist
  // Root client.json is the client identity source of truth
}

if (!exists(path.join(outDir, 'config', 'defaults.json'))) {
  writeJson(path.join(outDir, 'config', 'defaults.json'), {
    timezone: 'UTC',
    naming: {
      project_name_pattern: '{service}__{framework}__{slug}'
    }
  });
}

writeJson(path.join(outDir, 'WORKSPACE_MANIFEST.json'), {
  workspace_version: '1.1',
  client_code: clientCode,
  client_name: clientName,
  open_first: ['WORKSPACE_MANIFEST.json', 'README.md'],
  shared: {
    brand: 'shared/brand/',
    assets: 'shared/assets/',
    research: 'shared/research/'
  },
  projects: []
});

if (isInternal) {
  writeText(
    path.join(outDir, 'README.md'),
    [
      `# ${clientCode} — Private Operations Workspace`,
      '',
      'This client workspace lives inside the Mythos repo (private operations mode).',
      '',
      'Start here:',
      '- Client metadata: `client.json`',
      '- LLM index: `WORKSPACE_MANIFEST.json`',
      '- Shared assets: `shared/` (brand, assets, research)',
      '- Projects: `projects/`',
      '',
      'Create a project:',
      '```',
      `/new-project ${clientCode} wordpress/qa <slug>`,
      '```'
    ].join('\n') + '\n'
  );
} else {
  writeText(
    path.join(outDir, 'README.md'),
    [
      `# ${clientCode} Workspace`,
      '',
      'Start here:',
      '- LLM index: `WORKSPACE_MANIFEST.json`',
      '- Client config: `config/client.json`',
      '- Shared assets: `shared/` (brand, assets, research)',
      '- Projects: `projects/`',
      '',
      'Create a project (from Mythos repo):',
      '```bash',
      `npm run workspace:project -- --workspace ${JSON.stringify(outDir)} --framework wordpress/qa --slug <slug>`,
      '```'
    ].join('\n') + '\n'
  );
}

console.log(`OK scaffolded ${isInternal ? 'internal' : 'external'} workspace: ${outDir}`);
