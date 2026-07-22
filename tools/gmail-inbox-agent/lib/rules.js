'use strict';

const OUTCOMES = Object.freeze(['keep', 'task', 'digest', 'noise', 'watch']);

const CORRECTION_LABEL_TO_OUTCOME = Object.freeze({
  'Mythos/Correct/Keep': 'keep',
  'Mythos/Correct/Task': 'task',
  'Mythos/Correct/Digest': 'digest',
  'Mythos/Correct/Noise': 'noise',
  'Mythos/Correct/Watch': 'watch',
});

const OUTCOME_ACTIONS = Object.freeze({
  keep: Object.freeze({
    gmail_labels: Object.freeze(['Mythos/Triage/Keep']),
    archive: false,
    dart_action: 'none',
  }),
  task: Object.freeze({
    gmail_labels: Object.freeze(['Mythos/Triage/Task']),
    archive: false,
    dart_action: 'create_task',
  }),
  digest: Object.freeze({
    gmail_labels: Object.freeze(['Mythos/Triage/Digest']),
    archive: true,
    dart_action: 'append_digest',
  }),
  noise: Object.freeze({
    gmail_labels: Object.freeze(['Mythos/Triage/Noise']),
    archive: true,
    dart_action: 'none',
  }),
  watch: Object.freeze({
    gmail_labels: Object.freeze(['Mythos/Triage/Watch']),
    archive: false,
    dart_action: 'create_review',
  }),
});

const RULE_SOURCE_RANK = Object.freeze({
  seed: 1,
  human_correction: 2,
});

function normalizeOutcome(outcome) {
  const value = String(outcome || '').trim().toLowerCase();
  if (!OUTCOMES.includes(value)) {
    throw new Error(`Unsupported Gmail inbox agent outcome: ${outcome}`);
  }
  return value;
}

function normalizeLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels.map((label) => String(label || '').trim()).filter(Boolean);
}

function correctionOutcomeFromLabels(labels) {
  for (const label of normalizeLabels(labels)) {
    if (CORRECTION_LABEL_TO_OUTCOME[label]) {
      return CORRECTION_LABEL_TO_OUTCOME[label];
    }
  }
  return null;
}

function extractSenderAddress(emailOrAddress) {
  if (!emailOrAddress) return '';
  if (typeof emailOrAddress === 'object') {
    return extractSenderAddress(
      emailOrAddress.sender_email ||
        emailOrAddress.from_email ||
        emailOrAddress.sender ||
        emailOrAddress.from ||
        ''
    );
  }

  const value = String(emailOrAddress).trim().toLowerCase();
  const angleMatch = value.match(/<([^>]+)>/);
  const candidate = angleMatch ? angleMatch[1] : value;
  const emailMatch = candidate.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return emailMatch ? emailMatch[0].toLowerCase() : '';
}

function extractSenderDomain(emailOrAddress) {
  const address = extractSenderAddress(emailOrAddress);
  const at = address.lastIndexOf('@');
  return at === -1 ? '' : address.slice(at + 1).toLowerCase();
}

function emptyRuleSet() {
  return {
    senders: {},
    domains: {},
  };
}

function normalizeRuleEntry(entry, fallback) {
  if (typeof entry === 'string') {
    return {
      outcome: normalizeOutcome(entry),
      source: fallback.source,
      id: fallback.id,
    };
  }
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  return {
    outcome: normalizeOutcome(entry.outcome),
    source: String(entry.source || fallback.source || 'seed'),
    id: String(entry.id || fallback.id),
  };
}

function addRule(ruleSet, scope, key, entry) {
  const normalizedScope = scope === 'domain' || scope === 'domains' ? 'domains' : 'senders';
  const normalizedKey = normalizedScope === 'senders'
    ? extractSenderAddress(key)
    : String(key || '').trim().toLowerCase();
  if (!normalizedKey) return null;

  const fallback = {
    source: entry && entry.source ? entry.source : 'seed',
    id: `${entry && entry.source ? entry.source : 'seed'}:${normalizedScope}:${normalizedKey}`,
  };
  const normalizedEntry = normalizeRuleEntry(entry, fallback);
  if (!normalizedEntry) return null;

  const existingEntry = ruleSet[normalizedScope][normalizedKey];
  const existingRank = existingEntry ? RULE_SOURCE_RANK[existingEntry.source] || 0 : 0;
  const incomingRank = RULE_SOURCE_RANK[normalizedEntry.source] || 0;
  if (existingEntry && existingRank > incomingRank) {
    return {
      id: existingEntry.id,
      source: existingEntry.source,
      scope: normalizedScope === 'senders' ? 'sender' : 'domain',
      pattern: normalizedKey,
      outcome: existingEntry.outcome,
    };
  }

  ruleSet[normalizedScope][normalizedKey] = normalizedEntry;
  return {
    id: normalizedEntry.id,
    source: normalizedEntry.source,
    scope: normalizedScope === 'senders' ? 'sender' : 'domain',
    pattern: normalizedKey,
    outcome: normalizedEntry.outcome,
  };
}

function loadRuleMap(target, sourceMap, scope, defaultSource) {
  if (!sourceMap || typeof sourceMap !== 'object') return;
  for (const [key, value] of Object.entries(sourceMap)) {
    const entry = typeof value === 'object' && value
      ? { ...value, source: value.source || defaultSource }
      : { outcome: value, source: defaultSource };
    addRule(target, scope, key, entry);
  }
}

function normalizeRuleSet(input = {}) {
  const ruleSet = emptyRuleSet();

  loadRuleMap(ruleSet, input.senders || input.sender || input.senderRules, 'sender', 'seed');
  loadRuleMap(ruleSet, input.domains || input.domain || input.domainRules, 'domain', 'seed');

  if (input.human_corrections) {
    loadRuleMap(ruleSet, input.human_corrections.senders, 'sender', 'human_correction');
    loadRuleMap(ruleSet, input.human_corrections.domains, 'domain', 'human_correction');
  }

  if (input.seed) {
    loadRuleMap(ruleSet, input.seed.senders, 'sender', 'seed');
    loadRuleMap(ruleSet, input.seed.domains, 'domain', 'seed');
  }

  return ruleSet;
}

function learningScopesForEmail(email, options) {
  const explicit = String(email.correction_scope || email.rule_scope || '').trim().toLowerCase();
  if (explicit === 'domain') return ['domain'];
  if (explicit === 'both') return ['sender', 'domain'];
  if (options.learnDomains) return ['sender', 'domain'];
  return [options.scope || 'sender'];
}

function learnRulesFromCorrections(emails, baseRules = {}, options = {}) {
  const ruleSet = normalizeRuleSet(baseRules);
  const learned = [];
  const items = Array.isArray(emails) ? emails : [emails];

  for (const email of items) {
    const labels = email && (email.labels || email.gmail_labels);
    const outcome = correctionOutcomeFromLabels(labels);
    if (!outcome) continue;

    for (const scope of learningScopesForEmail(email, options)) {
      const key = scope === 'domain' ? extractSenderDomain(email) : extractSenderAddress(email);
      if (!key) continue;
      const learnedRule = addRule(ruleSet, scope, key, {
        outcome,
        source: 'human_correction',
        id: `human-correction:${scope}:${key}`,
      });
      if (learnedRule) learned.push(learnedRule);
    }
  }

  return {
    rules: ruleSet,
    learned,
  };
}

module.exports = {
  OUTCOMES,
  CORRECTION_LABEL_TO_OUTCOME,
  OUTCOME_ACTIONS,
  addRule,
  correctionOutcomeFromLabels,
  emptyRuleSet,
  extractSenderAddress,
  extractSenderDomain,
  learnRulesFromCorrections,
  normalizeLabels,
  normalizeOutcome,
  normalizeRuleSet,
};
