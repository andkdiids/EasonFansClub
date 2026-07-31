'use client'

import { useMemo, useState } from 'react'

type Props = {
  value: string[]
  onChange: (dates: string[]) => void
  max?: number
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function toISO(year: number, month: number, day: number) {
  const mm = String(month + 1).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

export function MultiDatePicker({ value, onChange, max = 40 }: Props) {
  const selected = useMemo(() => new Set(value), [value])
  const [cursor, setCursor] = useState(() => {
    const base = value[0] ? new Date(value[0]) : new Date()
    return { year: base.getFullYear(), month: base.getMonth() }
  })

  const { year, month } = cursor
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (string | null)[] = []
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null)
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(toISO(year, month, day))

  function toggle(date: string) {
    if (selected.has(date)) {
      onChange(value.filter((item) => item !== date))
    } else {
      if (value.length >= max) return
      onChange([...value, date].sort())
    }
  }

  function shift(dir: -1 | 1) {
    let m = month + dir
    let y = year
    if (m < 0) { m = 11; y -= 1 }
    if (m > 11) { m = 0; y += 1 }
    setCursor({ year: y, month: m })
  }

  return (
    <div className="rounded-2xl border border-sky-100 p-4">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} aria-label="上一月" className="rounded-lg bg-sky-100 px-3 py-1.5 text-sm font-black text-brand-800">‹</button>
        <span className="text-sm font-black text-brand-950">{year} 年 {month + 1} 月</span>
        <button type="button" onClick={() => shift(1)} aria-label="下一月" className="rounded-lg bg-sky-100 px-3 py-1.5 text-sm font-black text-brand-800">›</button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-black text-slate-400">
        {WEEKDAYS.map((weekday) => <div key={weekday}>{weekday}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((date, index) => date
          ? <button key={date} type="button" onClick={() => toggle(date)} aria-pressed={selected.has(date)} className={`rounded-lg py-2 text-sm font-black ${selected.has(date) ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-800 hover:bg-sky-100'}`}>{Number(date.slice(8, 10))}</button>
          : <div key={`empty-${index}`} />)}
      </div>
      <div className="mt-3 flex min-h-10 flex-wrap gap-2">
        {value.map((date) => <span key={date} className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-black text-brand-800">{date}<button type="button" aria-label={`取消 ${date}`} onClick={() => toggle(date)} className="text-red-600">×</button></span>)}
        {!value.length ? <span className="text-xs font-bold text-slate-400">尚未选择日期（最多 {max} 个）</span> : null}
      </div>
    </div>
  )
}
