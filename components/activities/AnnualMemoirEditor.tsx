'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { ActivityView } from '@/lib/activity'
import { memoirTimeFields, toMemoirShanghaiInput } from '@/lib/annual-memoir-admin'
import { annualMemoirPlatforms } from '@/lib/annual-memoir-platforms'
import { ActivityImageUploader, uploadActivityImage, type ActivityImageSelection } from './ActivityImageUploader'

type Schedule = Record<keyof typeof memoirTimeFields, string>
type Config = Schedule & { enabled: boolean; reservationPoints: number; reservationBadgeId: string | null; annualBadgeId: string | null; showInActivityCenter: boolean; statisticsLockedAt: string | null }
type Outstanding = { id: string; user: { uid: number } }
type Stats = { reservations: number; reports: number; notified: number; settled: number; medals: number; points: number }
type Props = { activity?: ActivityView; badges: { id: string; name: string }[]; onSaved: (id: string, activity?: ActivityView) => void }

export function AnnualMemoirEditor({ activity, badges, onSaved }: Props) {
  const url = activity ? '/api/admin/activities/' + encodeURIComponent(activity.id) + '/annual-memoir' : '/api/admin/activities'
  const [loaded, setLoaded] = useState<{ config: Config; platformPoints: number[]; outstanding: Outstanding[]; stats: Stats } | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [image, setImage] = useState<ActivityImageSelection | null>(null)
  const [savedCover, setSavedCover] = useState(activity?.coverUrl ?? null)
  const [pointsEnabled, setPointsEnabled] = useState(true)
  const [badgeEnabled, setBadgeEnabled] = useState(false)
  useEffect(() => {
    if (!activity) return
    const controller = new AbortController()
    fetch(url, { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      const data = await response.json()
      if (!response.ok || !data.config) throw new Error()
      setLoaded(data)
      setPointsEnabled(data.config.reservationPoints > 0)
      setBadgeEnabled(!!data.config.reservationBadgeId)
    }).catch(() => { if (!controller.signal.aborted) setMessage('无法读取年度活动配置。') })
    return () => controller.abort()
  }, [activity, url])
  async function save(fields: HTMLFieldSetElement) {
    if (busy) return
    const input = (name: string) => fields.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[name="' + name + '"]')!
    const check = (name: string) => (input(name) as HTMLInputElement).checked
    const basic = { title: input('memoirTitle').value, subtitle: input('memoirSubtitle').value,
      description: input('memoirDescription').value, isFeatured: check('memoirFeatured'), pinToPlaza: check('memoirPlaza') }
    if (!basic.title.trim() || !basic.description.trim()) { setMessage('请填写标题和活动介绍。'); return }
    const schedule = Object.fromEntries(Object.keys(memoirTimeFields).map((key) => [key, input(key).value]))
    if (Object.values(schedule).some((value) => !value)) { setMessage('请填写所有北京时间。'); return }
    const annualMemoir = { ...schedule, enabled: activity ? check('memoirEnabled') : false,
      showInActivityCenter: check('memoirCenter'), reservationPoints: pointsEnabled ? Number(input('memoirPoints').value) : 0,
      reservationBadgeId: badgeEnabled ? input('reservationBadgeId').value : '', annualBadgeId: input('annualBadgeId').value }
    if (badgeEnabled && !annualMemoir.reservationBadgeId) { setMessage('请选择预约勋章。'); return }
    const platformPoints = annualMemoirPlatforms.map(([key]) => Number(input('points-' + key).value))
    setBusy(true)
    setMessage('')
    try {
      const coverUrl = image?.file ? await uploadActivityImage(image.file) : image?.removed ? null : savedCover
      setSavedCover(coverUrl)
      const base = { ...basic, coverUrl }
      const body = activity ? { ...annualMemoir, activity: base, platformPoints } : { ...base, annualMemoir, platformPoints }
      const response = await fetch(url, { method: activity ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await response.json()
      if (!response.ok) { setMessage(data.message || '保存失败。'); return }
      setMessage('年度活动已保存。')
      onSaved(activity?.id ?? data.activity.id, data.activity ?? (activity && { ...activity, ...base }))
    } catch { setMessage('保存失败，请重试。') } finally { setBusy(false) }
  }
  async function retryReward(reservationId: string) {
    setBusy(true)
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId }) })
      const result = await response.json()
      setMessage(result.message)
      if (response.ok) setLoaded((data) => data && { ...data, outstanding: data.outstanding.filter((row) => row.id !== reservationId) })
    } catch { setMessage('补发请求失败，请重试。') } finally { setBusy(false) }
  }
  const config = loaded?.config
  const fieldClass = 'block min-h-10 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2'
  return <section className="mt-5 space-y-4" aria-label="年度活动配置">
    <h3 className="text-xl font-bold">《葡萄成熟时》年度活动配置</h3>
    {activity ? <Link className="underline" href={'/admin/activities/' + encodeURIComponent(activity.id) + '/annual-memoir-preview'}>打开只读预览</Link> : <p>保存后为关闭、未公开的草稿。</p>}
    {message && <p role="status">{message}</p>}
    {(!activity || config) && <fieldset disabled={busy} className="space-y-5" onKeyDown={(event) => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault() }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>活动标题<input className={fieldClass} name="memoirTitle" maxLength={160} defaultValue={activity?.title ?? '《葡萄成熟时》'} /></label>
        <label>活动副标题<input className={fieldClass} name="memoirSubtitle" maxLength={300} defaultValue={activity?.subtitle ?? '私家E院 2026 年度回忆录'} /></label>
      </div>
      <ActivityImageUploader label="活动封面" initialUrl={savedCover} disabled={busy} onSelectionChange={setImage} />
      <label className="block">活动介绍<textarea className={fieldClass} name="memoirDescription" rows={4} defaultValue={activity?.description ?? ''} /></label>
      <div className="flex flex-wrap gap-4">
        <label><input name="memoirFeatured" type="checkbox" defaultChecked={activity?.isFeatured ?? false} /> 首页展示</label>
        <label><input name="memoirPlaza" type="checkbox" defaultChecked={activity?.pinToPlaza ?? false} /> 广场置顶</label>
        <label><input name="memoirCenter" type="checkbox" defaultChecked={config?.showInActivityCenter ?? true} /> 活动中心展示</label>
      </div>
      <h4 className="font-bold">时间设置（北京时间）</h4>
      <div className="grid gap-3 sm:grid-cols-3">
        {Object.entries(memoirTimeFields).map(([key, label]) => <label key={key}>{label}
          <input className={fieldClass} type="datetime-local" name={key} step="1"
            readOnly={!!config?.statisticsLockedAt && (key === 'statisticsStartAt' || key === 'statisticsEndAt')}
            defaultValue={config ? toMemoirShanghaiInput(config[key as keyof Schedule]) : ''} />
        </label>)}
      </div>
      <h4 className="font-bold">预约奖励</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <label><input type="checkbox" checked={pointsEnabled} onChange={(e) => setPointsEnabled(e.target.checked)} /> 发放预约挂号费</label>
        <label>预约挂号费<input className={fieldClass} name="memoirPoints" type="number" min="1" disabled={!pointsEnabled} defaultValue={config?.reservationPoints || 74} /></label>
        <label><input type="checkbox" checked={badgeEnabled} onChange={(e) => setBadgeEnabled(e.target.checked)} /> 发放预约勋章</label>
        <label>预约勋章<select className={fieldClass} name="reservationBadgeId" disabled={!badgeEnabled} defaultValue={config?.reservationBadgeId ?? ''}>
          <option value="">请选择</option>{badges.map((badge) => <option key={badge.id} value={badge.id}>{badge.name}</option>)}
        </select></label>
      </div>
      <label className="block font-bold">年度限定勋章<select className={fieldClass} name="annualBadgeId" defaultValue={config?.annualBadgeId ?? ''}>
        <option value="">请选择</option>{badges.map((badge) => <option key={badge.id} value={badge.id}>{badge.name}</option>)}
      </select></label>
      <div className="grid scroll-mt-24 gap-2 rounded border border-[var(--border)] p-4" aria-label="五平台分享奖励">
        <h4 className="font-bold">五平台分享奖励（挂号费）</h4>
        {annualMemoirPlatforms.map(([key, label], i) => <label key={key}>{label}
          <input name={'points-' + key} className={fieldClass} type="number" min="1" defaultValue={loaded?.platformPoints[i] ?? 74} />
        </label>)}
      </div>
      {activity && <label className="block"><input type="checkbox" name="memoirEnabled" defaultChecked={config?.enabled ?? false} /> 启用年度活动（公开还需将活动发布）</label>}
      <button className="rounded bg-brand-700 px-4 py-2 font-bold text-white" type="button" onClick={(event) => {
        const fields = event.currentTarget.closest('fieldset')
        if (fields) void save(fields)
      }}>{busy ? '保存中…' : activity ? '保存年度活动' : '创建并保存年度活动草稿'}</button>
    </fieldset>}
    {loaded && <p>预约 {loaded.stats.reservations} 人 · 已发挂号费 {loaded.stats.points} · 预约勋章 {loaded.stats.medals} 人 · 通知 {loaded.stats.notified} 人 · 已生成报告 {loaded.stats.reports} 份 · 年度勋章 {loaded.stats.settled} 人</p>}
    {loaded?.outstanding.map((row) => <p key={row.id}>UID {row.user.uid} 有预约奖励待发 <button type="button" disabled={busy} onClick={() => void retryReward(row.id)}>补发未到账奖励</button></p>)}
  </section>
}
