'use client'

import { scoreToStars } from '@/lib/rating-types'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function RatingStars({ score, size = 'text-xl', label }: Readonly<{ score: number; size?: string; label?: string }>) {
  const stars = scoreToStars(score)
  return (
    <span className={`inline-flex items-center leading-none ${size}`} aria-label={label || `${score}分`}>
      {Array.from({ length: 5 }, (_, index) => {
        const fill = clamp((stars - index) * 100, 0, 100)
        return (
          <span key={index} className="relative inline-block h-[1em] w-[1em]" aria-hidden="true">
            <span className="absolute inset-0 text-slate-300/55 dark:text-slate-600">★</span>
            <span className="absolute inset-y-0 left-0 overflow-hidden text-amber-400" style={{ width: `${fill}%` }}>★</span>
          </span>
        )
      })}
    </span>
  )
}

export function RatingSelector({ value, onChange, disabled = false }: Readonly<{ value: number | null; onChange: (score: number) => void; disabled?: boolean }>) {
  const displayScore = value || 0
  return (
    <div className="relative inline-flex h-11 w-[220px] max-w-full items-center" role="radiogroup" aria-label="你的评分">
      <RatingStars score={displayScore} size="text-3xl" label={value ? `${value}分` : '尚未评分'} />
      <div className="absolute inset-0 flex">
        {Array.from({ length: 10 }, (_, index) => {
          const score = index + 1
          return (
            <button
              key={score}
              type="button"
              role="radio"
              aria-label={`${score}分`}
              aria-checked={value === score}
              disabled={disabled}
              onClick={() => onChange(score)}
              className="h-full min-w-0 flex-1 rounded-sm bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-amber-400/80 disabled:cursor-not-allowed"
            />
          )
        })}
      </div>
    </div>
  )
}
