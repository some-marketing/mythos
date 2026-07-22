'use strict';

/**
 * renderer.js — Render operator guidance payloads into human-facing markdown.
 *
 * Takes a schema-compliant guidance payload and produces the standard
 * operator-facing output block that appears at the end of every
 * phase-1 command invocation.
 */

/**
 * Render operator guidance payload into human-facing markdown.
 *
 * @param {object} payload - Schema-compliant guidance payload
 * @returns {string} Formatted markdown
 */
function renderGuidance(payload) {
  if (!payload || typeof payload !== 'object') {
    return '> No guidance payload provided.\n';
  }

  const lines = [];

  lines.push('## Next Steps');
  lines.push('');

  // Primary action
  if (payload.primary_action) {
    lines.push(`**Recommended:** \`${payload.primary_action.command}\``);
    lines.push(payload.primary_action.why);
    lines.push('');
    lines.push('> Type `yes` to run, `why` for rationale, `skip` for alternatives, `improve` to help harden the system');
    lines.push('');
  }

  // Alternative next steps
  const alternatives = payload.next_steps || [];
  if (alternatives.length > 0) {
    lines.push('### Alternatives');
    for (const step of alternatives) {
      lines.push(`- **If** ${step.condition}: \`${step.command}\` \u2014 ${step.why}`);
    }
    lines.push('');
  }

  // Improvement request
  if (payload.improvement_request) {
    lines.push('## How You Can Help Improve');
    lines.push(payload.improvement_request.ask);
    lines.push('');

    const examples = payload.improvement_request.examples || [];
    if (examples.length > 0) {
      lines.push('Looking for:');
      for (const example of examples) {
        lines.push(`- ${example}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Render only the alternatives block (used by the show_alternatives action).
 *
 * @param {Array} nextSteps - The next_steps array from a guidance payload
 * @returns {string} Formatted markdown listing alternatives
 */
function renderAlternatives(nextSteps) {
  if (!Array.isArray(nextSteps) || nextSteps.length === 0) {
    return '> No alternative steps available.\n';
  }

  const lines = ['### Alternative Steps', ''];
  for (const step of nextSteps) {
    lines.push(`- **If** ${step.condition}: \`${step.command}\` \u2014 ${step.why}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Render only the improvement request block (used by the open_improvement action).
 *
 * @param {object} improvementRequest - The improvement_request object from a guidance payload
 * @returns {string} Formatted markdown for the improvement prompt
 */
function renderImprovementRequest(improvementRequest) {
  if (!improvementRequest || typeof improvementRequest !== 'object') {
    return '> No improvement request available.\n';
  }

  const lines = ['## How You Can Help Improve', improvementRequest.ask, ''];
  const examples = improvementRequest.examples || [];
  if (examples.length > 0) {
    lines.push('Looking for:');
    for (const example of examples) {
      lines.push(`- ${example}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { renderGuidance, renderAlternatives, renderImprovementRequest };
