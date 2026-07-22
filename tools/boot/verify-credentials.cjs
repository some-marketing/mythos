#!/usr/bin/env node
// tools/boot/verify-credentials.cjs
//
// Runs on SessionStart. Verifies that credentials across known intelligence-lanes
// belong to the operator and are in the expected state. READ-ONLY. Never writes,
// never rotates, never prompts. Reports a plain-language status block to stdout.
//
// Extend this script when new lanes are wired (direct OpenAI API, Gemini OAuth,
// subscription browser adapters, Anthropic API, local Ollama, etc.) by adding a
// section and a pass/anomaly check. Do NOT print secret material — only mode,
// timestamps, prefix hints, and anomaly names.
//
// Authority: canonical guardrails Discipline #4 (spawn verification applied at
// session boot), Discipline #6 (trust compact), Discipline #1 (cross-verification
// requires knowing which lanes are live). See check-yoself-routing.md for the
// adapter contract this script observes.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const HOME = os.homedir();
const lines = [];
const anomalies = [];

function line(s) { lines.push(s); }
function section(name) { line(''); line(`--- ${name} ---`); }
function anomaly(s) { anomalies.push(s); }

line('=== CREDENTIAL VERIFY ON SESSION BOOT ===');
line(`timestamp: ${new Date().toISOString()}`);
line(`operator-home: ${HOME}`);

// ---------- CODEX / CHATGPT ----------
section('Codex (OpenAI Codex CLI)');
const codexAuthPath = path.join(HOME, '.codex', 'auth.json');
try {
  if (!fs.existsSync(codexAuthPath)) {
    line('status: NOT CONFIGURED (auth.json missing)');
    anomaly('codex: ~/.codex/auth.json missing — Codex bridge lane unavailable');
  } else {
    const auth = JSON.parse(fs.readFileSync(codexAuthPath, 'utf8'));
    const mode = auth.auth_mode || 'unknown';
    const refresh = auth.last_refresh || '(no last_refresh)';
    const hasApiKey = Boolean(auth.OPENAI_API_KEY);
    const hasTokens = Boolean(auth.tokens);

    line(`auth_mode: ${mode}`);
    line(`last_refresh: ${refresh}`);
    line(`has_oauth_tokens: ${hasTokens}`);
    line(`has_cached_api_key: ${hasApiKey}`);

    if (mode === 'chatgpt') {
      line('interpretation: running on ChatGPT subscription OAuth (expected)');
      try {
        const status = execSync('codex login status 2>&1', {
          encoding: 'utf8',
          timeout: 5000,
        }).trim();
        line(`codex login status: ${status}`);
      } catch (e) {
        line(`codex login status: FAILED (${e.message.split('\n')[0]})`);
        anomaly('codex: `codex login status` command failed — CLI may be missing or broken');
      }
    } else if (mode === 'apikey') {
      line('interpretation: running on OPENAI_API_KEY (burns per-token credits)');
      anomaly('codex: auth_mode=apikey — expected chatgpt subscription auth. Either run `codex login` to rotate, or accept per-token billing.');
    } else {
      line(`interpretation: unknown auth_mode`);
      anomaly(`codex: unexpected auth_mode=${mode}`);
    }

    if (mode === 'chatgpt' && hasApiKey) {
      anomaly('codex: auth_mode=chatgpt but OPENAI_API_KEY still cached in auth.json — minor hygiene; revoke the key at platform.openai.com/api-keys if unused elsewhere');
    }
  }
} catch (e) {
  line(`status: ERROR — ${e.message}`);
  anomaly(`codex: ${e.message}`);
}

// ---------- GEMINI ----------
section('Gemini (Google AI)');
const geminiEnvKey =
  process.env.GOOGLE_AI_API_KEY ||
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  null;
const geminiOauthCandidates = [
  path.join(HOME, '.config', 'gemini', 'auth.json'),
  path.join(HOME, '.gemini', 'auth.json'),
  path.join(HOME, '.gemini', 'oauth_creds.json'),
  path.join(HOME, '.gemini', 'google_accounts.json'),
];
const geminiOauthHit = geminiOauthCandidates.find((p) => {
  try { return fs.existsSync(p); } catch { return false; }
});

if (geminiEnvKey) {
  const prefix = geminiEnvKey.slice(0, 6);
  line(`status: API KEY in env (prefix=${prefix}..., length=${geminiEnvKey.length})`);
  line('interpretation: direct Google AI Studio / Vertex API lane available');
  line('note: operator must visually confirm the prefix is theirs, not a stale or borrowed key');
} else if (geminiOauthHit) {
  line(`status: OAuth config present at ${geminiOauthHit}`);
  line('interpretation: Gemini OAuth lane configured (verify on first use)');
} else {
  line('status: NOT YET CONFIGURED (no API key env var, no OAuth cache)');
  line('interpretation: Gemini lane unavailable — will block on any creative-lane routing');
}

// ---------- OPENAI DIRECT API ----------
section('OpenAI direct API');
if (process.env.OPENAI_API_KEY) {
  const prefix = process.env.OPENAI_API_KEY.slice(0, 8);
  line(`status: OPENAI_API_KEY in env (prefix=${prefix}..., length=${process.env.OPENAI_API_KEY.length})`);
  anomaly('openai: OPENAI_API_KEY present in environment — if you are intentionally on ChatGPT subscription auth only, unset it to avoid accidental per-token billing');
} else {
  line('status: no OPENAI_API_KEY in env (subscription-only path)');
}

// ---------- ANTHROPIC / CLAUDE ----------
section('Anthropic / Claude');
if (process.env.ANTHROPIC_API_KEY) {
  line('status: ANTHROPIC_API_KEY in env (direct API available)');
} else {
  line('status: Claude Code native session (Claude Max subscription)');
}

// ---------- OLLAMA / LOCAL ----------
section('Local models (Ollama)');
try {
  const ollamaCheck = execSync('curl.exe -sS --max-time 2 http://localhost:11434/api/tags 2>&1', {
    encoding: 'utf8',
    timeout: 3000,
  }).slice(0, 200).trim();
  if (ollamaCheck && ollamaCheck.includes('models')) {
    line('status: Ollama reachable at localhost:11434');
  } else if (ollamaCheck && ollamaCheck.length > 0) {
    line('status: Ollama endpoint responded but format unexpected');
  } else {
    line('status: Ollama not reachable (local lane unavailable — not an error)');
  }
} catch {
  line('status: Ollama not reachable (local lane unavailable — not an error)');
}

// ---------- SUMMARY ----------
line('');
line('--- Summary ---');
if (anomalies.length === 0) {
  line('STATUS: no anomalies detected in the lanes this script inspected.');
  line('NOTE: "no anomalies" is NOT the same as "all lanes verified live." The script reports on config');
  line('      presence and per-lane state it could cheaply probe. A lane that is configured but unreachable');
  line('      at runtime may still look clean here. See per-lane sections above for what was actually');
  line('      tested vs only config-checked. This script is a SessionStart read, not a liveness gate.');
} else {
  line(`STATUS: ${anomalies.length} anomaly(ies) detected — review before starting real work:`);
  anomalies.forEach((a, i) => line(`  ${i + 1}. ${a}`));
}
line('=========================================');

process.stdout.write(lines.join('\n') + '\n');
