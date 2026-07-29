export function GuessHeader({ mode, position, total, score, streak, remaining, lives, countdown }: Readonly<{
  mode: string
  position: number
  total: number | null
  score: number
  streak: number
  remaining: number | null
  lives?: number
  countdown?: number | null
}>) {
  return (
    <header className="guess-play-header">
      <div className="guess-play-level">
        <span>{mode}</span>
        <strong>{total ? `第 ${position} / ${total} 题` : `第 ${position} 关`}</strong>
      </div>
      <dl>
        <div><dt>得分</dt><dd>{score}</dd></div>
        <div><dt>连击</dt><dd>{streak}</dd></div>
        {lives !== undefined ? <div><dt>机会</dt><dd>{lives}</dd></div> : <div><dt>剩余</dt><dd>{remaining ?? '∞'}</dd></div>}
        {countdown != null ? <div><dt>倒计时</dt><dd>{countdown}s</dd></div> : null}
      </dl>
    </header>
  )
}
