type CassetteControlsProps = {
  hasTape: boolean
  playing: boolean
  busy: boolean
  onPrevious: () => void
  onRewind: () => void
  onTogglePlayback: () => void
  onStop: () => void
  onNext: () => void
}

export function CassetteControls({
  hasTape,
  playing,
  busy,
  onPrevious,
  onRewind,
  onTogglePlayback,
  onStop,
  onNext,
}: Readonly<CassetteControlsProps>) {
  return (
    <div className="walkman-controls">
      <button type="button" className="walkman-key" onClick={onPrevious} disabled={!hasTape || busy} aria-label="上一首">
        <i className="wk-ic wk-ic-prev" aria-hidden="true" />
      </button>
      <button type="button" className="walkman-key" onClick={onRewind} disabled={!hasTape || busy} aria-label="快退 10 秒">
        <i className="wk-ic wk-ic-rew" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="walkman-key walkman-key-play"
        data-active={playing ? 'true' : 'false'}
        onClick={onTogglePlayback}
        disabled={!hasTape || busy}
        aria-label={playing ? '暂停' : '播放'}
      >
        <i className={`wk-ic ${playing ? 'wk-ic-pause' : 'wk-ic-play'}`} aria-hidden="true" />
      </button>
      <button type="button" className="walkman-key" onClick={onStop} disabled={!hasTape || busy} aria-label="停止并退出磁带">
        <i className="wk-ic wk-ic-stop" aria-hidden="true" />
      </button>
      <button type="button" className="walkman-key" onClick={onNext} disabled={!hasTape || busy} aria-label="下一首">
        <i className="wk-ic wk-ic-next" aria-hidden="true" />
      </button>
    </div>
  )
}
