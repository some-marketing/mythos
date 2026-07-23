#!/usr/bin/env node
'use strict';

const {
  finish,
  readPayload,
  shouldEmit,
  toolInput,
  toolName,
  writeOut
} = require('./lib/compat-dispatch.cjs');

function frameworkNotice(payload) {
  const filePath = String(toolInput(payload).file_path || '');
  const marker = '/frameworks/';
  if (!filePath.includes(marker)) return;
  const suffix = filePath.split(marker)[1] || filePath;
  if (!shouldEmit(payload, `framework-manifest-notice:${suffix}`)) return;
  writeOut(`NOTICE: Framework file changed (${suffix}). Run npm run manifest:sync if prompt chain, guardrails, or manifest changed.`);
}

function main() {
  const payload = readPayload();
  const tool = toolName(payload);

  if (tool === 'Write' || tool === 'Edit') frameworkNotice(payload);

  if (tool === 'Write') {
    const result = require('../../verify/visual-review-gate.cjs').run(toolInput(payload));
    if (result && result.status === 2) finish(2);
  }

  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
    const result = require('../../verify/hooks/post-write-paste-target.cjs').run(payload);
    if (result && result.status === 2) finish(2);
  }

  require('./posttool-arc-rest-check.cjs').main();
  require('./posttool-arc-transition.cjs').main();
  require('../../transcripts/snapshot-current-session.cjs').snapshotCurrentSession(payload);

  if (tool === 'Write' || tool === 'Edit') {
    require('../../auto-bridge/post-write-concept.cjs').main(payload);
  }

  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
    try {
      require('../../planning/hooks/post-write-plan-diagram-publication.cjs').main(payload);
    } catch (_) {
      // Diagram publication is fail-open and must never block PostToolUse.
    }
  }

  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
    try {
      require('../../planning/hooks/post-write-amend-authority-guard.cjs').main(payload);
    } catch (_) {
      // Amend authority guard is advisory and fail-open; must never block PostToolUse.
    }
  }

  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
    try {
      require('../../planning/hooks/post-write-repair-plan-pairing.cjs').main(payload);
    } catch (_) {
      // Repair-plan pairing hook is advisory and fail-open; must never block PostToolUse.
    }
  }

  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'Bash' || tool === 'run_shell_command') {
    try {
      require('./posttool-write-ledger.cjs').main(payload);
    } catch (_) {
      // Write ledger is fail-open and must never block PostToolUse.
    }
  }

  finish(0);
}

main();
