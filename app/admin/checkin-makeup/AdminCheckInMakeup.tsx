'use client'

import { useEffect, useState } from 'react'

type UserResult = { id: string; uid: number; nickname: string; points: number }

export function AdminCheckInMakeup() {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<UserResult[]>([])
  const [selected, setSelected] = useState<UserResult | null>(null)
  const [targetDate, setTargetDate] = useState('')
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ status: string; nearby: Array<{ checkinDateKey: string; type: string; streakDay: number }> } | null>(null)

  useEffect(() => {
    if (!selected || !targetDate) { setPreview(null); return }
    const controller = new AbortController()
    void fetch(`/api/admin/checkin-makeup?userId=${encodeURIComponent(selected.id)}&targetDate=${encodeURIComponent(targetDate)}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => { const data = await response.json(); if (response.ok) setPreview(data) })
      .catch(() => null)
    return () => controller.abort()
  }, [selected, targetDate])

  async function search() {
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/admin/checkin-makeup?q=${encodeURIComponent(query)}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || '搜索失败')
      setUsers(data.users)
    } catch (error) { setMessage(error instanceof Error ? error.message : '搜索失败') } finally { setBusy(false) }
  }

  async function submit() {
    if (!selected) return setMessage('请先选择用户')
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/admin/checkin-makeup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selected.id, targetDate, reason }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || '补签失败')
      setMessage(`已为 ${selected.nickname} 补签 ${data.targetDate}${data.longTermRewardTriggered ? '，并触发长期患者奖励' : ''}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : '补签失败') } finally { setBusy(false) }
  }

  return (
    <section className="space-y-5 border border-sky-100 bg-white p-5">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="min-h-11 flex-1 border border-slate-300 px-3" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="昵称 / 用户名 / E院ID" />
        <button className="min-h-11 bg-brand-950 px-5 font-black text-white" disabled={busy || !query.trim()} onClick={() => void search()}>搜索用户</button>
      </div>
      {users.length ? <div className="grid gap-2 sm:grid-cols-2">{users.map((user) => <button key={user.id} type="button" onClick={() => setSelected(user)} className={`border p-3 text-left ${selected?.id === user.id ? 'border-brand-700 bg-sky-50' : 'border-slate-200'}`}><strong>{user.nickname}</strong><span className="ml-2 text-sm text-slate-500">E院ID {user.uid} · {user.points} 挂号费</span></button>)}</div> : null}
      <label className="block"><span className="mb-1 block text-sm font-black">目标日期</span><input className="min-h-11 w-full border border-slate-300 px-3" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
      {preview ? <div className="border border-sky-100 bg-sky-50 p-3 text-sm"><p className="font-black">当天状态：{preview.status === 'CHECKED_IN' ? '已挂号，不可重复补签' : '未挂号'}</p><p className="mt-2">附近记录：{preview.nearby.length ? preview.nearby.map((item) => `${item.checkinDateKey}（${item.streakDay}天）`).join('、') : '前后3天暂无记录'}</p></div> : null}
      <label className="block"><span className="mb-1 block text-sm font-black">补签原因（必填）</span><textarea className="min-h-28 w-full border border-slate-300 p-3" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="系统异常 / 客服补偿 / 数据修复 / 其他详细原因" /></label>
      <button className="min-h-11 bg-brand-700 px-5 font-black text-white disabled:opacity-50" disabled={busy || !selected || !targetDate || !reason.trim() || preview?.status === 'CHECKED_IN'} onClick={() => void submit()}>确认免费补签</button>
      {message ? <p role="status" className="border border-sky-100 bg-sky-50 p-3 text-sm font-bold">{message}</p> : null}
    </section>
  )
}
