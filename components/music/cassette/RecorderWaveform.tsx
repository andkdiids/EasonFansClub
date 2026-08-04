'use client'

import { useEffect, useRef } from 'react'
import type { AudioAnalysisMode, AudioAnalysisModeDetails } from '@/types/music-cassette'

const COLUMN_COUNT = 12
const BASELINE_HEIGHT = 0.12
const MAX_HEIGHT = 0.9
const ZERO_DATA_FRAME_THRESHOLD = 20

type AudioElementRef = { readonly current: HTMLAudioElement | null }
type AnalysisModeChange = (mode: AudioAnalysisMode, details?: AudioAnalysisModeDetails) => void

export function hasUsableFrequencyData(data: ArrayLike<number>, threshold = 2) {
  for (let index = 0; index < data.length; index += 1) {
    if (data[index] > threshold) return true
  }
  return false
}

export function getFallbackWaveTarget(index: number, timeMs: number) {
  const center = (COLUMN_COUNT - 1) / 2
  const centerWeight = Math.max(0, 1 - Math.abs(index - center) / center)
  const time = timeMs / 1000
  const wave = Math.sin(time * 4.2 + index * 0.47) * 0.34
    + Math.sin(time * 2.45 + index * 0.23) * 0.2
  const normalizedWave = Math.max(0, Math.min(1, 0.52 + wave))
  const minimumLift = 0.045
  const amplitude = 0.1 + centerWeight * 0.48
  return BASELINE_HEIGHT + minimumLift + amplitude * normalizedWave
}

function setColumnHeight(column: HTMLSpanElement | null, height: number) {
  column?.style.setProperty('--wave-height', String(Math.max(BASELINE_HEIGHT, Math.min(MAX_HEIGHT, height))))
}

export function RecorderWaveform({
  analyser,
  audioRef,
  playing,
  canAnalyzeAudio,
  analysisMode,
  onAnalysisModeChange,
}: Readonly<{
  analyser: AnalyserNode | null
  audioRef: AudioElementRef
  playing: boolean
  canAnalyzeAudio: boolean
  analysisMode: AudioAnalysisMode
  onAnalysisModeChange: AnalysisModeChange
}>) {
  const columnsRef = useRef<Array<HTMLSpanElement | null>>([])
  const heightsRef = useRef(Array.from({ length: COLUMN_COUNT }, () => BASELINE_HEIGHT))
  const reportedModeRef = useRef<AudioAnalysisMode>(analysisMode)

  useEffect(() => {
    reportedModeRef.current = analysisMode
  }, [analysisMode])

  useEffect(() => {
    let active = true
    let frame: number | null = null
    let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let visible = document.visibilityState !== 'hidden'
    let zeroFrames = 0
    const columns = columnsRef.current
    const heights = heightsRef.current
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null

    const cancelScheduledWork = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
        frame = null
      }
    }

    const setBaseline = () => {
      heights.forEach((_, index) => {
        heights[index] = BASELINE_HEIGHT
        setColumnHeight(columns[index], BASELINE_HEIGHT)
      })
    }

    const settleBaseline = () => {
      frame = null
      if (!active) return
      if (!visible) {
        setBaseline()
        return
      }

      let settled = true
      const easing = reducedMotion ? 0.28 : 0.18
      heights.forEach((height, index) => {
        const nextHeight = height + (BASELINE_HEIGHT - height) * easing
        heights[index] = nextHeight
        setColumnHeight(columns[index], nextHeight)
        if (Math.abs(nextHeight - BASELINE_HEIGHT) > 0.004) settled = false
      })

      if (!settled) frame = window.requestAnimationFrame(settleBaseline)
    }

    const scheduleBaseline = () => {
      if (active && visible && frame === null) frame = window.requestAnimationFrame(settleBaseline)
    }

    const schedule = () => {
      if (!active || !visible || frame !== null) return
      frame = window.requestAnimationFrame(draw)
    }

    const setAnalysisMode = (mode: AudioAnalysisMode, details?: AudioAnalysisModeDetails) => {
      if (reportedModeRef.current === mode) return
      reportedModeRef.current = mode
      onAnalysisModeChange(mode, details)
    }

    const drawBaselineFrame = () => {
      const easing = reducedMotion ? 0.32 : 0.16
      heights.forEach((height, index) => {
        const nextHeight = height + (BASELINE_HEIGHT - height) * easing
        heights[index] = nextHeight
        setColumnHeight(columns[index], nextHeight)
      })
    }

    const drawRealWaveform = () => {
      if (!analyser || !data) return
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
        }
        const average = samples ? total / samples / 255 : 0
        const peakValue = peak / 255
        const energy = Math.min(1, average * 2.2 + peakValue * 0.65)
        const target = BASELINE_HEIGHT + Math.pow(energy, 0.58) * (MAX_HEIGHT - BASELINE_HEIGHT)
        const easing = reducedMotion ? 0.32 : 0.14
        heights[index] += (target - heights[index]) * easing
        setColumnHeight(columns[index], heights[index])
      }
    }

    const drawFallbackVisualization = (time: number) => {
      const easing = reducedMotion ? 0.14 : 0.2
      for (let index = 0; index < COLUMN_COUNT; index += 1) {
        const target = getFallbackWaveTarget(index, time)
        heights[index] += (target - heights[index]) * easing
        setColumnHeight(columns[index], heights[index])
      }
    }

    const draw = (time: number) => {
      frame = null
      if (!active || !visible) return

      const audio = audioRef.current
      const audioIsPlaying = Boolean(audio && playing && !audio.paused && !audio.ended)
      if (!audioIsPlaying || !audio) {
        setAnalysisMode('idle', { hasFrequencyData: false, canAnalyzeAudio })
        scheduleBaseline()
        return
      }

      if (!canAnalyzeAudio || !analyser || !data) {
        setAnalysisMode('fallback', { hasFrequencyData: false, canAnalyzeAudio })
        drawFallbackVisualization(time)
        schedule()
        return
      }

      try {
        analyser.getByteFrequencyData(data)
      } catch {
        setAnalysisMode('fallback', { hasFrequencyData: false, canAnalyzeAudio })
        drawFallbackVisualization(time)
        schedule()
        return
      }

      if (hasUsableFrequencyData(data)) {
        zeroFrames = 0
        setAnalysisMode('real', { hasFrequencyData: true, canAnalyzeAudio })
        drawRealWaveform()
      } else {
        const readyForZeroCheck = audio.currentTime > 0.25
          && audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        zeroFrames = readyForZeroCheck ? zeroFrames + 1 : 0
        if (zeroFrames >= ZERO_DATA_FRAME_THRESHOLD) {
          setAnalysisMode('fallback', { analyserAllZero: true, hasFrequencyData: false, canAnalyzeAudio })
          drawFallbackVisualization(time)
        } else {
          drawBaselineFrame()
        }
      }

      schedule()
    }

    const onVisibilityChange = () => {
      visible = document.visibilityState !== 'hidden'
      cancelScheduledWork()
      if (!visible) {
        setAnalysisMode('idle', { hasFrequencyData: false, canAnalyzeAudio })
        setBaseline()
      } else if (playing) {
        schedule()
      } else {
        scheduleBaseline()
      }
    }

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches
      cancelScheduledWork()
      if (playing) schedule()
      else scheduleBaseline()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    motionQuery.addEventListener('change', onMotionChange)

    if (!playing) {
      setAnalysisMode('idle', { hasFrequencyData: false, canAnalyzeAudio })
      scheduleBaseline()
    } else {
      schedule()
    }

    return () => {
      active = false
      cancelScheduledWork()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      motionQuery.removeEventListener('change', onMotionChange)
    }
  }, [analyser, audioRef, canAnalyzeAudio, onAnalysisModeChange, playing])

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
