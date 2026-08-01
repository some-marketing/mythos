'use strict';

const path = require('path');

const {
  loadFrameworkOrchestration,
  loadFrameworkManifest,
  orchestrationEdgeIndex,
  orchestrationNodeIndex,
  resolveFrameworkPrompt
} = require('./framework-methodology');
const {
  validateMethodologyRecords
} = require('./similarity-methodology');

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const ENFORCED_CONTRACT_ID = 'FrameworkMethodologyRouting/1.0';

function formatStepPath(index, suffix = '') {
  return `/bounded_plan/steps/${index}${suffix}`;
}

function pushIssue(target, pathValue, message) {
  target.push({ path: pathValue, message });
}

function getMethodologyRouting(plan) {
  return plan && typeof plan.methodology_routing === 'object'
    ? plan.methodology_routing
    : null;
}

function getDecisionTree(plan) {
  return plan && typeof plan.decision_tree === 'object'
    ? plan.decision_tree
    : null;
}

function validateFrameworkPromptRoute(step, index, projectRoot, errors, warnings) {
  const route = step.route || {};
  const frameworkId = String(route.framework_id || '').trim();
  const phaseId = String(route.phase_id || '').trim();
  const promptId = String(route.prompt_id || '').trim();
  const modeSource = String(route.mode_source || '').trim();

  if (route.kind !== 'framework_prompt') {
    pushIssue(errors, formatStepPath(index, '/route/kind'), 'Covered steps must use route.kind="framework_prompt" under FrameworkMethodologyRouting/1.0.');
    return;
  }

  if (!frameworkId) {
    pushIssue(errors, formatStepPath(index, '/route/framework_id'), 'Covered framework_prompt steps must declare route.framework_id.');
  }
  if (!phaseId) {
    pushIssue(errors, formatStepPath(index, '/route/phase_id'), 'Covered framework_prompt steps must declare route.phase_id.');
  }
  if (!promptId) {
    pushIssue(errors, formatStepPath(index, '/route/prompt_id'), 'Covered framework_prompt steps must declare route.prompt_id.');
  }
  if (modeSource !== 'prompt_header') {
    pushIssue(errors, formatStepPath(index, '/route/mode_source'), 'Covered framework_prompt steps must inherit mode from the prompt header (route.mode_source="prompt_header").');
  }
  if (!frameworkId || !phaseId || !promptId) return;

  const framework = loadFrameworkManifest(projectRoot, frameworkId);
  if (!framework.manifest) {
    pushIssue(errors, formatStepPath(index, '/route/framework_id'), `Framework manifest could not be loaded for "${frameworkId}".`);
    return;
  }

  if (framework.manifest._quarantine_note) {
    pushIssue(errors, formatStepPath(index, '/route/framework_id'), `Framework "${frameworkId}" is quarantined and cannot be treated as covered methodology: ${framework.manifest._quarantine_note}`);
  }

  const prompt = resolveFrameworkPrompt(projectRoot, frameworkId, promptId);
  if (!prompt.promptExists) {
    pushIssue(errors, formatStepPath(index, '/route/prompt_id'), `Prompt "${promptId}" does not exist for framework "${frameworkId}".`);
    return;
  }

  if (!prompt.phaseIds.includes(phaseId)) {
    pushIssue(
      errors,
      formatStepPath(index, '/route/phase_id'),
      `Prompt "${promptId}" is not declared in phase "${phaseId}" for framework "${frameworkId}". Declared phases: ${prompt.phaseIds.join(', ') || '(none)'}.`
    );
  }

  if (!prompt.metadata.mode) {
    pushIssue(errors, formatStepPath(index, '/route/prompt_id'), `Prompt "${promptId}" does not declare an explicit mode in its prompt file.`);
  } else if (step.mode !== prompt.metadata.mode) {
    pushIssue(
      errors,
      formatStepPath(index, '/mode'),
      `Step mode "${step.mode}" does not match prompt "${promptId}" mode "${prompt.metadata.mode}".`
    );
  }

  if (step.framework_step && !String(step.framework_step).includes(promptId)) {
    pushIssue(
      warnings,
      formatStepPath(index, '/framework_step'),
      `Legacy framework_step "${step.framework_step}" does not name prompt "${promptId}".`
    );
  }
}

function validateGapRoute(step, index, errors) {
  const route = step.route || {};
  if (route.kind === 'framework_prompt') {
    pushIssue(errors, formatStepPath(index, '/route/kind'), 'Gap steps must not claim route.kind="framework_prompt". Keep aspirational or unsupported framework references in route.route_reason instead.');
  }
}

function collectFrameworkPromptSteps(steps) {
  const items = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i] || {};
    const route = step.route || {};
    if (step.is_gap === true || route.kind !== 'framework_prompt') continue;
    items.push({
      index: i,
      frameworkId: String(route.framework_id || '').trim(),
      phaseId: String(route.phase_id || '').trim(),
      promptId: String(route.prompt_id || '').trim()
    });
  }
  return items;
}

function validateDecisionTree(plan, steps, projectRoot, errors, warnings) {
  const decisionTree = getDecisionTree(plan);
  const frameworkSteps = collectFrameworkPromptSteps(steps);
  const frameworksWithOrchestration = new Set();

  for (const step of frameworkSteps) {
    const framework = loadFrameworkManifest(projectRoot, step.frameworkId);
    if (framework.manifest && framework.manifest.orchestration_v1) {
      frameworksWithOrchestration.add(step.frameworkId);
    }
  }

  if (frameworksWithOrchestration.size === 0) {
    return;
  }

  if (!decisionTree) {
    pushIssue(
      errors,
      '/decision_tree',
      `Enforced methodology routing requires decision_tree when covered steps target framework orchestration: ${Array.from(frameworksWithOrchestration).join(', ')}.`
    );
    return;
  }

  const basedOnFramework = String(decisionTree.based_on_framework || '').trim();
  const orchestrationKey = String(decisionTree.based_on_orchestration || '').trim();

  if (!basedOnFramework) {
    pushIssue(errors, '/decision_tree/based_on_framework', 'decision_tree.based_on_framework is required.');
    return;
  }

  if (!frameworksWithOrchestration.has(basedOnFramework)) {
    pushIssue(
      errors,
      '/decision_tree/based_on_framework',
      `decision_tree.based_on_framework "${basedOnFramework}" does not match any covered framework with orchestration metadata. Covered frameworks: ${Array.from(frameworksWithOrchestration).join(', ')}.`
    );
  }

  if (!orchestrationKey) {
    pushIssue(errors, '/decision_tree/based_on_orchestration', 'decision_tree.based_on_orchestration is required.');
    return;
  }

  const framework = loadFrameworkOrchestration(projectRoot, basedOnFramework, orchestrationKey);
  if (!framework.manifest) {
    pushIssue(errors, '/decision_tree/based_on_framework', `Framework manifest could not be loaded for "${basedOnFramework}".`);
    return;
  }
  if (!framework.orchestration) {
    pushIssue(errors, '/decision_tree/based_on_orchestration', `Framework "${basedOnFramework}" does not expose "${orchestrationKey}".`);
    return;
  }

  const nodeIndex = orchestrationNodeIndex(framework.orchestration);
  const edgeIndex = orchestrationEdgeIndex(framework.orchestration);
  const activeNodes = Array.isArray(decisionTree.active_nodes) ? decisionTree.active_nodes.map((value) => String(value)) : [];
  const activeNodeSet = new Set(activeNodes);
  const terminalNodes = Array.isArray(decisionTree.terminal_nodes) ? decisionTree.terminal_nodes.map((value) => String(value)) : [];
  const terminalSet = new Set(terminalNodes);
  const entryNode = String(decisionTree.entry_node || '').trim();
  const nodeBindings = Array.isArray(decisionTree.node_bindings) ? decisionTree.node_bindings : [];
  const branchConditions = Array.isArray(decisionTree.branch_conditions) ? decisionTree.branch_conditions : [];

  if (!entryNode) {
    pushIssue(errors, '/decision_tree/entry_node', 'decision_tree.entry_node is required.');
  } else if (!nodeIndex.has(entryNode)) {
    pushIssue(errors, '/decision_tree/entry_node', `decision_tree.entry_node "${entryNode}" is not declared in framework orchestration.`);
  } else if (!activeNodeSet.has(entryNode)) {
    pushIssue(errors, '/decision_tree/entry_node', `decision_tree.entry_node "${entryNode}" must be included in decision_tree.active_nodes.`);
  }

  for (const nodeId of activeNodes) {
    if (!nodeIndex.has(nodeId)) {
      pushIssue(errors, '/decision_tree/active_nodes', `decision_tree.active_nodes includes unknown node "${nodeId}".`);
    }
  }

  for (const nodeId of terminalNodes) {
    if (!nodeIndex.has(nodeId)) {
      pushIssue(errors, '/decision_tree/terminal_nodes', `decision_tree.terminal_nodes includes unknown node "${nodeId}".`);
    } else if (!activeNodeSet.has(nodeId)) {
      pushIssue(errors, '/decision_tree/terminal_nodes', `decision_tree.terminal_nodes includes "${nodeId}" which is not active in this bounded tree.`);
    }
  }

  for (let i = 0; i < nodeBindings.length; i += 1) {
    const binding = nodeBindings[i] || {};
    const nodeId = String(binding.node_id || '').trim();
    if (!nodeId) {
      pushIssue(errors, `/decision_tree/node_bindings/${i}/node_id`, 'decision_tree.node_bindings entries must declare node_id.');
      continue;
    }
    if (!activeNodeSet.has(nodeId)) {
      pushIssue(errors, `/decision_tree/node_bindings/${i}/node_id`, `decision_tree.node_bindings targets inactive node "${nodeId}".`);
    }
  }

  for (let i = 0; i < branchConditions.length; i += 1) {
    const branch = branchConditions[i] || {};
    const from = String(branch.from || '').trim();
    const outcome = String(branch.canonical_outcome || '').trim();
    const to = String(branch.to || '').trim();
    const edgeKey = `${from}::${outcome}::${to}`;

    if (!activeNodeSet.has(from)) {
      pushIssue(errors, `/decision_tree/branch_conditions/${i}/from`, `Branch source "${from}" is not active in this bounded tree.`);
    }
    if (!activeNodeSet.has(to)) {
      pushIssue(errors, `/decision_tree/branch_conditions/${i}/to`, `Branch destination "${to}" is not active in this bounded tree.`);
    }
    if (!edgeIndex.has(edgeKey)) {
      pushIssue(
        errors,
        `/decision_tree/branch_conditions/${i}`,
        `Branch "${edgeKey}" is not declared in framework orchestration "${basedOnFramework}.${orchestrationKey}".`
      );
    }
  }

  const activeFrameworkNodes = new Map();
  for (const nodeId of activeNodeSet) {
    const node = nodeIndex.get(nodeId);
    if (!node || node.kind !== 'framework_prompt') continue;
    activeFrameworkNodes.set(`${basedOnFramework}::${node.phase_id}::${node.prompt_id}`, { nodeId, node });
  }

  for (const [key, descriptor] of activeFrameworkNodes.entries()) {
    const hasStep = frameworkSteps.some((step) => `${step.frameworkId}::${step.phaseId}::${step.promptId}` === key);
    if (!hasStep) {
      pushIssue(
        errors,
        '/decision_tree/active_nodes',
        `Active node "${descriptor.nodeId}" (${descriptor.node.prompt_id}) has no matching bounded_plan framework_prompt step.`
      );
    }
  }

  for (const step of frameworkSteps) {
    if (step.frameworkId !== basedOnFramework) continue;
    const key = `${step.frameworkId}::${step.phaseId}::${step.promptId}`;
    if (!activeFrameworkNodes.has(key)) {
      pushIssue(
        warnings,
        formatStepPath(step.index, '/route/prompt_id'),
        `Step routes to "${step.promptId}" but that prompt is not active in decision_tree.active_nodes.`
      );
    }
  }

  if (!terminalSet.size) {
    pushIssue(errors, '/decision_tree/terminal_nodes', 'decision_tree.terminal_nodes must declare at least one terminal node.');
  }
}

// Phrases that indicate a named verification was deferred, skipped, or left undone.
// If these co-occur with a high-confidence trust tier or a confirmed validation field,
// the plan is making a load-bearing claim from unfinished evidence and should be flagged.
// Origin: IMP-2026-04-13-02 from run-debrief__2026-04-13__{CLIENT_CODE}-gtm-staging-form-flow-validation.
const UNVERIFIED_PHRASE_PATTERNS = [
  /\bdid not run\b/i,
  /\bhave not run\b/i,
  /\bnot yet run\b/i,
  /\bnot been run\b/i,
  /\bnot yet verified\b/i,
  /\bnot yet confirmed\b/i,
  /\bhave not verified\b/i,
  /\bhave not confirmed\b/i,
  /\bhaven['\u2019]t verified\b/i,
  /\bhaven['\u2019]t confirmed\b/i,
  /\bwithout running\b/i,
  /\bcontrol not yet run\b/i,
  /\bunverified\b/i,
  /\bunconfirmed\b/i,
  /\bto be verified\b/i,
  /\bto be confirmed\b/i
];

const HIGH_CONFIDENCE_TRUST_TIERS = new Set(['hardened', 'confirmed']);
const HIGH_CONFIDENCE_VALIDATION = new Set(['confirmed']);

function collectStrings(value, accumulator, pathStack) {
  if (value == null) return;
  if (typeof value === 'string') {
    if (value.length > 0) {
      accumulator.push({ path: pathStack.join('/'), value });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      pathStack.push(String(i));
      collectStrings(value[i], accumulator, pathStack);
      pathStack.pop();
    }
    return;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      pathStack.push(key);
      collectStrings(value[key], accumulator, pathStack);
      pathStack.pop();
    }
  }
}

function validateVerificationConsistency(plan, errors, warnings) {
  if (!plan || typeof plan !== 'object') return;

  const trustTier = plan.similarity_assessment
    && typeof plan.similarity_assessment.trust_tier === 'string'
    ? plan.similarity_assessment.trust_tier.trim().toLowerCase()
    : '';
  const validationConfidence = typeof plan.validation_confidence === 'string'
    ? plan.validation_confidence.trim().toLowerCase()
    : '';

  const highConfidence = HIGH_CONFIDENCE_TRUST_TIERS.has(trustTier)
    || HIGH_CONFIDENCE_VALIDATION.has(validationConfidence);

  if (!highConfidence) return;

  const strings = [];
  collectStrings(plan, strings, ['']);

  const hits = [];
  for (const entry of strings) {
    for (const pattern of UNVERIFIED_PHRASE_PATTERNS) {
      if (pattern.test(entry.value)) {
        hits.push({ path: entry.path, pattern: String(pattern), excerpt: entry.value.slice(0, 140) });
        break;
      }
    }
    if (hits.length >= 3) break;
  }

  if (hits.length === 0) return;

  const tierLabel = trustTier
    ? `similarity_assessment.trust_tier="${trustTier}"`
    : `validation_confidence="${validationConfidence}"`;

  for (const hit of hits) {
    pushIssue(
      warnings,
      hit.path || '/',
      `Plan declares high confidence (${tierLabel}) while a field contains an unverified-check phrase: "${hit.excerpt}". Run the referenced verification before claiming high confidence, or explicitly waive it with a reason. (IMP-2026-04-13-02 verify-before-classify guard.)`
    );
  }
}

function collectMethodologyStepIds(plan) {
  const steps = plan
    && plan.bounded_plan
    && Array.isArray(plan.bounded_plan.steps)
    ? plan.bounded_plan.steps
    : [];
  const result = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i] || {};
    const recordId = typeof step.methodology_record_id === 'string'
      ? step.methodology_record_id.trim()
      : '';
    if (recordId) {
      result.push({
        index: i,
        recordId,
        isGap: step.is_gap === true,
        routeKind: step.route && typeof step.route === 'object' ? String(step.route.kind || '').trim() : ''
      });
    }
  }
  return result;
}

function canonicalTagSet(record) {
  const result = new Set();
  const tags = record && record.similarity_tags && typeof record.similarity_tags === 'object'
    ? record.similarity_tags
    : {};
  for (const [axis, values] of Object.entries(tags)) {
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      result.add(`${axis}:${String(value)}`);
    }
  }
  return result;
}

function canonicalSourcePathSet(record) {
  return new Set(
    (Array.isArray(record.source_refs) ? record.source_refs : [])
      .map((ref) => ref && typeof ref === 'object' ? String(ref.path || '').trim() : '')
      .filter(Boolean)
  );
}

function validateSimilarityMetadata(plan, projectRoot, errors, warnings) {
  const similarity = plan && plan.similarity_assessment && typeof plan.similarity_assessment === 'object'
    ? plan.similarity_assessment
    : null;
  const methodologyMatches = similarity && Array.isArray(similarity.methodology_matches)
    ? similarity.methodology_matches
    : [];
  const stepMethodologyIds = collectMethodologyStepIds(plan);

  if (methodologyMatches.length === 0 && stepMethodologyIds.length === 0) return;

  const registry = validateMethodologyRecords(projectRoot);
  if (!registry.ok) {
    for (const error of registry.errors) {
      pushIssue(errors, `/methodology_registry${error.path || ''}`, error.message);
    }
    return;
  }

  const recordMap = new Map(registry.records.map((record) => [String(record.id || '').trim(), record]));
  const recordIds = new Set(recordMap.keys());
  const matchedIds = new Set();

  for (let i = 0; i < methodologyMatches.length; i += 1) {
    const match = methodologyMatches[i] || {};
    const recordId = String(match.record_id || '').trim();
    if (!recordId) continue;
    matchedIds.add(recordId);
    if (!recordIds.has(recordId)) {
      pushIssue(
        warnings,
        `/similarity_assessment/methodology_matches/${i}/record_id`,
        `Methodology match references unknown record "${recordId}". Advisory similarity is ignored until the registry contains that record.`
      );
      continue;
    }

    const canonical = recordMap.get(recordId);
    const copiedLifecycle = String(match.lifecycle_state || '').trim();
    const canonicalLifecycle = String(canonical.lifecycle_state || '').trim();
    if (copiedLifecycle && canonicalLifecycle && copiedLifecycle !== canonicalLifecycle) {
      pushIssue(
        errors,
        `/similarity_assessment/methodology_matches/${i}/lifecycle_state`,
        `Methodology match "${recordId}" cannot override canonical lifecycle_state "${canonicalLifecycle}" with "${copiedLifecycle}". Promotion requires updating the methodology registry.`
      );
    }

    const canonicalTags = canonicalTagSet(canonical);
    const matchedTags = match.matched_tags && typeof match.matched_tags === 'object' ? match.matched_tags : {};
    for (const [axis, values] of Object.entries(matchedTags)) {
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        const tagKey = `${axis}:${String(value)}`;
        if (!canonicalTags.has(tagKey)) {
          pushIssue(
            warnings,
            `/similarity_assessment/methodology_matches/${i}/matched_tags/${axis}`,
            `Methodology match "${recordId}" includes tag "${tagKey}" that is not declared on the canonical record.`
          );
        }
      }
    }

    const canonicalSources = canonicalSourcePathSet(canonical);
    const copiedSources = Array.isArray(match.source_refs) ? match.source_refs : [];
    for (let j = 0; j < copiedSources.length; j += 1) {
      const relPath = copiedSources[j] && typeof copiedSources[j] === 'object'
        ? String(copiedSources[j].path || '').trim()
        : '';
      if (relPath && !canonicalSources.has(relPath)) {
        pushIssue(
          warnings,
          `/similarity_assessment/methodology_matches/${i}/source_refs/${j}/path`,
          `Methodology match "${recordId}" cites source_ref "${relPath}" that is not declared on the canonical record.`
        );
      }
    }
  }

  for (const stepRef of stepMethodologyIds) {
    const recordId = stepRef.recordId;
    if (!stepRef.isGap && stepRef.routeKind !== 'framework_prompt') {
      pushIssue(
        errors,
        `/bounded_plan/steps/${stepRef.index}/methodology_record_id`,
        `Step references methodology record "${recordId}" while marked covered, but advisory methodology metadata cannot replace route.kind="framework_prompt". Mark the step as a gap or provide a real framework prompt route.`
      );
    }
    if (!recordIds.has(recordId)) {
      pushIssue(
        warnings,
        `/bounded_plan/steps/${stepRef.index}/methodology_record_id`,
        `Step references unknown methodology record "${recordId}". This is advisory metadata, but the reference cannot be verified.`
      );
      continue;
    }
    if (methodologyMatches.length > 0 && !matchedIds.has(recordId)) {
      pushIssue(
        warnings,
        `/bounded_plan/steps/${stepRef.index}/methodology_record_id`,
        `Step references methodology record "${recordId}" that is not present in similarity_assessment.methodology_matches. Keep advisory reuse evidence and plan mapping aligned.`
      );
    }
  }

  const notes = similarity && Array.isArray(similarity.similarity_notes) ? similarity.similarity_notes : [];
  if (methodologyMatches.length > 0 && notes.length === 0) {
    pushIssue(
      warnings,
      '/similarity_assessment/similarity_notes',
      'Methodology matches are present without similarity_notes. Note why the matches are advisory and what still requires lived-context or operator review.'
    );
  }
}

function validateTaskPlan(plan, options = {}) {
  const projectRoot = options.projectRoot || DEFAULT_PROJECT_ROOT;
  const errors = [];
  const warnings = [];
  const methodologyRouting = getMethodologyRouting(plan);

  if (!methodologyRouting) {
    pushIssue(
      warnings,
      '/methodology_routing',
      'Legacy plan: no methodology_routing contract declared. Structured framework-prompt validation is skipped.'
    );
    // verify-before-classify guard runs regardless of methodology routing — it is orthogonal to structured framework-prompt validation.
    validateVerificationConsistency(plan, errors, warnings);
    validateSimilarityMetadata(plan, projectRoot, errors, warnings);
    return {
      ok: errors.length === 0,
      contract_id: null,
      enforcement: 'legacy-exempt',
      errors,
      warnings
    };
  }

  const contractId = String(methodologyRouting.contract_id || '').trim();
  const enforcement = String(methodologyRouting.enforcement || '').trim();

  if (contractId !== ENFORCED_CONTRACT_ID) {
    pushIssue(
      errors,
      '/methodology_routing/contract_id',
      `Unsupported methodology_routing contract "${contractId}". Expected "${ENFORCED_CONTRACT_ID}".`
    );
  }

  if (enforcement !== 'enforced' && enforcement !== 'legacy-exempt') {
    pushIssue(
      errors,
      '/methodology_routing/enforcement',
      'methodology_routing.enforcement must be "enforced" or "legacy-exempt".'
    );
  }

  if (enforcement !== 'enforced') {
    pushIssue(
      warnings,
      '/methodology_routing/enforcement',
      'Plan declares methodology_routing but is not enforced. Structured framework-prompt validation is skipped.'
    );
    validateVerificationConsistency(plan, errors, warnings);
    validateSimilarityMetadata(plan, projectRoot, errors, warnings);
    return {
      ok: errors.length === 0,
      contract_id: contractId || null,
      enforcement: enforcement || 'legacy-exempt',
      errors,
      warnings
    };
  }

  const steps = plan
    && plan.bounded_plan
    && Array.isArray(plan.bounded_plan.steps)
    ? plan.bounded_plan.steps
    : [];

  if (steps.length === 0) {
    pushIssue(errors, '/bounded_plan/steps', 'Enforced methodology routing requires at least one bounded_plan step.');
  }

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i] || {};
    if (!step.route || typeof step.route !== 'object') {
      pushIssue(
        errors,
        formatStepPath(i, '/route'),
        'Enforced methodology routing requires structured step.route metadata for every bounded_plan step.'
      );
      continue;
    }

    if (step.is_gap === true) {
      validateGapRoute(step, i, errors);
      continue;
    }

    validateFrameworkPromptRoute(step, i, projectRoot, errors, warnings);
  }

  validateDecisionTree(plan, steps, projectRoot, errors, warnings);
  validateVerificationConsistency(plan, errors, warnings);
  validateSimilarityMetadata(plan, projectRoot, errors, warnings);

  return {
    ok: errors.length === 0,
    contract_id: contractId || null,
    enforcement,
    errors,
    warnings
  };
}

module.exports = {
  ENFORCED_CONTRACT_ID,
  validateTaskPlan
};
