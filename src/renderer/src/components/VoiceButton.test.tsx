/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VoiceButton from './VoiceButton'

beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})
afterEach(cleanup)

describe('VoiceButton pointer lifecycle', () => {
  it('does not stop when the pointer leaves while captured', () => {
    const stop = vi.fn()
    const { getByRole } = render(
      <VoiceButton isRecording onPointerDown={vi.fn()} onPointerUp={stop} />
    )
    const button = getByRole('button')
    fireEvent.pointerDown(button, { pointerId: 7 })
    fireEvent.pointerLeave(button, { pointerId: 7 })
    expect(stop).not.toHaveBeenCalled()
    fireEvent.pointerUp(button, { pointerId: 7 })
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('stops once on cancellation and ignores later pointerup', () => {
    const stop = vi.fn()
    const { getByRole } = render(
      <VoiceButton isRecording onPointerDown={vi.fn()} onPointerUp={stop} />
    )
    const button = getByRole('button')
    fireEvent.pointerDown(button, { pointerId: 3 })
    fireEvent.pointerCancel(button, { pointerId: 3 })
    fireEvent.pointerUp(button, { pointerId: 3 })
    expect(stop).toHaveBeenCalledTimes(1)
  })
})