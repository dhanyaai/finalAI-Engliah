/**
 * Web implementation of window.api — replaces the Electron preload bridge when
 * running as a plain web app (e.g. on Replit).
 *
 * Audio:  browser SpeechRecognition (STT) + SpeechSynthesis (TTS)
 * LLM:    SSE stream from the Vite backend at /api/chat (see src/web/chat-plugin.ts)
 * Config: REST calls to /api/config
 *
 * This module is a no-op inside Electron (window.api is already provided by
 * the preload bridge). The macOS audio flow is entirely untouched.
 */

// ─── Types (mirror preload/index.ts) ─────────────────────────────────────────

type KittenState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'interrupted'
type Unsubscribe = () => void
type Listener<T> = (data: T) => void

interface ConfigData {
  aiName: string
  systemPrompt: string
  baseUrl: string
  apiKey: string
  modelName: string
}

interface DownloadProgress {
  bytes: number
  total: number
  currentFile: string
}

// ─── isWebChatMode helper (used by UI components) ────────────────────────────

/**
 * Returns true when the app is running in web-mode (window.api is the web
 * adapter, not the Electron preload bridge). Safe to call before the adapter
 * has finished initialising.
 */
export function isWebChatMode(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window as { __HIKID_WEB_CHAT__?: boolean }).__HIKID_WEB_CHAT__ === true
  )
}

// ─── Event bus ───────────────────────────────────────────────────────────────

type BusMap = {
  serviceStatus: { ready: boolean }
  kittenState: KittenState
  transcription: { text: string }
  llmDelta: { text: string }
  ttsEvent: 'start' | 'end'
  downloadProgress: DownloadProgress
  error: { message: string }
  configChanged: ConfigData
}

const listeners: { [K in keyof BusMap]?: Array<(data: BusMap[K]) => void> } = {}

function on<K extends keyof BusMap>(channel: K, handler: (data: BusMap[K]) => void): Unsubscribe {
  if (!listeners[channel]) listeners[channel] = []
  ;(listeners[channel] as Array<(data: BusMap[K]) => void>).push(handler)
  return () => {
    const arr = listeners[channel] as Array<(data: BusMap[K]) => void>
    const idx = arr.indexOf(handler)
    if (idx !== -1) arr.splice(idx, 1)
  }
}

function emit<K extends keyof BusMap>(channel: K, data: BusMap[K]): void {
  const arr = listeners[channel]
  if (arr) (arr as Array<(data: BusMap[K]) => void>).forEach((h) => h(data))
}

// ─── TTS via SpeechSynthesis ──────────────────────────────────────────────────

let ttsQueue: Promise<void> = Promise.resolve()
let pendingTtsCount = 0
let ttsAborted = false

function enqueueTts(text: string): void {
  const trimmed = text.trim()
  if (!trimmed || ttsAborted) return

  pendingTtsCount++
  ttsQueue = ttsQueue.then(
    () =>
      new Promise<void>((resolve) => {
        if (ttsAborted) {
          pendingTtsCount--
          resolve()
          return
        }
        emit('ttsEvent', 'start')
        emit('kittenState', 'speaking')

        const utt = new SpeechSynthesisUtterance(trimmed)
        utt.lang = 'en-US'
        utt.rate = 0.95

        const finish = (): void => {
          pendingTtsCount--
          emit('ttsEvent', 'end')
          if (pendingTtsCount === 0 && !ttsAborted) {
            emit('kittenState', 'idle')
          }
          resolve()
        }

        utt.onend = finish
        utt.onerror = finish
        speechSynthesis.speak(utt)
      })
  )
}

function stopTts(): void {
  ttsAborted = true
  speechSynthesis.cancel()
  pendingTtsCount = 0
  ttsQueue = Promise.resolve()
  ttsAborted = false
}

// ─── LLM chat ─────────────────────────────────────────────────────────────────

let chatAbort: AbortController | null = null
// Full conversation history so the LLM has context
const chatHistory: Array<{ role: 'user' | 'assistant'; text: string }> = []

async function sendMessage(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return

  stopTts()
  emit('kittenState', 'thinking')
  emit('llmDelta', { text: '' }) // clear previous delta in UI

  chatHistory.push({ role: 'user', text: trimmed })
  emit('transcription', { text: trimmed })

  chatAbort = new AbortController()

  let assistantText = ''
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatHistory }),
      signal: chatAbort.signal
    })

    if (!res.ok || !res.body) {
      let message = `Backend error: ${res.status} ${res.statusText}`
      try {
        const body = (await res.json()) as { error?: string }
        if (body.error) message = body.error
      } catch {
        // keep generic message
      }
      emit('error', { message })
      emit('kittenState', 'idle')
      // Remove the user message we added since it didn't go through
      chatHistory.pop()
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      const lines = buf.split('\n')
      buf = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const evt = JSON.parse(line.slice(6)) as {
            type: string
            text?: string
            message?: string
          }

          if (evt.type === 'thinking') {
            emit('kittenState', 'thinking')
          } else if (evt.type === 'delta' && evt.text) {
            assistantText += evt.text
            emit('llmDelta', { text: evt.text })
          } else if (evt.type === 'sentence' && evt.text) {
            enqueueTts(evt.text)
          } else if (evt.type === 'done') {
            if (assistantText) {
              chatHistory.push({ role: 'assistant', text: assistantText })
            }
            if (pendingTtsCount === 0) emit('kittenState', 'idle')
          } else if (evt.type === 'interrupted') {
            emit('kittenState', 'interrupted')
            stopTts()
            emit('kittenState', 'idle')
          } else if (evt.type === 'error') {
            emit('error', { message: evt.message ?? 'Unknown error' })
            emit('kittenState', 'idle')
            // Remove the user message we added since it failed
            chatHistory.pop()
          }
        } catch {
          // malformed SSE line
        }
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      stopTts()
      emit('kittenState', 'idle')
    } else {
      const message = err instanceof Error ? err.message : String(err)
      emit('error', { message })
      emit('kittenState', 'idle')
      // Remove the user message we added since it failed
      chatHistory.pop()
    }
  }
}

// ─── Speech Recognition ───────────────────────────────────────────────────────

type SpeechRecognitionCtor = new () => SpeechRecognition

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  return (
    (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor })
      .webkitSpeechRecognition ??
    null
  )
}

let recognition: SpeechRecognition | null = null
let recognitionActive = false
let latestTranscript = ''

function startRecording(): Promise<boolean> {
  const SR = getSpeechRecognition()
  if (!SR) {
    emit('error', {
      message:
        'Speech recognition is not supported in this browser. Please use Chrome or Edge for voice input.'
    })
    return Promise.resolve(false)
  }

  stopTts()
  chatAbort?.abort()
  latestTranscript = ''

  recognition = new SR()
  recognition.lang = 'en-US'
  recognition.interimResults = true
  recognition.maxAlternatives = 1
  recognition.continuous = false

  recognition.onstart = (): void => {
    recognitionActive = true
    emit('kittenState', 'listening')
  }

  recognition.onresult = (event: SpeechRecognitionEvent): void => {
    const result = event.results[event.results.length - 1]
    const transcript = result[0].transcript.trim()

    if (result.isFinal) {
      latestTranscript = transcript
      emit('transcription', { text: transcript })
    } else {
      // Interim result — show in transcription but don't send yet
      emit('transcription', { text: transcript })
    }
  }

  recognition.onerror = (event: SpeechRecognitionErrorEvent): void => {
    recognitionActive = false
    if (event.error === 'no-speech') {
      emit('transcription', { text: '' }) // clears pending placeholder
    } else if (event.error !== 'aborted') {
      emit('error', { message: `Microphone error: ${event.error}` })
    }
    emit('kittenState', 'idle')
  }

  recognition.onend = (): void => {
    recognitionActive = false
    if (latestTranscript) {
      // Fire-and-forget: send to LLM
      sendMessage(latestTranscript).catch(() => {})
      latestTranscript = ''
    } else {
      emit('kittenState', 'idle')
    }
  }

  recognition.start()
  return Promise.resolve(true)
}

function stopRecording(): Promise<void> {
  if (recognition && recognitionActive) {
    recognition.stop()
  }
  return Promise.resolve()
}

// ─── Config ───────────────────────────────────────────────────────────────────

async function getConfig(): Promise<ConfigData> {
  const res = await fetch('/api/config')
  if (!res.ok) throw new Error(`Failed to load config: ${res.status}`)
  return res.json() as Promise<ConfigData>
}

async function setConfig(config: ConfigData): Promise<void> {
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  })
  if (!res.ok) throw new Error(`Failed to save config: ${res.status}`)
  const updated = (await res.json()) as ConfigData
  emit('configChanged', updated)
}

// ─── Service lifecycle ────────────────────────────────────────────────────────

function startServices(): Promise<void> {
  // In web mode there are no external services to start.
  // We simply signal ready after a short delay so the UI transitions correctly.
  setTimeout(() => emit('serviceStatus', { ready: true }), 100)
  return Promise.resolve()
}

function stopServices(): Promise<void> {
  stopTts()
  chatAbort?.abort()
  return Promise.resolve()
}

function interrupt(): Promise<void> {
  chatAbort?.abort()
  stopTts()
  fetch('/api/interrupt', { method: 'POST' }).catch(() => {})
  emit('kittenState', 'idle')
  return Promise.resolve()
}

async function resetConversation(): Promise<void> {
  chatAbort?.abort()
  stopTts()
  chatHistory.length = 0
  await fetch('/api/reset', { method: 'POST' }).catch(() => {})
  emit('kittenState', 'idle')
}

// ─── Deps & models (no-op in web mode) ───────────────────────────────────────

async function checkDependencies(): Promise<{ sox: boolean; espeakNg: boolean; ollama: boolean }> {
  try {
    const res = await fetch('/api/deps')
    if (res.ok) return res.json() as Promise<{ sox: boolean; espeakNg: boolean; ollama: boolean }>
  } catch {
    // backend not ready yet
  }
  return { sox: true, espeakNg: true, ollama: true }
}

function checkModels(): Promise<{ exists: boolean }> {
  return Promise.resolve({ exists: true })
}

function startDownload(): Promise<void> {
  return Promise.resolve()
}

function cancelDownload(): Promise<void> {
  return Promise.resolve()
}

// ─── Assemble and inject window.api ──────────────────────────────────────────

const webApi = {
  startServices,
  stopServices,
  sendMessage,
  interrupt,
  resetConversation,
  checkModels,
  startDownload,
  cancelDownload,
  checkDependencies,
  startRecording,
  stopRecording,
  getConfig,
  setConfig,

  onServiceStatus: (cb: (s: { ready: boolean }) => void): Unsubscribe =>
    on('serviceStatus', cb),
  onKittenState: (cb: (s: KittenState) => void): Unsubscribe =>
    on('kittenState', cb),
  onTranscription: (cb: (d: { text: string }) => void): Unsubscribe =>
    on('transcription', cb),
  onLlmDelta: (cb: (d: { text: string }) => void): Unsubscribe =>
    on('llmDelta', cb),
  onTtsEvent: (cb: (e: 'start' | 'end') => void): Unsubscribe =>
    on('ttsEvent', cb),
  onDownloadProgress: (cb: (d: DownloadProgress) => void): Unsubscribe =>
    on('downloadProgress', cb),
  onError: (cb: (d: { message: string }) => void): Unsubscribe =>
    on('error', cb),
  onConfigChanged: (cb: (c: ConfigData) => void): Unsubscribe =>
    on('configChanged', cb)
}

// Only inject if not already provided by Electron preload
if (typeof window !== 'undefined' && !('api' in window)) {
  ;(window as { __HIKID_WEB_CHAT__?: boolean }).__HIKID_WEB_CHAT__ = true
  ;(window as unknown as { api: typeof webApi }).api = webApi
}

export {}
