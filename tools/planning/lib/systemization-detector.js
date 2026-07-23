'use strict';

const crypto = require('crypto');

const SCHEMA_ID = 'SystemizationCandidate/1.0';

const CORRECTION_CUES = [
  /\bagain\b/i,
  /\balways\b/i,
  /\bbut\b/i,
  /\bchange\b/i,
  /\bdo not\b/i,
  /\bdon't\b/i,
  /\bfix\b/i,
  /\binstead\b/i,
  /\bkeep\b/i,
  /\bmake sure\b/i,
  /\bmust\b/i,
  /\bnot that\b/i,
  /\bonly\b/i,
  /\bplease\b/i,
  /\bprefer\b/i,
  /\brewrite\b/i,
  /\bstill\b/i,
  /\bthis needs\b/i,
  /\buse\b/i
];

const TOPIC_GROUPS = [
  {
    layer: 'command',
    primitive: 'managed_command',
    keywords: [
      'command',
      'cli',
      'args',
      'flag',
      'flags',
      'handler',
      'managed',
      'route',
      'execute',
      'run',
      '/concept-init',
      '/plan-task',
      'json output'
    ]
  },
  {
    layer: 'prompt',
    primitive: 'prompt_pack',
    keywords: [
      'prompt',
      'wording',
      'tone',
      'copy',
      'response',
      'language',
      'draft',
      'text'
    ]
  },
  {
    layer: 'framework',
    primitive: 'workflow',
    keywords: [
      'workflow',
      'plan',
      'task',
      'framework',
      'step',
      'steps',
      'gate',
      'concept-init',
      'plan-task',
      'process'
    ]
  },
  {
    layer: 'policy',
    primitive: 'guardrail',
    keywords: [
      'policy',
      'guardrail',
      'authority',
      'advisory',
      'review',
      'safety',
      'must not',
      'never',
      'blocked'
    ]
  },
  {
    layer: 'schema',
    primitive: 'schema_patch',
    keywords: [
      'schema',
      'field',
      'json',
      'validation',
      'contract',
      'shape',
      'required'
    ]
  }
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^[>*\-\s]+/, '')
    .replace(/^(operator|human|user|reviewer|assistant)\s*:\s*/i, '')
    .replace(/[^a-z0-9/._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripActorPrefix(value) {
  return String(value || '')
    .replace(/^(operator|human|user|reviewer|assistant)\s*:\s*/i, '')
    .trim();
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^(operator|human|user|reviewer|assistant)\s*:\s*/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80) || 'systemization-candidate';
}

function shortExcerpt(value, maxLength) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

function splitIntoLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function countWords(text) {
  const normalized = normalizeText(text);
  if (!normalized) return 0;
  return normalized.split(' ').filter(Boolean).length;
}

function detectTopicScores(text) {
  const normalized = normalizeText(text);
  const scores = TOPIC_GROUPS.map((group) => {
    let score = 0;
    for (const keyword of group.keywords) {
      if (!keyword) continue;
      const needle = String(keyword).toLowerCase();
      if (needle.startsWith('/') && normalized.includes(needle)) {
        score += 3;
      } else if (normalized.includes(needle)) {
        score += 1;
      }
    }
    return { layer: group.layer, primitive: group.primitive, score };
  });

  scores.sort((left, right) => right.score - left.score);
  return scores;
}

function chooseLayer(text) {
  const scores = detectTopicScores(text);
  const best = scores[0] || { layer: 'framework', primitive: 'workflow', score: 0 };
  return {
    recommended_layer: best.score > 0 ? best.layer : 'framework',
    proposed_primitive: best.score > 0 ? best.primitive : 'workflow'
  };
}

function detectCueKind(text) {
  const normalized = normalizeText(text);
  const matchesCorrection = CORRECTION_CUES.some((regex) => regex.test(normalized));
  if (matchesCorrection) return 'operator-correction';

  const taskTerms = [
    'workflow',
    'plan',
    'task',
    'framework',
    'step',
    'steps',
    'route',
    'concept-init',
    'plan-task',
    'repeat',
    'reusable',
    'build',
    'create',
    'need'
  ];
  if (taskTerms.some((term) => normalized.includes(term))) return 'task-description';

  return '';
}

function buildCandidateSlug(text, triggers) {
  const source = triggers && triggers.length > 0
    ? triggers[0].excerpt
    : text;
  return slugify(source);
}

function buildCandidateId(text, triggers, layer) {
  const hash = crypto.createHash('sha256')
    .update(String(text || ''))
    .update('\n')
    .update(JSON.stringify(triggers || []))
    .update('\n')
    .update(String(layer || 'framework'))
    .digest('hex');
  return `syscand-${hash.slice(0, 12)}`;
}

function aggregateTriggers(lines) {
  const counts = new Map();
  for (const line of lines) {
    const normalized = normalizeText(line);
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }

  const triggerMap = new Map();
  for (const line of lines) {
    const normalized = normalizeText(line);
    if (!normalized) continue;

    const duplicateCount = counts.get(normalized) || 0;
    const cueKind = detectCueKind(line);
    const shouldRecord = cueKind || duplicateCount > 1;
    if (!shouldRecord) continue;

    const kind = cueKind || 'repeated-line';
    const topicScores = detectTopicScores(line);
    const bestTopic = topicScores.find((entry) => entry.score > 0) || topicScores[0] || {
      layer: 'framework',
      primitive: 'workflow'
    };
    const key = `${kind}::${normalized}`;
    const current = triggerMap.get(key) || {
      kind,
      topic: bestTopic.layer,
      excerpt: shortExcerpt(stripActorPrefix(line), 140),
      count: 0,
      confidence: 0
    };

    current.count = Math.max(current.count, duplicateCount > 1 ? duplicateCount : 1);
    current.confidence = Math.max(current.confidence, duplicateCount > 1 ? 0.75 : 0.5);
    triggerMap.set(key, current);
  }

  return Array.from(triggerMap.values()).sort((left, right) => right.count - left.count);
}

function classifyFromTriggers(triggers) {
  const kinds = new Set((triggers || []).map((trigger) => trigger.kind));
  if (kinds.has('operator-correction') && kinds.has('task-description')) {
    return 'mixed-repeat-signal';
  }
  if (kinds.has('operator-correction')) return 'repeated-operator-corrections';
  if (kinds.has('task-description') || kinds.has('repeated-line')) return 'repeated-task-descriptions';
  return 'insufficient-signal';
}

function chooseRiskTier(evidenceCount, classification, layer) {
  if (evidenceCount >= 4 || (classification === 'mixed-repeat-signal' && layer === 'command')) {
    return 'high';
  }
  if (evidenceCount >= 2) return 'medium';
  return 'low';
}

function buildWarnings({ evidenceCount, nextRoute, classification }) {
  const warnings = [
    'Advisory only; this output is not an authority surface.'
  ];
  if (evidenceCount < 2) {
    warnings.push('Single-signal watchlist item; do not promote to concept-init yet.');
  } else {
    warnings.push('Suggested route only; concept-init and plan-task were not executed.');
  }
  if (classification === 'insufficient-signal') {
    warnings.push('Signal is too thin for a durable substrate recommendation.');
  }
  if (!nextRoute || nextRoute === 'collect more evidence') {
    warnings.push('Collect another occurrence before converting this into code work.');
  }
  return warnings;
}

function detectSystemizationCandidate(input, options = {}) {
  const text = typeof input === 'string'
    ? input
    : String((input && (input.text || input.transcript || input.description || input.args)) || '');
  const lines = splitIntoLines(text);
  const triggers = aggregateTriggers(lines);
  const evidenceCount = triggers.reduce((sum, trigger) => sum + Math.max(1, trigger.count || 1), 0);
  const classification = classifyFromTriggers(triggers);
  const layerChoice = chooseLayer(text);
  const nextRoute = evidenceCount >= 2 ? 'concept-init -> plan-task' : 'collect more evidence';
  const candidateSlug = String(options.candidateSlug || options.candidate_slug || '').trim() || buildCandidateSlug(text, triggers);
  const candidateId = String(options.candidateId || options.candidate_id || '').trim() || buildCandidateId(text, triggers, layerChoice.recommended_layer);

  return {
    schema: SCHEMA_ID,
    candidate_id: candidateId,
    candidate_slug: candidateSlug,
    classification,
    recommended_layer: layerChoice.recommended_layer,
    evidence_count: evidenceCount,
    triggers,
    proposed_primitive: layerChoice.proposed_primitive,
    risk_tier: chooseRiskTier(evidenceCount, classification, layerChoice.recommended_layer),
    next_route: nextRoute,
    advisory_not_authority: true,
    warnings: buildWarnings({
      evidenceCount,
      nextRoute,
      classification
    })
  };
}

module.exports = {
  SCHEMA_ID,
  detectSystemizationCandidate,
  normalizeText,
  slugify
};
