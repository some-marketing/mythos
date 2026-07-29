'use strict';

// Meta AI-in-advertising compliance preflight.
//
// Runs before any creative-write call (meta_update_ad_text, future
// meta_update_creative). Block-on-fail by default. Operator override requires
// explicit reason.
//
// Compliance posture is resolved by ad_account_id against client project
// metadata at clients/<CLIENT>/projects/meta-app-integration/project.json.
// One Meta App + one shared system-user token authenticates every ad account
// in Example Group's BM; per-account compliance differs (patron-alpha = financial-services
// special-ad, patron-beta/patron-gamma = standard automotive) and lives in client project.json.

const fs = require('fs');
const path = require('path');

const CHECK_IDS = {
  CLIENT_RESOLUTION: 'client-resolution',
  AI_DISCLOSURE: 'ai-disclosure',
  SPECIAL_AD_CATEGORY: 'special-ad-category',
  SYNTHETIC_TESTIMONIAL: 'synthetic-testimonial',
  FABRICATED_ENDORSEMENT: 'fabricated-endorsement',
  PROTECTED_CLASS_TARGETING: 'protected-class-targeting',
  DISABILITY_INFERENCE_TARGETING: 'disability-inference-targeting',
  FREE_CLAIM_SUBSTANTIATION: 'free-claim-substantiation',
  REGISTERED_AUDIOLOGIST_VERIFICATION: 'registered-audiologist-verification'
};

function findClientProjectsRoot(opts) {
  if (opts && opts.clientsRoot) return opts.clientsRoot;
  return path.join(process.cwd(), 'clients');
}

function resolveClientByAdAccountId(adAccountId, opts) {
  if (!adAccountId) return null;
  const normalized = String(adAccountId).replace(/^act_/, '');
  const root = findClientProjectsRoot(opts);
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const candidate = path.join(root, ent.name, 'projects', 'meta-app-integration', 'project.json');
    if (!fs.existsSync(candidate)) continue;
    let pj;
    try {
      pj = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    } catch {
      continue;
    }
    const declared = pj.meta_integration && pj.meta_integration.ad_account_id;
    if (declared && String(declared).replace(/^act_/, '') === normalized) {
      return { client_code: ent.name, project: pj, project_path: candidate };
    }
  }
  return null;
}

// payload shape (caller is responsible for populating the compliance fields):
// {
//   ad_account_id: '1234567890',
//   creative: { primary_text, headline, description, ... },
//   compliance: {
//     ai_generated_or_altered: boolean,
//     ai_disclosure_present: boolean,
//     special_ad_category_acknowledged: boolean,
//     contains_testimonial: boolean,
//     testimonial_attribution_documented: boolean,
//     contains_endorsement: boolean,
//     endorsement_documented: boolean,
//     targeting_uses_protected_class: boolean,
//     targeting_uses_protected_class_proxy: boolean,
//     free_claim_substantiated: boolean,
//     registered_audiologist_verified: boolean,
//     override_reason: string | null
//   }
// }
function runCompliancePreflight(payload, opts) {
  const failures = [];
  const passes = [];
  const compliance = (payload && payload.compliance) || {};
  const overrideReason = compliance.override_reason && String(compliance.override_reason).trim();

  // Check 1 — resolve client by ad_account_id
  const resolved = resolveClientByAdAccountId(payload && payload.ad_account_id, opts);
  if (!resolved) {
    failures.push({
      id: CHECK_IDS.CLIENT_RESOLUTION,
      reason: 'No client project found for ad_account_id; compliance posture unresolved. Add clients/<CLIENT>/projects/meta-app-integration/project.json with meta_integration.ad_account_id populated.'
    });
  } else {
    passes.push({ id: CHECK_IDS.CLIENT_RESOLUTION, client_code: resolved.client_code });
  }

  const posture = (resolved && resolved.project && resolved.project.meta_integration && resolved.project.meta_integration.compliance_posture) || null;

  // Check 2 — AI disclosure
  if (compliance.ai_generated_or_altered === true && compliance.ai_disclosure_present !== true) {
    failures.push({
      id: CHECK_IDS.AI_DISCLOSURE,
      reason: 'Creative is AI-generated or AI-altered but compliance.ai_disclosure_present is not true. Meta requires disclosure of AI-generated/altered ad content.'
    });
  } else {
    passes.push({ id: CHECK_IDS.AI_DISCLOSURE });
  }

  // Check 3 — special ad category (only when posture demands it)
  if (posture && posture.meta_special_ad_category && posture.meta_special_ad_category !== 'none') {
    if (compliance.special_ad_category_acknowledged !== true) {
      failures.push({
        id: CHECK_IDS.SPECIAL_AD_CATEGORY,
        reason: `Client ${resolved && resolved.client_code} requires special-ad-category="${posture.meta_special_ad_category}" acknowledgement; compliance.special_ad_category_acknowledged is not true.`
      });
    } else {
      passes.push({ id: CHECK_IDS.SPECIAL_AD_CATEGORY, category: posture.meta_special_ad_category });
    }
  } else {
    passes.push({ id: CHECK_IDS.SPECIAL_AD_CATEGORY, applicable: false });
  }

  // Check 4 — synthetic testimonial
  if (compliance.contains_testimonial === true && compliance.testimonial_attribution_documented !== true) {
    failures.push({
      id: CHECK_IDS.SYNTHETIC_TESTIMONIAL,
      reason: 'Creative contains a testimonial but compliance.testimonial_attribution_documented is not true. Synthetic-person or undocumented testimonials are blocked.'
    });
  } else {
    passes.push({ id: CHECK_IDS.SYNTHETIC_TESTIMONIAL });
  }

  // Check 5 — fabricated endorsement
  if (compliance.contains_endorsement === true && compliance.endorsement_documented !== true) {
    failures.push({
      id: CHECK_IDS.FABRICATED_ENDORSEMENT,
      reason: 'Creative contains an endorsement but compliance.endorsement_documented is not true. Fabricated endorsements are blocked.'
    });
  } else {
    passes.push({ id: CHECK_IDS.FABRICATED_ENDORSEMENT });
  }

  // Check 6 — protected-class targeting
  if (compliance.targeting_uses_protected_class === true || compliance.targeting_uses_protected_class_proxy === true) {
    failures.push({
      id: CHECK_IDS.PROTECTED_CLASS_TARGETING,
      reason: 'Targeting uses protected-class attributes or proxies; blocked. (Targeting writes are out of scope for this MCP version regardless.)'
    });
  } else {
    passes.push({ id: CHECK_IDS.PROTECTED_CLASS_TARGETING });
  }

  const creativeText = collectText(payload && payload.creative);
  const targetingText = collectText(payload && payload.targeting);

  if (containsDisabilityInferenceTargeting(targetingText)) {
    failures.push({
      id: CHECK_IDS.DISABILITY_INFERENCE_TARGETING,
      reason: 'Targeting appears to infer hearing disability, hearing-loss status, or assistive-device use. Healthcare/audiology creative writes must not target disability-inference tokens.'
    });
  } else {
    passes.push({ id: CHECK_IDS.DISABILITY_INFERENCE_TARGETING });
  }

  if (containsSyntheticTestimonialPattern(creativeText) && compliance.testimonial_attribution_documented !== true) {
    failures.push({
      id: CHECK_IDS.SYNTHETIC_TESTIMONIAL,
      reason: 'Creative copy appears testimonial-like but compliance.testimonial_attribution_documented is not true.'
    });
  }

  if (/\bfree\b/i.test(creativeText) && compliance.free_claim_substantiated !== true) {
    failures.push({
      id: CHECK_IDS.FREE_CLAIM_SUBSTANTIATION,
      reason: 'Creative includes a free claim but compliance.free_claim_substantiated is not true.'
    });
  } else {
    passes.push({ id: CHECK_IDS.FREE_CLAIM_SUBSTANTIATION });
  }

  if (/\bregistered audiologist(s)?\b/i.test(creativeText) && compliance.registered_audiologist_verified !== true) {
    failures.push({
      id: CHECK_IDS.REGISTERED_AUDIOLOGIST_VERIFICATION,
      reason: 'Creative mentions registered audiologists but compliance.registered_audiologist_verified is not true.'
    });
  } else {
    passes.push({ id: CHECK_IDS.REGISTERED_AUDIOLOGIST_VERIFICATION });
  }

  const blocked = failures.length > 0;
  const overrideApplied = blocked && Boolean(overrideReason);

  const verdict = {
    schema: 'meta-ads/compliance-preflight/1.0',
    timestamp: new Date().toISOString(),
    ad_account_id: (payload && payload.ad_account_id) || null,
    resolved_client: resolved ? resolved.client_code : null,
    compliance_posture: posture,
    passes: passes.map((p) => p.id),
    failures: failures.map((f) => ({ id: f.id, reason: f.reason })),
    blocked,
    override_applied: overrideApplied,
    override_reason: overrideApplied ? overrideReason : null,
    actor: (opts && opts.actor) || null,
    decision: blocked && !overrideApplied ? 'block' : 'allow'
  };

  return verdict;
}

function collectText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(collectText).join(' ');
  if (typeof value === 'object') return Object.values(value).map(collectText).join(' ');
  return String(value);
}

function containsDisabilityInferenceTargeting(text) {
  return /\b(hearing loss|hearing impaired|hard of hearing|deaf|deafness|tinnitus|hearing aid users?|disabilit(y|ies|y status))\b/i.test(text);
}

function containsSyntheticTestimonialPattern(text) {
  if (!text) return false;
  return /["“][^"”]{8,}["”]\s*[-—]\s*[A-Z][A-Za-z .'-]+/.test(text) ||
    /\b(i|my|we|our)\b.{0,80}\b(life|hearing|care|experience|recommend)\b/i.test(text);
}

module.exports = {
  runCompliancePreflight,
  resolveClientByAdAccountId,
  CHECK_IDS
};
