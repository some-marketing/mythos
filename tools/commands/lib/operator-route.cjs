'use strict';

const { loadCanonicalCommand } = require('./command-registry.cjs');
const { resolveCommandAlias } = require('./command-aliases.cjs');

const RULES = Object.freeze([
  {
    id: 'run-framework',
    patterns: [/\brun\s+(the\s+)?framework\b/i, /\bexecute\s+(the\s+)?framework\b/i, /\bframework\s+run\b/i],
    command: '/run-framework <service/framework> <project>',
    target: 'run-framework',
    reason: 'direct framework execution should stay on the native run-framework surface.'
  },
  {
    id: 'capture-task',
    patterns: [/\bcapture\s+(this|the)\s+(task|work|run)\b/i, /\bimport\s+successful\s+work\b/i],
    command: '/capture-task <successful-work-scope>',
    target: 'capture-task',
    reason: 'successful work must be captured before it can become framework substrate.'
  },
  {
    id: 'scaffold-framework',
    patterns: [/\bscaffold\s+(a\s+)?framework\b/i, /\bcreate\s+(a\s+)?framework\s+candidate\b/i, /\bframework\s+scaffold\b/i],
    command: '/scaffold-framework <capture-id>',
    target: 'scaffold-framework',
    reason: 'framework candidates should be created through the native scaffold-framework surface.'
  },
  {
    id: 'replay-framework',
    patterns: [/\breplay\s+(the\s+)?framework\b/i, /\breplay-readiness\b/i, /\bframework\s+replay\b/i],
    command: '/replay-framework <service/framework>',
    target: 'replay-framework',
    reason: 'framework replay checks should use the native replay-framework surface.'
  },
  {
    id: 'promote-framework',
    patterns: [/\bpromote\s+(the\s+)?framework\b/i, /\bpromote\s+.+\bframework\b/i, /\bframework\s+promote\b/i],
    command: '/promote-framework <service/framework>',
    target: 'promote-framework',
    reason: 'framework promotion should use the native promote-framework gate.'
  },
  {
    id: 'improve-framework',
    patterns: [/\bimprove\s+(the\s+)?framework\b/i, /\bframework\s+improve\b/i],
    command: '/improve-framework <service/framework>',
    target: 'improve-framework',
    reason: 'framework improvement work should consume native improve-plan items.'
  },
  {
    id: 'generate-harness',
    patterns: [/\bgenerate\s+(the\s+)?harness\b/i, /\bharness\s+(for|from)\s+(the\s+)?framework\b/i, /\bframework\s+harness\b/i],
    command: '/generate-harness <service/framework>',
    target: 'generate-harness',
    reason: 'framework harness generation should use the native generate-harness surface.'
  },
  {
    id: 'make-plan',
    patterns: [/\b(make|create|write|draft)\s+(a\s+)?plan\b/i, /\bplan\s+this\b/i],
    command: '/plan-task "<task summary>"',
    target: 'plan-task',
    reason: 'planning intent should enter the native task-plan lifecycle.'
  },
  {
    id: 'concept-init',
    patterns: [/\bcreate\s+(a\s+)?concept\s+bundle\b/i, /\bconcept\s+bundle\s+first\b/i],
    command: '/concept-init <concept-id> --bundle',
    target: 'concept-init',
    reason: 'concept architecture should start with the native concept-init bundle surface before task planning.'
  },
  {
    id: 'run-qa',
    patterns: [/\b(run|do)\s+(the\s+)?qa\b/i, /\btest\s+(the\s+)?fix(es)?\b/i],
    command: '/fw-wordpress-qa',
    target: 'fw-wordpress-qa',
    reason: 'WordPress QA work should use the registered QA framework command when no narrower plan is supplied.'
  },
  {
    id: 'run-plan',
    patterns: [/\b(run|execute|ship)\s+(this|the)?\s*(plan|task|workstream)?\b/i, /\bship\s+this\b/i, /\bproceed\s+with\s+(the\s+)?recommendation\b/i],
    command: '/run-plan <task-id>',
    target: 'run-plan',
    reason: 'execution should route through the approved task-plan gate.'
  },
  {
    id: 'framework-lifecycle',
    patterns: [/\b(turn|make|convert)\s+.+\bframework\b/i, /\bframework\s+(candidate|lifecycle|promote|scaffold)\b/i, /\bmake\s+.+\breusable\b/i],
    command: '/capture-task <successful-work-scope>',
    target: 'capture-task',
    reason: 'broad framework-lifecycle intent starts with capture unless the operator names a specific lifecycle command.'
  },
  {
    id: 'remember',
    patterns: [/\bremember\s+this\b/i, /\bsave\s+this\s+to\s+memory\b/i],
    command: '/remember',
    target: 'remember',
    reason: 'memory intent must route through the canonical memory writer surface.'
  },
  {
    id: 'closeout-mirror',
    patterns: [/\b(save|close|mirror).+\bsession\b/i, /\bclose\s+this\s+out\b/i, /\bshutdown\b/i, /\bmirror\b.+\b(vps|private|remote)\b/i],
    command: '/shutdown --system',
    target: 'shutdown',
    reason: 'session closeout and mirroring should reuse shutdown/private-remote sync invariants.'
  },
  {
    id: 'what-next',
    patterns: [/\bwhat'?s next\b/i, /\bwhat\s+next\b/i, /\bwhat should i do next\b/i],
    command: '/whats-next',
    target: 'whats-next',
    reason: 'daily/current-state routing belongs to the native whats-next surface.'
  },
  {
    id: 'review-task-plan',
    patterns: [/\breview\s+this\s+first\b/i, /\breview\s+(the\s+)?plan\s+first\b/i],
    command: '/review-task-plan <task-id>',
    target: 'review-task-plan',
    reason: 'plan review should run through the native review-task-plan gate before execution.'
  }
]);

function hasNativeCommand(prompt, projectRoot) {
  const p = String(prompt || '').trim();
  if (/^[/!][a-z0-9-]*/i.test(p)) return true;
  if (/(^|\s)\/[a-z][a-z0-9-]*/i.test(p)) return true;

  const first = (p.match(/^([a-z][a-z0-9-]*)\b/i) || [])[1];
  if (!first || !projectRoot) return false;
  const normalized = first.toLowerCase();
  const alias = resolveCommandAlias(projectRoot, normalized);
  if (alias.isAlias) return true;
  return normalized.includes('-') && Boolean(loadCanonicalCommand(projectRoot, normalized));
}

function validateTarget(projectRoot, target) {
  const commandId = String(target || '').replace(/^\//, '').trim().toLowerCase();
  if (!commandId) return { ok: false, reason: 'missing target' };
  const alias = resolveCommandAlias(projectRoot, commandId);
  const canonical = loadCanonicalCommand(projectRoot, alias.executionCommand || commandId);
  if (canonical) {
    return {
      ok: true,
      command_id: commandId,
      execution_command: alias.executionCommand || commandId,
      spec_path: canonical.specPath,
      alias: alias.isAlias
    };
  }
  return {
    ok: false,
    command_id: commandId,
    execution_command: alias.executionCommand || commandId,
    reason: 'target does not resolve to a canonical command'
  };
}

function routeIntent(projectRoot, prompt, opts = {}) {
  const text = String(prompt || '').trim();
  if (!text) {
    return { matched: false, reason: 'empty prompt', executed: false };
  }
  if (!opts.allowNative && hasNativeCommand(text, projectRoot)) {
    return { matched: false, reason: 'native command already present', executed: false };
  }

  for (const rule of RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(text))) continue;
    const validation = validateTarget(projectRoot, rule.target);
    return {
      matched: true,
      id: rule.id,
      command: rule.command,
      target: rule.target,
      reason: rule.reason,
      validation,
      executed: false
    };
  }

  return { matched: false, reason: 'no route rule matched', executed: false };
}

function formatRouteLine(route) {
  if (!route || !route.matched) return '';
  return `[route] Suggest ${route.command} — ${route.reason} Advisory only; no execution.`;
}

module.exports = {
  RULES,
  formatRouteLine,
  hasNativeCommand,
  routeIntent,
  validateTarget
};
