/**
 * twilio-function-handler.js — Twilio Serverless Function handler.
 *
 * Deploy via Twilio Console or Serverless API (no server needed).
 * This single file is the complete Twilio Function — paste into the Console
 * editor or deploy via `twilio serverless:deploy`.
 *
 * Runtime: Node.js 18 (Twilio Serverless)
 *
 * Behavior:
 *   - POST /gather → reads SpeechResult → returns <Gather> TwiML with response
 *   - Assistant integration: calls the response-brain URL via HTTP if BRAIN_URL env is set
 *   - Default (no BRAIN_URL): echo brain for testing
 *
 * Environment variables (set in Twilio Console → Functions → Environment Variables):
 *   BRAIN_URL   Response-brain endpoint (optional)
 *               POST { speech: "..." } → { response: "..." }
 *
 * Deploying via Serverless API:
 *   See: https://www.twilio.com/docs/serverless/api
 *   POST /v1/Services → POST /v1/Services/{sid}/Functions → upload → deploy build
 */

// Twilio Functions runtime exposes `Twilio`, `context`, `event`, `callback`
exports.handler = function(context, event, callback) {
  const speechResult = event.SpeechResult || '';
  const callSid = event.CallSid || 'unknown';

  console.log(`[function/gather] CallSid=${callSid} speech="${speechResult}"`);

  const twiml = new Twilio.twiml.VoiceResponse();

  // End-of-conversation keywords
  const lower = speechResult.toLowerCase();
  if (['goodbye', 'bye', 'end', 'stop', 'hang up', 'hangup'].some(w => lower.includes(w))) {
    twiml.say({ voice: 'alice' }, 'Goodbye. Mythos out.');
    twiml.hangup();
    return callback(null, twiml);
  }

  const BRAIN_URL = context.BRAIN_URL || null;

  function respondWithText(responseText) {
    const gather = twiml.gather({ input: 'speech', speechTimeout: 'auto', action: '/gather', method: 'POST' });
    gather.say({ voice: 'alice' }, responseText);
    twiml.say({ voice: 'alice' }, "I didn't hear anything. Goodbye.");
    twiml.hangup();
    callback(null, twiml);
  }

  if (BRAIN_URL) {
    // Call the response-brain URL asynchronously
    const https = require('https');
    const url = new URL(BRAIN_URL);
    const payload = JSON.stringify({ speech: speechResult });
    const options = {
      hostname: url.hostname,
      path: url.pathname + (url.search || ''),
      port: url.port || 443,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          respondWithText(parsed.response || parsed.text || 'Got it.');
        } catch {
          respondWithText('Received your message.');
        }
      });
    });
    req.on('error', () => respondWithText('I had trouble connecting to the response brain. Please try again.'));
    req.setTimeout(8000, () => { req.destroy(); respondWithText('Response timed out. Please try again.'); });
    req.write(payload);
    req.end();
  } else {
    // Echo brain (testing)
    respondWithText(`You said: ${speechResult}. Say something else, or say goodbye to end.`);
  }
};
