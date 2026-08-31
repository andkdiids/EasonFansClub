'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ActivityLotteryAdminListView, ActivityLotteryAdminView } from '@/lib/activity-lottery'

type PrizeDraft = { tierName: string; name: string; imageUrl: string; description: string; quantity: string }

function calculateLotteryWinRate(totalPrizeSlots: number, participantCount: number) {
  if (participantCount <= 0 || totalPrizeSlots <= 0) return 0
  return Math.min(100, (totalPrizeSlots / participantCount) * 100)
}

const emptyPrize = (): PrizeDraft => ({ tierName: '', name: '', imageUrl: '', description: '', quantity: '1' })

function emptyDraft() {
  return { title: '', description: '', drawAt: '', prizes: [emptyPrize()] }
}

function dateInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

function toBeijingIso(value: string) {
  return value ? new Date(`${value}:00+08:00`).toISOString() : ''
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未设置'
}

function totalSlots(lottery: Pick<ActivityLotteryAdminView, 'prizes'>) {
  return lottery.prizes.reduce((total, prize) => total + prize.quantity, 0)
}

function draftFromLottery(lottery: ActivityLotteryAdminView) {
  return {
    title: lottery.title,
    description: lottery.description || '',
    drawAt: dateInput(lottery.drawAt),
    prizes: lottery.prizes.map((prize) => ({ tierName: prize.tierName || '', name: prize.name, imageUrl: prize.imageUrl || '', description: prize.description || '', quantity: String(prize.quantity) })),
  }
}

export function ActivityLotteryManager({ activityId, activityTitle, registrationEndAt, openOnMount = false }: Readonly<{ activityId: string; activityTitle: string; registrationEndAt: string | null; openOnMount?: boolean }>) {
  const [data, setData] = useState<ActivityLotteryAdminListView | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(openOnMount)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/lotteries`, { credentials: 'same-origin', cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.message || '抽奖加载失败')
      setData(body as ActivityLotteryAdminListView)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '抽奖加载失败')
    } finally {
      setLoading(false)
    }
  }, [activityId])

  useEffect(() => { void load() }, [load])

  const currentParticipants = data?.activity.activeParticipantCount || 0
  const capacity = data?.activity.signupLimit && data.activity.signupLimit > 0 ? data.activity.signupLimit : null
  const summary = useMemo(() => {
    const slots = data?.lotteries.reduce((sum, lottery) => sum + totalSlots(lottery), 0) || 0
    return { slots, currentRate: calculateLotteryWinRate(slots, currentParticipants), fullRate: capacity ? calculateLotteryWinRate(slots, capacity) : 0 }
  }, [capacity, currentParticipants, data?.lotteries])

  function resetDraft() {
    setEditingId(null)
    setDraft(emptyDraft())
  }

  function updatePrize(index: number, key: keyof PrizeDraft, value: string) {
    setDraft((current) => ({ ...current, prizes: current.prizes.map((prize, prizeIndex) => prizeIndex === index ? { ...prize, [key]: value } : prize) }))
  }

  async function saveLottery() {
    if (!draft.drawAt) {
      setError('请设置开奖时间')
      return
    }
    setSaving(true); setError(''); setMessage('')
    try {
      const payload = {
        title: draft.title,
        description: draft.description,
        drawAt: toBeijingIso(draft.drawAt),
        prizes: draft.prizes.map((prize) => ({ tierName: prize.tierName, name: prize.name, imageUrl: prize.imageUrl || null, description: prize.description || null, quantity: Number(prize.quantity) })),
      }
      const response = await fetch(editingId
        ? `/api/admin/activities/${encodeURIComponent(activityId)}/lotteries/${encodeURIComponent(editingId)}`
        : `/api/admin/activities/${encodeURIComponent(activityId)}/lotteries`, {
        method: editingId ? 'PATCH' : 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.message || '抽奖保存失败')
      setMessage(editingId ? '抽奖已更新' : '抽奖已创建')
      resetDraft()
      setExpanded(false)
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '抽奖保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function cancelLottery(lottery: ActivityLotteryAdminView) {
    if (!window.confirm(`确认取消「${lottery.title}」吗？`)) return
    setError(''); setMessage('')
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/lotteries/${encodeURIComponent(lottery.id)}/cancel`, { method: 'POST', credentials: 'same-origin' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.message || '取消抽奖失败')
      setMessage('抽奖已取消')
      await load()
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : '取消抽奖失败')
    }
  }

  async function drawLottery(lottery: ActivityLotteryAdminView) {
    if (!window.confirm(`确认立即开奖「${lottery.title}」吗？开奖后不能修改。`)) return
    setError(''); setMessage('')
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/lotteries/${encodeURIComponent(lottery.id)}/draw`, { method: 'POST', credentials: 'same-origin' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.message || '开奖失败')
      setMessage(body?.status === 'ALREADY_DRAWN' ? '该抽奖已经开奖，本次操作幂等完成' : '开奖成功')
      await load()
    } catch (drawError) {
      setError(drawError instanceof Error ? drawError.message : '开奖失败')
    }
  }

  return <section className="mt-5 rounded-2xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/60 dark:bg-violet-950/20 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black tracking-[0.18em] text-violet-700 dark:text-violet-300">活动抽奖（可选）</p><h3 className="mt-1 text-xl font-black text-brand-950 dark:text-slate-100">{activityTitle}</h3><p className="mt-1 text-xs font-bold leading-5 text-slate-600 dark:text-slate-300">抽奖资格自动继承有效活动报名，不单独配置参与上限。报名结束：{formatDate(registrationEndAt)}</p></div><button type="button" onClick={() => setExpanded((value) => !value)} disabled={!registrationEndAt && !editingId} className="min-h-10 rounded-full bg-violet-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{expanded ? '收起设置' : '+ 添加抽奖'}</button></div>
    {!registrationEndAt ? <p role="alert" className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-xs font-black leading-5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">请先设置报名结束时间，再添加自动抽奖。</p> : null}
    <div className="mt-4 grid gap-2 rounded-xl border border-violet-200 bg-white/70 p-3 text-xs font-bold text-slate-600 dark:border-violet-900 dark:bg-slate-900/70 dark:text-slate-300 sm:grid-cols-3"><p>当前有效报名：{currentParticipants}</p><p>总中奖名额：{summary.slots}</p><p>当前理论中奖率：{summary.currentRate.toFixed(2)}%</p><p>活动报名上限：{capacity || '不限'}</p><p>满员理论中奖率：{capacity ? `${summary.fullRate.toFixed(2)}%` : '—'}</p></div>
    {expanded ? <div className="mt-4 space-y-3 rounded-xl border border-violet-200 bg-white p-4 dark:border-violet-900 dark:bg-slate-950"><div className="grid gap-3 sm:grid-cols-2"><input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="抽奖名称" className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" /><input type="datetime-local" value={draft.drawAt} onChange={(event) => setDraft((current) => ({ ...current, drawAt: event.target.value }))} className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" /></div><textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="抽奖说明（可选）" rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" /><div className="space-y-2">{draft.prizes.map((prize, index) => <div key={`${index}-${prize.tierName}`} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><div className="grid gap-2 sm:grid-cols-[1fr_1.5fr_7rem_auto_auto_auto]"><input value={prize.tierName} onChange={(event) => updatePrize(index, 'tierName', event.target.value)} placeholder="一等奖" className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" /><input value={prize.name} onChange={(event) => updatePrize(index, 'name', event.target.value)} placeholder="奖品名称" className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" /><input type="number" min={1} value={prize.quantity} onChange={(event) => updatePrize(index, 'quantity', event.target.value)} placeholder="数量" className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" /><button type="button" disabled={index === 0} onClick={() => setDraft((current) => ({ ...current, prizes: current.prizes.map((item, itemIndex, all) => itemIndex === index - 1 ? all[index] : itemIndex === index ? all[index - 1] : item) }))} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300">↑</button><button type="button" disabled={index === draft.prizes.length - 1} onClick={() => setDraft((current) => ({ ...current, prizes: current.prizes.map((item, itemIndex, all) => itemIndex === index ? all[index + 1] : itemIndex === index + 1 ? all[index] : item) }))} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300">↓</button>{draft.prizes.length > 1 ? <button type="button" onClick={() => setDraft((current) => ({ ...current, prizes: current.prizes.filter((_, prizeIndex) => prizeIndex !== index) }))} className="min-h-10 rounded-lg border border-rose-200 px-3 text-xs font-black text-rose-700">删除</button> : <span />}</div><div className="mt-2 grid gap-2 sm:grid-cols-2"><input value={prize.imageUrl} onChange={(event) => updatePrize(index, 'imageUrl', event.target.value)} placeholder="奖品图片 URL（可选）" className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" /><input value={prize.description} onChange={(event) => updatePrize(index, 'description', event.target.value)} placeholder="奖品说明（可选）" className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" /></div></div>)}</div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setDraft((current) => ({ ...current, prizes: [...current.prizes, emptyPrize()] }))} disabled={draft.prizes.length >= 50} className="min-h-10 rounded-lg border border-violet-300 px-3 text-sm font-black text-violet-700 disabled:opacity-50">增加奖项</button><button type="button" onClick={() => void saveLottery()} disabled={saving} className="min-h-10 rounded-lg bg-violet-700 px-4 text-sm font-black text-white disabled:opacity-50">{saving ? '保存中…' : editingId ? '保存修改' : '创建抽奖'}</button>{editingId ? <button type="button" onClick={resetDraft} className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-black text-slate-600 dark:border-slate-700 dark:text-slate-300">取消编辑</button> : null}</div></div> : null}
    {message ? <p role="status" className="mt-3 rounded-lg bg-emerald-100 px-3 py-2 text-sm font-black text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">{message}</p> : null}{error ? <p role="alert" className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm font-black text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">{error}</p> : null}
    <div className="mt-4 space-y-3">{loading && !data ? <p className="py-4 text-center text-sm font-bold text-slate-500">加载抽奖中…</p> : data?.lotteries.map((lottery) => { const slots = totalSlots(lottery); const currentRate = calculateLotteryWinRate(slots, currentParticipants); return <article key={lottery.id} className="rounded-xl border border-violet-200 bg-white p-4 dark:border-violet-900 dark:bg-slate-950"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h4 className="break-words font-black text-brand-950 dark:text-slate-100">{lottery.title}</h4><p className="mt-1 text-xs font-bold text-slate-500">{lottery.status === 'DRAWN' ? `已开奖于 ${formatDate(lottery.drawnAt)}` : lottery.status === 'CANCELLED' ? '已取消' : `开奖时间：${formatDate(lottery.drawAt)}`}</p></div><div className="flex flex-wrap gap-2">{lottery.status !== 'DRAWN' && lottery.status !== 'CANCELLED' ? <><button type="button" onClick={() => { setEditingId(lottery.id); setDraft(draftFromLottery(lottery)); setExpanded(true) }} className="min-h-9 rounded-full border border-violet-300 px-3 text-xs font-black text-violet-700">编辑</button><button type="button" onClick={() => void cancelLottery(lottery)} className="min-h-9 rounded-full border border-rose-200 px-3 text-xs font-black text-rose-700">取消</button><button type="button" onClick={() => void drawLottery(lottery)} className="min-h-9 rounded-full bg-violet-700 px-3 text-xs font-black text-white">立即开奖</button></> : null}</div></div><div className="mt-3 grid gap-2 text-xs font-bold text-slate-600 dark:text-slate-300 sm:grid-cols-3"><p>有效报名：{lottery.eligibleCount ?? currentParticipants}</p><p>中奖名额：{slots} · 实际中奖：{lottery.winnerCount ?? 0}</p><p>当前理论中奖率：{currentRate.toFixed(2)}%</p></div><ul className="mt-3 space-y-1 border-t border-violet-100 pt-3 text-sm font-bold dark:border-violet-900">{lottery.prizes.map((prize) => <li key={prize.id}>{prize.tierName || '中奖奖项'} · {prize.name} ×{prize.quantity}{lottery.status === 'DRAWN' ? `（中奖 ${prize.winnerCount}）` : ''}</li>)}</ul>{lottery.winners.length ? <details className="mt-3 border-t border-violet-100 pt-3 text-xs font-bold dark:border-violet-900"><summary className="cursor-pointer">查看中奖结果（{lottery.winners.length}）</summary><ul className="mt-2 space-y-1">{lottery.winners.map((winner) => <li key={winner.id}>E院ID {winner.uid} · {winner.nickname} · {winner.tierName} · {winner.prizeName} · {winner.redemptionStatus === 'REDEEMED' ? '已核销' : '待核销'}</li>)}</ul></details> : null}</article> })}{!loading && data && !data.lotteries.length ? <p className="py-4 text-center text-sm font-bold text-slate-500">暂无抽奖活动。</p> : null}</div>
  </section>
}
