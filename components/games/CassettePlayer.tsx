import { ProgressBar } from './ProgressBar'
import { WaveformBackground } from './WaveformBackground'

function formatTime(seconds: number) {
  return `00:${String(Math.max(0, Math.ceil(seconds))).padStart(2, '0')}`
}

export function CassettePlayer({
  playing,
  loading,
  progress,
  elapsedSeconds,
  durationSeconds,
  remainingPlayCount,
  disabled,
  onToggle,
}: Readonly<{
  playing: boolean
  loading: boolean
  progress: number
  elapsedSeconds: number
  durationSeconds: number
  remainingPlayCount: number
  disabled: boolean
  onToggle: () => void
}>) {
  return (
    <section className={`cassette-stage ${playing ? 'is-playing' : ''}`} data-testid="cassette-player">
      <WaveformBackground active={playing} />
      <div className="cassette-player">
        <header>
          <span>ECFC AUDIO LAB</span>
          <i aria-hidden="true" />
        </header>
        <div className="cassette-window">
          <div className="cassette-reel" aria-hidden="true"><i /><b /></div>
          <div className="cassette-label">
            <span>EASON ARCHIVE</span>
            <strong>{loading ? 'LOADING' : playing ? 'NOW PLAYING' : 'READY'}</strong>
            <button
              type="button"
              className="cassette-play"
              onClick={onToggle}
              disabled={disabled}
              aria-label={playing ? '暂停音频' : '播放音频'}
            >
              {loading ? <i className="cassette-loader" /> : playing ? <i className="cassette-pause" /> : <i className="cassette-play-icon" />}
            </button>
          </div>
          <div className="cassette-reel" aria-hidden="true"><i /><b /></div>
        </div>
        <div className="cassette-controls">
          <div>
            <ProgressBar value={progress} label="音频播放进度" />
            <p><span>{formatTime(elapsedSeconds)}</span><span>{formatTime(durationSeconds)}</span></p>
          </div>
          <b>{remainingPlayCount} PLAY{remainingPlayCount === 1 ? '' : 'S'}</b>
        </div>
      </div>
    </section>
  )
}
