'use strict';

const AUDIENCE_LENSES = Object.freeze({
  owner: Object.freeze({
    id: 'owner',
    label: 'Owner',
    domain: 'owner',
    status: 'supported',
    description: 'Plain-business framing for the human operator, client owner, or stakeholder.'
  }),
  media_buyer: Object.freeze({
    id: 'media_buyer',
    label: 'Media buyer',
    domain: 'paid_media',
    status: 'supported',
    description: 'Paid-media framing for budget, creative, targeting, and measurement work.'
  })
});

const DOMAIN_ALIASES = Object.freeze([
  { id: 'paid_media', patterns: [/paid[-_/ ]?media/i, /google[-_/ ]?ads/i, /meta[-_/ ]?(ads|creative|campaign)/i, /campaign/i, /ad[-_/ ]?creative/i] },
  { id: 'designer', patterns: [/design/i, /creative/i, /visual/i, /drawio/i, /diagram/i] },
  { id: 'seo', patterns: [/\bseo\b/i, /search[-_/ ]?engine/i] },
  { id: 'analytics', patterns: [/analytics/i, /tracking/i, /conversion/i, /attribution/i, /measurement/i] },
  { id: 'finance', patterns: [/finance/i, /billing/i, /budget/i, /spend/i, /invoice/i] },
  { id: 'compliance', patterns: [/compliance/i, /legal/i, /privacy/i, /credential/i, /secret/i, /permission/i, /policy/i] },
  { id: 'developer', patterns: [/dev(eloper)?/i, /code/i, /build/i, /deploy/i, /schema/i, /hook/i, /tool/i, /runtime/i, /wordpress/i] },
  { id: 'owner', patterns: [/owner/i, /stakeholder/i, /operator/i, /client/i] }
]);

const FALLBACK_LENS = Object.freeze({
  id: 'technical_fallback',
  label: 'Technical fallback',
  status: 'fallback',
  visible_marker: 'technical fallback - not yet voiced',
  description: 'This domain is detected but does not yet have a promoted audience voice.'
});

function normalizeText(value) {
  return String(value || '').trim();
}

function inferDomainFromFrameworkStep(frameworkStep) {
  const text = normalizeText(frameworkStep);
  if (!text) return 'unknown';
  for (const entry of DOMAIN_ALIASES) {
    if (entry.patterns.some((pattern) => pattern.test(text))) return entry.id;
  }
  return 'unknown';
}

function lensForDomain(domain) {
  const normalized = normalizeText(domain).toLowerCase();
  if (normalized === 'owner') return AUDIENCE_LENSES.owner;
  if (normalized === 'paid_media') return AUDIENCE_LENSES.media_buyer;
  return Object.freeze({
    ...FALLBACK_LENS,
    domain: normalized || 'unknown'
  });
}

function lensForStep(step = {}) {
  const domain = inferDomainFromFrameworkStep(step.framework_step || step.stage || step.step_id || '');
  return lensForDomain(domain);
}

function validateLensCoverage(steps = []) {
  const rows = (Array.isArray(steps) ? steps : []).map((step) => {
    const domain = inferDomainFromFrameworkStep(step.framework_step || step.stage || step.step_id || '');
    const lens = lensForDomain(domain);
    return {
      step_id: step && step.step_id ? String(step.step_id) : '',
      framework_step: step && step.framework_step ? String(step.framework_step) : '',
      domain,
      lens_id: lens.id,
      lens_status: lens.status,
      visible_fallback: lens.status === 'fallback' ? lens.visible_marker : ''
    };
  });

  return {
    schema: 'PlanAudienceLensCoverage/1.0',
    supported_lenses: Object.keys(AUDIENCE_LENSES),
    rows,
    fallback_count: rows.filter((row) => row.lens_status === 'fallback').length,
    missing_step_ids: rows.filter((row) => !row.step_id).length,
    ok: rows.every((row) => row.lens_status === 'supported' || Boolean(row.visible_fallback))
  };
}

function normalizeAudienceKey(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

module.exports = {
  AUDIENCE_LENSES,
  FALLBACK_LENS,
  inferDomainFromFrameworkStep,
  lensForDomain,
  lensForStep,
  normalizeAudienceKey,
  validateLensCoverage
};
