#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { validatePromotionGate } = require('./native-promotion-gate.cjs');

function value(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const root = path.resolve(value('root') || process.cwd());
const gate = value('gate') || '_dev/state/debrief-closeout/native-promotion-gate.json';
const result = validatePromotionGate(root, gate);
process.stdout.write(`${JSON.stringify({ schema: 'NativePromotionGateValidation/1.0', ok: result.ok, gate, errors: result.errors }, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
