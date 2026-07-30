'use client'

import { forwardRef } from 'react'
import { AudioVisualizer } from '@/components/music/cassette/AudioVisualizer'
import { CassetteControls } from '@/components/music/cassette/CassetteControls'
import { TapeReel, type TapeReelState } from '@/components/music/cassette/TapeReel'
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

type CassettePlayerProps = {
  phase: CassetteMachinePhase
  track: CassetteSong | null
  pendingTrack: CassetteSong | null
  overDeck: boolean
  elapsed: number
  duration: number
  error: string | null
  onTogglePlayback: () => void
  onEject: () => void
  onPrevious: () => void
  onNext: () => void
  onRewind: () => void
}

function TapeShell({ title, artist, reelState }: Readonly<{ title: string; artist: string; reelState: TapeReelState }>) {
  return (
    <>
      <div className="walkman-tape-label">
        <strong>{title}</strong>
        <small>{artist}</small>
        <i>A</i>
      </div>
      <div className="walkman-tape-reels">
        <TapeReel state={reelState} />
        <span className="walkman-tape-spool" aria-hidden="true" />
        <TapeReel state={reelState} />
      </div>
      <em className="walkman-tape-type">NORMAL POSITION TYPE I</em>
    </>
  )
}

export const CassettePlayer = forwardRef<HTMLElement, CassettePlayerProps>(function CassettePlayer({
  phase,
  track,
  pendingTrack,
  overDeck,
  elapsed,
  duration,
  error,
  onTogglePlayback,
  onEject,
  onPrevious,
  onNext,
  onRewind,
}, ref) {
  const hasTape = Boolean(track)
  const busy = phase === 'inserting' || phase === 'ejecting' || phase === 'loading'
  const playing = phase === 'playing'
  const reelState: TapeReelState = playing ? 'playing' : phase === 'paused' || phase === 'loading' ? 'paused' : 'stopped'
  const vizState: TapeReelState = reelState
  const recState = playing ? 'on' : phase === 'paused' || phase === 'loading' ? 'dim' : 'off'
  const deckOpen = phase === 'inserting' || phase === 'ejecting' || overDeck

  return (
    <section
      ref={ref}
      className="walkman"
      data-phase={phase}
      data-drop-active={overDeck ? 'true' : 'false'}
      aria-label="复古随身录音机"
    >
      <header className="walkman-top">
        <span>ECFC · EASMUSIC ARCHIVE</span>
        <span className="walkman-rec" data-rec={recState}><i aria-hidden="true" />REC</span>
      </header>
      <div className="walkman-face">
        <div className="walkman-deck" data-open={deckOpen ? 'true' : 'false'}>
          <div className="walkman-deck-window">
            {hasTape && track ? (
              <div className="walkman-loaded-tape">
                <TapeShell title={track.title} artist={track.artist} reelState={reelState} />
              </div>
            ) : (
              <span className="walkman-deck-empty">{overDeck ? '放入这里' : statusCopy[phase]}</span>
            )}
            {phase === 'inserting' && pendingTrack ? (
              <div className="walkman-inserting-tape" aria-hidden="true">
                <TapeShell title={pendingTrack.title} artist={pendingTrack.artist} reelState="stopped" />
              </div>
            ) : null}
            <div className="walkman-deck-door" aria-hidden="true" />
          </div>
        </div>
        <div className="walkman-lcd" aria-live="polite">
          <span className="walkman-lcd-title">{hasTape && track ? track.title : 'CASSETTE SAMPLER'}</span>
          <span className="walkman-lcd-artist">{hasTape && track ? track.artist : statusCopy[phase]}</span>
          <span className="walkman-lcd-time">
            <strong>{formatTime(elapsed)}</strong>
            <span>/ {formatTime(duration || 60)}</span>
          </span>
          <AudioVisualizer state={vizState} />
        </div>
        <div className="walkman-knobs" aria-hidden="true">
          <div className="walkman-knob"><i /><span>FUNCTION</span></div>
          <div className="walkman-knob"><i /><span>VOLUME</span></div>
        </div>
      </div>
      {error ? <p className="walkman-error" role="alert">{error}</p> : null}
      <div className="walkman-bottom">
        <CassetteControls
          hasTape={hasTape}
          playing={playing}
          busy={busy}
          onPrevious={onPrevious}
          onRewind={onRewind}
          onTogglePlayback={onTogglePlayback}
          onStop={onEject}
          onNext={onNext}
        />
        <div className="walkman-sliders" aria-hidden="true">
          <div className="walkman-slider"><span>BASS</span><i><b style={{ left: '58%' }} /></i></div>
          <div className="walkman-slider"><span>VOL</span><i><b style={{ left: '76%' }} /></i></div>
        </div>
      </div>
    </section>
  )
})
