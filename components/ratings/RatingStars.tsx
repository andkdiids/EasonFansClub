'use client'

import { ratingScoreForStarHalf, scoreToStars } from '@/lib/rating-types'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function starFill(score: number, index: number) {
  return clamp((scoreToStars(score) - index) * 100, 0, 100)
}

function StarVisual({ score, index }: Readonly<{ score: number; index: number }>) {
  const fill = starFill(score, index)
  return (
    <span className="pointer-events-none absolute inset-0" aria-hidden="true">
      <span className="absolute inset-0 text-slate-300/55 dark:text-slate-600">★</span>
      <span className="absolute inset-y-0 left-0 overflow-hidden text-amber-400" style={{ width: fill + '%' }}>★</span>
    </span>
  )
}

export function RatingStars({ score, size = 'text-xl', label }: Readonly<{ score: number; size?: string; label?: string }>) {
  const accessibleLabel = label || String(score) + '分'
  return (
    <span className={'inline-flex items-center leading-none ' + size} aria-label={accessibleLabel}>
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} className="relative inline-block h-[1em] w-[1em] shrink-0" aria-hidden="true">
          <StarVisual score={score} index={index} />
        </span>
      ))}
    </span>
  )
}

export function RatingSelector({ value, onChange, disabled = false }: Readonly<{ value: number | null; onChange: (score: number) => void; disabled?: boolean }>) {
  const displayScore = value || 0
  const accessibleLabel = value ? String(value) + '分' : '尚未评分'
  return (
    <div className="rating-selector inline-flex h-11 max-w-full items-center" role="radiogroup" aria-label="你的评分">
      <div className="rating-stars inline-flex w-fit items-center text-3xl leading-none" aria-label={accessibleLabel}>
        {Array.from({ length: 5 }, (_, index) => {
          const leftScore = ratingScoreForStarHalf(index, 'left')!
          const rightScore = ratingScoreForStarHalf(index, 'right')!
          return (
            <span key={index} className="rating-star relative inline-block h-[1em] w-[1em] shrink-0">
              <StarVisual score={displayScore} index={index} />
              <button
                type="button"
                role="radio"
                data-score={leftScore}
                data-half="left"
                aria-label={String(leftScore) + '分'}
                aria-checked={value === leftScore}
                disabled={disabled}
                onClick={() => onChange(leftScore)}
                className="absolute inset-y-0 left-0 z-10 w-1/2 rounded-sm border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-amber-400/80 disabled:cursor-not-allowed"
              />
              <button
                type="button"
                role="radio"
                data-score={rightScore}
                data-half="right"
                aria-label={String(rightScore) + '分'}
                aria-checked={value === rightScore}
                disabled={disabled}
                onClick={() => onChange(rightScore)}
                className="absolute inset-y-0 right-0 z-10 w-1/2 rounded-sm border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-amber-400/80 disabled:cursor-not-allowed"
              />
            </span>
          )
        })}
      </div>
    </div>
  )
}
