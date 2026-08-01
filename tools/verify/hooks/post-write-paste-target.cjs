#!/usr/bin/env node
'use strict';

// PostToolUse hook (Write|Edit|MultiEdit): advisory paste-target-prompt validator.
// Shared by .claude/settings.json (Claude Code harness) and tools/codex/lib/hook-emulation.js.
// Advisory only — never blocks; never writes to stderr; silent on PASS / non-target paths.

const fs = require('fs');
const path = require('path');

function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function tryParse(json) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function extractFilePath(parsed) {
  if (!parsed || typeof parsed !== 'object') return '';
  if (parsed.tool_input && typeof parsed.tool_input === 'object' && parsed.tool_input.file_path) {
    return String(parsed.tool_input.file_path);
  }
  if (parsed.file_path) return String(parsed.file_path);
  return '';
}

function resolveFilePath(payload) {
  const stdinParsed = payload || tryParse(readStdinSync());
  let filePath = extractFilePath(stdinParsed);
  if (!filePath) {
    const envParsed = tryParse(process.env.CLAUDE_TOOL_INPUT || '');
    filePath = extractFilePath(envParsed);
  }
  if (!filePath) return '';
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function relativeToRepo(absPath) {
  const cwd = process.cwd();
  if (absPath.startsWith(cwd + path.sep)) return absPath.slice(cwd.length + 1);
  return absPath;
}

function run(payload) {
  const filePath = resolveFilePath(payload);
  if (!filePath) return { status: 0 };

  let validator;
  try {
    validator = require('../lib/paste-target-prompt.cjs');
  } catch {
    return { status: 0 };
  }

  const { isPromptTargetPath, validatePasteTargetPrompt } = validator;
  if (typeof isPromptTargetPath !== 'function' || typeof validatePasteTargetPrompt !== 'function') {
    return { status: 0 };
  }

  if (!isPromptTargetPath(filePath)) return { status: 0 };

  let result;
  try {
    result = validatePasteTargetPrompt(filePath);
  } catch {
    return { status: 0 };
  }

  if (!result || result.ok) return { status: 0 };

  const relPath = relativeToRepo(filePath);
  const violations = Array.isArray(result.violations) ? result.violations : [];
  const lines = [];
  for (const v of violations) {
    const loc = v && v.line ? `:${v.line}` : '';
    lines.push(`⚠ paste-target-prompt validator: ${v.rule} at ${relPath}${loc}`);
    if (v && v.message) lines.push(`  ${v.message}`);
  }
  lines.push('  Run: node tools/verify/verify-paste-target-prompts.cjs to recheck after fix.');
  process.stdout.write(lines.join('\n') + '\n');
  return { status: 0 };
}

module.exports = {
  extractFilePath,
  relativeToRepo,
  resolveFilePath,
  run,
  tryParse
};

if (require.main === module) {
  run();
}
