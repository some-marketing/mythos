'use strict';

/**
 * parse-usage-block.cjs — Defensive extraction of subagent metrics and metadata.
 */

function parseUsageBlock(toolInput, toolOutput) {
  const result = {
    subagent_type: 'unknown',
    actor_reason: null,
    duration_ms: null,
    total_tokens: null,
    tool_uses: null,
    // C6.2: the WITNESSED model. The Agent/Task tool carries a `model` param ONLY
    // when an explicit override is passed (e.g. operator routes a mechanical lane
    // to haiku). Present => witnessed (record honestly); absent (null) => the
    // subagent ran on the coordinator's model, an unverifiable parallel context,
    // and the writer must emit the structured sentinel instead of guessing.
    model: null
  };

  // 1. Extract from INPUT (metadata)
  if (toolInput) {
    // Claude Code Task/Agent input uses `subagent_type` (+ `description`/`prompt`);
    // older/variant shapes use `agent_name`. Accept all so the in-session path
    // labels its worker rows instead of emitting `unknown` (info preservation).
    result.subagent_type = toolInput.subagent_type
      || toolInput.agent_name
      || toolInput.agentName
      || toolInput.subagentType
      || 'unknown';
    result.actor_reason = toolInput.reason || toolInput.description || toolInput.prompt || null;
    // Witnessed model override, if the Agent call carried one. Only accept a
    // non-empty string; never coerce a falsy/blank value into a fake model.
    if (typeof toolInput.model === 'string' && toolInput.model.trim()) {
      result.model = toolInput.model.trim();
    }
  }

  // 2. Extract from OUTPUT (metrics)
  // Usage block shape in Claude Code dispatches: 
  // { usage: { duration_ms: 123, total_tokens: 456, tool_uses: 7 } }
  if (toolOutput && toolOutput.usage) {
    const u = toolOutput.usage;
    result.duration_ms = typeof u.duration_ms === 'number' ? u.duration_ms : null;
    result.total_tokens = typeof u.total_tokens === 'number' ? u.total_tokens : null;
    result.tool_uses = typeof u.tool_uses === 'number' ? u.tool_uses : null;
  }

  return result;
}

module.exports = { parseUsageBlock };
