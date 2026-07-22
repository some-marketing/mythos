'use strict';

const {
  OUTCOME_ACTIONS,
  correctionOutcomeFromLabels,
  extractSenderAddress,
  extractSenderDomain,
  learnRulesFromCorrections,
  normalizeLabels,
  normalizeRuleSet,
} = require('./rules');

function emailLabels(email) {
  return normalizeLabels(email && (email.labels || email.gmail_labels));
}

function combinedText(email) {
  return [
    email && email.subject,
    email && email.snippet,
    email && email.body,
    email && email.text,
  ].map((value) => String(value || '')).join('\n').toLowerCase();
}

function ruleWithMetadata(rule, scope, pattern) {
  return {
    id: rule.id,
    source: rule.source,
    scope,
    pattern,
  };
}

function sourceMatches(rule, source) {
  return rule && String(rule.source || 'seed') === source;
}

function findRule(email, rules) {
  const sender = extractSenderAddress(email);
  const domain = extractSenderDomain(email);
  const senders = rules.senders || {};
  const domains = rules.domains || {};

  if (sender && sourceMatches(senders[sender], 'human_correction')) {
    return { rule: senders[sender], scope: 'sender', pattern: sender };
  }
  if (domain && sourceMatches(domains[domain], 'human_correction')) {
    return { rule: domains[domain], scope: 'domain', pattern: domain };
  }
  if (sender && sourceMatches(senders[sender], 'seed')) {
    return { rule: senders[sender], scope: 'sender', pattern: sender };
  }
  if (domain && sourceMatches(domains[domain], 'seed')) {
    return { rule: domains[domain], scope: 'domain', pattern: domain };
  }
  return null;
}

function scorePattern(text, patterns, amount, reasons, reason) {
  let score = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      score += amount;
      reasons.push(reason);
      break;
    }
  }
  return score;
}

function deterministicClassify(email) {
  const text = combinedText(email);
  const scores = {
    task: 0,
    digest: 0,
    noise: 0,
    watch: 0,
  };
  const reasons = {
    task: [],
    digest: [],
    noise: [],
    watch: [],
  };

  scores.watch += scorePattern(text, [
    /\b(security|suspicious|password|passcode|verification code|two[- ]factor|2fa|mfa|sign[- ]?in|login|authentication|account access)\b/,
  ], 3, reasons.watch, 'security or authentication language');
  scores.watch += scorePattern(text, [
    /\b(invoice|receipt|payment|billing|charge|paid|failed payment|renewal|subscription)\b/,
  ], 3, reasons.watch, 'payment or billing language');

  scores.task += scorePattern(text, [
    /\bplease\b/,
    /\bcan you\b/,
    /\bcould you\b/,
    /\bwould you\b/,
    /\bneed you to\b/,
    /\baction required\b/,
  ], 2, reasons.task, 'direct action language');
  scores.task += scorePattern(text, [
    /\b(decision|decide|approve|approval|confirm|reply|respond|review this|question)\b/,
    /\?/,
  ], 2, reasons.task, 'decision, reply, review, or question language');

  scores.noise += scorePattern(text, [
    /\b(unsubscribe|manage preferences)\b/,
  ], 1, reasons.noise, 'unsubscribe or preference-management language');
  scores.noise += scorePattern(text, [
    /\b(sale|promo|promotion|coupon|deal|discount|advertisement|sponsored|limited time|special offer|save [0-9]+)\b/,
  ], 2, reasons.noise, 'promotional language');
  scores.noise += scorePattern(text, [
    /\b(liked your post|new follower|followed you|connection request|people you may know)\b/,
  ], 3, reasons.noise, 'low-value social notification language');

  scores.digest += scorePattern(text, [
    /\b(newsletter|digest|roundup|weekly update|monthly update|mailing list|webinar|event invite|product update|release notes)\b/,
  ], 2, reasons.digest, 'newsletter, digest, or update language');
  scores.digest += scorePattern(text, [
    /\b(unsubscribe|manage preferences|notification)\b/,
  ], 1, reasons.digest, 'automated email marker');

  if (scores.watch >= 3) {
    return {
      outcome: 'watch',
      confidence: 0.82,
      reasons: reasons.watch,
    };
  }
  if (scores.noise >= 3) {
    return {
      outcome: 'noise',
      confidence: 0.78,
      reasons: reasons.noise,
    };
  }
  if (scores.task >= 2 && scores.task >= scores.digest) {
    return {
      outcome: 'task',
      confidence: 0.74,
      reasons: reasons.task,
    };
  }
  if (scores.digest >= 2) {
    return {
      outcome: 'digest',
      confidence: 0.7,
      reasons: reasons.digest,
    };
  }

  return {
    outcome: 'keep',
    confidence: 0.35,
    reasons: ['no rule or strong deterministic signal matched'],
  };
}

function buildDecision(email, outcome, details = {}) {
  const action = OUTCOME_ACTIONS[outcome];
  return {
    email_id: email && email.id ? String(email.id) : null,
    outcome,
    gmail_labels: [...action.gmail_labels],
    archive: action.archive,
    dart_action: action.dart_action,
    confidence: details.confidence,
    reasons: details.reasons || [],
    matched_rule: details.matched_rule || null,
    learned_rules: details.learned_rules || [],
  };
}

function classifyEmail(email, options = {}) {
  const labels = emailLabels(email);
  const correctionOutcome = correctionOutcomeFromLabels(labels);
  if (correctionOutcome) {
    const learned = learnRulesFromCorrections(email).learned;
    const matched = learned[0] || null;
    return buildDecision(email, correctionOutcome, {
      confidence: 0.99,
      reasons: ['human correction label on message'],
      matched_rule: matched ? {
        id: matched.id,
        source: matched.source,
        scope: matched.scope,
        pattern: matched.pattern,
      } : {
        id: `human-correction:label:${correctionOutcome}`,
        source: 'human_correction',
        scope: 'message',
        pattern: labels.find((label) => label.startsWith('Mythos/Correct/')) || '',
      },
      learned_rules: learned,
    });
  }

  const rules = normalizeRuleSet(options.rules || {});
  const matched = findRule(email, rules);
  if (matched) {
    return buildDecision(email, matched.rule.outcome, {
      confidence: matched.rule.source === 'human_correction' ? 0.96 : 0.88,
      reasons: [`matched ${matched.rule.source} ${matched.scope} rule`],
      matched_rule: ruleWithMetadata(matched.rule, matched.scope, matched.pattern),
    });
  }

  const deterministic = deterministicClassify(email || {});
  return buildDecision(email, deterministic.outcome, {
    confidence: deterministic.confidence,
    reasons: deterministic.reasons,
  });
}

function classifyEmails(emails, options = {}) {
  const items = Array.isArray(emails) ? emails : [];
  if (!options.learnCorrections) {
    return items.map((email) => classifyEmail(email, options));
  }

  const learned = learnRulesFromCorrections(items, options.rules || {}, options.learning || {});
  return items.map((email) => classifyEmail(email, {
    ...options,
    rules: learned.rules,
  }));
}

module.exports = {
  classifyEmail,
  classifyEmails,
  deterministicClassify,
};
