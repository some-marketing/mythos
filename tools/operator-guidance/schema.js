'use strict';

/**
 * schema.js — Machine-readable output schema for operator guidance payloads.
 *
 * Defines the contract that every guidance payload must satisfy before
 * being rendered or acted on. Phase-1 commands produce payloads that
 * conform to this schema; the validator and renderer consume it.
 */

/**
 * JSON Schema for operator guidance payloads.
 * @type {object}
 */
const OPERATOR_GUIDANCE_SCHEMA = {
  type: 'object',
  required: ['command_source', 'next_steps', 'improvement_request'],
  properties: {
    command_source: {
      type: 'string',
      description: 'Which phase-1 command produced this guidance'
    },
    primary_action: {
      type: 'object',
      required: ['command', 'why', 'canonical_accept'],
      properties: {
        command: { type: 'string' },
        why: { type: 'string' },
        canonical_accept: { type: 'string', enum: ['yes', 'y'] }
      }
    },
    next_steps: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['condition', 'command', 'why'],
        properties: {
          condition: { type: 'string' },
          command: { type: 'string' },
          why: { type: 'string' }
        }
      }
    },
    improvement_request: {
      type: 'object',
      required: ['ask', 'examples'],
      properties: {
        ask: {
          type: 'string',
          description: 'Concrete request for operator input'
        },
        examples: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
          description: 'Types of high-signal input: failure cases, acceptance criteria, desired defaults, guardrails, examples worth hardening'
        }
      }
    }
  }
};

/**
 * Phase-1 commands that must produce operator guidance.
 * @type {string[]}
 */
const PHASE_1_COMMANDS = [
  'run-plan',
  'review-task-plan',
  'review-progress',
  'debrief-run',
  'author-prompt-system',
  'assemble-prompt-system',
  'new-framework',
  'improve-framework'
];

/**
 * Canonical acceptance aliases that operators can type.
 * @type {Record<string, string>}
 */
const ACCEPTANCE_ALIASES = {
  yes: 'execute_primary',
  y: 'execute_primary',
  no: 'show_alternatives',
  n: 'show_alternatives',
  skip: 'show_alternatives',
  why: 'explain_ranking',
  q: 'explain_ranking',
  explain: 'explain_ranking',
  improve: 'open_improvement',
  i: 'open_improvement'
};

module.exports = {
  OPERATOR_GUIDANCE_SCHEMA,
  PHASE_1_COMMANDS,
  ACCEPTANCE_ALIASES
};
