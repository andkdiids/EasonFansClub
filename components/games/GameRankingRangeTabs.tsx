'use client'

import { useId, useState } from 'react'
import {
  GAME_RANKING_RANGE_OPTIONS,
  type GameRankingRangeKey,
} from '@/lib/game-ranking-range'

function formatDate(date: string) {
  return date.replaceAll('-', '/')
}

export function GameRankingRangeTabs({
  value,
  startDate,
  endDate,
  todayDate,
  onChange,
  ariaLabel = '排行榜时间范围',
}: Readonly<{
  value: GameRankingRangeKey
  startDate: string | null
  endDate: string | null
  todayDate: string
  onChange: (range: GameRankingRangeKey, startDate: string | null, endDate: string | null) => void
  ariaLabel?: string
}>) {
  const panelId = useId()
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [draftStartDate, setDraftStartDate] = useState(startDate || todayDate)
  const [draftEndDate, setDraftEndDate] = useState(endDate || (startDate ? startDate : ''))
  const validDraft = Boolean(draftStartDate && draftEndDate)
    && draftStartDate <= draftEndDate
    && draftStartDate <= todayDate
    && draftEndDate <= todayDate

  function openDatePicker() {
    if (!datePickerOpen) {
      setDraftStartDate(startDate || todayDate)
      setDraftEndDate(endDate || (startDate ? startDate : ''))
    }
    setDatePickerOpen((open) => !open)
  }

  return (
    <div className="game-ranking-range-control">
      <div className="game-ranking-range-tabs" role="tablist" aria-label={ariaLabel}>
        {GAME_RANKING_RANGE_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={value === option.key}
            aria-expanded={option.key === 'date' ? datePickerOpen : undefined}
            aria-controls={option.key === 'date' ? panelId : undefined}
            onClick={() => {
              if (option.key === 'date') {
                openDatePicker()
                return
              }
              setDatePickerOpen(false)
              onChange(option.key, null, null)
            }}
          >
            {option.label}
          </button>
        ))}
        {value === 'date' && startDate && endDate ? (
          <span className="game-ranking-date-range-summary" aria-live="polite">
            {formatDate(startDate)}{startDate === endDate ? '' : ` — ${formatDate(endDate)}`}
          </span>
        ) : null}
      </div>
      {datePickerOpen ? (
        <div id={panelId} className="game-ranking-date-range-panel" role="group" aria-label="自定义排行榜日期范围">
          <label>
            <span>开始日期</span>
            <input
              type="date"
              value={draftStartDate}
              max={todayDate}
              onChange={(event) => setDraftStartDate(event.target.value)}
            />
          </label>
          <span className="game-ranking-date-range-separator" aria-hidden="true">至</span>
          <label>
            <span>结束日期</span>
            <input
              type="date"
              value={draftEndDate}
              min={draftStartDate || undefined}
              max={todayDate}
              onChange={(event) => setDraftEndDate(event.target.value)}
            />
          </label>
          <div className="game-ranking-date-range-actions">
            <button type="button" onClick={() => setDatePickerOpen(false)}>取消</button>
            <button
              type="button"
              disabled={!validDraft}
              onClick={() => {
                if (!validDraft) return
                onChange('date', draftStartDate, draftEndDate)
                setDatePickerOpen(false)
              }}
            >
              确认范围
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
