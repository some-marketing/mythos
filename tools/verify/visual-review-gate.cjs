#!/usr/bin/env node

/**
 * visual-review-gate.cjs
 *
 * PostToolUse hook script for Write tool. Blocks completion artifacts
 * when a project's execution gates declare visual review but no
 * screenshot evidence exists.
 *
 * Environment (set by Claude Code hook system):
 *   CLAUDE_TOOL_INPUT — JSON with { file_path: "..." }
 *
 * Exit behavior:
 *   - stdout message = shown to Claude as feedback
 *   - non-zero exit = blocks the write (PostToolUse hooks can't block,
 *     but the message warns Claude to stop)
 *
 * Checked paths:
 *   - Files matching *evidence/*complete* or *evidence/*signal*
 *   - Files containing "verdict": "PASS" (checked via content heuristic on path)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { globSync } = require('fs').promises ? { globSync: null } : {};

// Node 20+ has globSync; fallback for older
function findFiles(dir, pattern) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.match(pattern)) {
      results.push(full);
    }
  }
  return results;
}

function run(inputObject) {
  const input = inputObject || (() => {
    try { return JSON.parse(process.env.CLAUDE_TOOL_INPUT || '{}'); } catch { return {}; }
  })();
  let filePath;
  filePath = input.file_path || '';

  if (!filePath) return { status: 0 };

  // Check if file matches completion artifact patterns
  const basename = path.basename(filePath);
  const isCompletionArtifact =
    (filePath.includes('/evidence/') && (basename.includes('complete') || basename.includes('signal'))) ||
    basename.match(/verdict.*PASS|PASS.*verdict/i) ||
    basename.match(/-complete\.json$/) ||
    basename.match(/-signal\.json$/);

  if (!isCompletionArtifact) return { status: 0 };

  // Find the project root (walk up from file to find CLAUDE_EXECUTION_GATES.md or project.json)
  let projectDir = path.dirname(filePath);
  let gatesFile = null;
  let maxDepth = 10;

  while (maxDepth-- > 0 && projectDir !== '/') {
    const candidate = path.join(projectDir, 'CLAUDE_EXECUTION_GATES.md');
    if (fs.existsSync(candidate)) {
      gatesFile = candidate;
      break;
    }
    const projectJson = path.join(projectDir, 'project.json');
    if (fs.existsSync(projectJson)) {
      // Check for gates in same dir or parent
      if (fs.existsSync(candidate)) {
        gatesFile = candidate;
        break;
      }
    }
    projectDir = path.dirname(projectDir);
  }

  if (!gatesFile) return { status: 0 }; // No execution gates found, no gate to enforce

  // Check if gates mention visual review
  const gatesContent = fs.readFileSync(gatesFile, 'utf8').toLowerCase();
  const hasVisualGate =
    gatesContent.includes('visual review') ||
    gatesContent.includes('screenshot') ||
    gatesContent.includes('visual verification') ||
    gatesContent.includes('inspect the pilot screenshot');

  if (!hasVisualGate) return { status: 0 }; // No visual review gate declared

  // Check for screenshot evidence in the project's evidence directory
  const evidenceDir = path.join(projectDir, 'evidence');
  if (!fs.existsSync(evidenceDir)) {
    process.stdout.write(
      'BLOCKED: Visual review gate declared in ' + path.basename(gatesFile) +
      ' but no evidence/ directory exists. Take screenshots and run visual review before declaring completion.'
    );
    return { status: 1 };
  }

  // Look for screenshot files (png, jpg) with reasonable recency
  const screenshots = findFiles(evidenceDir, /\.(png|jpg|jpeg)$/i);
  if (screenshots.length === 0) {
    process.stdout.write(
      'BLOCKED: Visual review gate declared but no screenshot evidence found in ' +
      evidenceDir + '. Take screenshots and run Gemini visual review before declaring completion.'
    );
    return { status: 1 };
  }

  // Check if any screenshots are from a recent session (within last 24h)
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  const recentScreenshots = screenshots.filter(f => {
    try { return fs.statSync(f).mtimeMs > oneDayAgo; } catch { return false; }
  });

  if (recentScreenshots.length === 0) {
    process.stdout.write(
      'WARNING: Visual review gate declared. Screenshot evidence exists but none from the last 24 hours. ' +
      'Consider taking fresh screenshots to verify current state before declaring completion. ' +
      'Found ' + screenshots.length + ' older screenshot(s) in ' + evidenceDir
    );
    // Don't block — just warn for stale evidence
    return { status: 0 };
  }

  // Gate passes — evidence exists
  return { status: 0 };
}

function main() {
  run();
}

module.exports = { findFiles, run };

if (require.main === module) {
  main();
}
