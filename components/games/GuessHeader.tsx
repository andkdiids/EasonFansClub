export function GuessHeader({ mode, position, total, score, streak, remaining, lives, wrongCount, maxWrongCount, countdown }: Readonly<{
  mode: string
  position: number
  total: number | null
  score: number
  streak: number
  remaining: number | null
  lives?: number
  wrongCount?: number
  maxWrongCount?: number
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
        {maxWrongCount !== undefined
          ? <div><dt>错误</dt><dd>{wrongCount ?? Math.max(0, maxWrongCount - (lives ?? maxWrongCount))}/{maxWrongCount}</dd></div>
          : lives !== undefined
            ? <div><dt>机会</dt><dd>{lives}</dd></div>
            : <div><dt>剩余</dt><dd>{remaining ?? '∞'}</dd></div>}
        {countdown != null ? <div><dt>倒计时</dt><dd>{countdown}s</dd></div> : null}
      </dl>
    </header>
  )
}
