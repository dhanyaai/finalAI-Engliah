/**
 * Vite dev-server plugin that adds a chat backend for "web mode".
 * Proxies conversation messages to an OpenAI-compatible chat completions
 * endpoint (OpenAI, remote Ollama, etc.) and streams deltas back via SSE.
 *
 * Configuration (env vars, read at request time):
 * - WEB_LLM_BASE_URL  — OpenAI-compatible base URL (default https://api.openai.com/v1)
 * - WEB_LLM_API_KEY   — API key (falls back to OPENAI_API_KEY)
 * - WEB_LLM_MODEL     — model name (default gpt-4o-mini)
 *
 * This runs only in the standalone web build (vite.web.config.ts).
 * The Electron/macOS pipeline is untouched.
 */
import type { Plugin, Connect } from 'vite'
import type { ServerResponse } from 'http'

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

interface ChatRequestBody {
  messages?: Array<{ role: string; text: string }>
  aiName?: string
  systemPrompt?: string
}

function getLlmConfig(): { baseUrl: string; apiKey: string; model: string } {
  return {
    baseUrl: (process.env.WEB_LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey: process.env.WEB_LLM_API_KEY || process.env.OPENAI_API_KEY || '',
    model: process.env.WEB_LLM_MODEL || 'gpt-4o-mini'
  }
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function sseWrite(res: ServerResponse, type: string, extra: Record<string, unknown> = {}): void {
  res.write(`data: ${JSON.stringify({ type, ...extra })}\n\n`)
}

// Mirrors the same logic in server/index.ts and src/main/services/agent.ts so
// sentence boundaries are detected consistently across all three paths.
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

async function handleChat(req: Connect.IncomingMessage, res: ServerResponse): Promise<void> {
  const { baseUrl, apiKey, model } = getLlmConfig()

  if (!apiKey) {
    sendJson(res, 503, {
      error:
        'No LLM API key configured for web mode. Set the OPENAI_API_KEY secret (or WEB_LLM_API_KEY / WEB_LLM_BASE_URL for another OpenAI-compatible endpoint).'
    })
    return
  }

  let body: ChatRequestBody
  try {
    body = JSON.parse(await readBody(req)) as ChatRequestBody
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  const history = Array.isArray(body.messages) ? body.messages : []
  if (history.length === 0) {
    sendJson(res, 400, { error: 'messages array is required' })
    return
  }

  const aiName =
    typeof body.aiName === 'string' && body.aiName.trim() ? body.aiName.trim() : 'Kitten'
  const systemPrompt = (
    typeof body.systemPrompt === 'string' && body.systemPrompt.trim()
      ? body.systemPrompt
      : DEFAULT_SYSTEM_PROMPT
  ).replaceAll('{{AI_NAME}}', aiName)

  const llmMessages = [
    { role: 'system', content: systemPrompt },
    ...history
      .filter((m) => m && typeof m.text === 'string' && m.text.trim())
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.text
      }))
  ]

  let upstream: Response
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, messages: llmMessages, stream: true })
    })
  } catch (err) {
    sendJson(res, 502, {
      error: `Could not reach LLM endpoint ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`
    })
    return
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '')
    sendJson(res, 502, {
      error: `LLM endpoint returned ${upstream.status}: ${detail.slice(0, 500)}`
    })
    return
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sentenceBuffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>
          }
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            sseWrite(res, 'delta', { text: delta })
            sentenceBuffer += delta
            const { sentences, remainder } = extractSentences(sentenceBuffer)
            for (const sentence of sentences) {
              sseWrite(res, 'sentence', { text: sentence })
            }
            sentenceBuffer = remainder
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }
    // Flush any trailing partial sentence
    if (sentenceBuffer.trim()) {
      sseWrite(res, 'sentence', { text: sentenceBuffer.trim() })
    }
    sseWrite(res, 'done', {})
  } catch (err) {
    sseWrite(res, 'error', {
      message: err instanceof Error ? err.message : String(err)
    })
  } finally {
    res.end()
  }
}

export function webChatPlugin(): Plugin {
  return {
    name: 'hikid-web-chat',
    configureServer(server) {
      server.middlewares.use('/api/chat', (req, res, next) => {
        if (req.method !== 'POST') return next()
        handleChat(req, res).catch((err) => {
          if (!res.headersSent) {
            sendJson(res, 500, {
              error: err instanceof Error ? err.message : String(err)
            })
          } else {
            res.end()
          }
        })
      })

      server.middlewares.use('/api/web-config', (req, res, next) => {
        if (req.method !== 'GET') return next()
        const { baseUrl, apiKey, model } = getLlmConfig()
        sendJson(res as ServerResponse, 200, {
          configured: Boolean(apiKey),
          baseUrl,
          model
        })
      })
    }
  }
}
