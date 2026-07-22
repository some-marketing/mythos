#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildPlanVisibilityModel,
  buildVisualPlanAdapterManifest,
  renderFocusedVisualPlanMarkdown,
  renderPlanVisibilityHtml,
  renderPlanVisibilityIndex,
  renderPlanVisibilityMarkdown,
  renderPlanVisibilityOperatorBrief,
  renderVisualPlanLibraryHtml,
  renderVisualPlanLibraryMarkdown
} = require('./lib/plan-visibility');

const OUTPUT_ROOT = path.join('_dev', 'reports', 'analysis');
const DASHBOARD_CLUSTER_LIMIT = 8;

function parseArgs(argv) {
  const args = {
    allVisuals: false
  };

  for (const arg of argv) {
    if (arg === '--all-visuals') args.allVisuals = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function usage() {
  return [
    'Usage: node tools/planning/build-plan-visibility-dashboard.js [--all-visuals]',
    '',
    'Builds the repo-native Mythos plan visibility dashboard bundle.',
    '--all-visuals writes focused visual briefs for every detected relationship cluster instead of only the dashboard top clusters.'
  ].join('\n');
}

function writeFile(projectRoot, relativePath, content) {
  const outputPath = path.resolve(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content);
  return path.relative(projectRoot, outputPath).split(path.sep).join('/');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }

  if (args.help) {
    console.log(usage());
    return;
  }

  const projectRoot = process.cwd();
  const generatedAt = new Date().toISOString();
  const outputs = [];
  const visualClusterLimit = args.allVisuals ? Number.MAX_SAFE_INTEGER : DASHBOARD_CLUSTER_LIMIT;
  const systemOptions = { generatedAt, visualClusterLimit };
  const allOptions = { generatedAt, includeClient: true, visualClusterLimit };
  const systemModel = buildPlanVisibilityModel(projectRoot, systemOptions);
  const allModel = buildPlanVisibilityModel(projectRoot, allOptions);
  const writeClusterLimit = args.allVisuals
    ? systemModel.relationship_clusters.length
    : DASHBOARD_CLUSTER_LIMIT;

  outputs.push(writeFile(
    projectRoot,
    path.join(OUTPUT_ROOT, 'plan-visibility__current.md'),
    renderPlanVisibilityMarkdown(projectRoot, systemOptions)
  ));
  outputs.push(writeFile(
    projectRoot,
    path.join(OUTPUT_ROOT, 'plan-visibility__all.md'),
    renderPlanVisibilityMarkdown(projectRoot, allOptions)
  ));
  outputs.push(writeFile(
    projectRoot,
    path.join(OUTPUT_ROOT, 'plan-visibility__operator-brief.md'),
    renderPlanVisibilityOperatorBrief(projectRoot, systemOptions)
  ));
  outputs.push(writeFile(
    projectRoot,
    path.join(OUTPUT_ROOT, 'plan-visibility__current.html'),
    renderPlanVisibilityHtml(projectRoot, systemOptions)
  ));
  outputs.push(writeFile(
    projectRoot,
    path.join(OUTPUT_ROOT, 'plan-visibility__all.html'),
    renderPlanVisibilityHtml(projectRoot, allOptions)
  ));
  outputs.push(writeFile(
    projectRoot,
    path.join(OUTPUT_ROOT, 'plan-visibility__current.json'),
    `${JSON.stringify(systemModel, null, 2)}\n`
  ));
  outputs.push(writeFile(
    projectRoot,
    path.join(OUTPUT_ROOT, 'plan-visibility__all.json'),
    `${JSON.stringify(allModel, null, 2)}\n`
  ));
  outputs.push(writeFile(
    projectRoot,
    path.join(OUTPUT_ROOT, 'plan-visibility__index.html'),
    renderPlanVisibilityIndex({ generatedAt, model: systemModel })
  ));
  outputs.push(writeFile(
    projectRoot,
    path.join(OUTPUT_ROOT, 'visual-plans', 'index.md'),
    renderVisualPlanLibraryMarkdown(projectRoot, { generatedAt, clusterLimit: writeClusterLimit })
  ));
  outputs.push(writeFile(
    projectRoot,
    path.join(OUTPUT_ROOT, 'visual-plans', 'index.html'),
    renderVisualPlanLibraryHtml(projectRoot, { generatedAt, clusterLimit: writeClusterLimit, model: systemModel })
  ));
  outputs.push(writeFile(
    projectRoot,
    path.join(OUTPUT_ROOT, 'visual-plans', 'visual-plan-adapter-manifest.json'),
    `${JSON.stringify(buildVisualPlanAdapterManifest(projectRoot, {
      generatedAt,
      clusterLimit: writeClusterLimit,
      model: systemModel
    }), null, 2)}\n`
  ));
  outputs.push(writeFile(
    projectRoot,
    path.join(OUTPUT_ROOT, 'visual-plans', 'plan-visibility-surface.md'),
    renderFocusedVisualPlanMarkdown(projectRoot, { generatedAt, taskId: 'plan-visibility-surface' })
  ));
  for (const cluster of systemModel.relationship_clusters.slice(0, writeClusterLimit)) {
    outputs.push(writeFile(
      projectRoot,
      path.join(OUTPUT_ROOT, 'visual-plans', `${cluster.id}.md`),
      renderFocusedVisualPlanMarkdown(projectRoot, { generatedAt, clusterId: cluster.id })
    ));
  }

  for (const output of outputs) {
    console.log(`Wrote ${output}`);
  }
}

if (require.main === module) {
  main();
}
