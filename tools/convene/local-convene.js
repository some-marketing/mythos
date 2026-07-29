#!/usr/bin/env node
'use strict';

/**
 * local-convene.js — a fully-LOCAL convene (the de-Clauding lane).
 *
 * Fires a council of LOCAL Ollama models as participants, captures each voice to
 * an artifact dir, and writes a synthesis skeleton for the orchestrating session
 * to complete. ZERO cloud for the deliberation (lobes run on local models).
 *
 * Complements the `local-council` profile in convene.js: convene.js assumes the
 * origin is itself a lobe; this runner is for the common case where the
 * orchestrator (e.g. this Claude session) is NOT a lobe — it convenes the local
 * council and synthesizes their distinct voices.
 *
 * Honesty: a local council is diverse local models, NOT the cloud distinct-intelligence
 * trio. Use for cost-free / private / zero-cloud exploration; escalate to the kernel
 * triad for consequence-grade consensus.
 *
 * Usage:
 *   node tools/convene/local-convene.js --task "<question>" --scope <slug> \
 *     [--models qwen3:4b,deepseek-r1:14b,qwen2.5-coder:14b] [--timeout 240] [--num-predict 700]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ARTIFACT_ROOT = path.join(REPO_ROOT, '_dev/reports/analysis/convene-runs');
const OLLAMA = { host: '127.0.0.1', port: 11434, pathname: '/api/chat' };

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function callOllama(model, prompt, timeoutMs) {
  const body = JSON.stringify({
    model, stream: false, think: false,
    messages: [{ role: 'user', content: prompt }],
    options: { temperature: 0.6, num_predict: parseInt(arg('num-predict', '700'), 10) }
  });
  return new Promise((resolve) => {
    const req = http.request({ ...OLLAMA, method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const d = JSON.parse(data);
          const content = (d.message && d.message.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
          resolve({ ok: true, content, eval_count: d.eval_count });
        } catch (e) { resolve({ ok: false, error: `parse: ${e.message}` }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: `ollama: ${e.message} (is 'ollama serve' running?)` }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: `timeout after ${timeoutMs}ms` }); });
    req.write(body); req.end();
  });
}

async function main() {
  const task = arg('task');
  const scope = arg('scope', 'local-convene');
  if (!task) { console.error('--task required'); process.exit(2); }
  const models = arg('models', 'qwen3:4b,deepseek-r1:14b,qwen2.5-coder:14b').split(',').map(s => s.trim());
  const timeoutMs = parseInt(arg('timeout', '240'), 10) * 1000;

  // dated artifact dir (no Date in args-sensitive contexts, but this is a normal CLI)
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const dir = path.join(ARTIFACT_ROOT, `${ts}-local-${scope}`);
  fs.mkdirSync(dir, { recursive: true });

  console.log(`Local council on "${scope}" — models: ${models.join(', ')} (sequential, zero-cloud)`);
  const results = [];
  for (const m of models) {
    process.stdout.write(`  → ${m} ... `);
    const r = await callOllama(m, task, timeoutMs);
    const slug = m.replace(/[^a-z0-9]+/gi, '_');
    fs.writeFileSync(path.join(dir, `local__${slug}.md`),
      `# Local lobe: ${m}\n\n- status: ${r.ok ? 'ok' : 'error'}\n- eval_count: ${r.eval_count ?? 'n/a'}\n\n---\n\n${r.ok ? r.content : r.error}\n`);
    console.log(r.ok ? `ok (${r.eval_count} tok)` : `ERROR ${r.error}`);
    results.push({ model: m, ...r });
  }

  fs.writeFileSync(path.join(dir, 'synthesis-skeleton.md'),
    `# Local convene synthesis — ${scope}\n\n**Profile:** local-council (Ollama, ZERO cloud) — NOT consequence-grade (diverse local models, not the cloud distinct trio).\n**Models:** ${models.join(', ')}\n\n## Task\n\n${task}\n\n## Lobes\n\n${models.map(m => `- ${m}: see local__${m.replace(/[^a-z0-9]+/gi, '_')}.md`).join('\n')}\n\n## Cross-verification catches\n\n[ORCHESTRATOR fills: where they agreed/disagreed, where any was wrong/too-narrow]\n\n## Net findings\n\n[ORCHESTRATOR synthesizes the local voices; check prescriptions against system doctrine before adopting]\n`);

  console.log(`\nArtifacts: ${path.relative(REPO_ROOT, dir)}`);
  console.log(`Lobes: ${results.filter(r => r.ok).length}/${models.length} ok. Orchestrator now synthesizes synthesis-skeleton.md.`);
  process.exit(results.some(r => r.ok) ? 0 : 1);
}
main();
