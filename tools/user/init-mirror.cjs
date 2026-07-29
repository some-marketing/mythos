#!/usr/bin/env node
'use strict';

/**
 * init-mirror.cjs — scaffold $MYTHOS_HOME (default ~/.mythos) from the shipped
 * templates in tools/user/templates/.
 *
 * Run via: npm run mirror:init
 *
 * Rules this script holds itself to:
 *   - NEVER overwrites a file that already exists. Each of the four Mirror files is
 *     checked and copied independently; an existing file is left untouched and
 *     reported as already present.
 *   - Exits 0 on every success path, including "everything already existed" — this is
 *     an idempotent scaffold, not a strict one-time create. It only exits non-zero if
 *     a template this script depends on is missing from the shipped tree (a packaging
 *     defect, not a user error).
 *   - Never reads or prints the CONTENTS of any Mirror file, existing or newly
 *     created — only whether each one was created or already present.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const MYTHOS_HOME = process.env.MYTHOS_HOME || path.join(os.homedir(), '.mythos');

function line(s = '') { process.stdout.write(s + '\n'); }
function ok(s) { line('  + ' + s); }
function skip(s) { line('  = ' + s); }
function fail(s) { line('  ! ' + s); }

// { destination relative to MYTHOS_HOME, source relative to TEMPLATES_DIR }
const PLAN = [
  { dest: path.join('kernel', 'identity.md'), src: 'identity.md' },
  { dest: path.join('kernel', 'principles.md'), src: 'principles.md' },
  { dest: path.join('kernel', 'preferences.yaml'), src: 'preferences.yaml' },
  { dest: 'aliases.yaml', src: 'aliases.yaml.example' },
];

function main() {
  line('Scaffolding your Mirror at ' + MYTHOS_HOME + '...');
  line('');

  let missingTemplate = false;

  for (const { dest, src } of PLAN) {
    const srcPath = path.join(TEMPLATES_DIR, src);
    const destPath = path.join(MYTHOS_HOME, dest);

    if (!fs.existsSync(srcPath)) {
      fail('template missing from this install: ' + src + ' (packaging defect, please report)');
      missingTemplate = true;
      continue;
    }

    if (fs.existsSync(destPath)) {
      skip(dest + ' already exists — left untouched');
      continue;
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    ok(dest + ' created');
  }

  line('');
  if (missingTemplate) {
    line('Finished with a packaging problem above — your Mirror is only partially scaffolded.');
    process.exitCode = 1;
    return;
  }

  line('Your Mirror is ready. Edit the files under ' + MYTHOS_HOME + ' whenever you like —');
  line('this script will never touch them again once they exist. Nothing here is read');
  line('by anything except your own session at start, and nothing in it is ever written');
  line('back into ' + path.basename(REPO_ROOT) + ' or any generated, staged, or exported surface.');
  process.exitCode = 0;
}

main();
