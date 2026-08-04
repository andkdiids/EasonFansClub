'use client'

import Image from 'next/image'
import { forwardRef } from 'react'
import { LedMarqueeText } from '@/components/music/cassette/LedMarqueeText'
import { RecorderWaveform } from '@/components/music/cassette/RecorderWaveform'
import type { AudioAnalysisMode, AudioAnalysisModeDetails, CassetteMachinePhase, CassetteSong } from '@/types/music-cassette'

type CassettePlayerProps = {
  phase: CassetteMachinePhase
  track: CassetteSong | null
  overDeck: boolean
  error: string | null
  audioRef: { readonly current: HTMLAudioElement | null }
  analyserNode: AnalyserNode | null
  canAnalyzeAudio: boolean
  analysisMode: AudioAnalysisMode
  onAnalysisModeChange: (mode: AudioAnalysisMode, details?: AudioAnalysisModeDetails) => void
  previousDisabled: boolean
  nextDisabled: boolean
  onTogglePlayback: () => void
  onPrevious: () => void
  onNext: () => void
}

export const CassetteRecorder = forwardRef<HTMLElement, CassettePlayerProps>(function CassetteRecorder({
  phase,
  track,
  overDeck,
  error,
  audioRef,
  analyserNode,
  canAnalyzeAudio,
  analysisMode,
  onAnalysisModeChange,
  previousDisabled,
  nextDisabled,
  onTogglePlayback,
  onPrevious,
  onNext,
}, ref) {
  const hasTape = Boolean(track)
  const busy = phase === 'inserting' || phase === 'ejecting' || phase === 'loading'
  const playing = phase === 'playing'

  return (
    <section
      ref={ref}
      className="easmusic-recorder"
      data-phase={phase}
      data-drop-active={overDeck ? 'true' : 'false'}
      aria-label="EasMusic 复古录音机播放器"
    >
      <Image
        src="/easmusic/recorder-player-shell.png"
        alt="EasMusic 复古录音机播放器"
        width={1280}
        height={960}
        priority
        className="easmusic-recorder-shell-image"
      />

      <div className="easmusic-recorder-track-label" aria-live="polite">
        <LedMarqueeText
          text={track?.title || '请放入一盘磁带'}
          className={!track ? 'easmusic-recorder-empty-text' : undefined}
        />
      </div>

      <RecorderWaveform
        analyser={analyserNode}
        audioRef={audioRef}
        playing={playing}
        canAnalyzeAudio={canAnalyzeAudio}
        analysisMode={analysisMode}
        onAnalysisModeChange={onAnalysisModeChange}
      />

      <div className="easmusic-recorder-controls">
        <button
          type="button"
          className="easmusic-recorder-control easmusic-recorder-control-prev"
          onClick={onPrevious}
          disabled={!hasTape || busy || previousDisabled}
          aria-label="上一首"
          title="上一首"
        />
        <button
          type="button"
          className="easmusic-recorder-control easmusic-recorder-control-toggle"
          onClick={onTogglePlayback}
          disabled={!hasTape || busy}
          aria-label={playing ? '暂停' : '播放'}
          title={playing ? '暂停' : '播放'}
        />
        <button
          type="button"
          className="easmusic-recorder-control easmusic-recorder-control-next"
          onClick={onNext}
          disabled={!hasTape || busy || nextDisabled}
          aria-label="下一首"
          title="下一首"
        />
      </div>

      {error ? <p className="easmusic-recorder-error" role="alert">{error}</p> : null}
    </section>
  )
})
