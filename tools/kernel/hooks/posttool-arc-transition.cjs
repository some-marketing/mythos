#!/usr/bin/env node
'use strict';

/**
 * posttool-arc-transition.cjs — PostToolUse hook.
 * 
 * s06 state-transition hook.
 *
 * Transitions 'authorized-for-arc' to 'executing' on the first tool use.
 */

const { resolveActorId, readCurrentArc, transitionArc } = require('../lib/arc-state-writer.cjs');

function main() {
  const actorId = resolveActorId();
  const currentArc = readCurrentArc(actorId);

  if (!currentArc) return 0;

  if (currentArc.lifecycle_state === 'authorized-for-arc') {
    transitionArc(actorId, 'executing', 'first-tool-use', {
      tool: process.env.CLAUDE_TOOL_NAME || 'unknown'
    });
  }

  return 0;
}

if (require.main === module) {
  try {
    main();
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[posttool-arc-transition] ${err.message}\n`);
    process.exit(0);
  }
}

module.exports = {
  main
};
