'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ADMIN_MAKEUP_DEFAULT_RANGE_DAYS,
  ADMIN_MAKEUP_RANGE_OPTIONS,
  type AdminMakeupRangeDays,
} from '@/lib/admin-checkin-makeup'

type UserResult = { id: string; uid: number; nickname: string; points: number }

type AdminMakeupData = {
  user: UserResult & { createdDateKey: string }
  eligibleMissingDates: string[]
  recentCheckIns: Array<{
    checkinDateKey: string
    type: string
    streakDay: number
    status: 'CHECKED_IN' | 'MISSING'
  }>
  rangeDays: AdminMakeupRangeDays
  startDateKey: string
  todayKey: string
}

function formatDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return `${year}年${month}月${day}日`
}

function typeLabel(type: string) {
  if (type === 'MAKEUP_ADMIN') return '管理员补签'
  if (type === 'MAKEUP_PAID' || type === 'MAKEUP_FREE_QUIZ') return '用户补签'
  return '正常挂号'
}

export function AdminCheckInMakeup() {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<UserResult[]>([])
  const [selected, setSelected] = useState<UserResult | null>(null)
  const [rangeDays, setRangeDays] = useState<AdminMakeupRangeDays>(ADMIN_MAKEUP_DEFAULT_RANGE_DAYS)
  const [makeupData, setMakeupData] = useState<AdminMakeupData | null>(null)
  const [selectedDateKeys, setSelectedDateKeys] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingMakeup, setLoadingMakeup] = useState(false)

  const loadMakeupData = useCallback(async (userId: string, days: AdminMakeupRangeDays, signal?: AbortSignal) => {
    setLoadingMakeup(true)
    try {
      const response = await fetch(`/api/admin/checkin-makeup?userId=${encodeURIComponent(userId)}&rangeDays=${days}`, { cache: 'no-store', signal })
      const data = await response.json() as AdminMakeupData & { message?: string }
      if (!response.ok) throw new Error(data.message || '加载漏签日期失败')
      setMakeupData(data)
    } catch (error) {
      if (!signal?.aborted) {
        setMakeupData(null)
        setMessage(error instanceof Error ? error.message : '加载漏签日期失败')
      }
    } finally {
      if (!signal?.aborted) setLoadingMakeup(false)
    }
  }, [])

  useEffect(() => {
    if (!selected) {
      setMakeupData(null)
      setLoadingMakeup(false)
      return
    }
    const controller = new AbortController()
    void loadMakeupData(selected.id, rangeDays, controller.signal)
    return () => controller.abort()
  }, [loadMakeupData, rangeDays, selected])

  async function search() {
    setBusy(true)
    setMessage('')
    setUsers([])
    setSelected(null)
    setSelectedDateKeys([])
    setMakeupData(null)
    try {
      const response = await fetch(`/api/admin/checkin-makeup?q=${encodeURIComponent(query)}`, { cache: 'no-store' })
      const data = await response.json() as { users?: UserResult[]; message?: string }
      if (!response.ok) throw new Error(data.message || '搜索失败')
      const foundUsers = data.users || []
      setUsers(foundUsers)
      if (foundUsers.length === 1) setSelected(foundUsers[0])
      if (!foundUsers.length) setMessage('没有找到匹配的用户')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '搜索失败')
    } finally {
      setBusy(false)
    }
  }

  function selectUser(user: UserResult) {
    setSelected(user)
    setSelectedDateKeys([])
    setMakeupData(null)
    setMessage('')
  }

  function toggleDate(dateKey: string) {
    setSelectedDateKeys((current) => {
      const next = current.includes(dateKey) ? current.filter((item) => item !== dateKey) : [...current, dateKey]
      return next
    })
  }

  async function submit() {
    const validSelectedDates = selectedDateKeys.filter((dateKey) => makeupData?.eligibleMissingDates.includes(dateKey))
    if (!selected || !makeupData || !validSelectedDates.length || validSelectedDates.length !== selectedDateKeys.length || !reason.trim()) {
      setMessage('请先选择有效漏签日期并填写补签原因')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/checkin-makeup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selected.id, dates: validSelectedDates, reason }),
      })
      const data = await response.json() as { message?: string; makeupCount?: number; dates?: string[]; newRewards?: Array<unknown>; longTermRewardTriggered?: boolean }
      if (!response.ok) throw new Error(data.message || '补签失败')
      const makeupCount = data.makeupCount || validSelectedDates.length
      setSelectedDateKeys([])
      const rewardCount = data.newRewards?.length || 0
      const successMessage = `补签成功\n已为 ${selected.nickname}（E院ID ${selected.uid}）补签 ${makeupCount} 天。消耗挂号费：0${rewardCount ? `。新增连续挂号奖励：${rewardCount} 项` : ''}`
      setMessage(successMessage)
      await loadMakeupData(selected.id, rangeDays)
      setMessage(successMessage)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '补签失败')
      if ((error as { message?: string }).message === '该日期已经挂号') {
        void loadMakeupData(selected.id, rangeDays)
      }
    } finally {
      setBusy(false)
    }
  }

  const disabledReason = useMemo(() => {
    if (busy) return '正在处理请求，请稍候'
    if (!selected) return '请先搜索并选择用户'
    if (loadingMakeup) return '正在加载该用户的漏签日期'
    if (!makeupData) return '暂时无法加载漏签日期，请重试'
    if (!makeupData.eligibleMissingDates.length) return '当前查询范围内没有可补签日期'
    if (!selectedDateKeys.length) return '请选择需要补签的日期'
    if (selectedDateKeys.some((dateKey) => !makeupData.eligibleMissingDates.includes(dateKey))) return '所选日期已不再是可补签漏签，请重新选择'
    if (!reason.trim()) return '请填写补签原因'
    return ''
  }, [busy, loadingMakeup, makeupData, reason, selected, selectedDateKeys])

  return (
    <section className="space-y-5 border border-sky-100 bg-white p-5">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="min-h-11 flex-1 border border-slate-300 px-3" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="昵称 / 用户名 / E院ID" />
        <button className="min-h-11 bg-brand-950 px-5 font-black text-white disabled:opacity-50" disabled={busy || !query.trim()} onClick={() => void search()}>搜索用户</button>
      </div>

      {users.length ? (
        <div className="grid gap-2 sm:grid-cols-2" aria-label="用户搜索结果">
          {users.map((user) => (
            <button key={user.id} type="button" onClick={() => selectUser(user)} className={`border p-3 text-left ${selected?.id === user.id ? 'border-brand-700 bg-sky-50' : 'border-slate-200'}`}>
              <strong>{user.nickname}</strong>
              <span className="ml-2 text-sm text-slate-500">E院ID {user.uid} · {user.points} 挂号费</span>
            </button>
          ))}
        </div>
      ) : null}

      {selected ? (
        <div className="space-y-4 border border-slate-200 p-4">
          <div>
            <p className="font-black text-brand-950">{selected.nickname}</p>
            <p className="text-sm text-slate-500">E院ID {selected.uid} · 当前挂号费 {makeupData?.user.points ?? selected.points}</p>
            {makeupData ? <p className="mt-1 text-xs text-slate-500">注册日期 {formatDateKey(makeupData.user.createdDateKey)} · 查询起点 {formatDateKey(makeupData.startDateKey)}</p> : null}
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-black">漏签查询范围</span>
            <select className="min-h-11 w-full border border-slate-300 px-3" value={rangeDays} onChange={(event) => { setRangeDays(Number(event.target.value) as AdminMakeupRangeDays); setSelectedDateKeys([]) }} disabled={loadingMakeup}>
              {ADMIN_MAKEUP_RANGE_OPTIONS.map((days) => <option key={days} value={days}>最近{days}天</option>)}
            </select>
          </label>

          {loadingMakeup ? <p className="border border-sky-100 bg-sky-50 p-3 text-sm">正在加载签到记录并计算漏签日期…</p> : null}
          {!loadingMakeup && makeupData && makeupData.eligibleMissingDates.length ? (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm font-black">
                <span>选择漏签日期</span>
                <span>已找到 {makeupData.eligibleMissingDates.length} 个缺签日期 · 已选择 {selectedDateKeys.length} 天</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="选择多个漏签日期">
                {makeupData.eligibleMissingDates.map((dateKey) => (
                  <label key={dateKey} className={`flex min-h-11 items-center gap-3 border p-3 ${selectedDateKeys.includes(dateKey) ? 'border-brand-700 bg-sky-50' : 'border-slate-200'}`}>
                    <input type="checkbox" checked={selectedDateKeys.includes(dateKey)} onChange={() => toggleDate(dateKey)} disabled={busy} />
                    <span>{formatDateKey(dateKey)} · 未签到</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          {!loadingMakeup && makeupData && !makeupData.eligibleMissingDates.length ? <p className="border border-amber-200 bg-amber-50 p-3 text-sm font-bold">当前查询范围内没有可补签的日期。</p> : null}

          {selectedDateKeys.length ? <div className="border border-sky-100 bg-sky-50 p-3 text-sm"><p className="font-black">已选择 {selectedDateKeys.length} 天</p><p className="mt-1">所选日期当前均为未签到</p><p className="mt-1">可执行管理员批量补签</p></div> : null}

          {makeupData?.recentCheckIns.length ? (
            <div>
              <p className="mb-2 text-sm font-black">最近签到概览</p>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                {makeupData.recentCheckIns.map((item) => <div key={item.checkinDateKey} className={`border p-2 ${item.status === 'MISSING' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}><span>{formatDateKey(item.checkinDateKey)}</span><span className="ml-2 font-bold">{item.status === 'MISSING' ? '可补' : '✓'}</span><p className="mt-1 text-xs text-slate-500">{item.status === 'MISSING' ? '未签到' : typeLabel(item.type)}</p></div>)}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <label className="block"><span className="mb-1 block text-sm font-black">补签原因（必填）</span><textarea className="min-h-28 w-full border border-slate-300 p-3" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="系统异常 / 客服补偿 / 数据修复 / 其他详细原因" /></label>
      <button className="min-h-11 bg-brand-700 px-5 font-black text-white disabled:opacity-50" disabled={Boolean(disabledReason)} onClick={() => void submit()}>确认补签{selectedDateKeys.length ? ` ${selectedDateKeys.length} 天` : ''}</button>
      {disabledReason ? <p className="text-sm font-bold text-amber-700" role="status">{disabledReason}</p> : null}
      {message ? <p role="alert" className="whitespace-pre-line border border-sky-100 bg-sky-50 p-3 text-sm font-bold">{message}</p> : null}
    </section>
  )
}
