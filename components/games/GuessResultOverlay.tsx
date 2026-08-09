export function GuessResultOverlay({ correct, skipped = false, loading = false, title, artist, albumTitle, releaseYear, description, score, onContinue, final }: Readonly<{
  correct: boolean
  skipped?: boolean
  loading?: boolean
  title: string
  artist?: string | null
  albumTitle?: string | null
  releaseYear?: number | null
  description?: string | null
  score: number
  onContinue: () => void
  final: boolean
}>) {
  const showContinue = !loading && (skipped || !correct)
  const skippedState = skipped || loading
  return (
    <div className={`guess-result-overlay ${correct ? 'is-correct' : skippedState ? 'is-skipped' : 'is-wrong'}${loading ? ' is-loading' : ''}`} role="dialog" aria-modal="true" aria-labelledby="guess-result-title">
      {correct ? <div className="guess-particles" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div> : null}
      <div className="guess-result-content">
        <span>{skippedState ? 'SKIPPED' : correct ? 'CORRECT' : 'NOT QUITE'}</span>
        <strong id="guess-result-title">{skippedState ? '正确答案' : correct ? `回答正确 · +${score} 分` : '回答错误'}</strong>
        {loading ? (
          <p className="guess-result-loading" aria-live="polite">正在读取正确答案…</p>
        ) : skipped ? (
          <div className="guess-result-details">
            <div className="answer-info-row">
              <span className="answer-label">正确答案</span>
              <strong className="answer-value">《{title}》</strong>
            </div>
            <div className="answer-info-row">
              <span className="answer-label">歌手</span>
              <b className="answer-value">{artist || '暂无歌手信息'}</b>
            </div>
            <div className="answer-info-row">
              <span className="answer-label">发行年份</span>
              <b className="answer-value">{releaseYear ? `${releaseYear}年` : '暂无发行年份'}</b>
            </div>
            <div className="answer-info-row">
              <span className="answer-label">所属专辑</span>
              <b className="answer-value">{albumTitle ? `《${albumTitle}》` : '暂无专辑信息'}</b>
            </div>
            <div className="answer-description">
              <div className="answer-description-title">歌曲简介</div>
              <p className="answer-description-content">{description || '暂无歌曲简介'}</p>
            </div>
          </div>
        ) : (
          <p>正确答案：《{title}》</p>
        )}
        {showContinue ? <button type="button" onClick={onContinue}>{final ? '查看成绩' : '下一题'}</button> : null}
      </div>
    </div>
  )
}
