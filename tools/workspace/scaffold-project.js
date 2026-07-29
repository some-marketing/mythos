#!/usr/bin/env node
'use strict';

const path = require('path');
const { parseArgs } = require('./lib/args');
const { copyDir, ensureDir, exists, listDirs, readText, writeJson, writeText } = require('./lib/fs');
const { safeProjectBoundaryReceipt } = require('./lib/project-boundary');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function help() {
  console.log(`
Scaffold a project inside an existing workspace and install framework runtime + intake templates.

Usage:
  node tools/workspace/scaffold-project.js --workspace <path> --framework wordpress/qa --slug <slug>

Options:
  --workspace <path>      Required. Workspace root (contains WORKSPACE_MANIFEST.json).
  --framework <id>        Required. Framework id: <service>/<framework> (e.g., wordpress/qa).
  --slug <slug>           Required. Project slug (kebab-case recommended).
`.trim());
}

const args = parseArgs(process.argv);
if (args.help || args.h) {
  help();
  process.exit(0);
}

const workspaceRoot = args.workspace ? path.resolve(String(args.workspace)) : null;
const frameworkId = args.framework ? String(args.framework).trim() : '';
const slug = args.slug ? String(args.slug).trim() : '';

if (!workspaceRoot) die('Missing --workspace <path>');
if (!frameworkId || !frameworkId.includes('/')) die('Missing/invalid --framework <service>/<framework>');
if (!slug) die('Missing --slug <slug>');

const manifestPath = path.join(workspaceRoot, 'WORKSPACE_MANIFEST.json');
if (!exists(manifestPath)) die(`Not a workspace root (missing WORKSPACE_MANIFEST.json): ${workspaceRoot}`);

const [service, framework] = frameworkId.split('/');
const projectName = `${service}__${framework}__${slug}`;
const projectRoot = path.join(workspaceRoot, 'projects', projectName);

if (exists(projectRoot)) die(`Project already exists: ${projectRoot}`);

const smosRoot = path.resolve(__dirname, '..', '..');
const frameworkRoot = path.join(smosRoot, 'frameworks', service, framework);
const templatesDir = path.join(frameworkRoot, 'templates');
if (!exists(templatesDir)) die(`Framework templates not found: ${templatesDir}`);

let workspaceManifest;
try {
  workspaceManifest = JSON.parse(readText(manifestPath));
} catch {
  die(`Invalid WORKSPACE_MANIFEST.json: ${manifestPath}`);
}

if (frameworkId === 'wordpress/qa') {
  const requiredPaths = [
    path.join(frameworkRoot, 'runtime', 'workspace_pack'),
    path.join(frameworkRoot, 'runner')
  ];
  for (const requiredPath of requiredPaths) {
    if (!exists(requiredPath)) die(`Framework prerequisite missing: ${requiredPath}`);
  }
}

ensureDir(projectRoot);
ensureDir(path.join(projectRoot, 'intake'));

// Copy intake templates
copyDir(templatesDir, path.join(projectRoot, 'intake'));

// Render workflow guide if present
const workflowTemplatePath = path.join(templatesDir, 'WORKFLOW_GUIDE.template.md');
let workflowGuide = null;
let clientConfig = null;
try {
  clientConfig = JSON.parse(readText(path.join(workspaceRoot, 'config', 'client.json')));
} catch {
  // Fallback: root client.json (private operations mode)
  try {
    const rootClient = JSON.parse(readText(path.join(workspaceRoot, 'client.json')));
    clientConfig = {
      client_code: rootClient.code || rootClient.client_code || '',
      client_name: rootClient.name || rootClient.client_name || ''
    };
  } catch {}
}

if (exists(workflowTemplatePath)) {
  const tpl = readText(workflowTemplatePath);
  const renderContext = {
    CLIENT_NAME: String(clientConfig?.client_name || 'Client'),
    CLIENT_CODE: String(clientConfig?.client_code || 'CODE'),
    PROJECT_NAME: projectName,
    PROJECT_DIRECTORY: projectRoot,
    AUDIT_DATE: new Date().toISOString().slice(0, 10),
    VERIFICATION_DATE: new Date().toISOString().slice(0, 10),
    RECONCILIATION_DATE: new Date().toISOString().slice(0, 10),
    PRESENTATION_FILE: '<path-to-presentation-file>',
    SCOPE_DOCUMENT: '<path-to-scope-document>',
    SOURCE_DATA: '<path-to-source-data>',
    VERSION_A: '<path-to-version-a>',
    VERSION_B: '<path-to-version-b>',
    SOURCE_OF_TRUTH: 'neither'
  };
  workflowGuide = tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(renderContext, key)
      ? renderContext[key]
      : `<${key.toLowerCase().replace(/_/g, '-')}>`;
  });
  writeText(path.join(projectRoot, 'WORKFLOW_GUIDE.md'), workflowGuide);
}

function installWpQaRuntime() {
  // 1) Install framework CLI pack (framework/runner/*)
  const cliPackDir = path.join(frameworkRoot, 'runtime', 'workspace_pack');
  copyDir(cliPackDir, projectRoot);

  // 2) Install Playwright phased runner under playwright_phased_runner/
  const runnerSrc = path.join(frameworkRoot, 'runner');

  const pwRoot = path.join(projectRoot, 'playwright_phased_runner');
  const pwRunnerDest = path.join(pwRoot, 'runner');
  ensureDir(pwRunnerDest);

  // Copy runner directory into playwright_phased_runner/runner, but do NOT bring its package.json
  copyDir(runnerSrc, pwRunnerDest, {
    filter: (src) => path.basename(src) !== 'package.json'
  });

  // Create Playwright runner root package.json (expected by LOCAL_SETUP docs)
  writeText(
    path.join(pwRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'smos-playwright-phased-runner',
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          'install:browsers': 'node runner/tools/install-browsers.js',
          'run:phased': 'node runner/tools/run-phased-wrapper.js',
          'run:phased:headed': 'node runner/tools/run-phased-wrapper.js --headed',
          'run:runset:new': 'node runner/tools/new-runset.js',
          'run:runset:summary': 'node runner/tools/compile-runset.js',
          'run:runsets:index': 'node runner/tools/index-runsets.js',
          'run:handoff:new': 'node runner/tools/make-dev-handoff.js',
          'auth:record': 'node runner/tools/record-storage-state.js',
          'lint:json': 'node runner/tools/validate-json.js',
          'lint:locator-maps': 'node runner/tools/validate-locator-maps.js'
        },
        dependencies: {
          playwright: '^1.45.0'
        }
      },
      null,
      2
    ) + '\n'
  );

  // Ensure expected project folders exist
  for (const p of ['testcases', 'reports', 'dev_handoff', 'auth_states', 'changelogs', '.tmp']) {
    ensureDir(path.join(pwRoot, p));
  }

  // Minimal runner README
  writeText(
    path.join(pwRoot, 'README.md'),
    [
      '# Playwright Phased Runner',
      '',
      'Install:',
      '```bash',
      'npm install',
      'npm run install:browsers',
      '```',
      '',
      'Runner code lives under `runner/`. Testcases live under `testcases/`.'
    ].join('\n') + '\n'
  );
}

if (frameworkId === 'wordpress/qa') {
  installWpQaRuntime();
} else {
  // Fallback: copy a framework-provided project_pack if present.
  const runtimePackDir = path.join(frameworkRoot, 'runtime', 'project_pack');
  if (exists(runtimePackDir)) {
    copyDir(runtimePackDir, projectRoot);
  } else {
    // No runtime pack — this framework runs via Mythos skills/commands, not a standalone CLI.
    // Check if the framework has skills/commands defined (skill-driven execution).
    const hasSkills = exists(path.join(frameworkRoot, '.claude', 'skills'));
    const hasCommands = exists(path.join(frameworkRoot, '.claude', 'commands'));

    if (hasSkills || hasCommands) {
      writeText(
        path.join(projectRoot, 'HOW_TO_RUN.md'),
        [
          '# How to Run',
          '',
          `Framework: \`${frameworkId}\``,
          '',
          'This framework runs via Mythos slash commands from the Mythos repo directory.',
          '',
          '## Steps',
          '',
          '1. Open Claude Code in the Mythos repo',
          `2. Place your input files in this project's \`intake/\` directory`,
          '3. Run the framework command:',
          '```',
          `/${framework}`,
          '```',
          '',
          'See `WORKFLOW_GUIDE.md` for detailed instructions.'
        ].join('\n') + '\n'
      );
    } else {
      writeText(
        path.join(projectRoot, 'RUNTIME_NOT_INSTALLED.md'),
        [
          '# Runtime Not Installed',
          '',
          `Framework: \`${frameworkId}\``,
          '',
          'This framework does not currently ship a runnable runtime pack for external workspaces.',
          '',
          'You can still use the project folder for intake + outputs, but any execution tooling must be provided separately.',
          '',
          'If this framework should be runnable end-to-end, add a runtime pack under:',
          `- \`frameworks/${service}/${framework}/runtime/project_pack\``
        ].join('\n') + '\n'
      );
    }
  }
}

// Project metadata
let runtimeInfo = {};
if (frameworkId === 'wordpress/qa') {
  runtimeInfo = {
    framework_cli: 'framework/runner/cli.js',
    playwright_phased_runner: 'playwright_phased_runner'
  };
} else if (exists(path.join(frameworkRoot, 'runtime', 'project_pack', 'framework', 'runner', 'cli.js'))) {
  runtimeInfo = { framework_cli: 'framework/runner/cli.js' };
}

const projectBoundaryReceipt = process.env.PROJECT_BOUNDARY_RECEIPT_V1 === '0' ? null : safeProjectBoundaryReceipt({
  allowed_root: workspaceRoot,
  project_root: projectRoot,
  references: [{ path: 'intake', classification: 'private-bounded', reader_allowed: true }],
  classification: 'private-bounded'
});

writeJson(path.join(projectRoot, 'project.json'), {
  client_code: String(clientConfig?.client_code || '').trim() || null,
  service,
  framework,
  framework_id: frameworkId,
  slug,
  project_name: projectName,
  created: new Date().toISOString(),
  status: 'intake',
  runtime: runtimeInfo,
  ...(projectBoundaryReceipt ? { project_boundary_receipt: projectBoundaryReceipt } : {})
});

// Update workspace manifest
const existing = Array.isArray(workspaceManifest.projects) ? workspaceManifest.projects : [];
workspaceManifest.projects = [
  ...existing,
  {
    project_name: projectName,
    framework_id: frameworkId,
    path: path.relative(workspaceRoot, projectRoot).replaceAll(path.sep, '/'),
    created: new Date().toISOString()
  }
].sort((a, b) => String(a.project_name).localeCompare(String(b.project_name)));
writeJson(manifestPath, workspaceManifest);

const readmeRuntimeLines = runtimeInfo.framework_cli
  ? [
      'Runtime:',
      '- CLI: `framework/runner/cli.js`',
      ...(runtimeInfo.playwright_phased_runner ? ['- Runner: `playwright_phased_runner/`'] : []),
      ''
    ]
  : [];

writeText(
  path.join(projectRoot, 'README.md'),
  [
    `# ${projectName}`,
    '',
    'Start here:',
    '- `project.json`',
    ...(exists(path.join(projectRoot, 'WORKFLOW_GUIDE.md')) ? ['- `WORKFLOW_GUIDE.md`'] : []),
    '',
    ...readmeRuntimeLines,
    'Framework promotion pipeline:',
    '- `captures/`',
    '- `framework_candidates/`',
    '- `outputs/`',
    '',
    'Intake templates (copied from Mythos framework):',
    '- `intake/`'
  ].join('\n') + '\n'
);

for (const rel of ['outputs', 'captures', 'framework_candidates']) {
  ensureDir(path.join(projectRoot, rel));
}

console.log(`OK scaffolded project: ${projectRoot}`);
