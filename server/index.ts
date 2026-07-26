/**
 * HiKid web backend — Express API server (port 3000)
 * Proxied through the Vite dev server at /api so the browser only needs port 5000.
 *
 * Provides:
 *   GET  /api/config          — load persisted config
 *   POST /api/config          — save config
 *   GET  /api/deps            — always OK (no native binaries needed in web mode)
 *   POST /api/chat            — SSE-streaming LLM chat
 *   POST /api/interrupt       — abort current LLM request
 *   POST /api/reset           — clear conversation history
 */

import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import os from 'os'

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.config', 'hi-kid')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

const DEFAULT_SYSTEM_PROMPT = `You are a friendly English conversation partner named {{AI_NAME}}. Your goal is to help the user practice spoken English.

Rules:
- Always respond in English
- Keep responses concise (1-3 sentences) for natural conversation flow
- Be encouraging and supportive
- If the user makes grammar mistakes, gently correct them
- Ask follow-up questions to keep the conversation going
- Adapt to the user's level - if they're beginner, use simpler vocabulary
- Absolute prohibition of emoji usage / Emojis are strictly forbidden
`

interface AppConfig {
  version: number
  aiName: string
  systemPrompt: string
  baseUrl: string
  apiKey: string
  modelName: string
}

function getDefaultConfig(): AppConfig {
  // Prefer explicit overrides, then auto-detect from well-known env vars
  const hasOpenAI = !!process.env.OPENAI_API_KEY
  return {
    version: 1,
    aiName: 'Kitten',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    baseUrl:
      process.env.LLM_BASE_URL ??
      (hasOpenAI ? 'https://api.openai.com/v1' : 'http://localhost:11434/v1'),
    apiKey: process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? 'ollama',
    modelName: process.env.LLM_MODEL ?? (hasOpenAI ? 'gpt-4o-mini' : 'qwen3:0.6b')
  }
}

function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AppConfig>
      const defaults = getDefaultConfig()
      return {
        version: parsed.version ?? defaults.version,
        aiName: parsed.aiName?.trim() || defaults.aiName,
        systemPrompt: parsed.systemPrompt || defaults.systemPrompt,
        baseUrl: parsed.baseUrl?.trim() || defaults.baseUrl,
        apiKey: parsed.apiKey ?? defaults.apiKey,
        modelName: parsed.modelName?.trim() || defaults.modelName
      }
    }
  } catch (err) {
    console.warn('[Config] Failed to load, using defaults:', err)
  }
  return getDefaultConfig()
}

function saveConfig(config: AppConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  const tmp = `${CONFIG_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, CONFIG_FILE)
}

// ─── Conversation state ───────────────────────────────────────────────────────

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

let history: Message[] = []
let currentAbort: AbortController | null = null

// ─── Sentence splitter (mirrors agent.ts logic) ───────────────────────────────

function extractSentences(text: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (/[.!?。！？]/.test(ch)) {
      const next = text[i + 1]
      if (next === undefined || /\s/.test(next) || /[.!?。！？]/.test(next)) {
        const sentence = text.slice(start, i + 1).trim()
        if (sentence) sentences.push(sentence)
        start = i + 1
        while (start < text.length && /\s/.test(text[start])) start++
        i = start - 1
      }
    }
  }
  return { sentences, remainder: text.slice(start) }
}

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express()
app.use(cors())
app.use(express.json())

// GET /api/config
app.get('/api/config', (_req, res) => {
  res.json(loadConfig())
})

// POST /api/config
app.post('/api/config', (req, res) => {
  const body = req.body as Partial<AppConfig>
  const current = loadConfig()
  const updated: AppConfig = {
    version: current.version,
    aiName:
      typeof body.aiName === 'string' && body.aiName.trim() ? body.aiName.trim() : current.aiName,
    systemPrompt:
      typeof body.systemPrompt === 'string' && body.systemPrompt
        ? body.systemPrompt
        : current.systemPrompt,
    baseUrl:
      typeof body.baseUrl === 'string' && body.baseUrl.trim()
        ? body.baseUrl.trim()
        : current.baseUrl,
    apiKey: typeof body.apiKey === 'string' ? body.apiKey : current.apiKey,
    modelName:
      typeof body.modelName === 'string' && body.modelName.trim()
        ? body.modelName.trim()
        : current.modelName
  }
  saveConfig(updated)
  res.json(updated)
})

// GET /api/deps — web mode never needs native binaries
app.get('/api/deps', (_req, res) => {
  res.json({ sox: true, espeakNg: true, ollama: true })
})

// POST /api/reset
app.post('/api/reset', (_req, res) => {
  history = []
  currentAbort?.abort()
  currentAbort = null
  res.json({ ok: true })
})

// POST /api/interrupt
app.post('/api/interrupt', (_req, res) => {
  currentAbort?.abort()
  currentAbort = null
  res.json({ ok: true })
})

// POST /api/chat — SSE streaming
app.post('/api/chat', async (req, res) => {
  const { message } = req.body as { message: string }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  function send(obj: object): void {
    res.write(`data: ${JSON.stringify(obj)}\n\n`)
  }

  const cfg = loadConfig()
  const systemPrompt = cfg.systemPrompt.replace(/\{\{AI_NAME\}\}/g, cfg.aiName)

  history.push({ role: 'user', content: message })

  currentAbort = new AbortController()

  let fullResponse = ''

  try {
    const llmRes = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.modelName,
        messages: [{ role: 'system', content: systemPrompt }, ...history],
        stream: true
      }),
      signal: currentAbort.signal
    })

    if (!llmRes.ok) {
      const errText = await llmRes.text().catch(() => llmRes.statusText)
      send({ type: 'error', message: `LLM error ${llmRes.status}: ${errText}` })
      res.end()
      history.pop() // remove the user message we just added
      return
    }

    if (!llmRes.body) {
      send({ type: 'error', message: 'LLM returned no response body' })
      res.end()
      history.pop()
      return
    }

    const reader = llmRes.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let sentenceBuffer = ''

    send({ type: 'thinking' })

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data) as {
            choices?: { delta?: { content?: string }; finish_reason?: string }[]
          }
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            fullResponse += delta
            sentenceBuffer += delta
            send({ type: 'delta', text: delta })

            // Flush complete sentences so frontend can start TTS early
            const { sentences, remainder } = extractSentences(sentenceBuffer)
            for (const sentence of sentences) {
              send({ type: 'sentence', text: sentence })
            }
            sentenceBuffer = remainder
          }
        } catch {
          // malformed chunk — skip
        }
      }
    }

    // Flush any remaining partial sentence
    if (sentenceBuffer.trim()) {
      send({ type: 'sentence', text: sentenceBuffer.trim() })
    }

    history.push({ role: 'assistant', content: fullResponse })
    send({ type: 'done' })
    res.end()
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      send({ type: 'interrupted' })
    } else {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[chat] Error:', message)
      send({ type: 'error', message })
      history.pop() // don't store failed user messages
    }
    res.end()
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.API_PORT || '3000', 10)
app.listen(PORT, () => {
  console.log(`[HiKid] Backend API running on http://localhost:${PORT}`)
  console.log(`[HiKid] LLM endpoint: ${loadConfig().baseUrl}`)
})
