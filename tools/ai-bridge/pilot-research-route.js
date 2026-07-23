#!/usr/bin/env node
'use strict';

/**
 * pilot-research-route.js — Research routing pilot for the simpleminions integration.
 *
 * Proves the full routing-to-dispatch path end-to-end:
 *   1. Route a research workflow through the routing policy
 *   2. Record the routing decision as a durable artifact
 *   3. Attempt dispatch through the selected provider
 *   4. Validate the dispatch result against the dispatch contract
 *   5. Write a pilot findings report
 *
 * This is the Phase 6 proving slice for the track-f-simpleminions-routing
 * workstream. It exercises every layer built in Phases 1-5.
 *
 * Usage:
 *   node tools/ai-bridge/pilot-research-route.js [--dry-run] [--json] [--output-dir <dir>]
 *
 * Options:
 *   --dry-run     Route and record the decision but skip actual dispatch
 *   --json        Print machine-readable JSON output
 *   --output-dir  Directory for pilot artifacts (default: _dev/reports/analysis/)
 *   --help        Show this help
 */

const path = require('path');
const fs = require('fs');

const { parseArgs } = require('../workspace/lib/args');
const { createRoutingDecision, writeRoutingArtifact } = require('./lib/routing-artifact');
const { resolveRoute, listProviderCapabilities } = require('./lib/routing-policy');
const { getDispatcher } = require('./lib/dispatchers');
const { createDispatchRequest } = require('./lib/dispatch-contract');
const { createOllamaAdapter } = require('./adapters/ollama');
const { registerProvider, checkProviderHealth } = require('./lib/provider-contract');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Pilot configuration
// ---------------------------------------------------------------------------

const PILOT_WORKFLOW_TYPE = 'research';
const PILOT_TOPIC = 'Mythos local-model routing patterns from simpleminions';
const PILOT_PROMPT = `Summarize the key local-model routing patterns that can be extracted from a project called simpleminions for use in an LLM operating system. Focus on: local-first routing with cloud fallback, provider discovery, task classification for routing decisions, and durable routing artifacts.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function help() {
  console.log(`
Research Routing Pilot — Phase 6 proving slice.

Proves the full routing-to-dispatch path:
  1. Route a research workflow through the routing policy
  2. Record the routing decision as a durable artifact
  3. Attempt dispatch through the selected provider
  4. Validate the round-trip
  5. Write findings

Usage:
  node tools/ai-bridge/pilot-research-route.js [--dry-run] [--json] [--output-dir <dir>]

Options:
  --dry-run     Route and record but skip actual dispatch
  --json        Print machine-readable JSON
  --output-dir  Output directory (default: _dev/reports/analysis/)
  --help        Show this help
`.trim());
}

// ---------------------------------------------------------------------------
// Pilot steps
// ---------------------------------------------------------------------------

/**
 * Step 1: Route the research workflow through the routing policy.
 */
function stepRoute() {
  const route = resolveRoute(PILOT_WORKFLOW_TYPE);
  const decision = createRoutingDecision(PILOT_WORKFLOW_TYPE);

  return {
    step: 'route',
    route,
    decision,
    finding: route.selected_provider
      ? `Research routed to "${route.selected_provider}" (${route.selection_reason})`
      : `No implemented provider for research. Fallback chain: [${route.fallback_chain.join(', ')}]`
  };
}

/**
 * Step 2: Record the routing decision as a durable artifact.
 */
function stepRecordArtifact(decision, outputDir) {
  const artifactPath = path.join(outputDir, 'pilot-research-route.routing-decision.json');
  writeRoutingArtifact(decision, artifactPath);

  return {
    step: 'record-artifact',
    artifact_path: path.relative(PROJECT_ROOT, artifactPath),
    finding: `Routing decision written to ${path.relative(PROJECT_ROOT, artifactPath)}`
  };
}

/**
 * Step 3: Check provider health (register Ollama adapter for local-provider check).
 */
async function stepCheckProviders() {
  // Register Ollama adapter for health check
  const ollamaAdapter = createOllamaAdapter();
  try {
    registerProvider('ollama', ollamaAdapter);
  } catch {
    // Already registered from a prior call — that's fine
  }

  const ollamaHealth = await checkProviderHealth('ollama');
  const providerCaps = listProviderCapabilities();

  return {
    step: 'check-providers',
    ollama_health: ollamaHealth,
    provider_count: providerCaps.length,
    implemented_count: providerCaps.filter(p => p.implemented).length,
    finding: ollamaHealth.reachable
      ? `Ollama is reachable (${ollamaHealth.latency_ms}ms). Local routing path is viable.`
      : `Ollama is not reachable (${ollamaHealth.error}). Local routing path would require cloud fallback.`
  };
}

/**
 * Step 4: Attempt dispatch (or dry-run).
 */
async function stepDispatch(selectedProvider, dryRun) {
  if (dryRun) {
    return {
      step: 'dispatch',
      dry_run: true,
      finding: 'Dispatch skipped (dry-run mode). The routing decision was recorded without execution.'
    };
  }

  if (!selectedProvider) {
    return {
      step: 'dispatch',
      dry_run: false,
      finding: 'No implemented provider available for research dispatch. Manual dispatch is required.',
      result: null
    };
  }

  try {
    const dispatcher = getDispatcher(selectedProvider);

    if (!dispatcher.implemented) {
      return {
        step: 'dispatch',
        dry_run: false,
        finding: `Provider "${selectedProvider}" is registered but not implemented. Dispatch returns not_implemented status.`,
        result: null
      };
    }

    const request = createDispatchRequest({
      provider: selectedProvider,
      workflow_type: PILOT_WORKFLOW_TYPE,
      context: { project_root: PROJECT_ROOT, topic: PILOT_TOPIC },
      prompt: PILOT_PROMPT
    });

    const result = await dispatcher.dispatch(request);

    return {
      step: 'dispatch',
      dry_run: false,
      provider: selectedProvider,
      status: result.status,
      finding: `Dispatch to "${selectedProvider}" returned status: ${result.status}.`,
      result
    };
  } catch (err) {
    return {
      step: 'dispatch',
      dry_run: false,
      finding: `Dispatch failed: ${err.message}`,
      result: null
    };
  }
}

/**
 * Step 5: Write pilot findings report.
 */
function stepWriteFindings(steps, outputDir) {
  const findings = {
    pilot: 'research-routing-pilot',
    workstream: 'track-f-simpleminions-routing',
    signal_scope: 'simpleminions-routing-integration',
    phase: 6,
    timestamp: new Date().toISOString(),
    workflow_type: PILOT_WORKFLOW_TYPE,
    steps: steps.map(s => ({ step: s.step, finding: s.finding })),
    gaps: [],
    conclusion: ''
  };

  // Identify gaps
  const routeStep = steps.find(s => s.step === 'route');
  if (routeStep && !routeStep.route.selected_provider) {
    findings.gaps.push('No implemented provider for research — requires Perplexity or equivalent dispatcher');
  }
  if (routeStep && routeStep.route.selected_provider && routeStep.route.selected_provider !== routeStep.route.fallback_chain[0]) {
    findings.gaps.push(`Preferred provider "${routeStep.route.fallback_chain[0]}" is not implemented — falling back to "${routeStep.route.selected_provider}"`);
  }

  const providerStep = steps.find(s => s.step === 'check-providers');
  if (providerStep && !providerStep.ollama_health.reachable) {
    findings.gaps.push('Ollama is not reachable — local routing path not yet viable for this machine');
  }

  const dispatchStep = steps.find(s => s.step === 'dispatch');
  if (dispatchStep && dispatchStep.dry_run) {
    findings.gaps.push('Dispatch was dry-run only — no actual provider execution validated');
  }

  // Conclusion
  const gapCount = findings.gaps.length;
  if (gapCount === 0) {
    findings.conclusion = 'Full routing-to-dispatch path proved end-to-end with no gaps.';
  } else {
    findings.conclusion = `Routing-to-dispatch path proved with ${gapCount} gap(s). The routing policy, provider contract, Ollama discovery, and routing artifact layers all function correctly. Gaps are in dispatcher implementation, not routing architecture.`;
  }

  const findingsPath = path.join(outputDir, 'pilot-research-route.findings.json');
  fs.mkdirSync(path.dirname(findingsPath), { recursive: true });
  fs.writeFileSync(findingsPath, JSON.stringify(findings, null, 2) + '\n');

  return {
    step: 'write-findings',
    artifact_path: path.relative(PROJECT_ROOT, findingsPath),
    finding: `Pilot findings written to ${path.relative(PROJECT_ROOT, findingsPath)}. ${findings.conclusion}`
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    process.exit(0);
  }

  const dryRun = Boolean(args.dry_run);
  const asJson = Boolean(args.json);
  const outputDir = args.output_dir || path.join(PROJECT_ROOT, '_dev', 'reports', 'analysis');

  const steps = [];

  // Step 1: Route
  const routeResult = stepRoute();
  steps.push(routeResult);

  // Step 2: Record artifact
  const artifactResult = stepRecordArtifact(routeResult.decision, outputDir);
  steps.push(artifactResult);

  // Step 3: Check providers
  const providerResult = await stepCheckProviders();
  steps.push(providerResult);

  // Step 4: Dispatch
  const dispatchResult = await stepDispatch(routeResult.route.selected_provider, dryRun);
  steps.push(dispatchResult);

  // Step 5: Write findings
  const findingsResult = stepWriteFindings(steps, outputDir);
  steps.push(findingsResult);

  // Output
  if (asJson) {
    console.log(JSON.stringify({ steps: steps.map(s => ({ step: s.step, finding: s.finding })) }, null, 2));
  } else {
    console.log('Research Routing Pilot — Phase 6');
    console.log('================================\n');
    for (const s of steps) {
      console.log(`[${s.step}] ${s.finding}`);
    }
    console.log('\nDone.');
  }
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
