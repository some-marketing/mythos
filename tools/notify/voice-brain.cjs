#!/usr/bin/env node
'use strict';
// voice-brain.cjs — Conversational brain for the Twilio voice bridge.
// argv[2] = operator speech. Prints a short spoken reply via local Ollama.
const http = require('http');
const MODEL = process.env.VOICE_BRAIN_MODEL || 'qwen2.5-coder:14b';
const speech = (process.argv[2] || '').trim();
const system = [
  "You are the Mythos voice bridge, talking with the operator live on a phone call.",
  "Reply in ONE or TWO short, warm, natural sentences for speech.",
  "No markdown, no code, no lists, no emoji. Be direct and useful.",
  "You help run their business and personal operating system.",
  "If they say goodbye or that's all, acknowledge warmly and stop."
].join(' ');
const body = JSON.stringify({
  model: MODEL, stream: false, keep_alive: '15m',
  messages: [ { role: 'system', content: system }, { role: 'user', content: speech || 'Hello?' } ],
  options: { temperature: 0.6, num_predict: 90 }
});
const req = http.request({ host: '127.0.0.1', port: 11434, path: '/api/chat', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 14000 },
  (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => {
    try { let t = ((JSON.parse(d).message || {}).content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      process.stdout.write(t || "Sorry, I didn't catch that — could you say it again?");
    } catch { process.stdout.write("Sorry, I had a hiccup. Could you repeat that?"); }
  }); });
req.on('error', () => process.stdout.write("My connection glitched. Say that again?"));
req.on('timeout', () => { req.destroy(); process.stdout.write("One sec — could you repeat that?"); });
req.write(body); req.end();
