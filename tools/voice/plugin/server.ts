#!/usr/bin/env bun
/**
 * Voice channel MCP server for Claude Code.
 *
 * Bridges microphone input to Claude Code via the channel contract.
 * Audio processing (VAD, STT, TTS) runs in a Python subprocess.
 *
 * Architecture:
 *   TypeScript (MCP protocol) <──stdio──> Claude Code
 *        │
 *        └──spawns──> Python audio_worker.py
 *                       ├─ mic → VAD → whisper STT → transcription → channel notification
 *                       └─ voice_reply tool → choir TTS → speaker
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { appendFileSync } from 'fs'
import { createInterface } from 'readline'

const PLUGIN_DIR = dirname(new URL(import.meta.url).pathname)
const VOICE_DIR = resolve(PLUGIN_DIR, '..')
const PYTHON = resolve(VOICE_DIR, '.venv', 'bin', 'python3')
const WORKER_SCRIPT = resolve(PLUGIN_DIR, 'audio_worker.py')
const LOG_FILE = resolve(VOICE_DIR, 'channel_server.log')

let msgSeq = 0
let workerState = 'starting'
let isSpeaking = false

function log(msg: string) {
  const ts = new Date().toISOString()
  appendFileSync(LOG_FILE, `${ts} ${msg}\n`)
  process.stderr.write(`voice-channel: ${msg}\n`)
}

// ── MCP Server ──────────────────────────────────────────────────────────

const mcp = new Server(
  { name: 'voice', version: '1.0.0' },
  {
    capabilities: {
      tools: {},
      experimental: { 'claude/channel': {} },
    },
    instructions: [
      'Voice input arrives as <channel source="voice" chat_id="mic" ...> tags.',
      'The user is speaking aloud through a microphone — your transcript text does NOT reach them.',
      'You MUST reply using the voice_reply tool for anything you want the user to hear.',
      'Do not answer in chat text. Keep responses to 1-2 sentences.',
      'No markdown, no formatting, no lists, no code blocks.',
      'Speak naturally as if in conversation. The user is Taylor.',
    ].join('\n'),
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'voice_reply',
      description:
        'Speak a response aloud through the choir TTS system. ' +
        'Use this to reply to voice channel messages. ' +
        'The text will be spoken through multiple blended voices.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          text: {
            type: 'string' as const,
            description: 'The text to speak aloud',
          },
        },
        required: ['text'],
      },
    },
    {
      name: 'voice_status',
      description:
        'Get the current status of the voice channel (listening, recording, speaking, etc.)',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
  ],
}))

// Pending speak requests: resolve when Python confirms
const pendingSpeaks = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>()
let speakSeq = 0

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>

  switch (req.params.name) {
    case 'voice_reply': {
      const text = args.text as string
      if (!text) {
        return {
          content: [{ type: 'text' as const, text: 'No text provided' }],
          isError: true,
        }
      }

      // Send speak command to Python worker
      const id = ++speakSeq
      sendToWorker({ type: 'speak', text, id })
      isSpeaking = true

      // Wait for Python to finish speaking (or timeout)
      try {
        await new Promise<string>((resolve, reject) => {
          pendingSpeaks.set(id, { resolve, reject })
          setTimeout(() => {
            pendingSpeaks.delete(id)
            reject(new Error('TTS timeout'))
          }, 60_000)
        })
      } catch (e) {
        // Timeout or error — still report what we tried
        log(`voice_reply error: ${e}`)
      } finally {
        isSpeaking = false
      }

      return {
        content: [{ type: 'text' as const, text: `Spoke: ${text.slice(0, 80)}` }],
      }
    }

    case 'voice_status': {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              state: workerState,
              is_speaking: isSpeaking,
              messages_received: msgSeq,
            }),
          },
        ],
      }
    }

    default:
      return {
        content: [{ type: 'text' as const, text: `unknown tool: ${req.params.name}` }],
        isError: true,
      }
  }
})

// ── Python Audio Worker ─────────────────────────────────────────────────

let worker: ReturnType<typeof spawn> | null = null

function sendToWorker(msg: object) {
  if (worker?.stdin?.writable) {
    worker.stdin.write(JSON.stringify(msg) + '\n')
  }
}

function startWorker() {
  log(`spawning audio worker: ${PYTHON} ${WORKER_SCRIPT}`)

  worker = spawn(PYTHON, ['-u', WORKER_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: VOICE_DIR,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  })

  // Read line-delimited JSON from worker stdout
  const rl = createInterface({ input: worker.stdout! })
  rl.on('line', (line: string) => {
    try {
      const msg = JSON.parse(line)
      handleWorkerMessage(msg)
    } catch {
      log(`worker stdout (non-JSON): ${line}`)
    }
  })

  // Log worker stderr
  worker.stderr?.on('data', (data: Buffer) => {
    const text = data.toString().trim()
    if (text) log(`worker: ${text}`)
  })

  worker.on('exit', (code: number | null) => {
    log(`worker exited with code ${code}`)
    workerState = 'stopped'
    worker = null
  })

  worker.on('error', (err: Error) => {
    log(`worker spawn error: ${err.message}`)
    workerState = 'error'
  })
}

function handleWorkerMessage(msg: Record<string, unknown>) {
  switch (msg.type) {
    case 'ready':
      workerState = 'listening'
      log('audio worker ready — mic active')
      break

    case 'transcription': {
      const text = msg.text as string
      if (!text) break

      msgSeq++
      log(`transcription #${msgSeq}: ${text}`)

      // Emit channel notification to Claude Code
      void mcp.notification({
        method: 'notifications/claude/channel',
        params: {
          content: text,
          meta: {
            chat_id: 'mic',
            message_id: `voice-${msgSeq}`,
            user: 'Taylor (voice)',
            ts: new Date().toISOString(),
          },
        },
      })
      break
    }

    case 'spoke': {
      // Resolve any pending speak promise
      for (const [id, promise] of pendingSpeaks) {
        promise.resolve(msg.text as string)
        pendingSpeaks.delete(id)
        break // resolve the oldest one
      }
      isSpeaking = false
      break
    }

    case 'status':
      workerState = (msg.state as string) ?? workerState
      isSpeaking = (msg.is_speaking as boolean) ?? isSpeaking
      break

    case 'error':
      log(`worker error: ${msg.message}`)
      break
  }
}

// ── Startup ─────────────────────────────────────────────────────────────

log('voice channel server starting')

// Connect MCP first, then start audio worker
await mcp.connect(new StdioServerTransport())
log('MCP connected — starting audio worker')
startWorker()

// Graceful shutdown
process.on('SIGTERM', () => {
  log('SIGTERM received')
  sendToWorker({ type: 'quit' })
  setTimeout(() => {
    worker?.kill()
    process.exit(0)
  }, 2000)
})

process.on('SIGINT', () => {
  log('SIGINT received')
  sendToWorker({ type: 'quit' })
  setTimeout(() => {
    worker?.kill()
    process.exit(0)
  }, 2000)
})
