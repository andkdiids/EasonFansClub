'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityImageUploader, uploadActivityImage, type ActivityImageSelection, type ActivityImageUploadStatus } from '@/components/activities/ActivityImageUploader'
import { activityLotteryTierName, MAX_ACTIVITY_LOTTERY_PRIZES } from '@/lib/activity-lottery-levels'
import type { ActivityLotteryAdminListView, ActivityLotteryAdminView } from '@/lib/activity-lottery'

type PrizeDraft = { name: string; imageUrl: string; description: string; quantity: string }
type LotteryDraft = { title: string; description: string; drawAt: string; prizes: PrizeDraft[] }

function calculateLotteryWinRate(totalPrizeSlots: number, participantCount: number) {
  if (participantCount <= 0 || totalPrizeSlots <= 0) return 0
  return Math.min(100, (totalPrizeSlots / participantCount) * 100)
}

const emptyPrize = (): PrizeDraft => ({ name: '', imageUrl: '', description: '', quantity: '1' })

function emptyDraft(): LotteryDraft {
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

function draftFromLottery(lottery: ActivityLotteryAdminView): LotteryDraft {
  return {
    title: lottery.title,
    description: lottery.description || '',
    drawAt: dateInput(lottery.drawAt),
    // The stored tierName is intentionally ignored. The editor derives it from
    // the current array position so legacy duplicate names are corrected on save.
    prizes: lottery.prizes.map((prize) => ({ name: prize.name, imageUrl: prize.imageUrl || '', description: prize.description || '', quantity: String(prize.quantity) })),
  }
}

export function ActivityLotteryManager({ activityId, activityTitle, registrationEndAt, openOnMount = false }: Readonly<{ activityId: string; activityTitle: string; registrationEndAt: string | null; openOnMount?: boolean }>) {
  const [data, setData] = useState<ActivityLotteryAdminListView | null>(null)
  const [draft, setDraft] = useState<LotteryDraft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(openOnMount)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingPrizeIndex, setUploadingPrizeIndex] = useState<number | null>(null)
  const [prizeUploadStatuses, setPrizeUploadStatuses] = useState<Record<number, ActivityImageUploadStatus>>({})
  const [prizeUploadErrors, setPrizeUploadErrors] = useState<Record<number, string>>({})
  const [prizeUploadResetTokens, setPrizeUploadResetTokens] = useState<Record<number, number>>({})
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

  const prizeUploadInProgress = uploadingPrizeIndex !== null

  function clearPrizeUploadState() {
    setUploadingPrizeIndex(null)
    setPrizeUploadStatuses({})
    setPrizeUploadErrors({})
    setPrizeUploadResetTokens({})
  }

  function resetDraft() {
    setEditingId(null)
    setDraft(emptyDraft())
    clearPrizeUploadState()
  }

  function updatePrize(index: number, key: keyof PrizeDraft, value: string) {
    setDraft((current) => ({ ...current, prizes: current.prizes.map((prize, prizeIndex) => prizeIndex === index ? { ...prize, [key]: value } : prize) }))
  }

  async function handlePrizeImageSelection(index: number, selection: ActivityImageSelection) {
    if (selection.removed) {
      updatePrize(index, 'imageUrl', '')
      setPrizeUploadStatuses((current) => ({ ...current, [index]: 'idle' }))
      setPrizeUploadErrors((current) => ({ ...current, [index]: '' }))
      setError('')
      return
    }
    const file = selection.file
    if (!file) return

    setUploadingPrizeIndex(index)
    setPrizeUploadStatuses((current) => ({ ...current, [index]: 'uploading' }))
    setPrizeUploadErrors((current) => ({ ...current, [index]: '' }))
    setError('')
    try {
      const imageUrl = await uploadActivityImage(file)
      setDraft((current) => ({ ...current, prizes: current.prizes.map((prize, prizeIndex) => prizeIndex === index ? { ...prize, imageUrl } : prize) }))
      setPrizeUploadStatuses((current) => ({ ...current, [index]: 'success' }))
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : '图片上传失败，请稍后重试'
      // Do not touch draft.imageUrl here. The previous image remains the value
      // that will be saved, and the uploader reset token restores its preview.
      setPrizeUploadStatuses((current) => ({ ...current, [index]: 'error' }))
      setPrizeUploadErrors((current) => ({ ...current, [index]: message }))
      setPrizeUploadResetTokens((current) => ({ ...current, [index]: (current[index] || 0) + 1 }))
      setError(`第 ${index + 1} 个奖项图片上传失败：${message}`)
    } finally {
      setUploadingPrizeIndex(null)
    }
  }

  function movePrize(index: number, direction: -1 | 1) {
    if (prizeUploadInProgress || saving) return
    setDraft((current) => {
      const targetIndex = index + direction
      if (targetIndex < 0 || targetIndex >= current.prizes.length) return current
      const prizes = [...current.prizes]
      const currentPrize = prizes[index]
      prizes[index] = prizes[targetIndex]
      prizes[targetIndex] = currentPrize
      return { ...current, prizes }
    })
    clearPrizeUploadState()
  }

  function removePrize(index: number) {
    if (draft.prizes.length <= 1 || prizeUploadInProgress || saving) return
    setDraft((current) => current.prizes.length > 1 ? { ...current, prizes: current.prizes.filter((_, prizeIndex) => prizeIndex !== index) } : current)
    clearPrizeUploadState()
  }

  function addPrize() {
    if (draft.prizes.length >= MAX_ACTIVITY_LOTTERY_PRIZES || prizeUploadInProgress || saving) return
    setDraft((current) => current.prizes.length >= MAX_ACTIVITY_LOTTERY_PRIZES ? current : { ...current, prizes: [...current.prizes, emptyPrize()] })
    clearPrizeUploadState()
  }

  async function saveLottery() {
    if (prizeUploadInProgress) {
      setError('请等待奖品图片上传完成')
      return
    }
    if (draft.prizes.length < 1) {
      setError('抽奖至少需要 1 个奖项')
      return
    }
    if (draft.prizes.length > MAX_ACTIVITY_LOTTERY_PRIZES) {
      setError(`最多可设置 ${MAX_ACTIVITY_LOTTERY_PRIZES} 个奖项，请删除超出项`)
      return
    }
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
        prizes: draft.prizes.map((prize, index) => ({ tierName: activityLotteryTierName(index), name: prize.name, imageUrl: prize.imageUrl || null, description: prize.description || null, quantity: Number(prize.quantity) })),
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

  return (
    <section className="mt-5 rounded-2xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/60 dark:bg-violet-950/20 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black tracking-[0.18em] text-violet-700 dark:text-violet-300">活动抽奖（可选）</p>
          <h3 className="mt-1 text-xl font-black text-brand-950 dark:text-slate-100">{activityTitle}</h3>
          <p className="mt-1 text-xs font-bold leading-5 text-slate-600 dark:text-slate-300">抽奖资格自动继承有效活动报名，不单独配置参与上限。报名结束：{formatDate(registrationEndAt)}</p>
        </div>
        <button type="button" onClick={() => setExpanded((value) => !value)} disabled={(!registrationEndAt && !editingId) || prizeUploadInProgress || saving} className="min-h-10 rounded-full bg-violet-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{expanded ? '收起设置' : '+ 添加抽奖'}</button>
      </div>
      {!registrationEndAt ? <p role="alert" className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-xs font-black leading-5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">请先设置报名结束时间，再添加自动抽奖。</p> : null}
      <div className="mt-4 grid gap-2 rounded-xl border border-violet-200 bg-white/70 p-3 text-xs font-bold text-slate-600 dark:border-violet-900 dark:bg-slate-900/70 dark:text-slate-300 sm:grid-cols-3">
        <p>当前有效报名：{currentParticipants}</p><p>总中奖名额：{summary.slots}</p><p>当前理论中奖率：{summary.currentRate.toFixed(2)}%</p><p>活动报名上限：{capacity || '不限'}</p><p>满员理论中奖率：{capacity ? `${summary.fullRate.toFixed(2)}%` : '—'}</p>
      </div>
      {expanded ? (
        <div className="mt-4 space-y-3 rounded-xl border border-violet-200 bg-white p-4 dark:border-violet-900 dark:bg-slate-950">
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="抽奖名称" className="min-h-10 min-w-0 rounded-lg border border-slate-200 px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
            <input type="datetime-local" value={draft.drawAt} onChange={(event) => setDraft((current) => ({ ...current, drawAt: event.target.value }))} className="min-h-10 min-w-0 rounded-lg border border-slate-200 px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
          </div>
          <textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="抽奖说明（可选）" rows={2} className="w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
          <div className="space-y-3">
            {draft.prizes.map((prize, index) => {
              const tierName = activityLotteryTierName(index) || `超出 ${MAX_ACTIVITY_LOTTERY_PRIZES} 档上限`
              const controlsDisabled = saving || prizeUploadInProgress
              return (
                <div key={`${index}-${tierName}`} className="min-w-0 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(8rem,1fr)_minmax(0,1.5fr)_7rem_auto_auto_auto]">
                    <div aria-label={`奖项等级：${tierName}`} className="flex min-h-10 min-w-0 items-center rounded-lg border border-violet-200 bg-violet-50 px-3 text-sm font-black text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200"><span className="truncate">{tierName}</span></div>
                    <input aria-label={`${tierName}奖品名称`} value={prize.name} onChange={(event) => updatePrize(index, 'name', event.target.value)} placeholder="奖品名称" className="min-h-10 min-w-0 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                    <input aria-label={`${tierName}中奖人数`} type="number" min={1} value={prize.quantity} onChange={(event) => updatePrize(index, 'quantity', event.target.value)} placeholder="数量" className="min-h-10 min-w-0 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                    <button type="button" disabled={index === 0 || controlsDisabled} onClick={() => movePrize(index, -1)} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300">↑</button>
                    <button type="button" disabled={index === draft.prizes.length - 1 || controlsDisabled} onClick={() => movePrize(index, 1)} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300">↓</button>
                    <button type="button" disabled={draft.prizes.length <= 1 || controlsDisabled} title={draft.prizes.length <= 1 ? '至少保留一等奖' : undefined} onClick={() => removePrize(index)} className="min-h-10 rounded-lg border border-rose-200 px-3 text-xs font-black text-rose-700 disabled:opacity-40">删除</button>
                  </div>
                  <div className="mt-2 grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <ActivityImageUploader
                      label="奖品图片（可选）"
                      initialUrl={prize.imageUrl || null}
                      disabled={controlsDisabled}
                      status={prizeUploadStatuses[index] || 'idle'}
                      resetSignal={prizeUploadResetTokens[index] || 0}
                      replaceLabel="更换图片"
                      removeLabel="删除图片"
                      errorMessage={prizeUploadErrors[index] || ''}
                      onSelectionChange={(selection) => { void handlePrizeImageSelection(index, selection) }}
                    />
                    <textarea aria-label={`${tierName}奖品说明`} value={prize.description} onChange={(event) => updatePrize(index, 'description', event.target.value)} placeholder="奖品说明（可选）" rows={3} className="min-h-28 min-w-0 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button type="button" onClick={addPrize} disabled={saving || prizeUploadInProgress || draft.prizes.length >= MAX_ACTIVITY_LOTTERY_PRIZES} title={draft.prizes.length >= MAX_ACTIVITY_LOTTERY_PRIZES ? `最多可设置 ${MAX_ACTIVITY_LOTTERY_PRIZES} 个奖项` : undefined} className="min-h-10 rounded-lg border border-violet-300 px-3 text-sm font-black text-violet-700 disabled:opacity-50">增加奖项</button>
            {draft.prizes.length >= MAX_ACTIVITY_LOTTERY_PRIZES ? <span role="status" className="text-xs font-bold text-slate-500">最多可设置 {MAX_ACTIVITY_LOTTERY_PRIZES} 个奖项</span> : null}
            <button type="button" onClick={() => void saveLottery()} disabled={saving || prizeUploadInProgress || draft.prizes.length > MAX_ACTIVITY_LOTTERY_PRIZES} className="min-h-10 rounded-lg bg-violet-700 px-4 text-sm font-black text-white disabled:opacity-50">{saving ? '保存中…' : editingId ? '保存修改' : '创建抽奖'}</button>
            {editingId ? <button type="button" onClick={resetDraft} disabled={saving || prizeUploadInProgress} className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-black text-slate-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">取消编辑</button> : null}
          </div>
        </div>
      ) : null}
      {message ? <p role="status" className="mt-3 rounded-lg bg-emerald-100 px-3 py-2 text-sm font-black text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">{message}</p> : null}
      {error ? <p role="alert" className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm font-black text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">{error}</p> : null}
      <div className="mt-4 space-y-3">
        {loading && !data ? <p className="py-4 text-center text-sm font-bold text-slate-500">加载抽奖中…</p> : null}
        {data?.lotteries.map((lottery) => {
          const slots = totalSlots(lottery)
          const currentRate = calculateLotteryWinRate(slots, currentParticipants)
          return (
            <article key={lottery.id} className="rounded-xl border border-violet-200 bg-white p-4 dark:border-violet-900 dark:bg-slate-950">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><h4 className="break-words font-black text-brand-950 dark:text-slate-100">{lottery.title}</h4><p className="mt-1 text-xs font-bold text-slate-500">{lottery.status === 'DRAWN' ? `已开奖于 ${formatDate(lottery.drawnAt)}` : lottery.status === 'CANCELLED' ? '已取消' : `开奖时间：${formatDate(lottery.drawAt)}`}</p></div>
                <div className="flex flex-wrap gap-2">{lottery.status !== 'DRAWN' && lottery.status !== 'CANCELLED' ? <><button type="button" disabled={saving || prizeUploadInProgress} onClick={() => { clearPrizeUploadState(); setEditingId(lottery.id); setDraft(draftFromLottery(lottery)); setExpanded(true) }} className="min-h-9 rounded-full border border-violet-300 px-3 text-xs font-black text-violet-700 disabled:opacity-50">编辑</button><button type="button" disabled={saving || prizeUploadInProgress} onClick={() => void cancelLottery(lottery)} className="min-h-9 rounded-full border border-rose-200 px-3 text-xs font-black text-rose-700 disabled:opacity-50">取消</button><button type="button" disabled={saving || prizeUploadInProgress} onClick={() => void drawLottery(lottery)} className="min-h-9 rounded-full bg-violet-700 px-3 text-xs font-black text-white disabled:opacity-50">立即开奖</button></> : null}</div>
              </div>
              <div className="mt-3 grid gap-2 text-xs font-bold text-slate-600 dark:text-slate-300 sm:grid-cols-3"><p>有效报名：{lottery.eligibleCount ?? currentParticipants}</p><p>中奖名额：{slots} · 实际中奖：{lottery.winnerCount ?? 0}</p><p>当前理论中奖率：{currentRate.toFixed(2)}%</p></div>
              <ul className="mt-3 space-y-1 border-t border-violet-100 pt-3 text-sm font-bold dark:border-violet-900">{lottery.prizes.map((prize, index) => <li key={prize.id}>{activityLotteryTierName(index) || prize.tierName || '中奖奖项'} · {prize.name} ×{prize.quantity}{lottery.status === 'DRAWN' ? `（中奖 ${prize.winnerCount}）` : ''}</li>)}</ul>
              {lottery.winners.length ? <details className="mt-3 border-t border-violet-100 pt-3 text-xs font-bold dark:border-violet-900"><summary className="cursor-pointer">查看中奖结果（{lottery.winners.length}）</summary><ul className="mt-2 space-y-1">{lottery.winners.map((winner) => <li key={winner.id}>E院ID {winner.uid} · {winner.nickname} · {winner.tierName} · {winner.prizeName} · {winner.redemptionStatus === 'REDEEMED' ? '已核销' : '待核销'}</li>)}</ul></details> : null}
            </article>
          )
        })}
        {!loading && data && !data.lotteries.length ? <p className="py-4 text-center text-sm font-bold text-slate-500">暂无抽奖活动。</p> : null}
      </div>
    </section>
  )
}
