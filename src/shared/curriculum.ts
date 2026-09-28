export type Provider = 'mux' | 'vimeo' | 'youtube'

const providerHosts: Record<Provider, RegExp> = {
  mux: /^stream\.mux\.com$/i,
  vimeo: /^(player\.)?vimeo\.com$/i,
  youtube: /^(www\.)?youtube\.com$/i
}

export function isApprovedVideoUrl(provider: unknown, value: unknown): value is string {
  if (typeof provider !== 'string' || !(provider in providerHosts) || typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && providerHosts[provider as Provider].test(url.hostname)
  } catch {
    return false
  }
}

export function validateCurriculumInput(input: {
  title?: unknown
  objective?: unknown
  level?: unknown
  unitId?: unknown
  ageBands?: unknown
  video?: { provider?: unknown; playbackUrl?: unknown } | null
}): string | null {
  if (typeof input.title !== 'string' || !input.title.trim()) return 'Lesson title is required'
  if (typeof input.objective !== 'string' || !input.objective.trim()) return 'Lesson objective is required'
  if (!['Pre-A1', 'A1', 'A2', 'B1', 'B2', 'C1'].includes(String(input.level))) return 'A CEFR level is required'
  if (typeof input.unitId !== 'string' || !input.unitId.trim()) return 'A unit is required'
  if (!Array.isArray(input.ageBands) || input.ageBands.length === 0 ||
      input.ageBands.some((band) => !['5–8', '9–12', '13–15'].includes(String(band)))) return 'At least one valid age band is required'
  if (!input.video || !isApprovedVideoUrl(input.video.provider, input.video.playbackUrl)) return 'Provider and playback URL must match an approved HTTPS host'
  return null
}

export function canPublishLesson(review: { educatorApproved?: boolean; ageSafetyApproved?: boolean }): boolean {
  return review.educatorApproved === true && review.ageSafetyApproved === true
}