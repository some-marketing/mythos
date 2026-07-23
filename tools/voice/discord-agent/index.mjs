#!/usr/bin/env node
/**
 * Mythos Discord Voice Conversation Agent
 *
 * Full-duplex voice loop with the operator in a guild voice channel:
 *   operator speech -> Discord receive (DAVE E2E-encrypted via @discordjs/voice)
 *     -> opus decode -> ffmpeg (16k mono wav) -> whisper-cli STT
 *     -> "HEARD <ts> :: <text>" on stdout  (+ appended to inbound.jsonl)
 *   coordinator reply -> drop a .txt file into outbound/
 *     -> ElevenLabs TTS -> played into the channel -> file moved to played/
 *
 * Conversation surfaces (under $PROJECT_ROOT/_dev/state/voice-conversation/):
 *   inbound.jsonl   — one JSON line per operator utterance {ts,user,text}
 *   outbound/*.txt  — coordinator replies to speak (consumed oldest-first)
 *   played/         — archive of spoken replies
 *
 * Env (resolved by run.sh / tools/voice/.env):
 *   DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_VOICE_CHANNEL_ID,
 *   DISCORD_ALLOWED_USER_ID, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID?,
 *   VOICE_AGENT_IDLE_EXIT_MS? (default 30 min), OPUS/whisper paths fixed below.
 *
 * Interruptibility: SIGINT/SIGTERM disconnect + clean exit; idle timeout
 * exits on its own; deleting the outbound dir does NOT crash the watcher.
 *
 * INSTRUMENTED EVENT LINES (prefix-grep these in Monitor):
 *   AGENT_READY            — bot joined and receiver is armed
 *   SPEAKING_START <uid>   — gateway reports user started speaking
 *   SPEAKING_END <uid>     — gateway reports user stopped speaking
 *   OPUS_BYTES <uid> <pkts> <bytes>  — per-stream counters logged every ~1 s
 *   RECV_ERROR <uid> <msg> — decrypt/parse/decode error for that user's stream
 *   DAVE_DEBUG <msg>       — DAVE session state/transition messages from lib
 *   HEARD <ts> :: <text>   — STT result committed
 *   SPOKE <ts> :: <file>   — TTS file played
 *   AGENT_EXIT             — clean shutdown
 */

import {
  Client,
  GatewayIntentBits,
} from 'discord.js';
import {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  EndBehaviorType,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
} from '@discordjs/voice';
import prism from 'prism-media';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CLI flags ────────────────────────────────────────────────────────────────
// --probe : connect, run instrumentation, exit after 120 s (no TTS/outbound)
const PROBE_MODE = process.argv.includes('--probe');

// ── config ──────────────────────────────────────────────────────────────────
const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR
  || path.resolve(__dirname, '..', '..', '..');
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const CHANNEL_ID = process.env.DISCORD_VOICE_CHANNEL_ID || '';
const ALLOWED_USER = process.env.DISCORD_ALLOWED_USER_ID || '';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
const IDLE_EXIT_MS = parseInt(process.env.VOICE_AGENT_IDLE_EXIT_MS ?? `${30 * 60 * 1000}`, 10);
const SILENCE_END_MS = parseInt(process.env.VOICE_AGENT_SILENCE_END_MS ?? '1500', 10);
const PROBE_EXIT_MS = parseInt(process.env.VOICE_AGENT_PROBE_EXIT_MS ?? '120000', 10);

const WHISPER_CLI = process.env.WHISPER_CLI || '/opt/homebrew/bin/whisper-cli';
const WHISPER_MODEL = process.env.WHISPER_MODEL
  || path.join(__dirname, '..', 'models', 'ggml-base.en.bin');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

const CONVO_DIR = path.join(PROJECT_ROOT, '_dev', 'state', 'voice-conversation');
const INBOUND_FILE = path.join(CONVO_DIR, 'inbound.jsonl');
const OUTBOUND_DIR = path.join(CONVO_DIR, 'outbound');
const PLAYED_DIR = path.join(CONVO_DIR, 'played');
const KILL_SWITCH = path.join(CONVO_DIR, 'disabled');

for (const d of [CONVO_DIR, OUTBOUND_DIR, PLAYED_DIR]) fs.mkdirSync(d, { recursive: true });

function log(msg) {
  console.log(`[voice-agent] ${msg}`);
}

function heard(text, userId) {
  const ts = new Date().toISOString();
  fs.appendFileSync(INBOUND_FILE, JSON.stringify({ ts, user: userId, text }) + '\n');
  // stdout line is the live event stream the coordinator monitors
  console.log(`HEARD ${ts} :: ${text}`);
}

let lastActivity = Date.now();
function touch() { lastActivity = Date.now(); }

// ── sanity checks ───────────────────────────────────────────────────────────
const missing = [];
if (!BOT_TOKEN) missing.push('DISCORD_BOT_TOKEN');
if (!GUILD_ID) missing.push('DISCORD_GUILD_ID');
if (!CHANNEL_ID) missing.push('DISCORD_VOICE_CHANNEL_ID');
if (!ALLOWED_USER) missing.push('DISCORD_ALLOWED_USER_ID');
if (!PROBE_MODE && !ELEVENLABS_API_KEY) missing.push('ELEVENLABS_API_KEY');
if (missing.length) {
  console.error(`[voice-agent] missing env: ${missing.join(', ')}`);
  process.exit(1);
}
if (!PROBE_MODE && !fs.existsSync(WHISPER_MODEL)) {
  console.error(`[voice-agent] whisper model not found: ${WHISPER_MODEL}`);
  process.exit(1);
}

// ── STT: pcm buffer -> whisper text ─────────────────────────────────────────
async function transcribePcm(pcmBuffer) {
  if (pcmBuffer.length < 48000) return ''; // <0.25s of 48k stereo s16 — noise
  const stamp = Date.now();
  const rawPath = path.join(os.tmpdir(), `va-${stamp}.s16le`);
  const wavPath = path.join(os.tmpdir(), `va-${stamp}.wav`);
  try {
    fs.writeFileSync(rawPath, pcmBuffer);
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', rawPath, '-ar', '16000', '-ac', '1', wavPath]);
    const { stdout } = await run(WHISPER_CLI, ['-m', WHISPER_MODEL, '-f', wavPath, '--no-timestamps', '--no-prints', '-t', '4']);
    return cleanTranscript(stdout);
  } catch (e) {
    log(`STT error: ${e.message}`);
    return '';
  } finally {
    for (const p of [rawPath, wavPath]) { try { fs.unlinkSync(p); } catch {} }
  }
}

function cleanTranscript(text) {
  let t = String(text || '').trim()
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 2) return '';
  const noise = new Set(['silence', 'noise', 'music', 'inaudible', 'unintelligible', 'blank_audio']);
  if ([...t.toLowerCase().matchAll(/[a-z_]+/g)].every((m) => noise.has(m[0]))) return '';
  return t;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(cmd)} exited ${code}: ${stderr.slice(0, 200)}`));
    });
  });
}

// ── TTS: text -> mp3 file ───────────────────────────────────────────────────
async function fetchTts(text) {
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
    method: 'POST',
    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!resp.ok) throw new Error(`ElevenLabs ${resp.status}: ${(await resp.text()).slice(0, 150)}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const mp3Path = path.join(os.tmpdir(), `va-tts-${Date.now()}.mp3`);
  fs.writeFileSync(mp3Path, buf);
  return mp3Path;
}

// ── receive-path: attach a capture stream for one user speaking burst ────────
/**
 * STRUCTURAL FIX: receiver.subscribe() must be called BEFORE the first UDP
 * packet of a speaking burst arrives.  The speaking.on('start') event fires
 * on the first received packet via speaking.onPacket() — but onUdpMessage()
 * forwards the packet to the stream returned by subscriptions.get(userId) in
 * the same call, before the 'start' event propagates through EventEmitter.
 * That means the very first packet is always dropped if we subscribe inside
 * the 'start' handler.
 *
 * Fix: pre-subscribe the allowed user unconditionally once the connection is
 * Ready, using EndBehaviorType.AfterSilence so it auto-ends after silence, and
 * re-subscribe immediately each time a capture finishes.
 */
function attachCapture(receiver, userId, onTextCb) {
  if (receiver.subscriptions.has(userId)) return; // already subscribed

  const opusStream = receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_END_MS },
  });

  const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });

  // ── per-stream opus byte/packet counter ──────────────────────────────────
  let pktCount = 0;
  let byteCount = 0;
  let counterInterval = null;

  function logOpusCounters() {
    console.log(`OPUS_BYTES ${userId} ${pktCount} ${byteCount}`);
  }

  opusStream.on('data', (chunk) => {
    pktCount++;
    byteCount += chunk.length;
  });

  counterInterval = setInterval(logOpusCounters, 1000);

  // ── pipe opus -> pcm decoder ──────────────────────────────────────────────
  const chunks = [];
  opusStream.pipe(decoder);
  decoder.on('data', (c) => chunks.push(c));

  // ── cleanup helper ────────────────────────────────────────────────────────
  let finished = false;
  async function finish() {
    if (finished) return;
    finished = true;
    clearInterval(counterInterval);
    // log final counters
    logOpusCounters();

    const pcm = Buffer.concat(chunks);
    if (PROBE_MODE) {
      log(`[probe] capture ended for ${userId}: ${pktCount} pkts ${byteCount} bytes PCM=${pcm.length}`);
      // re-arm immediately for next utterance
      setImmediate(() => attachCapture(receiver, userId, onTextCb));
      return;
    }
    const text = await transcribePcm(pcm);
    if (text) { heard(text, userId); touch(); }
    // re-arm immediately for next utterance
    setImmediate(() => attachCapture(receiver, userId, onTextCb));
  }

  decoder.on('end', finish);

  // fallback: if opusStream is destroyed (e.g. decrypt error) before decoder
  // emits 'end', clean up via the close event on the opus stream
  opusStream.on('close', finish);

  opusStream.on('error', (e) => {
    console.log(`RECV_ERROR ${userId} opusStream:${e.message}`);
    finish();
  });
  decoder.on('error', (e) => {
    console.log(`RECV_ERROR ${userId} decoder:${e.message}`);
    finish();
  });
}

// ── main ────────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const player = PROBE_MODE ? null : createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
let connection = null;
let speaking = false; // serialize TTS playback
// NOTE: activeCaptures set removed — capture lifecycle is now managed by
// attachCapture() re-arming on stream close, not by a guard set.

if (PROBE_MODE) {
  log('probe mode — will exit after ' + (PROBE_EXIT_MS / 1000) + 's');
}

client.once('ready', async () => {
  log(`connected as ${client.user.tag}`);
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(CHANNEL_ID);

  // debug:true exposes DAVE session state/transitions via 'debug' events
  connection = joinVoiceChannel({
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
    debug: true,
  });

  // surface DAVE debug lines as DAVE_DEBUG on stdout
  connection.on('debug', (msg) => {
    // filter to DAVE-relevant lines to avoid flooding
    if (/dave|transition|epoch|mls|e2e|decrypt|encrypt|session|privacy/i.test(msg)) {
      console.log(`DAVE_DEBUG ${msg}`);
    }
  });

  connection.on('error', (e) => {
    log(`connection error: ${e.message}`);
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  if (!PROBE_MODE) connection.subscribe(player);
  log(`joined voice channel: ${channel.name}`);

  const receiver = connection.receiver;

  // Log speaking events with userId for observability
  receiver.speaking.on('start', (userId) => {
    console.log(`SPEAKING_START ${userId}`);
    touch();
    // pre-subscription already happened in attachCapture; this is purely for logging
  });

  receiver.speaking.on('end', (userId) => {
    console.log(`SPEAKING_END ${userId}`);
  });

  // Pre-subscribe the allowed user so the first opus packet of every burst is
  // captured (not dropped waiting for the 'start' event to propagate).
  attachCapture(receiver, ALLOWED_USER, (text) => {
    if (text) heard(text, ALLOWED_USER);
  });

  console.log('AGENT_READY');
  touch();

  if (PROBE_MODE) {
    setTimeout(() => {
      log('probe: exit timeout reached');
      shutdown(0);
    }, PROBE_EXIT_MS);
  }
});

// outbound watcher: speak coordinator replies oldest-first, one at a time
async function pumpOutbound() {
  if (PROBE_MODE) return;
  if (speaking) return;
  let entries;
  try {
    entries = fs.readdirSync(OUTBOUND_DIR).filter((f) => f.endsWith('.txt')).sort();
  } catch { return; }
  if (entries.length === 0) return;
  const file = path.join(OUTBOUND_DIR, entries[0]);
  let text;
  try { text = fs.readFileSync(file, 'utf8').trim(); } catch { return; }
  speaking = true;
  touch();
  try {
    if (text) {
      log(`speaking ${entries[0]} (${text.length} chars)`);
      const mp3 = await fetchTts(text);
      const resource = createAudioResource(mp3);
      player.play(resource);
      await new Promise((resolve) => {
        const onIdle = () => { player.off('error', onErr); resolve(); };
        const onErr = (e) => { log(`player error: ${e.message}`); player.off(AudioPlayerStatus.Idle, onIdle); resolve(); };
        player.once(AudioPlayerStatus.Idle, onIdle);
        player.once('error', onErr);
      });
      try { fs.unlinkSync(mp3); } catch {}
      console.log(`SPOKE ${new Date().toISOString()} :: ${entries[0]}`);
    }
    fs.renameSync(file, path.join(PLAYED_DIR, `${Date.now()}-${entries[0]}`));
  } catch (e) {
    log(`TTS/playback error: ${e.message}`);
    try { fs.renameSync(file, path.join(PLAYED_DIR, `FAILED-${Date.now()}-${entries[0]}`)); } catch {}
  } finally {
    speaking = false;
  }
}
setInterval(pumpOutbound, 750);

// idle + kill-switch supervision
setInterval(() => {
  if (fs.existsSync(KILL_SWITCH)) { log('kill-switch present — exiting'); shutdown(0); }
  if (!PROBE_MODE && Date.now() - lastActivity > IDLE_EXIT_MS) { log('idle timeout — exiting'); shutdown(0); }
}, 5000);

function shutdown(code) {
  try { connection?.destroy(); } catch {}
  try { client.destroy(); } catch {}
  console.log('AGENT_EXIT');
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

client.login(BOT_TOKEN).catch((e) => {
  console.error(`[voice-agent] login failed: ${e.message}`);
  process.exit(1);
});
