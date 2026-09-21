/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type FakeRecognition = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  onstart: (() => void) | null
  onresult: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  onend: (() => void) | null
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
}

type FakeUtterance = {
  text: string
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  lang?: string
  rate?: number
  voice?: unknown
}

const recognizers: FakeRecognition[] = []
const utterances: FakeUtterance[] = []
const speech = {
  paused: false,
  cancel: vi.fn(),
  resume: vi.fn(),
  speak: vi.fn(),
  getVoices: vi.fn(() => [{ name: 'Test English', lang: 'en-US' }]),
  addEventListener: vi.fn()
}

class Recognition {
  lang = ''
  interimResults = false
  maxAlternatives = 0
  continuous = false
  onstart: (() => void) | null = null
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn()
  abort = vi.fn()

  constructor() {
    recognizers.push(this)
  }
}

class Utterance {
  text: string
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  lang?: string
  rate?: number
  voice?: unknown

  constructor(text: string) {
    this.text = text
    utterances.push(this)
  }
}

function sseResponse(...events: Array<Record<string, string>>): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''))
      )
      controller.close()
    }
  })
  return new Response(body, { status: 200 })
}

async function setup() {
  vi.resetModules()
  recognizers.length = 0
  utterances.length = 0
  speech.paused = false
  speech.cancel.mockClear()
  speech.resume.mockClear()
  speech.speak.mockClear()
  speech.getVoices.mockClear()
  vi.stubGlobal('SpeechRecognition', Recognition)
  vi.stubGlobal('webkitSpeechRecognition', Recognition)
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  vi.stubGlobal('speechSynthesis', speech)
  Object.assign(window, { SpeechRecognition: Recognition, webkitSpeechRecognition: Recognition })
  delete (window as unknown as { api?: unknown }).api
  const fetchMock = vi.fn().mockResolvedValue(
    sseResponse({ type: 'delta', text: 'Hello!' }, { type: 'sentence', text: 'Hello!' }, { type: 'done' })
  )
  vi.stubGlobal('fetch', fetchMock)
  await import('./api-web')
  const api = (window as unknown as { api: typeof window.api }).api
  const states: string[] = []
  const transcripts: Array<{ text: string; interim?: boolean }> = []
  api.onKittenState((state) => states.push(state))
  api.onTranscription((event) => transcripts.push(event))
  return { api, fetchMock, states, transcripts }
}

function result(text: string, isFinal: boolean) {
  return { isFinal, 0: { transcript: text, confidence: 1 }, length: 1 }
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as unknown as { api?: unknown }).api
})

describe('web voice adapter', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('sends an interim-only short utterance exactly once', async () => {
    const { api, fetchMock } = await setup()
    await api.startRecording()
    const rec = recognizers[0]
    rec.onresult?.({ resultIndex: 0, results: { 0: result('Hi Pip', false), length: 1 } })
    await api.stopRecording()
    rec.onend?.()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].text).toBe('Hi Pip')
  })

  it('accumulates final results and uses the latest interim fallback', async () => {
    const { api, fetchMock } = await setup()
    await api.startRecording()
    const rec = recognizers[0]
    rec.onresult?.({ resultIndex: 0, results: { 0: result('My name', true), length: 1 } })
    rec.onresult?.({
      resultIndex: 1,
      results: { 0: result('My name', true), 1: result('is Pip', false), length: 2 }
    })
    await api.stopRecording()
    rec.onend?.()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].text).toBe('My name is Pip')
  })

  it('creates a fresh recognizer and sends the second recording', async () => {
    const { api, fetchMock } = await setup()
    await api.startRecording()
    recognizers[0].onresult?.({ resultIndex: 0, results: { 0: result('first', true), length: 1 } })
    await api.stopRecording()
    recognizers[0].onend?.()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await api.startRecording()
    expect(recognizers).toHaveLength(2)
    recognizers[1].onresult?.({ resultIndex: 0, results: { 0: result('second', true), length: 1 } })
    await api.stopRecording()
    recognizers[1].onend?.()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages.at(-1).text).toBe('second')
  })

  it('does not call chat for a no-speech recognition error', async () => {
    const { api, fetchMock } = await setup()
    await api.startRecording()
    const rec = recognizers[0]
    rec.onerror?.({ error: 'no-speech', message: '' })
    rec.onend?.()
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('queues SSE sentence events in order and resumes paused synthesis', async () => {
    const { api, fetchMock } = await setup()
    fetchMock.mockResolvedValueOnce(
      sseResponse(
        { type: 'delta', text: 'One. Two.' },
        { type: 'sentence', text: 'One.' },
        { type: 'sentence', text: 'Two.' },
        { type: 'done' }
      )
    )
    speech.paused = true
    await api.sendMessage('go')
    await vi.waitFor(() => expect(speech.speak).toHaveBeenCalledTimes(1))
    expect(utterances[0].text).toBe('One.')
    expect(speech.resume).toHaveBeenCalled()
    utterances[0].onend?.()
    await vi.waitFor(() => expect(speech.speak).toHaveBeenCalledTimes(2))
    expect(utterances[1].text).toBe('Two.')
  })

  it('ignores a stale utterance callback after cancellation and a new response', async () => {
    const { api, fetchMock, states } = await setup()
    fetchMock
      .mockResolvedValueOnce(sseResponse({ type: 'sentence', text: 'Old response.' }, { type: 'done' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(sseResponse({ type: 'sentence', text: 'New response.' }, { type: 'done' }))
    await api.sendMessage('old')
    await vi.waitFor(() => expect(speech.speak).toHaveBeenCalledTimes(1))
    await api.interrupt()
    await api.sendMessage('new')
    await vi.waitFor(() => expect(speech.speak).toHaveBeenCalledTimes(2))
    const first = speech.speak.mock.calls[0][0] as FakeUtterance
    const second = speech.speak.mock.calls[1][0] as FakeUtterance
    first.onend?.()
    expect(second.text).toBe('New response.')
    expect(states.at(-1)).toBe('speaking')
  })
})