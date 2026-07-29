function modeTable(executionModes) {
  const rows = executionModes.map((m) => `| ${m.id} | ${String(m.can_write)} | ${String(m.can_execute)} | ${m.description} |`);
  return [
    '| Mode | Can Write | Can Execute | Description |',
    '|---|---|---|---|',
    ...rows
  ].join('\n');
}

function mcpRequirementName(req) {
  if (req == null) return '';
  if (typeof req === 'string') return req;
  if (typeof req === 'object') return req.name || req.server || req.id || '';
  return String(req);
}

function frameworkTable(frameworks) {
  const rows = frameworks.map((fw) => {
    const mcp = fw.mcp_requirements.map(mcpRequirementName).filter(Boolean).join(', ') || 'none';
    return `| ${fw.id} | ${fw.prompt_count} | ${fw.execution_modes.join(', ')} | ${mcp} |`;
  });
  return [
    '| Framework | Prompt Count | Modes | MCP Requirements |',
    '|---|---:|---|---|',
    ...rows
  ].join('\n');
}

function operationsList(operations) {
  return operations.map((op) => `- \`${op.id}\` (${op.mode}): ${op.description}`).join('\n');
}

function safetyList(safetyRules) {
  return safetyRules.map((r) => `- ${r}`).join('\n');
}

function agentsList(agents) {
  return agents.map((a) => `- \`${a.id}\`: ${a.purpose}`).join('\n');
}

function orchestrationSummary(policy) {
  return [
    `- Completion auditing: ${policy.completion_auditing}`,
    `- Max reopen cycles: ${policy.max_reopen_cycles}`,
    `- Audit exemptions: ${policy.audit_exemptions.join(', ')}`,
    `- Evidence required: ${policy.evidence_required.join(', ')}`
  ].join('\n');
}

// Render one domain's aliases as bullet lines, grouped primary -> cross-alias ->
// compatibility (and any remaining statuses treated as compatibility). `prefix`
// is `/` for slash commands and '' for framework/skill/tool names.
function renderAliasGroup(aliases, prefix) {
  // primary alias id -> its authority, so a cross-alias that resolves to a
  // primary alias still reports the underlying canonical id.
  const primaryAuthorityById = new Map();
  for (const alias of aliases) {
    if (alias.status === 'primary') primaryAuthorityById.set(alias.id, alias.resolves_to);
  }
  const authorityOf = (alias) => {
    const target = alias.resolves_to;
    return primaryAuthorityById.has(target) ? primaryAuthorityById.get(target) : target;
  };

  const primaries = aliases.filter((a) => a.status === 'primary');
  const crossAliases = aliases.filter((a) => a.status === 'cross-alias');
  const compatibility = aliases.filter((a) => a.status !== 'primary' && a.status !== 'cross-alias');

  const lines = [];
  for (const alias of primaries) {
    lines.push(`- \`${prefix}${alias.id}\` (\`${prefix}${authorityOf(alias)}\`) [primary]; authority: \`${prefix}${authorityOf(alias)}\``);
  }
  for (const alias of crossAliases) {
    lines.push(`- \`${prefix}${alias.id}\` -> \`${prefix}${alias.resolves_to}\` [cross-alias]; authority: \`${prefix}${authorityOf(alias)}\``);
  }
  for (const alias of compatibility) {
    lines.push(`- \`${prefix}${alias.id}\` -> \`${prefix}${alias.resolves_to}\` [${alias.status || 'compatibility'}]; authority: \`${prefix}${authorityOf(alias)}\``);
  }
  return lines;
}

// Render the "## Command Aliases" section from the alias registry. Accepts
// either the full registry object ({ aliases, framework_aliases, skill_aliases,
// tool_aliases }) or, for back-compatibility, a bare command-alias array.
// Commands render directly under the heading (primary mythic names first with
// the canonical id in parentheses, then cross-aliases, then compatibility); the
// framework/skill/tool domains, when present, follow as labelled subsections.
// Returns null when no aliases ship, so the section is simply absent and the
// surface stays byte-identical to the aliasless baseline.
function commandAliasSection(registry) {
  const domains = Array.isArray(registry) ? { aliases: registry } : (registry || {});
  const commands = domains.aliases || [];
  const frameworks = domains.framework_aliases || [];
  const skills = domains.skill_aliases || [];
  const tools = domains.tool_aliases || [];

  if (!commands.length && !frameworks.length && !skills.length && !tools.length) return null;

  const lines = [
    '## Command Aliases',
    '',
    'Command names are mechanical aliases. The typed alias is provenance; authority, state, errors, evidence, and closeout belong to the resolved generic command.',
    ''
  ];
  lines.push(...renderAliasGroup(commands, '/'));

  const domainBlock = (title, aliases) => {
    if (!aliases.length) return;
    lines.push('', `### ${title}`, '', ...renderAliasGroup(aliases, ''));
  };
  domainBlock('Framework aliases', frameworks);
  domainBlock('Skill aliases', skills);
  domainBlock('Tool aliases', tools);

  return lines.join('\n');
}

// Render the "## The Core (doctrine)" section from the system kernel doctrine.
// Returns null when no doctrine ships, so the shared body stays byte-identical.
function coreDoctrineSection(doctrine) {
  if (!doctrine || !String(doctrine).trim()) return null;
  return ['## The Core (doctrine)', '', String(doctrine).trim()].join('\n');
}

function sharedBody(model) {
  const canonical = model.canonical || {};
  const sections = [
    '## Project',
    `${model.system.project.name}: ${model.system.project.description}`,
    '',
    '## Routing',
    `- Load framework manifest: \`${model.system.routing.framework_context}\``,
    `- Load framework guardrails: \`${model.system.routing.framework_guardrails}\``,
    `- Load project context when applicable: \`${model.system.routing.project_context}\``,
    '',
    '## Safety Rules',
    safetyList(model.system.safety_rules)
  ];

  // Core doctrine renders immediately after safety rules.
  const doctrineSection = coreDoctrineSection(canonical.doctrine);
  if (doctrineSection) {
    sections.push('', doctrineSection);
  }

  sections.push(
    '',
    '## Execution Modes',
    modeTable(model.system.execution_modes),
    '',
    '## Operations',
    operationsList(model.system.operations),
    '',
    '## Agents',
    agentsList(model.system.agents),
    '',
    '## Orchestration Policy',
    orchestrationSummary(model.system.orchestration_policy),
    '',
    '## Registered Frameworks',
    frameworkTable(model.frameworks)
  );

  const aliasSection = commandAliasSection(canonical.aliasRegistry || canonical.commandAliases);
  if (aliasSection) {
    sections.push('', aliasSection);
  }

  return sections.join('\n');
}

function renderGeneric(model) {
  return [
    '# INSTRUCTIONS',
    '',
    '> AUTO-GENERATED FILE. Edit canonical source in `instructions/canonical/*` and regenerate.',
    '',
    sharedBody(model)
  ].join('\n');
}

function renderCodex(model) {
  return [
    '# AGENTS.md',
    '',
    '> AUTO-GENERATED FILE. Edit canonical source in `instructions/canonical/*` and regenerate.',
    '',
    'Codex runtime guidance for Mythos.',
    '',
    sharedBody(model),
    '',
    '## Codex Notes',
    '- Use repository-local manifests as source of truth.',
    '- Prefer non-destructive changes unless explicitly requested.',
    '- Keep behavior aligned with canonical mode semantics.'
  ].join('\n');
}

function renderOpenCode(model) {
  return [
    '# OPENCODE.md',
    '',
    '> AUTO-GENERATED FILE. Edit canonical source in `instructions/canonical/*` and regenerate.',
    '',
    'OpenCode runtime guidance for Mythos.',
    '',
    sharedBody(model),
    '',
    '## OpenCode Notes',
    '- Adapter targets are configurable via `instructions/adapters/targets.local.yaml`.',
    '- Keep strict parity with canonical safety and mode rules.'
  ].join('\n');
}

function renderCursorRoot() {
  return [
    '# .cursorrules',
    '',
    '> AUTO-GENERATED FILE. Edit canonical source in `instructions/canonical/*` and regenerate.',
    '',
    '- Primary policy lives in `.cursor/rules/llmos.mdc`.',
    '- Apply strict execution mode enforcement.',
    '- Keep outputs observational and evidence-cited.'
  ].join('\n');
}

function renderCursorRule(model) {
  return [
    '# Mythos Rule',
    '',
    '> AUTO-GENERATED FILE. Edit canonical source in `instructions/canonical/*` and regenerate.',
    '',
    '## Scope',
    `${model.system.project.name} instruction policy for Cursor.`,
    '',
    '## Required Behavior',
    ...model.system.safety_rules.map((r) => `- ${r}`),
    '',
    '## Execution Modes',
    modeTable(model.system.execution_modes),
    '',
    '## Operations',
    operationsList(model.system.operations),
    '',
    '## Agents',
    agentsList(model.system.agents),
    '',
    '## Orchestration Policy',
    orchestrationSummary(model.system.orchestration_policy)
  ].join('\n');
}

function renderClaudeRouter(model) {
  return [
    '# CLAUDE.md',
    '',
    '> AUTO-GENERATED PREVIEW FILE. Canonical source: `instructions/canonical/*`.',
    '',
    sharedBody(model)
  ].join('\n');
}

function renderClaudeProject(model) {
  return [
    '# .claude/CLAUDE.md',
    '',
    '> AUTO-GENERATED PREVIEW FILE. Canonical source: `instructions/canonical/*`.',
    '',
    '## Scope',
    `${model.system.project.name} project-level behavioral policy.`,
    '',
    '## Safety',
    ...model.system.safety_rules.map((r) => `- ${r}`),
    '',
    '## Modes',
    modeTable(model.system.execution_modes),
    '',
    '## Agents',
    agentsList(model.system.agents),
    '',
    '## Orchestration Policy',
    orchestrationSummary(model.system.orchestration_policy)
  ].join('\n');
}

function renderClaudeGuardrails(model, canonicalGuardrails) {
  return [
    '# .claude/guardrails.md',
    '',
    '> AUTO-GENERATED PREVIEW FILE. Canonical source: `instructions/canonical/*`.',
    '',
    canonicalGuardrails.trim(),
    '',
    '## Framework Registry Snapshot',
    frameworkTable(model.frameworks)
  ].join('\n');
}

module.exports = {
  renderGeneric,
  renderCodex,
  renderOpenCode,
  renderCursorRoot,
  renderCursorRule,
  renderClaudeRouter,
  renderClaudeProject,
  renderClaudeGuardrails,
  commandAliasSection,
  coreDoctrineSection
};
