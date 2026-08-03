'use client'

import { useEffect, useRef } from 'react'

const COLUMN_COUNT = 12
const BASELINE_HEIGHT = 0.12
const MAX_HEIGHT = 0.9

type AudioElementRef = { readonly current: HTMLAudioElement | null }

function setColumnHeight(column: HTMLSpanElement | null, height: number) {
  column?.style.setProperty('--wave-height', String(Math.max(BASELINE_HEIGHT, Math.min(MAX_HEIGHT, height))))
}

export function RecorderWaveform({
  analyser,
  audioRef,
  playing,
}: Readonly<{
  analyser: AnalyserNode | null
  audioRef: AudioElementRef
  playing: boolean
}>) {
  const columnsRef = useRef<Array<HTMLSpanElement | null>>([])

  useEffect(() => {
    let active = true
    let frame: number | null = null
    let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let visible = document.visibilityState !== 'hidden'
    let zeroFrames = 0
    const heights = Array.from({ length: COLUMN_COUNT }, () => BASELINE_HEIGHT)
    const columns = columnsRef.current

    const cancelScheduledWork = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
        frame = null
      }
    }

    const setBaseline = () => {
      columns.forEach((column, index) => {
        heights[index] = BASELINE_HEIGHT
        setColumnHeight(column, BASELINE_HEIGHT)
      })
    }

    setBaseline()

    if (!playing || !analyser) {
      return () => {
        active = false
        cancelScheduledWork()
      }
    }

    const data = new Uint8Array(analyser.frequencyBinCount)
    let warnedAboutReadFailure = false

    const schedule = () => {
      if (!active || !playing || !visible || frame !== null) return
      frame = window.requestAnimationFrame(draw)
    }

    const draw = () => {
      frame = null
      if (!active || !playing || !visible) return

      let allZero = true
      try {
        analyser.getByteFrequencyData(data)
      } catch (error) {
        if (!warnedAboutReadFailure) {
          warnedAboutReadFailure = true
          console.warn('[EasMusic waveform] Frequency data could not be read; check the audio CORS response.', error)
        }
        setBaseline()
        schedule()
        return
      }

      for (let index = 0; index < COLUMN_COUNT; index += 1) {
        const start = Math.floor(Math.pow(index / COLUMN_COUNT, 1.35) * Math.max(0, data.length - 1))
        const end = Math.max(start + 1, Math.floor(Math.pow((index + 1) / COLUMN_COUNT, 1.35) * data.length))
        let total = 0
        let peak = 0
        let samples = 0
        for (let bin = start; bin < Math.min(end, data.length); bin += 1) {
          const value = data[bin]
          total += value
          peak = Math.max(peak, value)
          samples += 1
          if (value > 0) allZero = false
        }
        const average = samples ? total / samples / 255 : 0
        const peakValue = peak / 255
        const energy = Math.min(1, average * 2.2 + peakValue * 0.65)
        const target = BASELINE_HEIGHT + Math.pow(energy, 0.58) * (MAX_HEIGHT - BASELINE_HEIGHT)
        const easing = reducedMotion ? 0.32 : 0.14
        heights[index] += (target - heights[index]) * easing
        setColumnHeight(columns[index], heights[index])
      }

      const audio = audioRef.current
      if (allZero && audio && audio.currentTime > 0.25 && audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        zeroFrames += 1
        if (zeroFrames === 120 && !warnedAboutReadFailure) {
          warnedAboutReadFailure = true
          console.warn('[EasMusic waveform] The analyser returned only zeroes during playback; check COS CORS for https://ecfc.fans and the local development origin.')
        }
      } else if (!allZero) {
        zeroFrames = 0
      }

      schedule()
    }

    const onVisibilityChange = () => {
      visible = document.visibilityState !== 'hidden'
      if (!visible) {
        cancelScheduledWork()
        setBaseline()
      } else {
        schedule()
      }
    }
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches
      cancelScheduledWork()
      schedule()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    motionQuery.addEventListener('change', onMotionChange)
    schedule()

    return () => {
      active = false
      cancelScheduledWork()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      motionQuery.removeEventListener('change', onMotionChange)
      setBaseline()
    }
  }, [analyser, audioRef, playing])

  return (
    <div className="easmusic-recorder-waveform" aria-hidden="true">
      {Array.from({ length: COLUMN_COUNT }, (_, index) => (
        <span
          key={index}
          className="easmusic-recorder-waveform-column"
          ref={(element) => {
            columnsRef.current[index] = element
          }}
        >
          <i aria-hidden="true" />
        </span>
      ))}
    </div>
  )
}
