export function ProgressBar({ value, label }: Readonly<{ value: number; label?: string }>) {
  const safeValue = Math.max(0, Math.min(100, value))
  return (
    <div className="game-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(safeValue)} aria-label={label}>
      <i style={{ width: `${safeValue}%` }} />
    </div>
  )
}
