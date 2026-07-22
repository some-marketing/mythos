#!/usr/bin/env node
'use strict';

const REPO_DIR = process.env.FLEET_NODE_REPO_DIR || 'C:\\mythos';
const BRANCH = process.env.FLEET_NODE_BRANCH || 'main';
const WORKER_SERVICE = process.env.FLEET_NODE_WORKER_SERVICE || 'fleet-worker';

const commandLines = [
  `cd ${REPO_DIR}`,
  'git fetch origin',
  `git switch ${BRANCH}`,
  'git pull --ff-only',
  'powershell -ExecutionPolicy Bypass -File <your-cloud-stack-ensure-script.ps1> -OpenCloudApps',
  `Restart-Service ${WORKER_SERVICE}`
];

const EXAMPLE_NODES = (process.env.FLEET_NODE_LIST || 'example-gpu-host,example-workstation').split(',').map(n => n.trim()).filter(Boolean);

const verificationLines = EXAMPLE_NODES.flatMap(node => [
  `curl http://${node}:8001/api/health`,
  `curl http://${node}:11434/api/tags`
]).concat(['npm run fleet:broadcast-mirror -- --serve']);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    branch: BRANCH,
    node_command: commandLines,
    verify_from_orchestrator: verificationLines
  }, null, 2));
} else {
  console.log('Run from elevated PowerShell on each Windows fleet node:\n');
  console.log(commandLines.join('\n'));
  console.log('\nVerify from the orchestrator host:\n');
  console.log(verificationLines.join('\n'));
}
