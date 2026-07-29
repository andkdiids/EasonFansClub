export function GuessResultOverlay({ correct, title, score, onContinue, final }: Readonly<{
  correct: boolean
  title: string
  score: number
  onContinue: () => void
  final: boolean
}>) {
  return (
    <div className={`guess-result-overlay ${correct ? 'is-correct' : 'is-wrong'}`} role="status" aria-live="polite">
      {correct ? <div className="guess-particles" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div> : null}
      <span>{correct ? 'CORRECT' : 'NOT QUITE'}</span>
      <strong>{correct ? `回答正确 · +${score} 分` : '回答错误'}</strong>
      <p>正确答案：《{title}》</p>
      {!correct ? <button type="button" onClick={onContinue}>{final ? '查看成绩' : '进入下一题'}</button> : null}
    </div>
  )
}
