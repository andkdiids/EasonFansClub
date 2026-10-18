'use client'

import { formatBeijingDateTimeInput } from '@/lib/registration-availability'
import { parseActivityDateInput } from '@/lib/activity'
import { useCallback, useEffect, useRef, useState } from 'react'

export type TopicRewardReleaseValue = { rewardGrantMode?: 'IMMEDIATE' | 'SCHEDULED'; rewardGrantAt?: string | null }
export function TopicActivityRewardReleaseEditor({ value, onChange }: { value: TopicRewardReleaseValue; onChange: (value: TopicRewardReleaseValue) => void }) {
  const date = parseActivityDateInput(value.rewardGrantAt)
  const local = date && Number.isFinite(date.getTime()) ? formatBeijingDateTimeInput(date) : value.rewardGrantAt || ''
  return <fieldset className="space-y-3 border border-[var(--border)] p-3">
    <legend className="px-1 font-bold">奖励发放方式</legend>
    <label className="block text-sm">发放方式<select className="mt-1 min-h-11 w-full border border-[var(--border)] bg-[var(--surface)] px-3" value={value.rewardGrantMode || 'IMMEDIATE'}
      onChange={(event) => onChange({ rewardGrantMode: event.target.value as 'IMMEDIATE' | 'SCHEDULED', ...(event.target.value === 'IMMEDIATE' ? { rewardGrantAt: null } : {}) })}>
      <option value="IMMEDIATE">审核通过后立即发放</option><option value="SCHEDULED">指定时间统一发放</option>
    </select></label>
    {value.rewardGrantMode === 'SCHEDULED' ? <label className="block text-sm">统一发奖时间（北京时间）<input className="mt-1 min-h-11 w-full border border-[var(--border)] bg-[var(--surface)] px-3" type="datetime-local" value={local}
      onChange={(event) => onChange({ rewardGrantAt: event.target.value || null })} /></label> : null}
    <p className="text-xs text-[var(--foreground-muted)]">指定时间前审核通过的奖励将等待统一发放；已到账的奖励不会追回或重复发放。此时间不影响抽奖。</p>
  </fieldset>
}

const canonicalRelease = (value: TopicRewardReleaseValue) => ({ rewardGrantMode: value.rewardGrantMode || 'IMMEDIATE',
  rewardGrantAt: value.rewardGrantMode === 'SCHEDULED' ? parseActivityDateInput(value.rewardGrantAt)?.toISOString() || null : null })

/** Saves the existing Activity fields independently of program/lottery configuration. */
export function TopicActivityRewardReleaseSettings({ activityId, disabled = false }: { activityId: string; disabled?: boolean }) {
  const [value, setValue] = useState<TopicRewardReleaseValue>({ rewardGrantMode: 'IMMEDIATE', rewardGrantAt: null })
  const [baseline, setBaseline] = useState<TopicRewardReleaseValue | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const lock = useRef(false), pending = useRef<TopicRewardReleaseValue | null>(null)
  const path = `/api/admin/activities/${encodeURIComponent(activityId)}`
  const read = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal })
    const body = await response.json()
    if (!response.ok || body?.activity?.id !== activityId || body.activity.type !== 'TOPIC_ACTIVITY') throw new Error(body?.message || '无法读取活动发奖安排')
    return canonicalRelease(body.activity as TopicRewardReleaseValue)
  }, [path, activityId])
  useEffect(() => {
    const controller = new AbortController()
    setBaseline(null); setError(''); pending.current = null
    void read(controller.signal).then((next) => { if (!controller.signal.aborted) { setValue(next); setBaseline(next) } })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '发奖安排读取失败') })
    return () => controller.abort()
  }, [read])
  async function save() {
    if (lock.current || !baseline) return
    lock.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const expected = pending.current || canonicalRelease(value)
      if (expected.rewardGrantMode === 'SCHEDULED' && !expected.rewardGrantAt) throw new Error('请填写有效的统一发奖时间（北京时间）')
      if (!pending.current) {
        const current = await read()
        if (JSON.stringify(current) !== JSON.stringify(canonicalRelease(baseline))) throw new Error('发奖安排已被其他操作修改，请重新打开编辑器后核对')
        pending.current = expected
        const response = await fetch(path, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(expected) })
        if (!response.ok) { pending.current = null; const body = await response.json().catch(() => null); throw new Error(body?.message || '发奖安排保存失败') }
      }
      const confirmed = await read()
      if (JSON.stringify(confirmed) !== JSON.stringify(expected)) throw new Error('发奖安排尚未回读确认，请核对；再次点击只读取结果')
      pending.current = null; setBaseline(confirmed); setValue(confirmed); setMessage('发奖安排已保存并回读确认')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '发奖安排保存失败') }
    finally { lock.current = false; setBusy(false) }
  }
  return <section className="space-y-3">
    <fieldset disabled={disabled || busy || !baseline || Boolean(pending.current)}><TopicActivityRewardReleaseEditor value={value} onChange={(next) => setValue((current) => ({ ...current, ...next }))} /></fieldset>
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}{message ? <p role="status" className="text-sm">{message}</p> : null}
    <button type="button" className="min-h-11 border px-3 text-sm disabled:opacity-40" disabled={disabled || busy || !baseline} onClick={() => void save()}>{busy ? '正在保存发奖安排…' : pending.current ? '核对发奖安排' : '保存发奖安排'}</button>
  </section>
}
