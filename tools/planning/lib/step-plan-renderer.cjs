'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  FALLBACK_LENS,
  AUDIENCE_LENSES,
  inferDomainFromFrameworkStep,
  lensForDomain,
  normalizeAudienceKey
} = require('./domain-audience-registry');
const { lintPlanAudienceFraming } = require('../../ai-bridge/lib/plan-audience-framing-lint.cjs');
const { resolveTaskPlanPaths } = require('./resolve-task-plan.js');

const VISUAL_ROOT = path.join('_dev', 'reports', 'analysis', 'visual-plans');
const SUPPORTED_AUDIENCES = ['owner', 'media_buyer'];
const FALLBACK_DOMAINS = ['developer', 'designer', 'seo', 'analytics', 'finance', 'compliance'];

function safeSlug(value) {
  return String(value || 'step-plan').replace(/[^a-zA-Z0-9._-]+/g, '-');
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
      `<a href="${escapeAttr(format.href)}"${format.id === active ? ' aria-current="page"' : ''}>${escapeHtml(format.label)}</a>`
    )).join('')
    + '</nav>';
}

function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function escapeJsString(value) {
  return JSON.stringify(String(value == null ? '' : value));
}

function mermaidId(value) {
  return `s_${String(value || 'step').replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function mermaidLabel(value) {
  return String(value || '').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function readPlan(projectRoot, taskRef) {
  const resolved = resolveTaskPlanPaths(projectRoot, taskRef);
  if (!resolved) throw new Error(`No task plan found for ${taskRef}`);
  return {
    resolved,
    plan: JSON.parse(fs.readFileSync(resolved.jsonPath, 'utf8'))
  };
}

function planSteps(plan) {
  if (Array.isArray(plan?.bounded_plan?.steps)) return plan.bounded_plan.steps;
  if (Array.isArray(plan?.steps)) return plan.steps;
  return [];
}

function stepId(step, index) {
  return normalizeText(step.step_id || step.id || `step-${index + 1}`);
}

function stepStatus(step) {
  return normalizeText(step.status || step.state || 'planned') || 'planned';
}

function stepMode(step) {
  return normalizeText(step.mode || step.framework_mode || step.execution_mode || step.classification || 'STEP');
}

function asList(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  const text = normalizeText(value);
  return text ? [text] : [];
}

function normalizeAudienceField(entry, field) {
  if (!entry || typeof entry !== 'object') return null;
  const raw = entry[field];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      text: normalizeText(raw.text),
      provenance_handle: normalizeText(raw.provenance_handle),
      source_field: normalizeText(raw.source_field),
      provenance_state: normalizeText(raw.provenance_state),
      source: normalizeText(raw.provenance_state),
      shape: 'nested'
    };
  }
  if (typeof raw === 'string') {
    return {
      text: normalizeText(raw),
      provenance_handle: normalizeText(entry[`${field}_provenance`]),
      source_field: normalizeText(entry[`${field}_source_field`] || entry.source_field),
      provenance_state: normalizeText(entry[`${field}_provenance_state`] || entry.provenance_state || entry.source),
      source: normalizeText(entry.source),
      shape: 'flat'
    };
  }
  return null;
}

function audienceEntry(step, audienceKey, field) {
  const audiences = step && step.audiences && typeof step.audiences === 'object' ? step.audiences : {};
  const entry = audiences[audienceKey];
  return normalizeAudienceField(entry, field);
}

function fallbackProvenance(step, field) {
  return {
    text: normalizeText(step.description || step.summary || step.name || 'Needs authoring.'),
    provenance_handle: `bounded_plan.steps.${stepId(step, 0)}.description`,
    source_field: 'description',
    provenance_state: 'source-derived',
    source: 'fallback-description',
    shape: 'derived-fallback'
  };
}

function visibleVoicing(step, audienceKey, field) {
  const authored = audienceEntry(step, audienceKey, field);
  if (authored && authored.provenance_state === 'needs-authoring') {
    return {
      ...authored,
      text: authored.text || '[needs authoring]',
      placeholder: true
    };
  }
  if (authored && authored.text) return authored;
  return fallbackProvenance(step, field);
}

function stepDomain(step) {
  const explicit = normalizeText(step.domain);
  if (explicit) return explicit;
  return inferDomainFromFrameworkStep(step.framework_step || step.stage || step.step_id || '');
}

function stageLabel(step, index) {
  return normalizeText(step.stage_title || step.stage || `Stage ${index + 1}`);
}

function collectGates(step, plan) {
  return [
    ...asList(step.required_gates),
    ...asList(step.gate),
    ...asList(plan?.bounded_plan?.required_gates)
  ];
}

function collectRisks(step, plan) {
  return [
    ...asList(step.risk_notes),
    ...asList(plan?.bounded_plan?.risk_notes),
    ...asList(plan?.risk_notes)
  ];
}

function collectOutcomes(step, plan) {
  return [
    ...asList(step.expected_outcomes),
    ...asList(plan?.bounded_plan?.expected_outcomes)
  ];
}

function collectDependencies(step, previousStepId) {
  const explicit = Array.isArray(step.depends_on) ? step.depends_on.map(normalizeText).filter(Boolean) : [];
  if (explicit.length) return explicit;
  return previousStepId ? [previousStepId] : [];
}

function buildStepRows(plan) {
  const steps = planSteps(plan);
  return steps.map((step, index) => {
    const id = stepId(step, index);
    const previousId = index > 0 ? stepId(steps[index - 1], index - 1) : '';
    const domain = stepDomain(step);
    const lens = lensForDomain(domain);
    const owner = {
      what: visibleVoicing(step, 'owner', 'what'),
      why: visibleVoicing(step, 'owner', 'why')
    };
    const mediaBuyer = {
      what: visibleVoicing(step, 'media_buyer', 'what'),
      why: visibleVoicing(step, 'media_buyer', 'why')
    };
    return {
      id,
      index,
      stage: stageLabel(step, index),
      status: stepStatus(step),
      mode: stepMode(step),
      domain,
      lens_id: lens.id,
      lens_status: lens.status,
      visible_fallback: lens.status === 'fallback' ? lens.visible_marker : '',
      description: normalizeText(step.description || step.summary || step.name || ''),
      framework_step: normalizeText(step.framework_step),
      is_gap: Boolean(step.is_gap),
      dependencies: collectDependencies(step, previousId),
      gates: collectGates(step, plan),
      risks: collectRisks(step, plan),
      outcomes: collectOutcomes(step, plan),
      audiences: {
        owner,
        media_buyer: mediaBuyer
      }
    };
  });
}

function renderStepPlanMermaid(plan, options = {}) {
  const rows = buildStepRows(plan);
  const lines = ['flowchart TD'];
  if (!rows.length) {
    lines.push('  none["No bounded plan steps recorded"]');
    return `${lines.join('\n')}\n`;
  }

  const stages = new Map();
  for (const row of rows) {
    if (!stages.has(row.stage)) stages.set(row.stage, []);
    stages.get(row.stage).push(row);
  }

  let stageIndex = 0;
  for (const [stage, stageRows] of stages) {
    stageIndex += 1;
    lines.push(`  subgraph stage_${stageIndex}["${mermaidLabel(stage)}"]`);
    for (const row of stageRows) {
      const label = `${row.id}\\n${row.mode}${row.gates.length ? ' | GATE' : ''}${row.risks.length ? ' | RISK' : ''}`;
      lines.push(`    ${mermaidId(row.id)}["${mermaidLabel(label)}"]`);
    }
    lines.push('  end');
  }

  for (const row of rows) {
    for (const dep of row.dependencies) {
      if (rows.some((candidate) => candidate.id === dep)) {
        lines.push(`  ${mermaidId(dep)} --> ${mermaidId(row.id)}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

function stepDataForHtml(plan) {
  const rows = buildStepRows(plan);
  return {
    schema: 'StepPlanRenderModel/1.0',
    task_id: plan.task_id || '',
    title: plan.title || plan.task_summary || plan.task_id || 'Task plan',
    generated_from: 'TaskPlan/1.0',
    audiences: SUPPORTED_AUDIENCES.map((id) => ({
      id,
      label: AUDIENCE_LENSES[id] ? AUDIENCE_LENSES[id].label : id
    })),
    fallback_domains: FALLBACK_DOMAINS.map((domain) => ({
      domain,
      marker: FALLBACK_LENS.visible_marker
    })),
    steps: rows
  };
}

function renderInvariantList(row) {
  const sections = [];
  if (row.dependencies.length) sections.push(['Dependencies', row.dependencies]);
  if (row.gates.length) sections.push(['Gates', row.gates.map((gate) => `${gate} (your decision)`)]);
  if (row.risks.length) sections.push(['Risks', row.risks]);
  if (row.outcomes.length) sections.push(['Expected outcomes', row.outcomes]);
  if (!sections.length) return '<p class="muted">No gates, risks, dependencies, or expected outcomes recorded for this step.</p>';
  return sections.map(([label, items]) => (
    `<div class="invariant"><h4>${escapeHtml(label)}</h4><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`
  )).join('');
}

function renderProvenance(item) {
  return [
    item.provenance_handle ? `handle: ${item.provenance_handle}` : 'handle: missing',
    item.source_field ? `source field: ${item.source_field}` : 'source field: missing',
    item.provenance_state ? `state: ${item.provenance_state}` : 'state: missing'
  ].join(' | ');
}

function deterministicGeneratedAt(plan, options = {}) {
  return normalizeText(options.generatedAt || plan.produced_at || plan.timestamp || 'source-plan');
}

function renderStepPlanHtml(plan, options = {}) {
  const model = stepDataForHtml(plan);
  const taskId = model.task_id || 'task-plan';
  const generatedAt = deterministicGeneratedAt(plan, options);
  const dataJson = JSON.stringify(model).replace(/</g, '\\u003c');
  const mermaid = renderStepPlanMermaid(plan, options);
  const rows = model.steps;
  const firstId = rows[0] ? rows[0].id : '';
  const firstAudience = 'owner';
  const formatNav = renderVisualFormatNav(taskId, 'steps');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(model.title)} - step plan</title>
  <style>
    :root { color-scheme: light; --ink:#17202a; --muted:#5f6b76; --line:#d9dee6; --panel:#f7f9fb; --accent:#1d5f7a; --risk:#8a3a16; --gate:#7a2141; }
    * { box-sizing: border-box; }
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--ink); background:#fff; }
    header { padding:22px 28px 16px; border-bottom:1px solid var(--line); background:#f9fafb; display:flex; gap:16px; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; }
    .header-copy { min-width:260px; flex:1 1 auto; }
    h1 { margin:0 0 8px; font-size:24px; letter-spacing:0; }
    .authority { color:var(--muted); font-size:13px; max-width:980px; }
    .format-nav { display:flex; flex-wrap:wrap; gap:6px; align-items:center; padding-top:2px; }
    .format-nav a { color:var(--accent); text-decoration:none; border:1px solid var(--line); border-radius:999px; padding:4px 10px; font-size:12px; background:#fff; }
    .format-nav a[aria-current="page"] { background:var(--accent); color:#fff; border-color:var(--accent); font-weight:700; }
    main { display:grid; grid-template-columns:minmax(250px,340px) 1fr; min-height:calc(100vh - 92px); }
    nav { border-right:1px solid var(--line); padding:16px; background:#fbfcfd; overflow:auto; }
    .step-btn { display:block; width:100%; text-align:left; border:1px solid var(--line); background:#fff; padding:10px; margin:0 0 8px; border-radius:6px; cursor:pointer; color:var(--ink); }
    .step-btn[aria-current="true"] { border-color:var(--accent); box-shadow:inset 3px 0 0 var(--accent); }
    .step-id { font-weight:700; display:block; overflow-wrap:anywhere; }
    .meta { color:var(--muted); font-size:12px; margin-top:3px; }
    .content { padding:18px 24px 28px; overflow:auto; }
    .toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:16px; }
    .toggle { border:1px solid var(--line); background:#fff; color:var(--ink); border-radius:6px; padding:8px 10px; cursor:pointer; }
    .toggle[aria-pressed="true"] { background:#e6f2f6; border-color:var(--accent); color:#0d4258; font-weight:700; }
    .diagram { border:1px solid var(--line); border-radius:6px; padding:12px; background:#fff; overflow:auto; margin-bottom:16px; }
    pre { margin:0; white-space:pre; font-size:12px; }
    .step-card { border:1px solid var(--line); border-radius:6px; padding:16px; background:#fff; }
    .tag-row { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0 14px; }
    .tag { border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; color:#30404f; background:#f8fafc; }
    .tag.gate { color:var(--gate); border-color:#e2b8c8; background:#fff5f8; }
    .tag.risk { color:var(--risk); border-color:#ecc7b5; background:#fff7f2; }
    .copy-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:12px 0; }
    .copy-box { background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:12px; min-width:0; }
    .copy-box h3, .invariant h4 { margin:0 0 8px; font-size:14px; }
    .copy-box p { margin:0 0 8px; line-height:1.45; overflow-wrap:anywhere; }
    .prov { color:var(--muted); font-size:12px; overflow-wrap:anywhere; }
    .invariants { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; margin-top:14px; }
    .invariant { border:1px solid var(--line); border-radius:6px; padding:10px; background:#fff; }
    .invariant ul { margin:0; padding-left:18px; }
    .fallbacks { margin-top:16px; padding:12px; border:1px dashed var(--line); border-radius:6px; color:var(--muted); }
    .fallbacks span { display:inline-block; margin:3px 8px 3px 0; }
    .muted { color:var(--muted); }
    @media (max-width: 820px) { main { grid-template-columns:1fr; } nav { border-right:0; border-bottom:1px solid var(--line); max-height:230px; } .copy-grid { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <header>
    <div class="header-copy">
      <h1>${escapeHtml(model.title)}</h1>
      <div class="authority">Derived step-level visual context only. Task-plan JSON/MD, amendments, reviews, signals, and canonical command specs remain authority. Generated ${escapeHtml(generatedAt)}.</div>
    </div>
    ${formatNav}
  </header>
  <main>
    <nav aria-label="Plan steps">
      ${rows.map((row) => `<button class="step-btn" data-step="${escapeAttr(row.id)}" aria-current="${row.id === firstId ? 'true' : 'false'}"><span class="step-id">${escapeHtml(row.id)}</span><span class="meta">${escapeHtml(row.stage)} · ${escapeHtml(row.mode)} · ${escapeHtml(row.status)}</span></button>`).join('')}
    </nav>
    <section class="content">
      <div class="toolbar" aria-label="Audience lens">
        ${model.audiences.map((audience) => `<button class="toggle" data-audience="${escapeAttr(audience.id)}" aria-pressed="${audience.id === firstAudience ? 'true' : 'false'}">${escapeHtml(audience.label)}</button>`).join('')}
      </div>
      <section class="diagram" aria-label="Mermaid source"><pre>${escapeHtml(mermaid)}</pre></section>
      <section id="stepDetail" class="step-card"></section>
      <section class="fallbacks"><strong>Visible fallback domains:</strong> ${model.fallback_domains.map((row) => `<span>${escapeHtml(row.domain)}: ${escapeHtml(row.marker)}</span>`).join('')}</section>
    </section>
  </main>
  <script id="step-plan-data" type="application/json">${dataJson}</script>
  <script>
    const model = JSON.parse(document.getElementById('step-plan-data').textContent);
    let currentStep = ${escapeJsString(firstId)};
    let currentAudience = ${escapeJsString(firstAudience)};
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const detail = document.getElementById('stepDetail');
    function provenance(item) {
      const parts = [];
      parts.push(item.provenance_handle ? 'handle: ' + item.provenance_handle : 'handle: missing');
      parts.push(item.source_field ? 'source field: ' + item.source_field : 'source field: missing');
      parts.push(item.provenance_state ? 'state: ' + item.provenance_state : 'state: missing');
      return parts.join(' | ');
    }
    function listBlock(label, items, suffix) {
      if (!items || !items.length) return '';
      return '<div class="invariant"><h4>' + esc(label) + '</h4><ul>' + items.map(item => '<li>' + esc(item + (suffix || '')) + '</li>').join('') + '</ul></div>';
    }
    function render() {
      const row = model.steps.find(step => step.id === currentStep) || model.steps[0];
      if (!row) { detail.innerHTML = '<p class="muted">No steps recorded.</p>'; return; }
      const lens = row.audiences[currentAudience] || row.audiences.owner;
      const tags = [row.mode, row.status, row.domain, row.framework_step].filter(Boolean);
      detail.innerHTML =
        '<h2>' + esc(row.id) + '</h2>' +
        '<p class="muted">' + esc(row.stage) + '</p>' +
        '<div class="tag-row">' + tags.map(tag => '<span class="tag">' + esc(tag) + '</span>').join('') +
        (row.gates.length ? '<span class="tag gate">GATE</span>' : '') +
        (row.risks.length ? '<span class="tag risk">RISK</span>' : '') + '</div>' +
        '<div class="copy-grid">' +
          '<div class="copy-box"><h3>What</h3><p>' + esc(lens.what.text || '[needs authoring]') + '</p><div class="prov">' + esc(provenance(lens.what)) + '</div></div>' +
          '<div class="copy-box"><h3>Why</h3><p>' + esc(lens.why.text || '[needs authoring]') + '</p><div class="prov">' + esc(provenance(lens.why)) + '</div></div>' +
        '</div>' +
        '<div class="invariants">' +
          listBlock('Dependencies', row.dependencies || []) +
          listBlock('Gates', row.gates || [], ' (your decision)') +
          listBlock('Risks', row.risks || []) +
          listBlock('Expected outcomes', row.outcomes || []) +
        '</div>';
      document.querySelectorAll('.step-btn').forEach(btn => btn.setAttribute('aria-current', String(btn.dataset.step === row.id)));
      document.querySelectorAll('.toggle').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.audience === currentAudience)));
    }
    document.querySelectorAll('.step-btn').forEach(btn => btn.addEventListener('click', () => { currentStep = btn.dataset.step; render(); }));
    document.querySelectorAll('.toggle').forEach(btn => btn.addEventListener('click', () => { currentAudience = btn.dataset.audience; render(); }));
    render();
  </script>
</body>
</html>
`;
}

function renderStepPlanMarkdownWrapper(plan, options = {}) {
  const title = plan.title || plan.task_summary || plan.task_id || 'Task plan';
  return [
    `# ${title} - step plan`,
    '',
    '> Derived visual context only. Task-plan JSON/MD remains authority.',
    '',
    '```mermaid',
    renderStepPlanMermaid(plan, options).trim(),
    '```',
    ''
  ].join('\n');
}

function buildStepPlanArtifacts(projectRoot, options = {}) {
  const taskRef = options.taskId || options.plan;
  if (!taskRef) throw new Error('--plan is required');
  const { plan, resolved } = readPlan(projectRoot, taskRef);
  const taskId = plan.task_id || path.basename(resolved.jsonPath, '__plan.json');
  const lint = lintPlanAudienceFraming(plan, { plan_path: path.relative(projectRoot, resolved.jsonPath) });
  if (!lint.ok) {
    const codes = lint.findings.map((item) => `${item.step_id}/${item.audience}/${item.field}:${item.code}`).join(', ');
    throw new Error(`Plan audience framing lint failed; refusing to render step plan: ${codes}`);
  }
  const outputRoot = options.outputRoot || VISUAL_ROOT;
  const slug = safeSlug(taskId);
  return {
    schema: 'StepPlanArtifacts/1.0',
    task_id: taskId,
    source_plan: path.relative(projectRoot, resolved.jsonPath).split(path.sep).join('/'),
    paths: {
      mmd: path.join(outputRoot, `${slug}.steps.mmd`).split(path.sep).join('/'),
      md: path.join(outputRoot, `${slug}.steps.md`).split(path.sep).join('/'),
      html: path.join(outputRoot, `${slug}.steps.html`).split(path.sep).join('/')
    },
    lint,
    mermaid: renderStepPlanMermaid(plan, options),
    markdown: renderStepPlanMarkdownWrapper(plan, options),
    html: renderStepPlanHtml(plan, { ...options, generatedAt: deterministicGeneratedAt(plan, options) }),
    model: stepDataForHtml(plan)
  };
}

function writeStepPlanArtifacts(projectRoot, options = {}) {
  const built = buildStepPlanArtifacts(projectRoot, options);
  for (const [key, relPath] of Object.entries(built.paths)) {
    const abs = path.resolve(projectRoot, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const text = key === 'mmd' ? built.mermaid : key === 'md' ? built.markdown : built.html;
    fs.writeFileSync(abs, text.endsWith('\n') ? text : `${text}\n`);
  }
  return built;
}

module.exports = {
  VISUAL_ROOT,
  SUPPORTED_AUDIENCES,
  FALLBACK_DOMAINS,
  buildStepRows,
  buildStepPlanArtifacts,
  deterministicGeneratedAt,
  renderStepPlanHtml,
  renderStepPlanMermaid,
  renderStepPlanMarkdownWrapper,
  stepDataForHtml,
  writeStepPlanArtifacts
};
