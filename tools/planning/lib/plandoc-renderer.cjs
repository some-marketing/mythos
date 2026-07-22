'use strict';

/**
 * plandoc-renderer.cjs — Operator-facing layman plandoc HTML renderer.
 *
 * renderPlandocHtml(planJson) → self-contained HTML string.
 *
 * Layout matches the operator-approved hand-built prototypes at:
 *   _dev/reports/analysis/plandoc-prototype/pixar-rule4-omitted-dispatch-coverage-plandoc.html
 *   _dev/reports/analysis/plandoc-prototype/embodiment-unreal-bridge-stage1-plandoc.html
 *
 * DO NOT import from or modify tools/planning/lib/step-plan-renderer.cjs.
 * Small helpers (escapeHtml, normalizeText, normalizeAudienceField, visibleVoicing)
 * are duplicated here intentionally — step-plan-renderer.cjs is forbidden to modify
 * and does not export these.
 *
 * NO render-time LLM. Authored voicings come from plan JSON
 * (step.audiences.*.what/why). Missing operator voicings use deterministic
 * source-derived fallbacks so the operator view remains readable.
 *
 * Framing linter (plan-audience-framing-lint.cjs) gates rendering fail-closed:
 * if lint returns ok=false, renderPlandocHtml throws before generating any HTML.
 */

const path = require('node:path');

// ── Resolve linter relative to this file's location ──────────────────────────
const LINT_PATH = path.join(__dirname, '../../ai-bridge/lib/plan-audience-framing-lint.cjs');
const { lintPlanAudienceFraming } = require(LINT_PATH);

// ── Local helpers (duplicated — do NOT import from step-plan-renderer.cjs) ───

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function visualFormatHref(taskId, suffix) {
  if (!taskId) return '';
  return `${encodeURIComponent(taskId)}.${suffix}.html`;
}

function renderVisualFormatNav(taskId, active) {
  if (!taskId) return '';
  const formats = [
    { id: 'plan', label: 'Readable', href: visualFormatHref(taskId, 'plan') },
    { id: 'steps', label: 'Steps', href: visualFormatHref(taskId, 'steps') },
    { id: 'plandoc', label: 'Layman', href: visualFormatHref(taskId, 'plandoc') }
  ];
  return '<nav class="format-nav" aria-label="Plan visual formats">'
    + formats.map((format) => (
      `<a href="${escapeHtml(format.href)}"${format.id === active ? ' aria-current="page"' : ''}>${escapeHtml(format.label)}</a>`
    )).join('')
    + '</nav>';
}

function titleCaseWords(text) {
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
  return normalizeText(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((word, idx) => {
      const lower = word.toLowerCase();
      if (idx > 0 && small.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function conciseWords(text, maxWords = 8) {
  const words = normalizeText(text)
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean);
  const sliced = words.slice(0, maxWords).join(' ');
  return words.length > maxWords ? `${sliced}...` : sliced;
}

function stripTechnicalDetail(text) {
  let value = normalizeText(text);
  value = value.replace(/^[A-Z][A-Z0-9 _/-]{2,80}\s*(?:\([^)]*\))?\s*[—-]\s*/u, '');
  value = value.replace(/`[^`]+`/g, '');
  value = value.replace(/\b(?:node|npm|npx|rg|git|claude|gemini|codex)\s+[^\.;]+/gi, '');
  value = value.replace(/\b[\w./-]+(?:\.cjs|\.js|\.json|\.md|\.html|\.yaml|\.yml)\b/g, '');
  value = value.replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
  return value;
}

function isTechnicalHeavy(text) {
  const value = normalizeText(text);
  return (
    /\/[a-z][a-z0-9-]+/i.test(value) ||
    /\b[\w./-]+(?:\.cjs|\.js|\.json|\.md|\.html|\.yaml|\.yml)\b/.test(value) ||
    /\b(?:node|npm|npx|rg|git|claude|gemini|codex)\s+/i.test(value) ||
    /\bstep\.audiences|provenance_state|lintPlanAudienceFraming|SMOS_/i.test(value)
  );
}

function operatorGoalFromPlan(planJson) {
  const rawGoal = normalizeText(planJson.task_summary || planJson.title || planJson.description || planJson.question_work);
  return rawGoal && !isTechnicalHeavy(rawGoal)
    ? rawGoal
    : 'Make this plan easier to understand, review, and run.';
}

function operatorGateLabel(text) {
  const raw = normalizeText(text);
  if (!raw) return '';
  if (/ground-in-philosophy/i.test(raw)) return 'Grounding review required before execution.';
  if (/operator/i.test(raw) && /gate|approve|approval|decision/i.test(raw)) return 'Human approval required before continuing.';
  if (isTechnicalHeavy(raw)) return 'Review this checkpoint before continuing.';
  return stripTechnicalDetail(raw);
}

function phraseFromStepId(step) {
  const id = normalizeText(step && step.step_id);
  if (!id) return '';
  return titleCaseWords(id.replace(/^s\d+[-_:]*/i, '').replace(/[-_]+/g, ' '));
}

function operatorTitleFromStep(step) {
  const raw = normalizeText(step && step.description);
  if (/^VERIFICATION\b/i.test(raw)) return 'Verify the Current State';
  if (/^NEW FILE\b/i.test(raw) && /renderer/i.test(raw)) return 'Build the Visual Plan Page';
  if (/^NEW FILE\b/i.test(raw) && /export/i.test(raw)) return 'Add the Export Command';
  if (/^HOOK PATCH\b/i.test(raw)) return 'Wire Optional Publishing';
  if (/^DISTINCT-INTELLIGENCE REVIEW\b/i.test(raw)) return 'Review Output Quality';

  const desc = stripTechnicalDetail(raw);
  const firstSentence = normalizeText(desc.split(/[.!?]/)[0]);
  if (firstSentence) return titleCaseWords(conciseWords(firstSentence, 7));
  return phraseFromStepId(step) || 'Review This Step';
}

function operatorWhatFromStep(step) {
  const title = operatorTitleFromStep(step);
  const tag = deriveTag(step);
  if (tag === 'gate') return `Pause for a human decision before the work moves forward: ${title}.`;
  if (tag === 'review') return `Check whether this part of the plan is sound: ${title}.`;
  if (tag === 'build' || tag === 'patch') return `Create or update the work described here: ${title}.`;
  return `Work through this part of the plan: ${title}.`;
}

function operatorWhyFromStep(step) {
  const tag = deriveTag(step);
  if (tag === 'gate') return 'This keeps the plan from moving past a decision point without human approval.';
  if (tag === 'review') return 'This catches format, clarity, or readiness problems before later work depends on them.';
  if (tag === 'build' || tag === 'patch') return 'This turns the plan into something usable that later checks can verify.';
  return 'This moves the plan forward while keeping the next handoff clear.';
}

/**
 * Normalize an audience field (what or why) from a step.audiences.{lens} entry.
 * Handles both flat-string and nested-object shapes.
 */
function normalizeAudienceField(entry, field) {
  if (!entry || typeof entry !== 'object') {
    return { text: '', provenance_state: 'missing', shape: 'missing' };
  }
  const raw = entry[field];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      text: normalizeText(raw.text),
      provenance_state: normalizeText(raw.provenance_state || raw.source || ''),
      shape: 'nested'
    };
  }
  return {
    text: normalizeText(raw),
    provenance_state: normalizeText(entry[`${field}_provenance_state`] || entry.provenance_state || entry.source || ''),
    shape: raw == null ? 'missing' : 'flat'
  };
}

/**
 * Return plain-text voicing for a step audience field, or null if not available.
 * A field counts as "needs authoring" when:
 *   - shape is 'missing' (field absent entirely)
 *   - text is empty
 *   - provenance_state is 'needs-authoring'
 */
function visibleVoicing(entry, field) {
  const norm = normalizeAudienceField(entry, field);
  const needsAuthoring =
    norm.shape === 'missing' ||
    !norm.text ||
    norm.provenance_state === 'needs-authoring';
  return { text: norm.text, needsAuthoring, provenance_state: norm.provenance_state };
}

// ── Lens metadata ─────────────────────────────────────────────────────────────

const LENS_META = {
  operator: { icon: '🧑‍💼', label: 'You (operator)', sub: 'plain business English' },
  engineer:  { icon: '⚙️',        label: 'Engineer',        sub: 'technical detail' },
  owner:     { icon: '🏢',        label: 'Owner',           sub: 'business context' },
  media_buyer: { icon: '📊',      label: 'Media Buyer',     sub: 'media detail' },
  creative:  { icon: '🎨',        label: 'Creative',        sub: 'design context' },
};

function lensMetaFor(id) {
  return LENS_META[id] || { icon: '👤', label: id, sub: '' };
}

// ── Derivation helpers ────────────────────────────────────────────────────────

/**
 * Derive the set of lens IDs from union of step.audiences keys across all steps.
 * If no audiences fields are present, fall back to scope_type default.
 */
function deriveLensIds(planJson) {
  const steps = planJson && planJson.bounded_plan && Array.isArray(planJson.bounded_plan.steps)
    ? planJson.bounded_plan.steps
    : [];

  const union = new Set();
  for (const step of steps) {
    if (step && step.audiences && typeof step.audiences === 'object') {
      for (const key of Object.keys(step.audiences)) {
        union.add(key);
      }
    }
  }

  if (union.size > 0) return [...union];

  // Fall back to scope_type default
  const scopeType = normalizeText(planJson && planJson.scope_type);
  if (scopeType === 'client') return ['owner'];
  return ['operator', 'engineer'];
}

/**
 * Derive the chip tag ('gate'|'review'|'build'|'patch') from a step.
 */
function deriveTag(step) {
  const mode = normalizeText(step.mode).toUpperCase();
  const routeKind = normalizeText(step.route && step.route.kind).toLowerCase();

  if (
    mode.includes('GATE') ||
    step.is_gate_required === true ||
    routeKind === 'operator_gate' ||
    routeKind === 'gate'
  ) return 'gate';

  if (mode === 'REVIEW_ONLY') return 'review';

  if (
    routeKind === 'patch_artifact' ||
    routeKind === 'patch'
  ) return 'patch';

  if (
    mode === 'PATCH_ALLOWED' ||
    routeKind === 'build_artifact' ||
    routeKind === 'build'
  ) return 'build';

  // Default fallback
  if (mode.includes('REVIEW')) return 'review';
  if (mode.includes('PATCH')) return 'patch';
  if (mode.includes('BUILD') || mode.includes('ALLOWED')) return 'build';

  return 'review';
}

/**
 * Group steps into stages by step.stage value.
 * Steps without stage go into a synthetic 'Ungrouped' band placed last.
 *
 * Each stage: { stageLabel, band, steps: [...] }
 */
function deriveStages(planJson) {
  const steps = planJson && planJson.bounded_plan && Array.isArray(planJson.bounded_plan.steps)
    ? planJson.bounded_plan.steps
    : [];

  const ordered = [];       // stage labels in insertion order
  const byStage = new Map();
  const ungrouped = [];

  for (const step of steps) {
    const stageLabel = normalizeText(step.stage);
    if (!stageLabel) {
      ungrouped.push(step);
      continue;
    }
    if (!byStage.has(stageLabel)) {
      byStage.set(stageLabel, []);
      ordered.push(stageLabel);
    }
    byStage.get(stageLabel).push(step);
  }

  // Derive band slug from stage label index for color cycling
  const BAND_COLORS = ['recon', 'safety', 'planning', 'execute', 'verify', 'deploy'];

  const stages = ordered.map((label, idx) => ({
    stageLabel: label,
    stageTitle: label,   // ✎ proposed — same as label when step.stage_title absent
    band: BAND_COLORS[idx % BAND_COLORS.length],
    proposed: false,
    steps: byStage.get(label)
  }));

  if (ungrouped.length > 0) {
    stages.push({
      stageLabel: 'Ungrouped',
      stageTitle: 'Ungrouped ✎ proposed',
      band: 'execute',
      proposed: true,
      steps: ungrouped
    });
  }

  return stages;
}

/**
 * Derive step display title for a given lens.
 * Returns { text, needsAuthoring }
 */
function stepTitle(step, lensId) {
  // Try per-lens audience voicing
  const audience = step && step.audiences && step.audiences[lensId];
  if (audience) {
    const v = visibleVoicing(audience, 'what');
    if (!v.needsAuthoring && v.text) {
      // Truncate to first sentence or 120 chars for card title
      const truncated = v.text.length > 120 ? v.text.slice(0, 120) + '…' : v.text;
      return { text: truncated, needsAuthoring: false };
    }
  }
  // Fall back to description
  const desc = normalizeText(step.description);
  if (desc) {
    const truncated = desc.length > 120 ? desc.slice(0, 120) + '…' : desc;
    return { text: truncated, needsAuthoring: false };
  }
  return { text: 'No description', needsAuthoring: true };
}

/**
 * Derive glance strip data per-lens.
 * Returns { goal: {[lensId]: string}, gatesLabel: {[lensId]: string}, gates: {[lensId]: [{ref, label}]} }
 *
 * Facts-constant invariant: goal text, gatesLabel, and gate chips are IDENTICAL across all lenses.
 * Per-lens variation is allowed ONLY when the plan carries explicit plan-level audiences fields
 * (planJson.audiences[lensId].goal) authored with the same provenance contract as
 * step.audiences.*.what/why. Lens-specific variation is limited to step card what/why detail text.
 */
function deriveGlance(planJson, lensIds) {
  const steps = planJson && planJson.bounded_plan && Array.isArray(planJson.bounded_plan.steps)
    ? planJson.bounded_plan.steps
    : [];

  // ONE source-derived fallback goal — identical for all lenses that lack explicit plan-level audience goals.
  const sharedFallbackGoal = operatorGoalFromPlan(planJson);

  // Goal text per lens — invariant unless the plan explicitly carries per-lens plan.audiences[lensId].goal
  const goal = {};
  for (const lensId of lensIds) {
    // Try plan-level audiences if present (explicitly authored per-lens goal)
    const planAudiences = planJson.audiences && planJson.audiences[lensId];
    if (planAudiences && planAudiences.goal) {
      const v = visibleVoicing(planAudiences, 'goal');
      if (!v.needsAuthoring) { goal[lensId] = v.text; continue; }
    }
    // Fallback: same source-derived goal for ALL lenses (facts-constant invariant)
    goal[lensId] = sharedFallbackGoal;
  }

  // Gate steps: steps with mode containing GATE, route.kind=operator_gate, or is_gate_required
  const gateSteps = steps.filter(s => {
    if (!s) return false;
    const mode = normalizeText(s.mode).toUpperCase();
    const routeKind = normalizeText(s.route && s.route.kind).toLowerCase();
    return (
      mode.includes('GATE') ||
      s.is_gate_required === true ||
      routeKind === 'operator_gate' ||
      routeKind === 'gate'
    );
  });

  // Also pull from required_gates at plan level as additional context
  const planRequiredGates = Array.isArray(planJson.bounded_plan && planJson.bounded_plan.required_gates)
    ? planJson.bounded_plan.required_gates
    : [];

  const gates = {};
  const gatesLabel = {};

  // ONE shared gate label — identical across all lenses (facts-constant invariant)
  const sharedGatesLabel = 'decisions needed from you';

  for (const lensId of lensIds) {
    gatesLabel[lensId] = sharedGatesLabel;
    gates[lensId] = gateSteps.map(s => ({
      ref: normalizeText(s.step_id),
      label: operatorGateLabel(
        (s.route && s.route.route_reason) ||
        s.description ||
        s.step_id
      ).slice(0, 100)
    }));

    // If no gate steps, surface the first required_gate as a reference
    if (gates[lensId].length === 0 && planRequiredGates.length > 0) {
      gates[lensId] = [{ ref: 'plan', label: operatorGateLabel(planRequiredGates[0]).slice(0, 100) }];
    }
  }

  return { goal, gatesLabel, gates };
}

function buildOperatorBrief(planJson, stages) {
  const steps = stages.flatMap(st => st.steps || []);
  const goal = operatorGoalFromPlan(planJson);
  const outcomes = Array.isArray(planJson.bounded_plan && planJson.bounded_plan.expected_outcomes)
    ? planJson.bounded_plan.expected_outcomes.map(normalizeText).filter(Boolean)
    : [];
  const impact = outcomes.length > 0 && !isTechnicalHeavy(outcomes[0])
    ? stripTechnicalDetail(outcomes[0])
    : 'The finished work should be easier to review, approve, and hand off.';
  const flightPath = steps.length > 0
    ? steps.map(operatorTitleFromStep).slice(0, 5).join(' → ')
    : 'Review the plan, do the work, then check the result.';
  const gates = Array.isArray(planJson.bounded_plan && planJson.bounded_plan.required_gates)
    ? planJson.bounded_plan.required_gates.map(operatorGateLabel).filter(Boolean)
    : [];
  const checkpoints = gates.length > 0
    ? gates.slice(0, 2).join(' ')
    : 'Check the output before treating the plan as ready.';
  const risks = normalizeText(planJson.bounded_plan && planJson.bounded_plan.risk_notes || planJson.risk_notes);
  return {
    goal,
    impact: impact || 'The finished work should be easier to review, approve, and hand off.',
    flightPath,
    checkpoints,
    risks: risks && !isTechnicalHeavy(risks)
      ? stripTechnicalDetail(risks).slice(0, 220)
      : 'Main risk: the plan may still need a human readability pass.'
  };
}

// ── HTML generation ───────────────────────────────────────────────────────────

const CSS = `
  :root{--bg:#f6f7f9;--ink:#1f2733;--muted:#5b6675;--line:#dde2e9;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}

  /* ── sticky header ──────────────────────────────── */
  header{background:#fff;border-bottom:1px solid var(--line);padding:16px 22px;position:sticky;top:0;z-index:5;
         display:flex;gap:16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
  .header-copy{min-width:260px;flex:1 1 auto}
  header h1{margin:0;font-size:18px}
  header p{margin:4px 0 0;color:var(--muted);font-size:13px}
  .format-nav{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding-top:1px}
  .format-nav a{color:#1565c0;text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:12px;background:#fff}
  .format-nav a[aria-current="page"]{background:#1565c0;color:#fff;border-color:#1565c0;font-weight:700}

  .wrap{max-width:1180px;margin:0 auto;padding:16px 20px 40px}

  /* ── plan glance strip ──────────────────────────── */
  .glance{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin-bottom:18px}
  .glance-goal{font-size:15px;font-weight:600;color:var(--ink);margin-bottom:10px}
  .glance-goal span.plbl{font-weight:400;color:var(--muted);font-size:13px;margin-right:6px}
  .operator-brief{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;
                  background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:18px}
  .brief-item{border-left:3px solid #90caf9;padding-left:10px;min-width:0}
  .brief-item h2{margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  .brief-item p{margin:0;font-size:13px;line-height:1.45;color:#2b3543}
  .glance-gates{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start}
  .glance-gates .glbl{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#e65100;margin-right:4px;white-space:nowrap;padding-top:2px}
  .gate-chip{display:inline-flex;align-items:center;gap:5px;background:#fff3e0;border:1px solid #ffcc80;
             border-radius:20px;padding:3px 10px;font-size:12px;color:#7c3700;font-weight:500}
  .gate-chip .step-ref{font-family:ui-monospace,monospace;font-size:10px;opacity:.7}

  /* ── proposed legend ────────────────────────────── */
  .legend{background:#fff8e1;border:1px solid #ffe082;border-radius:10px;padding:10px 16px;
          margin-bottom:16px;font-size:12px;color:#5c4000;display:flex;flex-wrap:wrap;gap:14px;align-items:center}
  .legend strong{font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-right:4px}
  .l-real{background:#eceff1;border:1px solid #b0bec5;border-radius:8px;padding:1px 8px;font-size:11px;font-weight:700;color:#37474f}
  .l-prop{background:#fff8e1;border:1px dashed #f59e0b;border-radius:8px;padding:1px 8px;font-size:11px;font-weight:700;color:#92400e}
  .l-prop::before{content:"\\2712 "}

  /* ── audience lens toggle ───────────────────────── */
  .lens-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:16px}
  .lens-bar .lens-prompt{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-right:4px}
  .lens-pill{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #b0bec5;
             border-radius:22px;padding:6px 14px;font-size:13px;color:#37474f;cursor:pointer;
             transition:background .12s,border-color .12s,box-shadow .12s;font-weight:500}
  .lens-pill:hover{box-shadow:0 2px 8px rgba(0,0,0,.1)}
  .lens-pill.active{background:#1565c0;border-color:#1565c0;color:#fff;font-weight:600}
  .lens-pill .lens-sub{font-size:11px;opacity:.75;font-weight:400}
  .lens-pill.active .lens-sub{opacity:.85}

  /* ── stage bands ────────────────────────────────── */
  .stage{margin:0 0 14px;border-radius:12px;padding:12px 14px}
  .stage[data-band="recon"]{background:#e3f2fd;border:1px solid #90caf9}
  .stage[data-band="safety"]{background:#e8f5e9;border:1px solid #a5d6a7}
  .stage[data-band="planning"]{background:#fce4ec;border:1px solid #f48fb1}
  .stage[data-band="execute"]{background:#eceff1;border:1px solid #cfd8dc}
  .stage[data-band="verify"]{background:#f3e5f5;border:1px solid #ce93d8}
  .stage[data-band="deploy"]{background:#fff3e0;border:1px solid #ffcc80}
  .shead{font-weight:700;font-size:14px;display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}
  .shead .meta{font-weight:500;font-size:12px;color:var(--muted)}

  /* ── step boxes ─────────────────────────────────── */
  .row{display:flex;flex-wrap:wrap;gap:10px}
  .box{background:#fff;border:1px solid #b0bec5;border-radius:9px;padding:9px 11px;width:220px;cursor:pointer;
       transition:box-shadow .12s,transform .12s;position:relative;min-height:72px}
  .box:hover{box-shadow:0 3px 10px rgba(0,0,0,.12);transform:translateY(-1px)}
  .box.active{outline:2px solid #1565c0;outline-offset:0}
  .box .sid{font-weight:700;font-family:ui-monospace,monospace;font-size:11px}
  .box .bt{font-size:12px;margin-top:3px;color:#2b3543;line-height:1.35}
  .box .needs-authoring{font-size:11px;font-style:italic;color:#b45309;background:#fef3c7;
                        border:1px dashed #f59e0b;border-radius:4px;padding:1px 5px;display:inline-block;margin-top:3px}
  .box .tag{position:absolute;top:7px;right:8px;font-size:8px;font-weight:700;padding:1px 5px;
            border-radius:8px;letter-spacing:.3px;text-transform:uppercase}
  .t-build{background:#f3e5f5;color:#6a1b9a}
  .t-patch{background:#e3f2fd;color:#1565c0}
  .t-review{background:#fff8e1;color:#b8860b}
  .t-gate{background:#ffe0b2;color:#e65100}

  /* ── detail panel ───────────────────────────────── */
  .detail{margin-top:11px;background:#fff;border:1px solid var(--line);border-radius:9px;
          padding:0;max-height:0;overflow:hidden;transition:max-height .25s ease}
  .detail.open{max-height:700px;padding:14px 16px;overflow:auto}
  .detail .dt{font-weight:700;font-size:13px;margin-bottom:8px}
  .detail .lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;
               color:var(--muted);margin:10px 0 2px}
  .detail .lbl:first-of-type{margin-top:0}
  .detail .why{color:#374151;font-size:13px;line-height:1.55}
  .detail .dep{color:#374151;font-size:13px;line-height:1.55}
  .detail .na-block{background:#fef3c7;border:1px dashed #f59e0b;border-radius:6px;
                    padding:8px 12px;font-size:12px;font-style:italic;color:#92400e;
                    margin-top:2px}
  .detail .na-block::before{content:"\\2712 [needs authoring] "}
  .detail .fallback-note{display:inline-flex;align-items:center;background:#f8fafc;border:1px solid #dbe3ec;
                         border-radius:999px;padding:1px 7px;font-size:10px;font-weight:700;
                         color:#5b6675;margin-left:6px;text-transform:none;letter-spacing:0}
  .detail .mind-line{display:inline-flex;align-items:center;gap:5px;
                     background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;
                     padding:3px 9px;font-size:12px;color:#1e40af;font-weight:500}
  .detail .prop-badge{display:inline-flex;align-items:center;
                      background:#fff8e1;border:1px dashed #f59e0b;border-radius:6px;
                      padding:1px 7px;font-size:10px;font-weight:700;color:#92400e;
                      margin-left:5px;vertical-align:middle}
  .detail .prop-badge::before{content:"\\2712 proposed"}

  /* ── tech depth collapse ────────────────────────── */
  .detail summary{cursor:pointer;font-size:11px;font-weight:700;text-transform:uppercase;
                  letter-spacing:.04em;color:#1565c0;margin-top:12px;list-style:none;
                  display:flex;align-items:center;gap:5px}
  .detail summary::-webkit-details-marker{display:none}
  .detail summary::before{content:"\\25b8"}
  details.tech[open] summary::before{content:"\\25be"}
  .tech-inner{margin-top:8px;font-size:12px;color:var(--muted);line-height:1.6;
              background:#f8f9fb;border:1px solid var(--line);border-radius:6px;padding:10px 12px}
  .tech-inner h5{font-size:10px;text-transform:uppercase;letter-spacing:.04em;
                 color:var(--muted);margin:8px 0 2px;font-weight:700}
  .tech-inner h5:first-child{margin-top:0}
  .tech-inner code{font-family:ui-monospace,monospace;font-size:11px;background:#e5e7eb;
                   padding:1px 5px;border-radius:3px;color:#1f2733}
  .tech-inner ul{margin:2px 0 0 14px}
  .tech-inner li{margin-bottom:2px}

  /* ── footer ─────────────────────────────────────── */
  footer{color:var(--muted);font-size:12px;padding:0 22px 40px;max-width:1180px;margin:0 auto}
  footer b{font-weight:700}
  @media (max-width:900px){.operator-brief{grid-template-columns:1fr 1fr}.brief-item:last-child{grid-column:1/-1}}
  @media (max-width:560px){.operator-brief{grid-template-columns:1fr}.box{width:100%}}
`;

/**
 * Build the inline JS data + interaction code for the generated HTML.
 * All data is JSON-serialized from the plan so the HTML is self-contained.
 */
function buildInlineScript(planJson, lensIds, stages, glance) {
  const lensesData = lensIds.map(id => {
    const m = lensMetaFor(id);
    return { id, icon: m.icon, label: m.label, sub: m.sub };
  });

  // Build STAGES data for JS
  const stagesData = stages.map(st => ({
    id: st.stageLabel,
    band: st.band,
    proposed: st.proposed,
    meta: buildStageMeta(st),
    steps: st.steps.map(s => buildStepData(s, lensIds))
  }));

  // Serialize safely for embedding in a <script> tag
  const lensesJson = JSON.stringify(lensesData);
  const glanceJson = JSON.stringify(glance);
  const stagesJson = JSON.stringify(stagesData);
  const defaultLens = JSON.stringify(lensIds[0] || 'operator');

  return `
// ── Data (rendered from plan JSON — no LLM at render time) ───────────────────
const LENSES = ${lensesJson};
const GLANCE = ${glanceJson};
const STAGES = ${stagesJson};
let CURRENT_LENS = ${defaultLens};

const propBadge = '<span class="prop-badge"></span>';
const fallbackBadge = '<span class="fallback-note">source-derived fallback</span>';

// ── Render lens toggle ────────────────────────────────────────────────────────
(function(){
  const lb = document.getElementById('lensbar');
  lb.innerHTML = '<span class="lens-prompt">Read as</span>' +
    LENSES.map(L =>
      '<span class="lens-pill' + (L.id === CURRENT_LENS ? ' active' : '') + '" data-lens="' + L.id + '">' +
        L.icon + ' ' + L.label + ' <span class="lens-sub">· ' + L.sub + '</span>' +
      '</span>'
    ).join('');
  lb.querySelectorAll('.lens-pill').forEach(p => {
    p.onclick = () => {
      CURRENT_LENS = p.dataset.lens;
      lb.querySelectorAll('.lens-pill').forEach(x => x.classList.toggle('active', x.dataset.lens === CURRENT_LENS));
      renderGlance();
      renderPlan();
    };
  });
})();

// ── Render glance strip (lens-aware) ──────────────────────────────────────────
function renderGlance(){
  const g = document.getElementById('glance');
  const lens = CURRENT_LENS;
  const goalText = (GLANCE.goal && GLANCE.goal[lens]) || '[needs authoring]';
  const gates = (GLANCE.gates && GLANCE.gates[lens]) || [];
  const gatesLabel = (GLANCE.gatesLabel && GLANCE.gatesLabel[lens]) || 'decisions needed from you';
  const gateLabelSafe = gates.length === 0 ? 'no explicit gates' :
    gates.length + ' ' + gatesLabel;
  g.innerHTML =
    '<div class="glance-goal"><span class="plbl">Goal</span>' + esc(goalText) + propBadge + '</div>' +
    '<div class="glance-gates">' +
      (gates.length > 0 ? '<span class="glbl">\\uD83D\\uDD12 ' + esc(gateLabelSafe) + '</span>' : '') +
      gates.map(gt =>
        '<span class="gate-chip"><span class="step-ref">' + esc(gt.ref) + '</span>' + esc(gt.label) + propBadge + '</span>'
      ).join('') +
    '</div>';
}
renderGlance();

// ── Render stage bands + step cards ──────────────────────────────────────────
const tagName = {build:'BUILD', patch:'PATCH', review:'REVIEW', gate:'GATE'};

function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function renderPlan(){
  const plan = document.getElementById('plan');
  plan.innerHTML = '';

  STAGES.forEach((st, si) => {
    const stage = document.createElement('div');
    stage.className = 'stage';
    stage.dataset.band = st.band;

    const shead = document.createElement('div');
    shead.className = 'shead';
    shead.innerHTML = '<span>' + esc(st.id) + (st.proposed ? ' <span class="l-prop" style="font-size:11px;vertical-align:middle;margin-left:4px;"></span>' : '') + '</span>' +
      '<span class="meta">' + esc(st.meta) + '</span>';
    stage.appendChild(shead);

    const row = document.createElement('div');
    row.className = 'row';

    const detail = document.createElement('div');
    detail.className = 'detail';
    detail.id = 'd' + si;

    st.steps.forEach(s => {
      const b = document.createElement('div');
      b.className = 'box';
      b.dataset.sid = s.id;

      const titleObj = s.titles ? (s.titles[CURRENT_LENS] || s.titles[Object.keys(s.titles)[0]] || {text: s.desc, needsAuthoring: false})
                                 : {text: s.desc, needsAuthoring: false};
      const titleText = titleObj.text || s.desc || s.id;
      const titleNa = titleObj.needsAuthoring || false;

      b.innerHTML =
        '<span class="tag t-' + s.tag + '">' + (tagName[s.tag] || s.tag.toUpperCase()) + '</span>' +
        '<div class="sid">' + esc(s.id) + '</div>' +
        '<div class="bt">' + esc(titleText) + (titleNa ? '<br><span class="needs-authoring">needs authoring</span>' : '') + '</div>';

      b.onclick = () => {
        const isOpen = detail.classList.contains('open') && detail.dataset.sid === s.id;
        document.querySelectorAll('.detail').forEach(d => d.classList.remove('open'));
        document.querySelectorAll('.box').forEach(x => x.classList.remove('active'));

        if (!isOpen) {
          detail.dataset.sid = s.id;
          const lensObj = LENSES.find(L => L.id === CURRENT_LENS) || LENSES[0];

          const voicings = s.voicings && s.voicings[CURRENT_LENS];
          const whatText = voicings ? voicings.what : '';
          const whyText  = voicings ? voicings.why  : '';
          const whatNa   = voicings ? voicings.whatNa : true;
          const whyNa    = voicings ? voicings.whyNa  : true;

          const whatHtml = '<div class="why">' + esc(whatText || s.fallbackWhat || titleText) + (whatNa ? fallbackBadge : propBadge) + '</div>';
          const whyHtml  = '<div class="why">' + esc(whyText || s.fallbackWhy || 'This keeps the next handoff clear.') + (whyNa ? fallbackBadge : propBadge) + '</div>';

          const depsHtml = s.deps && s.deps.length
            ? s.deps.map(d => '<code>' + esc(d) + '</code>').join(', ')
            : '<em>None — first step</em>';

          const modeHtml = '<code>' + esc(s.mode || '—') + '</code>';

          detail.innerHTML =
            '<div class="dt">' + esc(s.id) + ' · ' + esc(titleText) +
              '<span style="float:right;font-weight:500;font-size:11px;color:#5b6675">' +
                esc(lensObj.icon) + ' ' + esc(lensObj.label) + ' lens</span>' +
            '</div>' +

            '<div class="lbl">What it is</div>' + whatHtml +

            '<div class="lbl">Why it matters</div>' + whyHtml +

            (CURRENT_LENS === 'operator' ? '' :
            '<div class="lbl">Depends on <span style="font-weight:400;font-style:italic;color:#5b6675;text-transform:none;letter-spacing:0">(from plan)</span></div>' +
            '<div class="dep">' + depsHtml + '</div>' +
            '') +

            '<details class="tech"><summary>Technical details</summary>' +
            '<div class="tech-inner">' +
              '<h5>Full description (from plan)</h5><p>' + esc(s.fullDesc || s.desc) + '</p>' +
              '<h5>Mode (from plan)</h5><p>' + modeHtml + '</p>' +
              (s.routeKind ? '<h5>Route kind (from plan)</h5><p><code>' + esc(s.routeKind) + '</code></p>' : '') +
              (s.routeActor ? '<h5>Route actor (from plan)</h5><p><code>' + esc(s.routeActor) + '</code></p>' : '') +
            '</div></details>';

          detail.classList.add('open');
          b.classList.add('active');
        }
      };

      row.appendChild(b);
    });

    stage.appendChild(row);
    stage.appendChild(detail);
    plan.appendChild(stage);
  });
}
renderPlan();
`;
}

/**
 * Build a human-readable meta line for a stage header.
 */
function buildStageMeta(st) {
  const stepCount = st.steps.length;
  const modes = [...new Set(st.steps.map(s => normalizeText(s.mode)).filter(Boolean))];
  const parts = [];
  if (stepCount > 0) parts.push(stepCount === 1 ? '1 step' : `${stepCount} steps`);
  if (modes.includes('REVIEW_ONLY')) parts.push('read-only');
  if (modes.some(m => m === 'PATCH_ALLOWED')) parts.push('builds allowed');
  if (st.proposed) parts.push('✎ grouping proposed');
  return parts.join(' · ');
}

/**
 * Build the serializable step data object for embedding in inline JS.
 */
function buildStepData(step, lensIds) {
  const tag = deriveTag(step);
  const desc = normalizeText(step.description);
  const fallbackTitle = operatorTitleFromStep(step);
  const fallbackWhat = operatorWhatFromStep(step);
  const fallbackWhy = operatorWhyFromStep(step);

  // Build per-lens title and voicing objects
  const titles = {};
  const voicings = {};

  for (const lensId of lensIds) {
    const audience = step.audiences && step.audiences[lensId];

    // Title
    if (audience) {
      const v = visibleVoicing(audience, 'what');
      if (!v.needsAuthoring && v.text) {
        const t = v.text.length > 120 ? v.text.slice(0, 120) + '…' : v.text;
        titles[lensId] = { text: t, needsAuthoring: false };
      } else {
        const t = lensId === 'operator' ? fallbackTitle : (desc.length > 120 ? desc.slice(0, 120) + '…' : desc);
        titles[lensId] = { text: t, needsAuthoring: false, sourceDerived: true };
      }
    } else {
      const t = lensId === 'operator' ? fallbackTitle : (desc.length > 120 ? desc.slice(0, 120) + '…' : desc);
      titles[lensId] = { text: t, needsAuthoring: lensId !== 'operator' && !desc, sourceDerived: lensId === 'operator' };
    }

    // Voicings
    if (audience) {
      const what = visibleVoicing(audience, 'what');
      const why  = visibleVoicing(audience, 'why');
      voicings[lensId] = {
        what: what.needsAuthoring && lensId === 'operator' ? fallbackWhat : what.text,
        why: why.needsAuthoring && lensId === 'operator' ? fallbackWhy : why.text,
        whatNa: what.needsAuthoring,
        whyNa: why.needsAuthoring
      };
    } else {
      voicings[lensId] = lensId === 'operator'
        ? { what: fallbackWhat, why: fallbackWhy, whatNa: true, whyNa: true }
        : { what: '', why: '', whatNa: true, whyNa: true };
    }
  }

  const deps = Array.isArray(step.depends_on) ? step.depends_on : [];

  return {
    id: normalizeText(step.step_id),
    tag,
    desc: desc.slice(0, 200),
    fullDesc: desc,
    fallbackWhat,
    fallbackWhy,
    mode: normalizeText(step.mode),
    routeKind: normalizeText(step.route && step.route.kind),
    routeActor: normalizeText(step.route && step.route.actor),
    deps,
    titles,
    voicings
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Render a self-contained plandoc HTML string from a parsed plan JSON.
 *
 * @param {object} planJson - Parsed __plan.json object.
 * @returns {string} Self-contained HTML. No external CDN references.
 * @throws {Error} If the framing linter finds errors in step.audiences.*.what/why fields.
 */
function renderPlandocHtml(planJson) {
  if (!planJson || typeof planJson !== 'object') {
    throw new Error('renderPlandocHtml: planJson must be a non-null object');
  }

  // ── Framing linter gate (fail-closed) ──────────────────────────────────────
  const lint = lintPlanAudienceFraming(planJson);
  if (!lint.ok) {
    const errors = lint.findings
      .filter(f => f.severity === 'error')
      .map(f => `[${f.step_id}/${f.audience}/${f.field}] ${f.message}`)
      .join('; ');
    throw new Error(`Plandoc framing lint failed — fix before rendering: ${errors}`);
  }

  // ── Derive layout data ──────────────────────────────────────────────────────
  const lensIds = deriveLensIds(planJson);
  const stages  = deriveStages(planJson);
  const glance  = deriveGlance(planJson, lensIds);
  const operatorBrief = buildOperatorBrief(planJson, stages);

  const title    = escapeHtml(normalizeText(planJson.title || planJson.task_id || 'Plan'));
  const taskId   = escapeHtml(normalizeText(planJson.task_id || ''));
  const scopeType = normalizeText(planJson.scope_type || '');
  const riskTier  = normalizeText(
    planJson.routing_expectations && planJson.routing_expectations.risk_tier || ''
  );
  const operatorGated = stages.some(st =>
    st.steps.some(s => s && (
      normalizeText(s.mode).toUpperCase().includes('GATE') ||
      (s.route && normalizeText(s.route.kind).toLowerCase() === 'operator_gate')
    ))
  );

  const allSteps = stages.flatMap(st => st.steps);
  const stepCount = allSteps.length;
  const groupCount = stages.length;

  const subtitle = [
    `${stepCount} step${stepCount !== 1 ? 's' : ''}`,
    `${groupCount} work-unit group${groupCount !== 1 ? 's' : ''}`,
    riskTier ? `risk: ${riskTier}` : '',
    operatorGated ? 'operator-gated' : '',
    'Click any step box to see its plain-English what &amp; why.'
  ].filter(Boolean).join(' · ');

  const inlineScript = buildInlineScript(planJson, lensIds, stages, glance);
  const formatNav = renderVisualFormatNav(taskId, 'plandoc');

  // Risk notes for footer
  const riskNotes = escapeHtml(
    normalizeText(planJson.bounded_plan && planJson.bounded_plan.risk_notes || planJson.risk_notes || '')
  );
  const footerFlow = riskNotes
    ? `<br><b>Risk notes:</b> ${riskNotes.slice(0, 400)}${riskNotes.length > 400 ? '…' : ''}`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · plandoc</title>
<style>${CSS}</style>
</head>
<body>

<header>
  <div class="header-copy">
    <h1>${title}</h1>
    <p>${subtitle}</p>
  </div>
  ${formatNav}
</header>

<div class="wrap">

  <!-- Legend -->
  <div class="legend">
    <strong>Key</strong>
    <span><span class="l-real">from plan</span> — read directly from plan JSON</span>
    <span><span class="l-prop">proposed</span> — derived by document layer, not in plan JSON</span>
    <span style="flex-basis:100%;color:#7c5b00;border-top:1px solid #ffe082;padding-top:8px;margin-top:2px;font-style:italic;">
      Facts (step IDs, file names, risk tier, required gates) are constant across lenses — only voice / jargon / emphasis changes.
      Work-unit group names and plain-English translations marked ✒ are derived by the document layer, not authored in the source plan.
    </span>
  </div>

  <!-- Audience lens toggle -->
  <div class="lens-bar" id="lensbar"></div>

  <!-- Operator summary -->
  <div class="operator-brief" aria-label="Plain-language plan summary">
    <section class="brief-item"><h2>The Goal</h2><p>${escapeHtml(operatorBrief.goal)}</p></section>
    <section class="brief-item"><h2>The Impact</h2><p>${escapeHtml(operatorBrief.impact)}</p></section>
    <section class="brief-item"><h2>The Flight Path</h2><p>${escapeHtml(operatorBrief.flightPath)}</p></section>
    <section class="brief-item"><h2>My Checkpoints</h2><p>${escapeHtml(operatorBrief.checkpoints)}</p></section>
    <section class="brief-item"><h2>High-Level Risks</h2><p>${escapeHtml(operatorBrief.risks)}</p></section>
  </div>

  <!-- Plan glance strip -->
  <div class="glance" id="glance"></div>

  <!-- Stage bands rendered by JS -->
  <div id="plan"></div>

</div><!-- /wrap -->

<footer>
  Tags: <b style="color:#6a1b9a">BUILD</b> create or write something new ·
        <b style="color:#1565c0">PATCH</b> modify an existing artifact ·
        <b style="color:#b8860b">REVIEW</b> read-only check, nothing is changed ·
        <b style="color:#e65100">GATE</b> cannot proceed without your explicit approval.${footerFlow}
</footer>

<script>
${inlineScript}
</script>

</body>
</html>`;
}

module.exports = { renderPlandocHtml };
