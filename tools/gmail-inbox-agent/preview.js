#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { classifyEmails } = require('./lib/classifier');

function usage() {
  return [
    'Usage: node tools/gmail-inbox-agent/preview.js <emails.json> [--rules <rules.json>] [--learn-corrections]',
    '',
    'Input may be a JSON array of email objects or an object with { "emails": [], "rules": {} }.',
    'The preview reads local JSON only and does not call Gmail or Dart.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = [...argv];
  const parsed = {
    inputPath: null,
    rulesPath: null,
    learnCorrections: false,
  };

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--rules') {
      parsed.rulesPath = args.shift();
    } else if (arg === '--learn-corrections') {
      parsed.learnCorrections = true;
    } else if (!parsed.inputPath) {
      parsed.inputPath = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return parsed;
}

function readJson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (!args.inputPath) {
    throw new Error(usage());
  }

  const input = readJson(args.inputPath);
  const emails = Array.isArray(input) ? input : input.emails;
  if (!Array.isArray(emails)) {
    throw new Error('Preview input must be a JSON array or an object with an emails array.');
  }

  const embeddedRules = !Array.isArray(input) && input.rules ? input.rules : {};
  const fileRules = args.rulesPath ? readJson(args.rulesPath) : {};
  const rules = {
    ...embeddedRules,
    ...fileRules,
  };
  const learnCorrections = args.learnCorrections || Boolean(input.learn_corrections);

  const decisions = classifyEmails(emails, {
    rules,
    learnCorrections,
  });
  process.stdout.write(`${JSON.stringify(decisions, null, 2)}\n`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  parseArgs,
};
