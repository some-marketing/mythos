'use strict';

/**
 * acceptance-controller.js — Map operator input to canonical actions.
 *
 * When the agent presents guidance at the end of a phase-1 command,
 * the operator responds with a short alias. This module resolves that
 * alias into a canonical action with the appropriate target payload.
 */

const { ACCEPTANCE_ALIASES } = require('./schema');

/**
 * Map operator input to a canonical action.
 *
 * @param {string} input - Raw operator input (e.g., 'y', 'yes', 'skip', 'why', 'improve')
 * @param {object} guidancePayload - The guidance payload to act on
 * @returns {{ action: 'execute_primary'|'show_alternatives'|'explain_ranking'|'open_improvement'|'unrecognized', target?: object }}
 */
function resolveOperatorInput(input, guidancePayload) {
  if (typeof input !== 'string' || !input.trim()) {
    return { action: 'unrecognized' };
  }

  const normalized = input.trim().toLowerCase();
  const action = ACCEPTANCE_ALIASES[normalized];

  if (!action) {
    return { action: 'unrecognized' };
  }

  switch (action) {
    case 'execute_primary':
      return {
        action: 'execute_primary',
        target: guidancePayload.primary_action || null
      };

    case 'show_alternatives':
      return {
        action: 'show_alternatives',
        target: (guidancePayload.next_steps || []).filter((step) => {
          // Exclude the primary action command from alternatives when present
          if (!guidancePayload.primary_action) return true;
          return step.command !== guidancePayload.primary_action.command;
        })
      };

    case 'explain_ranking':
      return {
        action: 'explain_ranking',
        target: {
          why: guidancePayload.primary_action
            ? guidancePayload.primary_action.why
            : null,
          command: guidancePayload.primary_action
            ? guidancePayload.primary_action.command
            : null,
          alternatives_count: (guidancePayload.next_steps || []).length
        }
      };

    case 'open_improvement':
      return {
        action: 'open_improvement',
        target: guidancePayload.improvement_request || null
      };

    default:
      return { action: 'unrecognized' };
  }
}

module.exports = { resolveOperatorInput };
