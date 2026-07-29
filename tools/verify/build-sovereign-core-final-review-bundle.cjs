#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OUTPUT = '_dev/tmp/sovereign-core-harness-final-review-bundle.md';
const FILES = Object.freeze([
  '_dev/reports/analysis/task-plans/sovereign-core-harness__plan.json',
  '_dev/concepts/sovereign-core-harness.md',
  '_dev/reports/analysis/codex-last-message__20260709T152221Z__sovereign-core-harness-p0-codex-review-20260709.md',
  '_dev/reports/analysis/sovereign-core-harness-p1/p4-s0-reconciliation-receipt.md',
  '_dev/reports/analysis/codex-last-message__20260709T200310Z__sovereign-core-harness-custody-pass4-20260709.md',
  '_dev/reports/analysis/sovereign-core-harness-p3-receipt.md',
  '_dev/reports/analysis/sovereign-core-harness-p3-gemini-rereview.json',
  '_dev/reports/analysis/sovereign-core-harness-p4-s1-receipt.md',
  '_dev/reports/analysis/sovereign-core-harness-p4-s2-receipt.md',
  '_dev/reports/analysis/sovereign-core-harness-p4-s3-soak-receipt.json',
  '_dev/reports/analysis/sovereign-core-harness-actor-custody-tests.json',
  '_dev/reports/analysis/sovereign-core-harness-p4-s3-gemini-review.json',
  '_dev/reports/analysis/sovereign-core-harness-p4-s3-fable-review.md',
  '_dev/state/debrief-closeout/native-promotion-gate.json',
  '_dev/reports/analysis/sovereign-core-harness-p4-s3-rollback-proof.json',
  '_dev/state/enforcement-home-registry.json',
  '_dev/state/enforcement-home-transitions.jsonl',
  '_dev/state/enforcement-home-stale-claim-denials.jsonl',
  '_dev/reports/analysis/sovereign-core-harness-p5-receipt.md',
  '_dev/reports/analysis/sovereign-core-harness__hardening-gradient.json',
  '_dev/reports/analysis/sovereign-core-harness-p5-gemini-review.json',
  '_dev/reports/analysis/sovereign-core-harness-security-prior-art__perplexity__20260716.json',
  '_dev/reports/analysis/sovereign-core-harness__perplexity-findings-classification__20260716.md',
  '_dev/reports/analysis/sovereign-core-harness-validation__final.json',
  'tools/verify/sovereign-core-harness-completion.cjs',
  'tools/verify/build-sovereign-core-final-receipt.cjs',
  'tools/kernel/work-custody/actor-work-lease.cjs',
  'tools/kernel/work-custody/actor-work-lease.schema.json',
  'tools/kernel/work-custody/__tests__/actor-work-lease.test.cjs',
  'tools/kernel/enforcement-home/enforcement-home-registry.cjs',
  'tools/kernel/enforcement-home/execute-native-rollback-proof.cjs',
  'tools/kernel/enforcement-home/__tests__/execute-native-rollback-proof.test.cjs',
  'tools/kernel/hooks/stop-closeout-evidence-gate.cjs',
  'tools/kernel/hooks/__tests__/stop-closeout-evidence-gate.test.cjs',
  '_dev/forks/pi-mono/packages/coding-agent/src/core/debrief-close-decision.ts',
  '_dev/forks/pi-mono/packages/coding-agent/src/core/agent-session-runtime.ts'
]);

const PROMPT = `# Sovereign Core Harness P0-P5 Final Acceptance Review

You are a producer-independent, consequence-grade reviewer. REVIEW_ONLY; do not edit files and do not broaden scope.

Current State: The approved sovereign-core-harness program is limited to P0-P5. P6/P7, native MCP/subagent capability, and Broker phase 4 remain explicitly excluded. The packet is assembled only after P4's real >=24-hour/>=25-pair soak, independent P4 reviews, native promotion, same-process rollback/restoration proof, and a fresh all-green P0-P5 validation manifest.

Question / Work: Decide whether the completed P0-P5 program may issue its final receipt and close. Inspect evidence content rather than accepting filenames. Verify: P0 canonical CascadeSpan ownership/parity; P1 live native hook surface evidence; P2/P3 bounded Broker patch, sandbox, timeout, no-network, rollback, lineage, and durable closeout; P4 paired native/Claude parity from actual pi-fork production provenance, truthful soak, actor-portable invocation leases without model/provider/harness/parent ownership, collision and stale-write safety, heartbeat expiry, crash/corrupt-state reclamation, hash-bound distinct-family promotion authority, sole native blocking ownership, monotonic enforcement epochs with stale-owner denial, preservation of unrelated Stop enforcement, and rollback/restoration; P5 measurable hardening gradient plus a tooling-flagged completed descent; Perplexity findings classification; and the current nine-command validation results. Confirm unrelated model-catalogue changes were not claimed and excluded phases did not enter acceptance evidence.

Desired State: Return APPROVE or BLOCK as the first word. A BLOCK must name the exact artifact/field or mechanically reproducible failure and the minimum repair. APPROVE must map P0-P5 and the scope exclusions to evidence, identify residual non-blocking limits, and state that final receipt/debrief/outcome reconciliation may proceed.

The final receipt, final debrief, and completed outcome do not exist in this packet by design: they are downstream of this independent approval. Do not block merely because those downstream closeout artifacts are absent; do block if the supplied builder/auditor would allow them without the required evidence.`;

function resolveInput(root, rel) {
  if (path.isAbsolute(rel)) throw new Error(`review input must be relative: ${rel}`);
  const canonicalRoot = fs.realpathSync(root);
  const target = path.resolve(canonicalRoot, rel);
  const relative = path.relative(canonicalRoot, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`review input escapes root: ${rel}`);
  let cursor = canonicalRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) break;
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`review input contains a symbolic link: ${rel}`);
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error(`required final review input missing: ${rel}`);
  const realTarget = fs.realpathSync(target);
  const realRelative = path.relative(canonicalRoot, realTarget);
  if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) throw new Error(`review input resolves outside root: ${rel}`);
  return target;
}

function resolveOutput(root, rel) {
  if (path.isAbsolute(rel)) throw new Error('final review output must be relative');
  const canonicalRoot = fs.realpathSync(root);
  const output = path.resolve(canonicalRoot, rel);
  const relative = path.relative(canonicalRoot, output);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('final review output escapes root');
  let cursor = canonicalRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) break;
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('final review output contains a symbolic link');
  }
  let existingParent = path.dirname(output);
  while (!fs.existsSync(existingParent) && existingParent !== canonicalRoot) existingParent = path.dirname(existingParent);
  const parentReal = fs.realpathSync(existingParent);
  const parentRelative = path.relative(canonicalRoot, parentReal);
  if (parentRelative === '..' || parentRelative.startsWith(`..${path.sep}`) || path.isAbsolute(parentRelative)) throw new Error('final review output resolves outside root');
  return output;
}

function build(root = process.cwd(), outputRel = OUTPUT) {
  const sections = [PROMPT];
  for (const rel of FILES) {
    const target = resolveInput(root, rel);
    sections.push(`\n## File: ${rel}\n\n\`\`\`\n${fs.readFileSync(target, 'utf8')}\n\`\`\``);
  }
  const output = resolveOutput(root, outputRel);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${sections.join('\n')}\n`);
  return outputRel;
}

if (require.main === module) {
  try {
    const rootIndex = process.argv.indexOf('--root');
    const root = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : process.cwd());
    const outputIndex = process.argv.indexOf('--output');
    process.stdout.write(`${build(root, outputIndex >= 0 ? process.argv[outputIndex + 1] : OUTPUT)}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { FILES, OUTPUT, PROMPT, build, resolveInput, resolveOutput };
