/**
 * Stub for window.api — replaces the Electron preload bridge when running as
 * a plain web app (e.g. on Replit for preview purposes).
 * All methods are no-ops or return safe defaults.
 * The real audio/AI pipeline requires the macOS desktop app.
 */

type Unsubscribe = () => void

const noopUnsub = (): Unsubscribe => () => {}
const resolveVoid = (): Promise<void> => Promise.resolve()

const stub = {
  startServices: resolveVoid,
  stopServices: resolveVoid,
  sendMessage: (): Promise<void> => Promise.resolve(),
  interrupt: resolveVoid,
  resetConversation: resolveVoid,
  checkModels: (): Promise<{ exists: boolean }> => Promise.resolve({ exists: false }),
  startDownload: resolveVoid,
  cancelDownload: resolveVoid,
  checkDependencies: (): Promise<{ sox: boolean; espeakNg: boolean; ollama: boolean }> =>
    Promise.resolve({ sox: true, espeakNg: true, ollama: true }),
  startRecording: (): Promise<boolean> => Promise.resolve(false),
  stopRecording: resolveVoid,
  getConfig: (): Promise<{
    aiName: string
    systemPrompt: string
    baseUrl: string
    apiKey: string
    modelName: string
  }> =>
    Promise.resolve({
      aiName: 'Kitten',
      systemPrompt: '',
      baseUrl: 'http://localhost:11434',
      apiKey: '',
      modelName: 'qwen3:0.6b'
    }),
  setConfig: (): Promise<void> => Promise.resolve(),

  onServiceStatus: noopUnsub,
  onKittenState: noopUnsub,
  onTranscription: noopUnsub,
  onLlmDelta: noopUnsub,
  onTtsEvent: noopUnsub,
  onDownloadProgress: noopUnsub,
  onError: noopUnsub,
  onConfigChanged: noopUnsub
}

// Only inject if window.api isn't already provided (i.e. not inside Electron)
if (typeof window !== 'undefined' && !('api' in window)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = stub
}

export {}
