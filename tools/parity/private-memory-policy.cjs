'use strict';

// Local memory is advisory session context, never repository or parity input.
// Keep the canonical and compatibility roots together so every generator uses
// the same repository/export membrane policy.
const PRIVATE_MEMORY_EXCLUSIONS = Object.freeze([
  'Mythos-memories/**',
  'sm_os-memories/**',
]);

module.exports = { PRIVATE_MEMORY_EXCLUSIONS };
