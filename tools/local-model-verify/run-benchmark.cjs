#!/usr/bin/env node
/**
 * Local-model verification — golden-set benchmark runner. Stdlib only.
 *
 * Two pluggable backends: talk directly to an Ollama host, or POST to any
 * generic HTTP endpoint following the minimal contract below. There is no
 * dependency on any particular fleet-orchestrator or private routing layer —
 * bring your own model host.
 *
 * Generic HTTP backend contract:
 *   POST http://<host>:<port>/generate
 *   body:     { "model": "<model>", "prompt": "<prompt>" }
 *   response: { "response": "<text>" }  (falls back to .output, .text, or the raw body)
 *
 * Usage:
 *   node tools/local-model-verify/run-benchmark.cjs --model qwen2.5:3b --direct-ollama <your-local-model-host>:11434
 *   node tools/local-model-verify/run-benchmark.cjs --model qwen2.5:3b --http localhost:8000
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

function parseArgs(argv) {
  const out = { model: null, directOllama: null, http: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') out.model = argv[++i];
    else if (a === '--direct-ollama') out.directOllama = argv[++i];
    else if (a === '--http') out.http = argv[++i];
  }
  if (!out.model) throw new Error('--model is required');
  if (!out.directOllama && !out.http) out.http = 'localhost:8000';
  return out;
}

function postJSON(host, port, urlPath, body, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ host, port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 500)}`));
        try { resolve(JSON.parse(text)); } catch (e) { resolve({ raw: text }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.write(data); req.end();
  });
}

async function dispatch(args, model, prompt) {
  if (args.directOllama) {
    const [h, p] = args.directOllama.split(':');
    const r = await postJSON(h, parseInt(p || '11434', 10), '/api/generate', { model, prompt, stream: false });
    return r.response || r.raw || '';
  }
  const [h, p] = args.http.split(':');
  const r = await postJSON(h, parseInt(p || '8000', 10), '/generate', { model, prompt });
  return r.response || r.output || r.text || JSON.stringify(r);
}

function score(response, prompt) {
  const r = (response || '').toLowerCase();
  for (const dq of prompt.disqualifying_patterns || [])
    if (r.includes(dq.toLowerCase())) return { verdict: 'fail', reason: `disqualifying: "${dq}"` };
  const topics = prompt.expected_topic || [];
  if (!topics.some((t) => r.includes(String(t).toLowerCase())))
    return { verdict: 'fail', reason: `no expected_topic match (${JSON.stringify(topics)})` };
  const shape = prompt.acceptable_response_shape || [];
  const hits = shape.filter((s) => r.includes(String(s).toLowerCase())).length;
  const ratio = shape.length === 0 ? 1 : hits / shape.length;
  if (ratio >= 0.5) return { verdict: 'pass', reason: `topic + ${hits}/${shape.length} shape` };
  if (hits >= 1) return { verdict: 'partial', reason: `topic + only ${hits}/${shape.length} shape` };
  return { verdict: 'fail', reason: `topic but no shape fragments` };
}

const tsCompact = (d = new Date()) => d.toISOString().replace(/[:.]/g, '').replace(/-/g, '').slice(0, 15) + 'Z';
const modelSlug = (m) => m.replace(/[^a-zA-Z0-9._-]/g, '-');

async function main() {
  const args = parseArgs(process.argv);
  const repoRoot = path.resolve(__dirname, '..', '..');
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-set', 'prompts.json'), 'utf8'));
  const prompts = golden.prompts || [];
  const results = [];
  const startedAt = new Date();
  for (const p of prompts) {
    const t0 = Date.now();
    let response = '', error = null;
    try { response = await dispatch(args, args.model, p.prompt); }
    catch (e) { error = String(e.message || e); }
    const latency_ms = Date.now() - t0;
    const v = error ? { verdict: 'fail', reason: `dispatch error: ${error}` } : score(response, p);
    results.push({ id: p.id, prompt: p.prompt, response, latency_ms, ...v });
    process.stderr.write(`[${v.verdict.padEnd(7)}] ${p.id} (${latency_ms}ms)\n`);
  }
  const finishedAt = new Date();
  const counts = { pass: 0, partial: 0, fail: 0 };
  for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1;

  const stamp = tsCompact(startedAt);
  const slug = modelSlug(args.model);
  const reportsDir = path.join(repoRoot, '_dev', 'reports', 'analysis');
  fs.mkdirSync(reportsDir, { recursive: true });
  const jsonPath = path.join(reportsDir, `local-model-verify__${slug}__${stamp}.json`);
  const mdPath = path.join(reportsDir, `local-model-verify__${slug}__${stamp}.md`);
  const transport = args.directOllama ? `ollama:${args.directOllama}` : `http:${args.http}`;
  fs.writeFileSync(jsonPath, JSON.stringify({ schema: 'LocalModelVerify/1.0', model: args.model, transport,
    started_at: startedAt.toISOString(), finished_at: finishedAt.toISOString(), counts, total: results.length, results }, null, 2));

  const lines = [`# Local-model verify — ${args.model}`, ``, `- Transport: ${transport}`,
    `- Started: ${startedAt.toISOString()}`, `- Finished: ${finishedAt.toISOString()}`,
    `- Total: ${results.length} | Pass: ${counts.pass||0} | Partial: ${counts.partial||0} | Fail: ${counts.fail||0}`,
    ``, `## Per-prompt verdicts`, ''];
  for (const r of results) {
    lines.push(`### ${r.id} — **${r.verdict}**`, `- Latency: ${r.latency_ms}ms`, `- Reason: ${r.reason}`,
      `- Prompt: ${r.prompt}`, `- Response: ${(r.response||'').slice(0,600).replace(/\n/g,' ')}`, '');
  }
  fs.writeFileSync(mdPath, lines.join('\n'));
  process.stderr.write(`\nReport: ${path.relative(repoRoot, jsonPath)}\n         ${path.relative(repoRoot, mdPath)}\n`);
  process.exit((counts.fail || 0) > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e.stack || e.message || String(e)); process.exit(2); });
