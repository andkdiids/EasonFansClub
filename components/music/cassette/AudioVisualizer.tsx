import type { CSSProperties } from 'react'

const BAR_PATTERN = [0.92, 0.61, 1.18, 0.74, 1.05, 0.58, 1.31, 0.83, 1.12, 0.66, 1.24, 0.78, 0.97, 0.62]

export function AudioVisualizer({ state }: Readonly<{ state: 'playing' | 'paused' | 'stopped' }>) {
  return (
    <span className="audio-viz" data-viz-state={state} aria-hidden="true">
      {BAR_PATTERN.map((ratio, index) => (
        <i key={index} style={{ '--viz-ratio': ratio } as CSSProperties} />
      ))}
    </span>
  )
}
