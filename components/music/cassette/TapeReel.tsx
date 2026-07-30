export type TapeReelState = 'playing' | 'paused' | 'stopped'

export function TapeReel({ state = 'stopped', small = false }: Readonly<{ state?: TapeReelState; small?: boolean }>) {
  return (
    <span className={`tape-reel${small ? ' tape-reel-sm' : ''}`} data-reel-state={state} aria-hidden="true">
      <i className="tape-reel-teeth" />
      <i className="tape-reel-hub" />
    </span>
  )
}
