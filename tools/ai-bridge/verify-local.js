#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { verifyArtifact } = require('./lib/model-runtime');
const { validateVerificationResult } = require('./lib/verification-contract');
const { evaluateEscalation } = require('./lib/escalation-policy');

async function main() {
  const args = process.argv.slice(2);

  const modelIdx = args.indexOf('--model');
  const model = modelIdx !== -1 ? args.splice(modelIdx, 2)[1] : '';

  const taskIdx = args.indexOf('--task');
  const taskPrompt = taskIdx !== -1 ? args.splice(taskIdx, 2)[1] : undefined;

  const VALID_RISKS = ['low', 'medium', 'high'];
  const riskIdx = args.indexOf('--risk');
  const riskClass = riskIdx !== -1 ? args.splice(riskIdx, 2)[1] : 'low';

  if (!VALID_RISKS.includes(riskClass)) {
    console.error(`Invalid --risk value: "${riskClass}". Must be one of: ${VALID_RISKS.join(', ')}`);
    process.exit(1);
  }

  const filePath = args[0];
  if (!filePath) {
    console.error('Usage: verify-local <file> [--model MODEL] [--task PROMPT] [--risk low|medium|high]');
    process.exit(1);
  }

  let content;
  if (filePath === '-') {
    content = fs.readFileSync(0, 'utf-8');
  } else {
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    content = fs.readFileSync(filePath, 'utf-8');
  }

  const requestedModel = model
    ? (model.includes(':') && (model.startsWith('ollama:') || model.startsWith('openai-compatible:')) ? model : `ollama:${model}`)
    : '';

  const { result, raw, latency_ms, error, selection } = await verifyArtifact(content, {
    model: requestedModel,
    taskPrompt,
    anchorPath: filePath === '-' ? process.cwd() : filePath,
    lane_context: {
      workflow_type: 'verification',
      acceptance_grade: false,
      risk_tier: riskClass,
      local_eligible: true
    }
  });

  if (error || !result) {
    console.error(`Verification failed: ${error}`);
    if (selection && selection.reason) {
      console.error(`Selection: ${selection.reason}`);
    }
    if (raw) console.error(`Raw response: ${raw.slice(0, 500)}`);
    process.exit(1);
  }

  const validation = validateVerificationResult(result);
  if (!validation.valid) {
    console.error(`Invalid VerificationResult: ${validation.errors.join('; ')}`);
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const decision = evaluateEscalation(result, { risk_class: riskClass });
  const output = {
    verification_result: result,
    escalation_decision: {
      needs_escalation: decision.needs_escalation,
      local_acceptance: decision.local_acceptance,
      risk_class: decision.risk_class,
      reason: decision.reason
    },
    selection: selection || null,
    meta: {
      requested_model: requestedModel || null,
      resolved_model: selection ? selection.resolved_model_id : result.model_id || null,
      resolved_provider: selection ? selection.resolved_provider : result.provider || null,
      latency_ms,
      file: filePath === '-' ? 'stdin' : filePath
    }
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(decision.needs_escalation ? 2 : 0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
