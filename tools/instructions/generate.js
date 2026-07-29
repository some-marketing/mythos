#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { buildModel, planOutputs } = require('./lib/engine');
const { writeText, ensureDir } = require('./lib/io');

const rootDir = path.resolve(__dirname, '..', '..');
const forceWriteClaude = process.argv.includes('--write-claude');
const previewClaude = process.argv.includes('--preview-claude');

if (forceWriteClaude && previewClaude) {
  console.error('Cannot use both --write-claude and --preview-claude');
  process.exit(1);
}

let writeClaude;
if (forceWriteClaude) {
  writeClaude = true;
} else if (previewClaude) {
  writeClaude = false;
}

const { outputs } = planOutputs(rootDir, { writeClaude });
const { system } = buildModel(rootDir);
const effectiveWriteClaude = typeof writeClaude === 'boolean' ? writeClaude : Boolean(system?.policy?.default_write_claude);

for (const out of outputs) {
  writeText(out.path, `${out.content.trim()}\n`);
  console.log(`WROTE ${path.relative(rootDir, out.path)}`);
}

const manifestPath = path.join(rootDir, 'instructions', 'generated', 'manifest.json');
ensureDir(path.dirname(manifestPath));
fs.writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      write_claude: effectiveWriteClaude,
      files: outputs.map((o) => ({ harness: o.harness, path: path.relative(rootDir, o.path) }))
    },
    null,
    2
  ) + '\n',
  'utf8'
);
console.log(`WROTE ${path.relative(rootDir, manifestPath)}`);
