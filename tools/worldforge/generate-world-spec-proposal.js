#!/usr/bin/env node
/**
 * generate-world-spec-proposal.js — bounded local-model proposal generator.
 *
 * The local model proposes exactly one world-spec entity as JSON. This script
 * validates/sanitizes that entity, appends it to an existing world-spec, and
 * writes an unapproved vNext proposal. It does not update approval manifests.
 * Optional --evidence inputs let the proposal respond to prior run logs/reviews
 * while preserving the same human-gated import boundary.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const VALIDATOR = path.join(__dirname, 'validate-world-spec.js');
const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const VALID_TYPES = new Set(['creature', 'structure', 'flora', 'mineral', 'artifact', 'npc', 'light', 'sound_source', 'trigger_volume', 'decoration']);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

function usage() {
  console.error([
    'Usage: node generate-world-spec-proposal.js --base <world-spec.json> --output <proposal.json> [options]',
    '',
    'Options:',
    '  --model <name>         Ollama model name (default: qwen2.5-coder:14b)',
    '  --ollama-url <url>     Ollama base URL (default: http://127.0.0.1:11434)',
    '  --iteration <n>        Proposal iteration number (default: base iteration + 1)',
    '  --idea <text>          Bounded idea for the new entity',
    '  --evidence <path>      Prior run evidence to summarize for the local model (repeatable)',
  ].join('\n'));
  process.exit(2);
}

function parseArgs(argv) {
  const args = {
    model: 'qwen2.5-coder:14b',
    ollamaUrl: DEFAULT_BASE_URL,
    idea: 'Add one visible review marker artifact that helps a human count the next import iteration.',
    evidence: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === '--base' && val) { args.base = val; i++; }
    else if (key === '--output' && val) { args.output = val; i++; }
    else if (key === '--model' && val) { args.model = val; i++; }
    else if (key === '--ollama-url' && val) { args.ollamaUrl = val; i++; }
    else if (key === '--iteration' && val) { args.iteration = Number(val); i++; }
    else if (key === '--idea' && val) { args.idea = val; i++; }
    else if (key === '--evidence' && val) { args.evidence.push(val); i++; }
    else usage();
  }
  if (!args.base || !args.output) usage();
  return args;
}

function requestJson(url, payload, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Ollama HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`Ollama returned invalid JSON: ${err.message}`));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error(`Ollama request timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function extractJsonObject(text) {
  const trimmed = String(text || '').trim();
  try { return JSON.parse(trimmed); } catch { /* continue */ }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch { /* continue */ }
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }
  throw new Error('Model response did not contain a JSON object');
}

function assertString(value, fallback, maxLen) {
  const out = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return out.slice(0, maxLen);
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sanitizeEntity(raw, regionId, usedIds) {
  let id = assertString(raw.id, 'local-model-marker-01', 64).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!ID_PATTERN.test(id)) id = 'local-model-marker-01';
  let suffix = 1;
  const baseId = id;
  while (usedIds.has(id)) {
    suffix += 1;
    id = `${baseId}-${suffix}`;
  }

  const type = VALID_TYPES.has(raw.type) ? raw.type : 'artifact';
  const name = assertString(raw.name, 'Local Model Marker', 100);
  const description = assertString(raw.description || raw.lore_hook, 'A bounded local-model proposal marker.', 300);

  return {
    id,
    region_id: regionId,
    type,
    name,
    position: {
      x: numberOr(raw.position?.x, 40),
      y: numberOr(raw.position?.y, -35),
      z: numberOr(raw.position?.z, 0),
    },
    scale: {
      x: Math.max(0.5, Math.min(5, numberOr(raw.scale?.x, 1.2))),
      y: Math.max(0.5, Math.min(5, numberOr(raw.scale?.y, 1.2))),
      z: Math.max(0.5, Math.min(5, numberOr(raw.scale?.z, 1.2))),
    },
    behavior_tags: Array.isArray(raw.behavior_tags) ? raw.behavior_tags.slice(0, 5).map((v) => String(v).slice(0, 40)) : ['static', 'review-marker'],
    lore_hooks: [description],
    asset_requests: [
      {
        type: 'static_mesh',
        description: assertString(raw.asset_description, `Primitive marker for ${name}`, 200),
      },
    ],
    active: true,
    energy: Math.max(0, Math.min(100, numberOr(raw.energy, 1))),
  };
}

function validateOutput(filePath) {
  const result = spawnSync(process.execPath, [VALIDATOR, filePath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Generated proposal failed validation:\n${result.stdout || result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function relativePath(filePath) {
  const resolved = path.resolve(filePath);
  const rel = path.relative(REPO_ROOT, resolved);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : resolved;
}

function compactWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function summarizeJsonEvidence(filePath, parsed) {
  const fields = [];
  if (parsed.import_allowed !== undefined) fields.push(`import_allowed=${parsed.import_allowed}`);
  if (parsed.reason) fields.push(`reason=${parsed.reason}`);
  if (parsed.world_id) fields.push(`world_id=${parsed.world_id}`);
  if (parsed.schema) fields.push(`schema=${parsed.schema}`);
  if (parsed.sha256) fields.push(`sha256=${parsed.sha256}`);
  if (parsed.validation) {
    fields.push(`validation.valid=${parsed.validation.valid}`);
    if (parsed.validation.regions !== undefined) fields.push(`regions=${parsed.validation.regions}`);
    if (parsed.validation.entities !== undefined) fields.push(`entities=${parsed.validation.entities}`);
    if (parsed.validation.events !== undefined) fields.push(`events=${parsed.validation.events}`);
  }
  if (parsed.response_text) fields.push(`review=${compactWhitespace(parsed.response_text).slice(0, 500)}`);
  if (parsed.checks?.approval) fields.push(`approval=${compactWhitespace(JSON.stringify(parsed.checks.approval)).slice(0, 500)}`);
  if (fields.length === 0) fields.push(compactWhitespace(JSON.stringify(parsed)).slice(0, 700));
  return `${relativePath(filePath)}: ${fields.join('; ')}`;
}

function summarizeTextEvidence(filePath, text) {
  const lines = String(text || '').split(/\r?\n/);
  const selected = [];
  for (const line of lines) {
    if (/preflight_approved|Game class|Loaded world|Spawned|Complete|PASS|FAIL|lighting/i.test(line)) {
      selected.push(compactWhitespace(line));
    }
  }
  const body = (selected.length ? selected : lines.map(compactWhitespace).filter(Boolean)).slice(0, 24).join(' | ');
  return `${relativePath(filePath)}: ${body.slice(0, 1200)}`;
}

function readEvidenceSummaries(evidencePaths) {
  return evidencePaths.map((entry) => {
    const fullPath = path.resolve(entry);
    const raw = fs.readFileSync(fullPath, 'utf8');
    if (fullPath.endsWith('.json')) {
      try {
        return summarizeJsonEvidence(fullPath, JSON.parse(raw));
      } catch {
        return summarizeTextEvidence(fullPath, raw);
      }
    }
    return summarizeTextEvidence(fullPath, raw);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const basePath = path.resolve(args.base);
  const outputPath = path.resolve(args.output);
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const region = base.regions?.[0];
  if (!region) throw new Error('Base spec must have at least one region');
  const evidenceSummaries = readEvidenceSummaries(args.evidence);
  const evidenceRefs = args.evidence.map(relativePath);
  const evidenceBlock = evidenceSummaries.length
    ? [
        'Evidence from prior run:',
        ...evidenceSummaries.map((summary, index) => `${index + 1}. ${summary}`),
        'Use this evidence to propose a small visible next marker. If the evidence mentions a caveat, respond to it without claiming the caveat is fixed unless the entity directly addresses it.',
      ].join('\n')
    : 'No prior run evidence supplied.';

  const prompt = [
    'Return ONLY one JSON object for a world-spec/1.0 entity proposal.',
    'No markdown, no code fences, no comments.',
    `Idea: ${args.idea}`,
    evidenceBlock,
    `Region id must be: ${region.id}`,
    'Use fields: id, type, name, description, position{x,y,z}, scale{x,y,z}, behavior_tags, asset_description, energy.',
    'Use safe bounded prose. Do not include paths, URLs, code, eval, require, import, shell, or network instructions.',
    'Prefer type "artifact" or "decoration" for a visible review marker.',
    'Make description or asset_description cite the evidence in plain prose, not as a file path.',
  ].join('\n');

  const response = await requestJson(`${args.ollamaUrl.replace(/\/$/, '')}/api/generate`, {
    model: args.model,
    prompt,
    stream: false,
    options: {
      temperature: 0.2,
      num_predict: 700,
    },
  });

  const rawEntity = extractJsonObject(response.response || '');
  const usedIds = new Set([
    ...(base.regions || []).map((r) => r.id),
    ...(base.entities || []).map((e) => e.id),
    ...(base.events || []).map((event) => event.id),
  ].filter(Boolean));
  const entity = sanitizeEntity(rawEntity, region.id, usedIds);

  const iteration = Number.isInteger(args.iteration)
    ? args.iteration
    : Math.max(0, Number(base.meta?.iteration || 0) + 1);

  const proposal = JSON.parse(JSON.stringify(base));
  proposal.meta = {
    ...proposal.meta,
    generated_by: `local-ollama:${args.model}`,
    generated_at: new Date().toISOString(),
    approved: false,
    approved_by: null,
    approved_at: null,
    iteration,
    description: `${proposal.meta?.description || proposal.meta?.name || 'World spec'} Proposed local-model iteration; not import-approved until exact hash is added to the approval manifest.`,
  };
  proposal.entities = [...(proposal.entities || []), entity];
  proposal.documentation = {
    ...(proposal.documentation || {}),
    iteration_notes: evidenceRefs.length
      ? `Evidence-driven local Ollama model ${args.model} proposed entity ${entity.id} from prior run evidence (${evidenceRefs.join(', ')}). This file is valid but intentionally unapproved for import until operator hash approval.`
      : `Local Ollama model ${args.model} proposed entity ${entity.id}. This file is valid but intentionally unapproved for import until operator hash approval.`,
    evidence_refs: evidenceRefs,
  };
  proposal.telemetry = {
    ...(proposal.telemetry || {}),
    seq: iteration,
    written_at: new Date().toISOString(),
    writer: `generate-world-spec-proposal.js:${args.model}`,
    complete: true,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(proposal, null, 2)}\n`);

  const validation = validateOutput(outputPath);
  console.log(JSON.stringify({
    ok: true,
    model: args.model,
    output: path.relative(REPO_ROOT, outputPath),
    proposed_entity_id: entity.id,
    evidence_refs: evidenceRefs,
    validation,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
