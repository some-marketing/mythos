#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const [key, value] of Object.entries(request.env || {})) process.env[key] = String(value);

const runtimeModule = await import(pathToFileURL(path.join(request.project_root, '_dev/forks/pi-mono/packages/coding-agent/dist/core/agent-session-runtime.js')).href);
const decisionModule = await import(pathToFileURL(path.join(request.project_root, '_dev/forks/pi-mono/packages/coding-agent/dist/core/debrief-close-decision.js')).href);

function lastJsonLine(target) {
  const lines = fs.readFileSync(target, 'utf8').trim().split('\n');
  return JSON.parse(lines.at(-1));
}

if (request.outcome === 'tombstone') {
  decisionModule.registerActiveSession(request.root, {
    session_id: request.session_id,
    scope: request.scope,
    pid: 99999999,
    started_at: request.started_at,
    telemetry_context: request.context
  }, process.env);
  const result = decisionModule.reconcileLostSessions(request.root, process.env, { isProcessAlive: () => false });
  const observation = lastJsonLine(path.join(request.root, '_dev/state/debrief-closeout/span-observations.jsonl'));
  process.stdout.write(`${JSON.stringify({ result, observation })}\n`);
} else {
  const sessionManager = { getSessionId: () => request.session_id };
  const session = { sessionManager, extensionRunner: { hasHandlers: () => false }, dispose() {} };
  const runtime = new runtimeModule.AgentSessionRuntime(session, { cwd: request.root }, async () => { throw new Error('unused'); });
  if (request.outcome === 'allow') {
    const dir = path.join(request.root, '_dev/reports/debriefs');
    fs.mkdirSync(dir, { recursive: true });
    const artifact = path.join(dir, `${request.session_id}.md`);
    fs.writeFileSync(artifact, `# Native production debrief\n\n## Summary\n\nSession ${request.session_id}; scope ${request.scope}.\n`);
    fs.writeFileSync(path.join(dir, `${request.session_id}.json`), `${JSON.stringify({
      schema: 'DebriefEvidence/1.0', protocol: 'debrief_before_closeout', session_id: request.session_id,
      scope: request.scope, created_at: new Date().toISOString(), artifact_path: path.relative(request.root, artifact).replace(/\\/g, '/')
    })}\n`);
  }
  const decision = runtime.prepareClose(request.reason);
  const observation = lastJsonLine(path.join(request.root, '_dev/state/debrief-closeout/span-observations.jsonl'));
  process.stdout.write(`${JSON.stringify({ decision, observation })}\n`);
}
