#!/usr/bin/env node
'use strict';

/**
 * twilio-webhook-server.js — Express-compatible webhook server for Twilio <Gather> callbacks.
 *
 * Designed to run on any host with a public URL (your own server, a small
 * VPS, or a tunnel like ngrok for local testing).
 *
 * Flow:
 *   1. Twilio calls the operator.
 *   2. Call uses <Gather input="speech" action="https://this-server/gather">.
 *   3. Operator speaks → Twilio POSTs SpeechResult here.
 *   4. This handler calls the response brain (configurable: local script or API).
 *   5. Returns TwiML with <Gather> containing the response, keeping the loop alive.
 *
 * Usage:
 *   node tools/notify/twilio-webhook-server.js [--port 3100] [--brain <path-or-url>]
 *
 * Options:
 *   --port <n>       Port to listen on (default: 3100, or PORT env)
 *   --brain <spec>   Response brain. Either:
 *                      - a local script path: node <path> "<input>" → stdout response
 *                      - an HTTP URL: POST { speech } → { response }
 *                    Default: echo brain (reads back what was heard — for testing)
 *   --validate-sig   Enforce Twilio request signature validation (recommended in prod)
 *                    Requires TWILIO_AUTH_TOKEN env (resolved via tools/lib/resolve-credential.cjs at startup).
 *
 * Deployment on your own host:
 *   scp tools/notify/twilio-webhook-server.js <user>@<your-host>:~/twilio-webhook/
 *   ssh <user>@<your-host> "cd ~/twilio-webhook && npm install express && \
 *     PORT=3100 TWILIO_AUTH_TOKEN=<token> node twilio-webhook-server.js"
 *   Then expose port 3100 via nginx or direct (ensure firewall allows it).
 *   Point --webhook-url to https://<your-host-domain-or-ip>:3100/gather
 *
 * Twilio Serverless alternative:
 *   See tools/notify/twilio-function-handler.js for the equivalent single-file
 *   Twilio Function (deployed via Serverless API — no server needed).
 */

const http  = require('http');
const https = require('https');
const { execSync } = require('child_process');
const crypto = require('crypto');

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { port: parseInt(process.env.PORT || '3100', 10), brain: null, validateSig: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':         opts.port        = parseInt(args[++i], 10); break;
      case '--brain':        opts.brain       = args[++i];               break;
      case '--validate-sig': opts.validateSig = true;                    break;
    }
  }
  return opts;
}

// ─── TwiML helpers ────────────────────────────────────────────────────────────

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function gatherTwiml(sayText, actionPath, repromptPath) {
  const rp = repromptPath || '/reprompt?n=1';
  return `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Gather input="speech" speechTimeout="auto" timeout="8" action="${actionPath}" method="POST">` +
    `<Say voice="alice">${xmlEscape(sayText)}</Say>` +
    `</Gather>` +
    `<Redirect method="POST">${rp}</Redirect>` +
    `</Response>`;
}

function hangupTwiml(sayText) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    (sayText ? `<Say voice="alice">${xmlEscape(sayText)}</Say>` : '') +
    `<Hangup/>` +
    `</Response>`;
}

// ─── Response brain ───────────────────────────────────────────────────────────

function callBrain(brain, speechInput) {
  if (!brain) {
    // Default echo brain (testing)
    return `You said: ${speechInput}. Say something else or say goodbye to end.`;
  }

  if (brain.startsWith('http://') || brain.startsWith('https://')) {
    // HTTP brain
    const url = new URL(brain);
    const payload = JSON.stringify({ speech: speechInput });
    const lib = brain.startsWith('https') ? https : http;

    // Synchronous HTTP call via execSync + curl (keeps this handler simple / no async complexity)
    try {
      const response = execSync(
        `curl -sf -X POST -H "Content-Type: application/json" -d '${payload.replace(/'/g, "'\\''")}' '${brain}'`,
        { encoding: 'utf8', timeout: 10000 }
      );
      const parsed = JSON.parse(response);
      return parsed.response || parsed.text || response.trim();
    } catch (e) {
      return 'I had trouble processing that. Please try again.';
    }
  } else {
    // Local script brain: node <script> "<input>"
    try {
      const response = execSync(
        `node ${brain} ${JSON.stringify(speechInput)}`,
        { encoding: 'utf8', timeout: 10000 }
      );
      return response.trim() || 'I processed that but had no response.';
    } catch (e) {
      return 'My response system encountered an error. Please try again.';
    }
  }
}

// ─── Twilio signature validation ──────────────────────────────────────────────

function validateTwilioSignature(authToken, url, params, signature) {
  // https://www.twilio.com/docs/usage/webhooks/webhooks-security
  const sortedKeys = Object.keys(params).sort();
  let s = url;
  for (const k of sortedKeys) s += k + (params[k] || '');
  const expected = crypto.createHmac('sha1', authToken).update(s).digest('base64');
  return expected === signature;
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const params = {};
        for (const pair of body.split('&')) {
          const [k, v] = pair.split('=');
          if (k) params[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
        }
        resolve(params);
      } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

async function handler(req, res, opts) {
  const url = new URL(req.url, `http://localhost:${opts.port}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', ts: new Date().toISOString() }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/gather') {
    const params = await parseBody(req);
    const speechResult = params.SpeechResult || '';
    const callSid = params.CallSid || 'unknown';

    console.log(`[gather] CallSid=${callSid} speech="${speechResult}"`);

    // Signature validation (optional but recommended in prod)
    if (opts.validateSig) {
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (!authToken) {
        console.error('[gather] --validate-sig requires TWILIO_AUTH_TOKEN env');
      } else {
        const sig = req.headers['x-twilio-signature'] || '';
        const fullUrl = `https://${req.headers.host}${req.url}`;
        if (!validateTwilioSignature(authToken, fullUrl, params, sig)) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Forbidden');
          console.warn('[gather] Signature validation FAILED');
          return;
        }
      }
    }

    // End-of-conversation keywords
    const lowerSpeech = speechResult.toLowerCase();
    if (['goodbye', 'bye', 'end', 'stop', 'hang up', 'hangup'].some(w => lowerSpeech.includes(w))) {
      const twiml = hangupTwiml('Goodbye. Mythos out.');
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(twiml);
      return;
    }

    // Get response from brain
    const responseText = callBrain(opts.brain, speechResult);
    const twiml = gatherTwiml(responseText, '/gather');

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml);
    return;
  }

  if (url.pathname === '/reprompt') {
    const n = parseInt(url.searchParams.get('n') || '1', 10);
    if (n >= 3) {
      const twiml = hangupTwiml('Looks like you stepped away. Call back anytime. Goodbye.');
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(twiml);
      return;
    }
    const twiml = gatherTwiml('Still there? Go ahead, or say goodbye to end.', '/gather', `/reprompt?n=${n + 1}`);
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml);
    return;
  }

  // Default: not found
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  const server = http.createServer(async (req, res) => {
    try {
      await handler(req, res, opts);
    } catch (e) {
      console.error(`[server] Unhandled: ${e.message}`);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
    }
  });

  // Graceful shutdown
  let closing = false;
  function shutdown(sig) {
    if (closing) return;
    closing = true;
    console.log(`\n[server] ${sig} — shutting down`);
    server.close(() => {
      console.log('[server] closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  }
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  server.listen(opts.port, () => {
    console.log(`[twilio-webhook-server] Listening on port ${opts.port}`);
    console.log(`  /gather  POST — Twilio <Gather> callback`);
    console.log(`  /health  GET  — health check`);
    console.log(`  brain:   ${opts.brain || 'echo (default)'}`);
    console.log('  Press Ctrl+C to stop');
  });
}

main().catch(e => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
