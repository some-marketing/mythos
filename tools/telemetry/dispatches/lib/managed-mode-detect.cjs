'use strict';

/**
 * managed-mode-detect.cjs — Classifies command dispatches for telemetry.
 */

const { isManaged } = require('../../../codex/lib/managed-command-registry');

function detectExecutionMode(commandStr) {
  if (!commandStr || typeof commandStr !== 'string') {
    return 'semantic-only';
  }

  const trimmed = commandStr.trim();
  if (!trimmed) return 'semantic-only';

  if (trimmed.startsWith('/')) {
    const cmdId = trimmed.slice(1).split(/\s+/)[0];
    if (isManaged(cmdId)) {
      return 'managed';
    }
    return 'manual-via-bridge';
  }

  return 'semantic-only';
}

module.exports = { detectExecutionMode };
