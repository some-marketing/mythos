#!/usr/bin/env node
'use strict';

const commandLines = [
  'cd C:\\Mythos',
  'git fetch origin',
  'git switch recovery/clean-lineage-2026-05-18',
  'git pull --ff-only',
  'powershell -ExecutionPolicy Bypass -File tools\\fleet\\ensure-node-cloud-stack.ps1 -OpenCloudApps',
  'Restart-Service simpleminions-worker'
];

const verificationLines = [
  'curl http://orwell:8001/api/health',
  'curl http://orwell:11434/api/tags',
  'curl http://rupert:8001/api/health',
  'curl http://rupert:11434/api/tags',
  'npm run fleet:broadcast-mirror -- --serve'
];

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    branch: 'recovery/clean-lineage-2026-05-18',
    node_command: commandLines,
    verify_from_orchestrator: verificationLines
  }, null, 2));
} else {
  console.log('Run from elevated PowerShell on each Windows fleet node:\n');
  console.log(commandLines.join('\n'));
  console.log('\nVerify from the orchestrator host:\n');
  console.log(verificationLines.join('\n'));
}
