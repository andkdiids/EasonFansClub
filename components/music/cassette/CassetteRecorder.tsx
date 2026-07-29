'use client'

import { forwardRef } from 'react'
import type { CassetteMachinePhase, CassetteSong } from '@/types/music-cassette'

function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

const statusCopy: Record<CassetteMachinePhase, string> = {
  idle: '拖入一盘磁带，开始试听',
  dragging: '放入这里',
  inserting: '正在装载磁带…',
  loading: '正在读取磁带…',
  playing: '正在播放',
  paused: '已暂停',
  ended: '试听结束',
  ejecting: '正在退出磁带…',
  error: '磁带读取失败',
}

export const CassetteRecorder = forwardRef<HTMLElement, {
  phase: CassetteMachinePhase
  track: CassetteSong | null
  pendingTrack: CassetteSong | null
  overDeck: boolean
  elapsed: number
  duration: number
  muted: boolean
  error: string | null
  onTogglePlayback: () => void
  onEject: () => void
  onToggleMuted: () => void
}>(function CassetteRecorder({
  phase,
  track,
  pendingTrack,
  overDeck,
  elapsed,
  duration,
  muted,
  error,
  onTogglePlayback,
  onEject,
  onToggleMuted,
}, ref) {
  const hasTape = Boolean(track)
  const spinning = phase === 'playing'
  const progress = duration > 0 ? Math.min(100, elapsed / duration * 100) : 0

  return (
    <section
      ref={ref}
      className="easmusic-recorder"
      data-phase={phase}
      data-drop-active={overDeck ? 'true' : 'false'}
      aria-label="互动录音机"
    >
      <div className="easmusic-recorder-handle" aria-hidden="true" />
      <header>
        <span>ECFC · EASMUSIC ARCHIVE</span>
        <i aria-hidden="true" />
      </header>
      <div className="easmusic-recorder-face">
        <div className={`easmusic-speaker ${spinning ? 'is-playing' : ''}`} aria-hidden="true"><i /></div>
        <div className="easmusic-deck">
          <div className="easmusic-recorder-display" aria-live="polite">
            <small>{hasTape ? track?.albumTitle : 'CASSETTE SAMPLER'}</small>
            <strong>{hasTape ? track?.title : statusCopy[phase]}</strong>
            {hasTape ? <span>{statusCopy[phase]}</span> : null}
          </div>
          <div className="easmusic-deck-slot" data-open={phase === 'inserting' || phase === 'ejecting' || overDeck ? 'true' : 'false'}>
            {hasTape ? (
              <div className="easmusic-loaded-tape" data-spinning={spinning ? 'true' : 'false'}>
                <i /><i />
                <b>{track?.title}</b>
              </div>
            ) : (
              <span>{overDeck ? '放入这里' : 'EMPTY'}</span>
            )}
            {phase === 'inserting' && pendingTrack ? (
              <div className="easmusic-inserting-tape" aria-hidden="true">
                <i /><i />
                <b>{pendingTrack.title}</b>
              </div>
            ) : null}
            <div className="easmusic-deck-door" aria-hidden="true" />
          </div>
          <div className="easmusic-recorder-progress">
            <i style={{ width: `${progress}%` }} />
          </div>
          <p><span>{formatTime(elapsed)}</span><span>{formatTime(duration || 60)}</span></p>
        </div>
        <div className={`easmusic-speaker ${spinning ? 'is-playing' : ''}`} aria-hidden="true"><i /></div>
      </div>
      {error ? <p className="easmusic-recorder-error">{error}</p> : null}
      <footer>
        <button type="button" onClick={onTogglePlayback} disabled={!hasTape || phase === 'loading' || phase === 'inserting' || phase === 'ejecting'} aria-label={spinning ? '暂停试听' : '播放试听'}>
          <i className={spinning ? 'is-pause' : 'is-play'} aria-hidden="true" />
          {phase === 'loading' ? '读取中' : spinning ? '暂停' : phase === 'ended' ? '重播' : '播放'}
        </button>
        <button type="button" onClick={onEject} disabled={!hasTape || phase === 'inserting' || phase === 'ejecting'}>退出磁带</button>
        <button type="button" onClick={onToggleMuted}>{muted ? '恢复声音' : '静音'}</button>
      </footer>
    </section>
  )
})
