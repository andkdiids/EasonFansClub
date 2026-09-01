'use client'

import {
  GAME_RANKING_RANGE_OPTIONS,
  type GameRankingRangeKey,
} from '@/lib/game-ranking-range'

export function GameRankingRangeTabs({
  value,
  date,
  todayDate,
  onChange,
  ariaLabel = '排行榜时间范围',
}: Readonly<{
  value: GameRankingRangeKey
  date: string | null
  todayDate: string
  onChange: (range: GameRankingRangeKey, date: string | null) => void
  ariaLabel?: string
}>) {
  return (
    <div className="game-ranking-range-tabs" role="tablist" aria-label={ariaLabel}>
      {GAME_RANKING_RANGE_OPTIONS.map((option) => (
        <button
          key={option.key}
          type="button"
          role="tab"
          aria-selected={value === option.key}
          onClick={() => onChange(option.key, option.key === 'date' ? date || todayDate : null)}
        >
          {option.label}
        </button>
      ))}
      {value === 'date' ? (
        <label className="game-ranking-date-picker">
          <span>选择日期</span>
          <input
            type="date"
            value={date || ''}
            max={todayDate}
            onChange={(event) => onChange('date', event.target.value || todayDate)}
          />
        </label>
      ) : null}
    </div>
  )
}
