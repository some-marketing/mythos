#!/usr/bin/env node
'use strict';

/**
 * generate-env-example.cjs — render an env.example file from a tool's
 * creds.config.json, so every tool's "here's what to set" doc stays in sync
 * with what its resolver actually reads.
 *
 * Usage:
 *   node tools/lib/generate-env-example.cjs <path-to-creds.config.json> [--out <path>]
 *
 * Without --out, prints to stdout.
 */

const fs = require('fs');
const path = require('path');

function render(config) {
  const fields = config && config.fields ? config.fields : config || {};
  const lines = [
    `# Environment variables for ${config.tool || 'this tool'}.`,
    '# Copy to .env.local (gitignored) and fill in real values, or set these in',
    '# your shell/CI environment directly. See SETUP.md for the full',
    '# Keychain/1Password seeding options — env vars are only the first of four',
    '# resolution sources tools/lib/resolve-credential.cjs tries.',
    ''
  ];
  for (const [field, fieldConfig] of Object.entries(fields)) {
    const envVar = (fieldConfig && fieldConfig.envVar) || field;
    if (fieldConfig && fieldConfig.description) {
      lines.push(`# ${fieldConfig.description}`);
    }
    const requiredNote = fieldConfig && fieldConfig.required === false ? ' (optional)' : '';
    lines.push(`${envVar}=${requiredNote}`);
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const configPath = args[0];
  if (!configPath) {
    process.stderr.write('Usage: generate-env-example.cjs <path-to-creds.config.json> [--out <path>]\n');
    process.exit(2);
  }
  const outIdx = args.indexOf('--out');
  const outPath = outIdx !== -1 ? args[outIdx + 1] : null;

  const config = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8'));
  const rendered = render(config);

  if (outPath) {
    fs.writeFileSync(path.resolve(outPath), rendered);
    process.stdout.write(`Wrote ${outPath}\n`);
  } else {
    process.stdout.write(rendered);
  }
}

if (require.main === module) main();

module.exports = { render };
