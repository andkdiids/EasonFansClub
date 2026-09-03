'use client'

import Image from 'next/image'
import { useMemo, useState, type FormEvent } from 'react'

export type AngelGiftCampaignSummary = {
  id: string
  title: string
  subtitle: string | null
  status: string
  displayStatus: string
  startsAt: string | null
  endsAt: string | null
  drawCost: number
  duplicateRecycleEnabled: boolean
  duplicateRecycleRequired: number | null
  duplicateRecycleReward: number | null
  probabilityPublic: boolean
  dailyDrawLimit: number | null
  totalDrawLimit: number | null
  prizeCount: number
  drawCount: number
  participantCount: number
  drawCostTotal: number
  createdAt: string
  updatedAt: string
}

type CampaignDetail = AngelGiftCampaignSummary & {
  description: string | null
  recycleAfterEndEnabled: boolean
  visualUrl: string | null
  prizes: PrizeView[]
  stats: { drawCount: number; participantCount: number; costTotal: number; pointsRewardTotal: number; recycleRewardTotal: number; netCost: number; duplicateProduced: number; duplicateRecycled: number; currentDuplicate: number }
}

type PrizeView = {
  id: string
  type: 'BADGE' | 'POINTS' | string
  name: string | null
  quantity: number
  rewardAmount: number | null
  weight: number
  enabled: boolean
  sortOrder: number
  badgeId: string | null
  badge: { id: string; name: string; iconUrl: string | null; rarity: string | null; visibility: string; isEnabled: boolean; isActive: boolean } | null
  calculatedProbability: number
  drawCount: number
  actualRate: number
  newBadgeCount: number
  duplicateCount: number
  rewardTotal: number
}

type BadgeOption = { id: string; name: string; code: string; iconUrl: string | null; rarity: string | null; visibility: string; isEnabled: boolean; isActive: boolean }
type DrawView = { id: string; drawAt: string; campaignTitle: string; drawCost: number; prizeName: string; prizeType: string; resultType: string; isNewBadge: boolean; isDuplicate: boolean; rewardAmount: number | null; balanceAfter: number; user?: { uid: string | null; nickname: string | null } }

type CampaignForm = { title: string; subtitle: string; description: string; startsAt: string; endsAt: string; drawCost: string; duplicateRecycleEnabled: boolean; duplicateRecycleRequired: string; duplicateRecycleReward: string; recycleAfterEndEnabled: boolean; probabilityPublic: boolean; dailyDrawLimit: string; totalDrawLimit: string; visualUrl: string; status: string }
type PrizeForm = { type: 'BADGE' | 'POINTS'; name: string; badgeId: string; rewardAmount: string; weight: string; quantity: string; enabled: boolean; sortOrder: string }

const statusLabels: Record<string, string> = { DRAFT: '草稿', SCHEDULED: '待开始', ACTIVE: '进行中', PAUSED: '暂停', ENDED: '已结束' }
const rarityLabels: Record<string, string> = { LIMITED: '限定', LEGENDARY: '传说', EPIC: '稀有', RARE: '特别', COMMON: '常规' }
const emptyForm: CampaignForm = { title: '', subtitle: '', description: '', startsAt: '', endsAt: '', drawCost: '', duplicateRecycleEnabled: false, duplicateRecycleRequired: '', duplicateRecycleReward: '', recycleAfterEndEnabled: true, probabilityPublic: false, dailyDrawLimit: '', totalDrawLimit: '', visualUrl: '', status: 'DRAFT' }
const emptyPrize: PrizeForm = { type: 'BADGE', name: '', badgeId: '', rewardAmount: '', weight: '1', quantity: '1', enabled: true, sortOrder: '0' }

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function dateInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

function toIso(value: string) {
  if (!value) return null
  const date = new Date(`${value}:00+08:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function formFromCampaign(campaign: CampaignDetail): CampaignForm {
  return { title: campaign.title, subtitle: campaign.subtitle || '', description: campaign.description || '', startsAt: dateInput(campaign.startsAt), endsAt: dateInput(campaign.endsAt), drawCost: String(campaign.drawCost), duplicateRecycleEnabled: campaign.duplicateRecycleEnabled, duplicateRecycleRequired: campaign.duplicateRecycleRequired === null ? '' : String(campaign.duplicateRecycleRequired), duplicateRecycleReward: campaign.duplicateRecycleReward === null ? '' : String(campaign.duplicateRecycleReward), recycleAfterEndEnabled: campaign.recycleAfterEndEnabled, probabilityPublic: campaign.probabilityPublic, dailyDrawLimit: campaign.dailyDrawLimit === null ? '' : String(campaign.dailyDrawLimit), totalDrawLimit: campaign.totalDrawLimit === null ? '' : String(campaign.totalDrawLimit), visualUrl: campaign.visualUrl || '', status: campaign.status }
}

function formFromPrize(prize: PrizeView): PrizeForm {
  return { type: prize.type === 'POINTS' ? 'POINTS' : 'BADGE', name: prize.name || '', badgeId: prize.badgeId || '', rewardAmount: prize.rewardAmount === null ? '' : String(prize.rewardAmount), weight: String(prize.weight), quantity: String(prize.quantity), enabled: prize.enabled, sortOrder: String(prize.sortOrder) }
}

function numericOrNull(value: string) {
  return value.trim() ? Number(value) : null
}

function campaignPayload(form: CampaignForm) {
  return { title: form.title, subtitle: form.subtitle || null, description: form.description || null, startsAt: toIso(form.startsAt), endsAt: toIso(form.endsAt), drawCost: Number(form.drawCost), duplicateRecycleEnabled: form.duplicateRecycleEnabled, duplicateRecycleRequired: numericOrNull(form.duplicateRecycleRequired), duplicateRecycleReward: numericOrNull(form.duplicateRecycleReward), recycleAfterEndEnabled: form.recycleAfterEndEnabled, probabilityPublic: form.probabilityPublic, dailyDrawLimit: numericOrNull(form.dailyDrawLimit), totalDrawLimit: numericOrNull(form.totalDrawLimit), visualUrl: form.visualUrl || null, status: form.status }
}

function prizePayload(form: PrizeForm) {
  return { type: form.type, name: form.name || null, badgeId: form.type === 'BADGE' ? form.badgeId : null, rewardAmount: form.type === 'POINTS' ? Number(form.rewardAmount) : null, weight: Number(form.weight), quantity: Number(form.quantity), enabled: form.enabled, sortOrder: Number(form.sortOrder) }
}

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const body = await response.json().catch(() => null) as { ok?: boolean; message?: string; [key: string]: unknown } | null
  if (!response.ok || body?.ok === false) throw new Error(body?.message || '保存失败，请稍后重试')
  return body || {}
}

export function AngelGiftAdminManager({ initialCampaigns }: Readonly<{ initialCampaigns: AngelGiftCampaignSummary[] }>) {
  const [campaigns, setCampaigns] = useState(initialCampaigns)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CampaignDetail | null>(null)
  const [form, setForm] = useState<CampaignForm>(emptyForm)
  const [editingPrizeId, setEditingPrizeId] = useState<string | null>(null)
  const [prizeForm, setPrizeForm] = useState<PrizeForm>(emptyPrize)
  const [badges, setBadges] = useState<BadgeOption[]>([])
  const [badgeSearch, setBadgeSearch] = useState('')
  const [badgesLoading, setBadgesLoading] = useState(false)
  const [draws, setDraws] = useState<DrawView[]>([])
  const [drawPage, setDrawPage] = useState(1)
  const [drawsMore, setDrawsMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const enabledWeight = useMemo(() => detail?.prizes.reduce((sum, prize) => sum + (prize.enabled && prize.weight > 0 ? prize.weight : 0), 0) || 0, [detail])
  const poolValid = Boolean(detail && detail.prizes.some((prize) => prize.enabled) && enabledWeight > 0 && detail.prizes.filter((prize) => prize.enabled).every((prize) => prize.weight > 0 && (prize.type === 'BADGE' ? Boolean(prize.badgeId && prize.badge?.isEnabled && prize.badge?.isActive) : prize.type === 'POINTS' && Boolean(prize.rewardAmount && prize.rewardAmount > 0))))

  async function refreshList() {
    const body = await jsonRequest('/api/admin/angel-gift/campaigns', { method: 'GET', headers: {} })
    if (Array.isArray(body.campaigns)) setCampaigns(body.campaigns.map((campaign: Record<string, unknown>) => ({ ...campaign, prizeCount: (campaign._count as { PharmacyPrize?: number })?.PharmacyPrize || 0, drawCount: (campaign._count as { PharmacyDraw?: number })?.PharmacyDraw || 0, participantCount: Number(campaign.participantCount || 0), drawCostTotal: Number(campaign.drawCostTotal || 0) })) as AngelGiftCampaignSummary[])
  }

  async function loadBadgeOptions(search = '') {
    setBadgesLoading(true)
    try {
      const query = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''
      const body = await jsonRequest(`/api/admin/angel-gift/badges${query}`)
      if (Array.isArray(body.badges)) setBadges(body.badges as BadgeOption[])
    } finally {
      setBadgesLoading(false)
    }
  }

  async function openCampaign(id: string) {
    setBusy(true); setError(''); setMessage('')
    try {
      const body = await jsonRequest(`/api/admin/angel-gift/campaigns/${id}`)
      const next = body.campaign as CampaignDetail
      setSelectedId(id); setDetail(next); setForm(formFromCampaign(next)); setEditingPrizeId(null); setDraws([]); setDrawPage(1); setDrawsMore(false)
      if (!badges.length) {
        await loadBadgeOptions()
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : '读取主题失败') } finally { setBusy(false) }
  }

  async function saveCampaign(event?: FormEvent, override?: Partial<CampaignForm>) {
    event?.preventDefault()
    setBusy(true); setError(''); setMessage('')
    try {
      const nextForm = { ...form, ...override }
      const body = await jsonRequest(selectedId ? `/api/admin/angel-gift/campaigns/${selectedId}` : '/api/admin/angel-gift/campaigns', { method: selectedId ? 'PATCH' : 'POST', body: JSON.stringify(campaignPayload(nextForm)) })
      const id = selectedId || String((body.campaign as { id: string }).id)
      await refreshList(); await openCampaign(id); setMessage('主题配置已保存')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '保存主题失败') } finally { setBusy(false) }
  }

  async function setStatus(status: string) {
    setForm((current) => ({ ...current, status }))
    await saveCampaign(undefined, { status })
  }

  async function savePrize(event?: FormEvent) {
    event?.preventDefault()
    if (!selectedId) return
    setBusy(true); setError(''); setMessage('')
    try {
      const url = editingPrizeId ? `/api/admin/angel-gift/prizes/${editingPrizeId}` : `/api/admin/angel-gift/campaigns/${selectedId}/prizes`
      await jsonRequest(url, { method: editingPrizeId ? 'PATCH' : 'POST', body: JSON.stringify(prizePayload(prizeForm)) })
      await openCampaign(selectedId); setEditingPrizeId(null); setPrizeForm(emptyPrize); setMessage('奖池配置已保存')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '保存奖品失败') } finally { setBusy(false) }
  }

  async function disablePrize(id: string) {
    if (!window.confirm('停用后会保留历史开奖快照，确定停用这个奖品吗？')) return
    setBusy(true); setError('')
    try { await jsonRequest(`/api/admin/angel-gift/prizes/${id}`, { method: 'DELETE', body: '{}' }); if (selectedId) await openCampaign(selectedId); setMessage('奖品已停用，历史记录保留') } catch (caught) { setError(caught instanceof Error ? caught.message : '停用奖品失败') } finally { setBusy(false) }
  }

  async function loadDraws(page = 1) {
    if (!selectedId) return
    setBusy(true); setError('')
    try { const body = await jsonRequest(`/api/admin/angel-gift/draws?campaignId=${encodeURIComponent(selectedId)}&page=${page}&pageSize=20`); const next = body.data as { draws: DrawView[]; hasMore: boolean; page: number }; setDraws(next.draws); setDrawPage(next.page); setDrawsMore(next.hasMore) } catch (caught) { setError(caught instanceof Error ? caught.message : '读取开奖记录失败') } finally { setBusy(false) }
  }

  function updateForm<K extends keyof CampaignForm>(key: K, value: CampaignForm[K]) { setForm((current) => ({ ...current, [key]: value })) }
  function updatePrize<K extends keyof PrizeForm>(key: K, value: PrizeForm[K]) { setPrizeForm((current) => ({ ...current, [key]: value })) }

  return (
    <section className="space-y-5">
      {message ? <div className="border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" role="status">{message}</div> : null}
      {error ? <div className="border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 dark:bg-red-950/30 dark:text-red-300" role="alert">{error}</div> : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(250px,0.75fr)_minmax(0,1.6fr)]">
        <section className="min-w-0 border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">Themes</p><h2 className="mt-1 text-xl font-black text-slate-900 dark:text-slate-100">主题</h2></div><button type="button" className="border border-red-700 bg-red-800 px-3 py-2 text-xs font-black text-white" onClick={() => { setSelectedId(null); setDetail(null); setForm(emptyForm); setEditingPrizeId(null); setPrizeForm(emptyPrize); setMessage(''); setError('') }}>新建主题</button></div>
          <div className="divide-y divide-slate-200 dark:divide-slate-700">{campaigns.length ? campaigns.map((campaign) => <button type="button" key={campaign.id} className={`block w-full p-4 text-left transition ${selectedId === campaign.id ? 'bg-amber-50 dark:bg-amber-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`} onClick={() => void openCampaign(campaign.id)}><div className="flex items-start justify-between gap-3"><strong className="min-w-0 truncate text-sm font-black text-slate-900 dark:text-slate-100">{campaign.title}</strong><span className="shrink-0 text-[10px] font-black text-amber-700 dark:text-amber-300">{statusLabels[campaign.displayStatus] || campaign.displayStatus}</span></div><p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">执药费用 {campaign.drawCost} · 奖品 {campaign.prizeCount} 项</p><p className="mt-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">参与 {campaign.participantCount} 人 · 执药 {campaign.drawCount} 次 · 消耗 {campaign.drawCostTotal}</p><p className="mt-1 text-[10px] font-bold text-slate-400 dark:text-slate-500">{formatDate(campaign.startsAt)} — {formatDate(campaign.endsAt)}</p></button>) : <p className="p-6 text-center text-sm font-bold text-slate-500">还没有主题。先新建「病态三部曲」，再配置奖池。</p>}</div>
        </section>

        <section className="min-w-0 space-y-5">
          <form className="border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900 sm:p-6" onSubmit={(event) => void saveCampaign(event)}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">{selectedId ? 'Theme Editor' : 'New Theme'}</p><h2 className="mt-1 text-xl font-black text-slate-900 dark:text-slate-100">{selectedId ? form.title || '编辑主题' : '新建主题'}</h2></div>{selectedId ? <span className="border border-amber-300 px-2 py-1 text-[10px] font-black text-amber-700 dark:border-amber-700 dark:text-amber-300">{statusLabels[detail?.displayStatus || form.status] || form.status}</span> : null}</div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="admin-form-label">主题名称</span><input className="admin-form-input" value={form.title} onChange={(event) => updateForm('title', event.target.value)} placeholder="病态三部曲" required /></label><label><span className="admin-form-label">主题副标题</span><input className="admin-form-input" value={form.subtitle} onChange={(event) => updateForm('subtitle', event.target.value)} /></label><label><span className="admin-form-label">主题状态</span><select className="admin-form-input" value={form.status} onChange={(event) => updateForm('status', event.target.value)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="sm:col-span-2"><span className="admin-form-label">主题说明</span><textarea className="admin-form-input min-h-20" value={form.description} onChange={(event) => updateForm('description', event.target.value)} /></label><label><span className="admin-form-label">开始时间（北京时间）</span><input className="admin-form-input" type="datetime-local" value={form.startsAt} onChange={(event) => updateForm('startsAt', event.target.value)} /></label><label><span className="admin-form-label">结束时间（北京时间）</span><input className="admin-form-input" type="datetime-local" value={form.endsAt} onChange={(event) => updateForm('endsAt', event.target.value)} /></label><label><span className="admin-form-label">执药费用（挂号费）</span><input className="admin-form-input" type="number" min="1" step="1" value={form.drawCost} onChange={(event) => updateForm('drawCost', event.target.value)} required /></label><label><span className="admin-form-label">主题视觉图 URL（可选）</span><input className="admin-form-input" value={form.visualUrl} onChange={(event) => updateForm('visualUrl', event.target.value)} /></label></div>
            <div className="mt-5 grid gap-3 border-t border-slate-200 pt-4 dark:border-slate-700 sm:grid-cols-2"><label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300"><input type="checkbox" checked={form.duplicateRecycleEnabled} onChange={(event) => updateForm('duplicateRecycleEnabled', event.target.checked)} /> 启用余药回收</label><label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300"><input type="checkbox" checked={form.recycleAfterEndEnabled} onChange={(event) => updateForm('recycleAfterEndEnabled', event.target.checked)} /> 结束后仍可回收</label><label><span className="admin-form-label">回收所需余药</span><input className="admin-form-input" type="number" min="1" step="1" value={form.duplicateRecycleRequired} onChange={(event) => updateForm('duplicateRecycleRequired', event.target.value)} disabled={!form.duplicateRecycleEnabled} /></label><label><span className="admin-form-label">回收奖励挂号费</span><input className="admin-form-input" type="number" min="1" step="1" value={form.duplicateRecycleReward} onChange={(event) => updateForm('duplicateRecycleReward', event.target.value)} disabled={!form.duplicateRecycleEnabled} /></label><label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300"><input type="checkbox" checked={form.probabilityPublic} onChange={(event) => updateForm('probabilityPublic', event.target.checked)} /> 前台公开概率</label><label><span className="admin-form-label">每日执药上限（留空不限）</span><input className="admin-form-input" type="number" min="1" step="1" value={form.dailyDrawLimit} onChange={(event) => updateForm('dailyDrawLimit', event.target.value)} /></label><label><span className="admin-form-label">单用户主题总上限（留空不限）</span><input className="admin-form-input" type="number" min="1" step="1" value={form.totalDrawLimit} onChange={(event) => updateForm('totalDrawLimit', event.target.value)} /></label></div>
            <div className="mt-5 flex flex-wrap gap-2"><button type="submit" className="border border-red-700 bg-red-800 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50" disabled={busy}>{busy ? '保存中…' : selectedId ? '保存主题' : '创建主题'}</button>{selectedId && form.status !== 'ENDED' ? <>{form.status === 'PAUSED' ? <button type="button" className="admin-secondary-button" disabled={busy} onClick={() => void setStatus('ACTIVE')}>恢复</button> : <button type="button" className="admin-secondary-button" disabled={busy} onClick={() => void setStatus('PAUSED')}>暂停</button>}<button type="button" className="admin-danger-button" disabled={busy} onClick={() => void setStatus('ENDED')}>结束主题</button></> : null}</div>
          </form>

          {selectedId && detail ? <>
            <section className="border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"><div className="border-b border-slate-200 p-5 dark:border-slate-700"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">Statistics</p><h2 className="mt-1 text-xl font-black text-slate-900 dark:text-slate-100">主题统计</h2></div><button type="button" className="admin-secondary-button" onClick={() => void loadDraws(1)}>查看开奖记录</button></div><div className="mt-4 grid grid-cols-2 gap-px overflow-hidden border border-slate-200 bg-slate-200 dark:border-slate-700 dark:bg-slate-700 sm:grid-cols-4"><div className="bg-white p-3 dark:bg-slate-900"><span className="admin-stat-label">累计执药</span><strong className="admin-stat-value">{detail.stats.drawCount}</strong></div><div className="bg-white p-3 dark:bg-slate-900"><span className="admin-stat-label">参与用户</span><strong className="admin-stat-value">{detail.stats.participantCount}</strong></div><div className="bg-white p-3 dark:bg-slate-900"><span className="admin-stat-label">POINTS 返还</span><strong className="admin-stat-value">{detail.stats.pointsRewardTotal}</strong></div><div className="bg-white p-3 dark:bg-slate-900"><span className="admin-stat-label">站内净消耗</span><strong className="admin-stat-value">{detail.stats.netCost}</strong></div></div><p className="mt-3 text-xs font-bold text-slate-500 dark:text-slate-400">执药消耗 {detail.stats.costTotal} − 奖品返还 {detail.stats.pointsRewardTotal} − 余药回收 {detail.stats.recycleRewardTotal} = {detail.stats.netCost}；余药产生 {detail.stats.duplicateProduced} / 已回收 {detail.stats.duplicateRecycled} / 当前统计 {detail.stats.currentDuplicate}。</p></div></section>

            <section className="border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"><div className="border-b border-slate-200 p-5 dark:border-slate-700"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">Prize Editor</p><h2 className="mt-1 text-xl font-black text-slate-900 dark:text-slate-100">奖池配置</h2></div><div className={`text-xs font-black ${poolValid ? 'text-emerald-600 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>{poolValid ? `当前概率合计 ${enabledWeight > 0 ? '100% ✓' : '—'}` : '奖池配置异常'}</div></div><p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">启用奖品 {detail.prizes.filter((prize) => prize.enabled).length} 项 · 总权重 {enabledWeight}。权重由服务器换算概率，前端不会参与开奖。</p></div><div className="divide-y divide-slate-200 dark:divide-slate-700">{detail.prizes.length ? detail.prizes.map((prize) => <div key={prize.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_100px_100px_auto] sm:items-center"><div className="flex min-w-0 items-center gap-3">{prize.badge?.iconUrl ? <Image className="h-10 w-10 object-contain" src={prize.badge.iconUrl} alt="" width={40} height={40} unoptimized /> : <span className="grid h-10 w-10 place-items-center border border-slate-300 text-xs font-black dark:border-slate-600">¥</span>}<div className="min-w-0"><strong className="block truncate text-sm font-black text-slate-900 dark:text-slate-100">{prize.type === 'POINTS' ? `+${prize.rewardAmount} 挂号费` : prize.badge?.name || prize.name || '未命名勋章'}</strong><span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">{prize.type === 'BADGE' ? `${rarityLabels[prize.badge?.rarity || 'COMMON'] || prize.badge?.rarity || '常规'} · ${prize.badge?.isEnabled && prize.badge?.isActive ? '可用' : '已停用'}` : '挂号费奖励'} · {prize.enabled ? '启用' : '已停用'}</span></div></div><div className="text-xs font-black text-amber-700 dark:text-amber-300">权重 {prize.weight}</div><div className="text-xs font-black text-slate-600 dark:text-slate-300">{prize.calculatedProbability.toFixed(2)}%<small className="block font-bold text-slate-400">实际 {prize.actualRate.toFixed(2)}%</small></div><div className="flex gap-2 sm:justify-end"><button type="button" className="admin-secondary-button" onClick={() => { setEditingPrizeId(prize.id); setPrizeForm(formFromPrize(prize)) }}>编辑</button>{prize.enabled ? <button type="button" className="admin-danger-button" onClick={() => void disablePrize(prize.id)}>停用</button> : null}</div></div>) : <p className="p-5 text-sm font-bold text-slate-500">还没有奖品。先从现有 Badge 中选择勋章，或新增挂号费奖品。</p>}</div><form className="border-t border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50" onSubmit={(event) => void savePrize(event)}><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label><span className="admin-form-label">奖品类型</span><select className="admin-form-input" value={prizeForm.type} onChange={(event) => updatePrize('type', event.target.value as 'BADGE' | 'POINTS') }><option value="BADGE">勋章</option><option value="POINTS">挂号费</option></select></label>{prizeForm.type === 'BADGE' ? <div className="sm:col-span-2"><label><span className="admin-form-label">从现有 Badge 选择</span><div className="flex min-w-0 gap-2"><input className="admin-form-input min-w-0 flex-1" aria-label="搜索 Badge" value={badgeSearch} onChange={(event) => setBadgeSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void loadBadgeOptions(badgeSearch) } }} placeholder="搜索勋章名称或 code" /><button type="button" className="admin-secondary-button shrink-0" disabled={badgesLoading} onClick={() => void loadBadgeOptions(badgeSearch)}>{badgesLoading ? '搜索中…' : '搜索'}</button></div><select className="admin-form-input mt-2" value={prizeForm.badgeId} onChange={(event) => updatePrize('badgeId', event.target.value)} required><option value="">请选择 Badge</option>{badges.map((badge) => <option key={badge.id} value={badge.id}>{badge.name} · {rarityLabels[badge.rarity || 'COMMON'] || badge.rarity || '常规'} · {badge.isEnabled && badge.isActive ? '启用' : '停用'}</option>)}</select></label>{badges.find((badge) => badge.id === prizeForm.badgeId) ? <div className="mt-2 flex items-center gap-2 text-[10px] font-bold text-slate-500 dark:text-slate-400"><Image className="h-8 w-8 object-contain" src={badges.find((badge) => badge.id === prizeForm.badgeId)?.iconUrl || ''} alt="" width={32} height={32} unoptimized />{badges.find((badge) => badge.id === prizeForm.badgeId)?.name} · {rarityLabels[badges.find((badge) => badge.id === prizeForm.badgeId)?.rarity || 'COMMON'] || badges.find((badge) => badge.id === prizeForm.badgeId)?.rarity || '常规'}</div> : null}</div> : <label className="sm:col-span-2"><span className="admin-form-label">奖励数量（正整数）</span><input className="admin-form-input" type="number" min="1" step="1" value={prizeForm.rewardAmount} onChange={(event) => updatePrize('rewardAmount', event.target.value)} required /></label>}<label><span className="admin-form-label">权重</span><input className="admin-form-input" type="number" min="1" step="1" value={prizeForm.weight} onChange={(event) => updatePrize('weight', event.target.value)} required /></label><label><span className="admin-form-label">排序</span><input className="admin-form-input" type="number" min="0" step="1" value={prizeForm.sortOrder} onChange={(event) => updatePrize('sortOrder', event.target.value)} required /></label></div><div className="mt-3 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300"><input type="checkbox" checked={prizeForm.enabled} onChange={(event) => updatePrize('enabled', event.target.checked)} /> 启用</label><label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">显示名称 <input className="admin-form-input max-w-52" value={prizeForm.name} onChange={(event) => updatePrize('name', event.target.value)} placeholder="可选" /></label><button type="submit" className="border border-red-700 bg-red-800 px-4 py-2 text-xs font-black text-white disabled:opacity-50" disabled={busy}>{editingPrizeId ? '保存奖品' : '新增奖品'}</button>{editingPrizeId ? <button type="button" className="admin-secondary-button" onClick={() => { setEditingPrizeId(null); setPrizeForm(emptyPrize) }}>取消编辑</button> : null}</div></form></section>

            <div className="grid gap-2 border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-700 dark:bg-slate-800/50">{detail.prizes.map((prize) => <div key={`stat-${prize.id}`} className="flex flex-wrap items-center justify-between gap-2 font-bold text-slate-500 dark:text-slate-400"><span>{prize.type === 'POINTS' ? `+${prize.rewardAmount} 挂号费` : prize.badge?.name || prize.name || '未命名勋章'}</span><span>中奖 {prize.drawCount} · 实际 {prize.actualRate.toFixed(2)}% · {prize.type === 'BADGE' ? `新药 ${prize.newBadgeCount} / 余药 ${prize.duplicateCount}` : `累计发放 ${prize.rewardTotal}`}</span></div>)}</div>
            {draws.length ? <section className="border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"><div className="border-b border-slate-200 p-5 dark:border-slate-700"><h2 className="text-xl font-black text-slate-900 dark:text-slate-100">开奖记录</h2></div><div className="divide-y divide-slate-200 dark:divide-slate-700">{draws.map((draw) => <div key={draw.id} className="grid gap-1 p-4 text-xs sm:grid-cols-[150px_120px_minmax(0,1fr)_120px]"><time className="font-bold text-slate-500 dark:text-slate-400">{formatDate(draw.drawAt)}</time><span className="font-bold text-slate-500 dark:text-slate-400">{draw.user?.nickname || draw.user?.uid || '用户'} </span><strong className="font-black text-slate-900 dark:text-slate-100">{draw.prizeName} {draw.isNewBadge ? '· 新药' : draw.isDuplicate ? '· 余药 +1' : draw.prizeType === 'POINTS' ? `· +${draw.rewardAmount || 0}` : ''}</strong><span className="font-bold text-slate-500 dark:text-slate-400">−{draw.drawCost} · 余额 {draw.balanceAfter}</span></div>)}</div><div className="flex justify-between gap-3 p-3"><button type="button" className="admin-secondary-button" disabled={drawPage <= 1 || busy} onClick={() => void loadDraws(drawPage - 1)}>上一页</button><span className="self-center text-xs font-bold text-slate-500">第 {drawPage} 页</span><button type="button" className="admin-secondary-button" disabled={!drawsMore || busy} onClick={() => void loadDraws(drawPage + 1)}>下一页</button></div></section> : null}
          </> : null}
        </section>
      </div>
    </section>
  )
}
