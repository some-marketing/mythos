#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FILES = Object.freeze([
  '_dev/reports/analysis/task-plans/sovereign-core-harness__plan.json',
  '_dev/reports/analysis/sovereign-core-harness-p4-s1-receipt.md',
  '_dev/reports/analysis/sovereign-core-harness-p4-s2-receipt.md',
  '_dev/reports/analysis/sovereign-core-harness-p4-s3-soak-receipt.json',
  '_dev/reports/analysis/sovereign-core-harness-p4-s3-soak-receipt.md',
  '_dev/reports/analysis/sovereign-core-harness-actor-custody-tests.json',
  '_dev/reports/analysis/sovereign-core-harness-p4-operator-authority.md',
  '_dev/reports/analysis/sovereign-core-harness-validation__final.json',
  '_dev/state/enforcement-home-registry.json',
  'tools/kernel/enforcement-home/debrief-soak-runner.cjs',
  'tools/kernel/enforcement-home/enforcement-home-registry.cjs',
  'tools/kernel/enforcement-home/native-promotion-gate.cjs',
  'tools/kernel/enforcement-home/manage-enforcement-home.cjs',
  'tools/kernel/enforcement-home/execute-native-rollback-proof.cjs',
  'tools/kernel/enforcement-home/__tests__/debrief-soak-runner.test.cjs',
  'tools/kernel/enforcement-home/__tests__/enforcement-home-registry.test.cjs',
  'tools/kernel/enforcement-home/__tests__/native-promotion-gate.test.cjs',
  'tools/kernel/enforcement-home/__tests__/execute-native-rollback-proof.test.cjs',
  'tools/kernel/work-custody/actor-work-lease.cjs',
  'tools/kernel/work-custody/actor-work-lease.schema.json',
  'tools/kernel/work-custody/__tests__/actor-work-lease.test.cjs',
  'tools/kernel/hooks/stop-closeout-evidence-gate.cjs',
  'tools/kernel/hooks/__tests__/stop-closeout-evidence-gate.test.cjs',
  '_dev/forks/pi-mono/packages/coding-agent/src/core/debrief-close-decision.ts',
  '_dev/forks/pi-mono/packages/coding-agent/src/core/agent-session-runtime.ts',
  '_dev/forks/pi-mono/packages/coding-agent/test/debrief-close-decision.test.ts'
]);

const PROMPT = `# P4-S3 Native Enforcement Promotion Acceptance Review

You are a producer-independent, consequence-grade reviewer. REVIEW_ONLY; do not edit.

Current State: Codex implemented native debrief_before_closeout enforcement and paired CascadeSpan projection in the pinned pi-mono fork. Claude remains the blocking owner during a real >=24-hour, >=25-pair report-only soak. The completed receipt in this bundle is authoritative. Managed promotion is fail-closed on a hash-bound packet and rollback remains ungated.

Question / Work: Decide whether P4-S3 may retire only the Claude debrief subdecision and promote native_fork as the sole blocking owner. Mechanically inspect: elapsed time and count; all seven workload families; zero unexplained mismatches; paired action IDs and separate actual runtime IDs; unpaired live-traffic segregation; immutable evidence hashes; native/hook parity; missing/corrupt registry fail-safe; exactly-one-owner invariant; monotonic enforcement epochs and stale-owner denial after rollback/restoration; mid-write crash behavior; next-Stop rollback without restart; preservation of unrelated distinct-review Stop enforcement; actor-portable work leases keyed only to invocation/session plus bounded unit/artifacts/lease epoch; collision denial, heartbeat expiry, handoff, crash reclamation, stale-writer denial, cross-model/provider/agent takeover, and corrupt-state recovery; the attached current command-validation manifest; and exclusion of P6/P7/native MCP/subagent. The concrete promotion gate does not exist yet by design: it hash-binds this review and the other required approval, so requiring that generated gate during this review would be circular. The coordinator must build and validate it only after both reviews approve. Include the exact SHA-256 values of the plan JSON and actor-custody test receipt in the approval so the gate can reject stale reviews.

Desired State: Return APPROVE or BLOCK as the first word. BLOCK only with an acceptance-grade finding naming exact file/field, failure path, and required mechanical test. APPROVE must map each repaired P4 gate to evidence and list residual non-blocking limits. Do not infer elapsed time or accept aggregate counts without inspecting the paired receipt.`;

function build(root = process.cwd(), outputRel = '_dev/tmp/sovereign-core-harness-p4-s3-review-bundle.md') {
  const sections = [PROMPT];
  for (const rel of FILES) {
    const target = path.join(root, rel);
    if (!fs.existsSync(target)) throw new Error(`required review input missing: ${rel}`);
    sections.push(`\n## File: ${rel}\n\n\`\`\`\n${fs.readFileSync(target, 'utf8')}\n\`\`\``);
  }
  sections.push('\n## Required independent command evidence\n\nThe bundled `sovereign-core-harness-validation__final.json` must show current green outer P4 tests plus focused fork tests/build. The reviewer must inspect the promotion-gate builder, validator, and adversarial tests in this bundle. After both independent reviews approve, the coordinator must build the hash-bound concrete gate, validate it, and validate ownership before promotion; a concrete pre-review gate is intentionally absent because it would depend on the reviews evaluating it.\n');
  const output = path.join(root, outputRel);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${sections.join('\n')}\n`);
  return outputRel;
}

if (require.main === module) {
  try {
    const rootIndex = process.argv.indexOf('--root');
    const root = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : process.cwd());
    const outputIndex = process.argv.indexOf('--output');
    const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
    process.stdout.write(`${build(root, output)}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { FILES, PROMPT, build };
