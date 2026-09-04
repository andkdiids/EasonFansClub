'use client'

import Image from 'next/image'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { calculateAngelGiftPrizePreview, parseAngelGiftPositiveInteger } from '@/lib/angel-gift-admin-preview'

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
  stats: {
    drawCount: number
    participantCount: number
    costTotal: number
    pointsRewardTotal: number
    recycleRewardTotal: number
    netCost: number
    duplicateProduced: number
    duplicateRecycled: number
    currentDuplicate: number
  }
}

type PrizeBadge = {
  id: string
  name: string
  code?: string
  iconUrl: string | null
  rarity: string | null
  visibility: string
  isEnabled: boolean
  isActive: boolean
  acquisitionDescription?: string | null
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
  badge: PrizeBadge | null
  calculatedProbability: number
  drawCount: number
  actualRate: number
  newBadgeCount: number
  duplicateCount: number
  rewardTotal: number
}

type BadgeOption = {
  id: string
  name: string
  code: string
  iconUrl: string | null
  rarity: string | null
  visibility: string
  isEnabled: boolean
  isActive: boolean
  acquisitionDescription: string | null
}

type DrawView = {
  id: string
  drawAt: string
  campaignTitle: string
  drawCost: number
  prizeName: string
  prizeType: string
  resultType: string
  isNewBadge: boolean
  isDuplicate: boolean
  rewardAmount: number | null
  balanceAfter: number
  user?: { uid: string | null; nickname: string | null }
}

type CampaignForm = {
  title: string
  subtitle: string
  description: string
  startsAt: string
  endsAt: string
  drawCost: string
  duplicateRecycleEnabled: boolean
  duplicateRecycleRequired: string
  duplicateRecycleReward: string
  recycleAfterEndEnabled: boolean
  probabilityPublic: boolean
  dailyDrawLimit: string
  totalDrawLimit: string
  visualUrl: string
  status: string
}

type PrizeForm = {
  type: 'BADGE' | 'POINTS'
  name: string
  badgeId: string
  rewardAmount: string
  weight: string
  quantity: string
  enabled: boolean
  sortOrder: string
}

type PrizeDraft = { weight: string; enabled: boolean }

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

function defaultPrizeDraft(prize: PrizeView): PrizeDraft {
  return { weight: String(prize.weight), enabled: prize.enabled }
}

function numericOrNull(value: string) {
  return value.trim() ? Number(value) : null
}

function nonNegativeInteger(value: string) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function campaignPayload(form: CampaignForm) {
  return { title: form.title, subtitle: form.subtitle || null, description: form.description || null, startsAt: toIso(form.startsAt), endsAt: toIso(form.endsAt), drawCost: Number(form.drawCost), duplicateRecycleEnabled: form.duplicateRecycleEnabled, duplicateRecycleRequired: numericOrNull(form.duplicateRecycleRequired), duplicateRecycleReward: numericOrNull(form.duplicateRecycleReward), recycleAfterEndEnabled: form.recycleAfterEndEnabled, probabilityPublic: form.probabilityPublic, dailyDrawLimit: numericOrNull(form.dailyDrawLimit), totalDrawLimit: numericOrNull(form.totalDrawLimit), visualUrl: form.visualUrl || null, status: form.status }
}

function prizePayload(form: PrizeForm) {
  return { type: form.type, name: form.name || null, badgeId: form.type === 'BADGE' ? form.badgeId : null, rewardAmount: form.type === 'POINTS' ? Number(form.rewardAmount) : null, weight: Number(form.weight), quantity: Number(form.quantity), enabled: form.enabled, sortOrder: Number(form.sortOrder) }
}

function acquisitionText(value: string | null | undefined) {
  return value?.trim() || '暂无自动获取规则'
}

function percentText(value: number) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : '0.00%'
}

function prizeLabel(prize: PrizeView) {
  return prize.type === 'POINTS' ? `+${prize.rewardAmount ?? 0} 挂号费` : prize.badge?.name || prize.name || '未命名勋章'
}

function BadgeIcon({ badge, size = 44 }: Readonly<{ badge: { iconUrl: string | null; name: string }; size?: number }>) {
  return badge.iconUrl
    ? <Image className="shrink-0 object-contain" src={badge.iconUrl} alt={`${badge.name} PNG`} width={size} height={size} unoptimized />
    : <span className="grid shrink-0 place-items-center border border-slate-300 text-[10px] font-black text-slate-500 dark:border-slate-600">PNG</span>
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
  const [prizeEditorMode, setPrizeEditorMode] = useState<'BADGE' | 'POINTS' | null>(null)
  const [prizeForm, setPrizeForm] = useState<PrizeForm>(emptyPrize)
  const [prizeDrafts, setPrizeDrafts] = useState<Record<string, PrizeDraft>>({})
  const [selectedBadgeIds, setSelectedBadgeIds] = useState<string[]>([])
  const [badges, setBadges] = useState<BadgeOption[]>([])
  const [badgeSearch, setBadgeSearch] = useState('')
  const [badgesLoading, setBadgesLoading] = useState(false)
  const [draws, setDraws] = useState<DrawView[]>([])
  const [drawPage, setDrawPage] = useState(1)
  const [drawsMore, setDrawsMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!detail) {
      setPrizeDrafts({})
      return
    }
    setPrizeDrafts(Object.fromEntries(detail.prizes.map((prize) => [prize.id, defaultPrizeDraft(prize)])))
  }, [detail])

  const previewInputs = useMemo(() => detail?.prizes.map((prize) => {
    const draft = prizeDrafts[prize.id] || defaultPrizeDraft(prize)
    const editorDraft = editingPrizeId === prize.id ? { weight: prizeForm.weight, enabled: prizeForm.enabled } : draft
    return { id: prize.id, weight: editorDraft.weight, enabled: editorDraft.enabled }
  }) || [], [detail, editingPrizeId, prizeDrafts, prizeForm.enabled, prizeForm.weight])
  const preview = useMemo(() => calculateAngelGiftPrizePreview(previewInputs), [previewInputs])
  const previewById = useMemo(() => new Map(preview.rows.map((row) => [row.id, row])), [preview])

  const poolSummary = useMemo(() => {
    const prizes = detail?.prizes || []
    const enabledPrizes = prizes.filter((prize) => previewInputs.find((input) => input.id === prize.id)?.enabled)
    const invalidWeight = previewInputs.some((input) => input.enabled && parseAngelGiftPositiveInteger(input.weight) === null)
    const invalidContent = enabledPrizes.some((prize) => {
      if (prize.type === 'BADGE') return !prize.badgeId || !prize.badge?.isEnabled || !prize.badge?.isActive
      return prize.type !== 'POINTS' || parseAngelGiftPositiveInteger(prize.rewardAmount ?? '') === null
    })
    const ready = Boolean(detail && prizes.length > 0 && enabledPrizes.length > 0 && preview.totalWeight > 0 && !invalidWeight && !invalidContent)
    const reason = prizes.length === 0
      ? '没有奖品'
      : enabledPrizes.length === 0
        ? '没有有效启用奖品'
        : invalidWeight
          ? '存在非法权重'
          : invalidContent
            ? '存在无效奖品配置'
            : ''
    return { prizeCount: prizes.length, badgeCount: prizes.filter((prize) => prize.type === 'BADGE').length, pointsCount: prizes.filter((prize) => prize.type === 'POINTS').length, enabledCount: enabledPrizes.length, totalWeight: preview.totalWeight, ready, reason }
  }, [detail, preview.totalWeight, previewInputs])

  const joinedBadgeIds = useMemo(() => new Set((detail?.prizes || []).filter((prize) => prize.type === 'BADGE' && prize.badgeId).map((prize) => prize.badgeId as string)), [detail])
  const selectedBadges = useMemo(() => badges.filter((badge) => selectedBadgeIds.includes(badge.id)), [badges, selectedBadgeIds])
  const editingPrize = detail?.prizes.find((prize) => prize.id === editingPrizeId) || null
  const currentFormWeightValid = parseAngelGiftPositiveInteger(prizeForm.weight) !== null
  const currentFormSortValid = nonNegativeInteger(prizeForm.sortOrder) !== null
  const currentFormContentValid = prizeEditorMode === 'POINTS'
    ? parseAngelGiftPositiveInteger(prizeForm.rewardAmount) !== null
    : editingPrizeId
      ? Boolean(prizeForm.badgeId)
      : selectedBadgeIds.length > 0
  const currentPrizeFormValid = currentFormWeightValid && currentFormSortValid && currentFormContentValid

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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取勋章失败')
    } finally {
      setBadgesLoading(false)
    }
  }

  async function openCampaign(id: string) {
    setBusy(true); setError(''); setMessage('')
    try {
      const body = await jsonRequest(`/api/admin/angel-gift/campaigns/${id}`)
      const next = body.campaign as CampaignDetail
      setSelectedId(id); setDetail(next); setForm(formFromCampaign(next)); setEditingPrizeId(null); setPrizeEditorMode(null); setPrizeForm(emptyPrize); setSelectedBadgeIds([]); setPrizeDrafts({}); setDraws([]); setDrawPage(1); setDrawsMore(false)
      await loadBadgeOptions()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '读取主题失败') } finally { setBusy(false) }
  }

  async function saveCampaign(event?: FormEvent, override?: Partial<CampaignForm>) {
    event?.preventDefault()
    const nextForm = { ...form, ...override }
    if ((nextForm.status === 'ACTIVE' || nextForm.status === 'SCHEDULED') && !poolSummary.ready) {
      setError(`无法启用主题：${poolSummary.reason || '奖池状态不可开启'}`)
      return
    }
    setBusy(true); setError(''); setMessage('')
    try {
      const body = await jsonRequest(selectedId ? `/api/admin/angel-gift/campaigns/${selectedId}` : '/api/admin/angel-gift/campaigns', { method: selectedId ? 'PATCH' : 'POST', body: JSON.stringify(campaignPayload(nextForm)) })
      const id = selectedId || String((body.campaign as { id: string }).id)
      await refreshList(); await openCampaign(id); setMessage('主题配置已保存')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '保存主题失败') } finally { setBusy(false) }
  }

  async function setStatus(status: string) {
    if ((status === 'ACTIVE' || status === 'SCHEDULED') && !poolSummary.ready) {
      setError(`无法启用主题：${poolSummary.reason || '奖池状态不可开启'}`)
      return
    }
    setForm((current) => ({ ...current, status }))
    await saveCampaign(undefined, { status })
  }

  function resetPrizeEditor() {
    setEditingPrizeId(null)
    setPrizeEditorMode(null)
    setPrizeForm(emptyPrize)
    setSelectedBadgeIds([])
  }

  async function saveSelectedBadges(event?: FormEvent) {
    event?.preventDefault()
    if (!selectedId || !selectedBadgeIds.length) return
    const weight = parseAngelGiftPositiveInteger(prizeForm.weight)
    const sortOrder = nonNegativeInteger(prizeForm.sortOrder)
    if (weight === null) { setError('权重必须是正整数'); return }
    if (sortOrder === null) { setError('排序必须是非负整数'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      await jsonRequest(`/api/admin/angel-gift/campaigns/${selectedId}/prizes`, { method: 'POST', body: JSON.stringify({ type: 'BADGE', name: null, badgeIds: selectedBadgeIds, rewardAmount: null, weight, quantity: 1, enabled: true, sortOrder }) })
      await openCampaign(selectedId); resetPrizeEditor(); setMessage(`已批量加入奖池 ${selectedBadgeIds.length} 枚勋章`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '批量加入勋章失败') } finally { setBusy(false) }
  }

  async function savePrize(event?: FormEvent) {
    event?.preventDefault()
    if (!selectedId || !prizeEditorMode) return
    if (!currentPrizeFormValid) {
      setError(!currentFormWeightValid ? '权重必须是正整数' : !currentFormSortValid ? '排序必须是非负整数' : prizeEditorMode === 'POINTS' ? '奖励挂号费必须是正整数' : '请选择勋章')
      return
    }
    setBusy(true); setError(''); setMessage('')
    try {
      const url = editingPrizeId ? `/api/admin/angel-gift/prizes/${editingPrizeId}` : `/api/admin/angel-gift/campaigns/${selectedId}/prizes`
      await jsonRequest(url, { method: editingPrizeId ? 'PATCH' : 'POST', body: JSON.stringify(prizePayload(prizeForm)) })
      await openCampaign(selectedId); resetPrizeEditor(); setMessage('奖池配置已保存')
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

  function updatePrize<K extends keyof PrizeForm>(key: K, value: PrizeForm[K]) {
    setPrizeForm((current) => ({ ...current, [key]: value }))
    if (editingPrizeId && (key === 'weight' || key === 'enabled')) setPrizeDrafts((current) => ({ ...current, [editingPrizeId]: { ...(current[editingPrizeId] || { weight: '', enabled: true }), [key]: value } }))
  }

  function updatePrizeDraft(id: string, patch: Partial<PrizeDraft>) {
    const persistedPrize = detail?.prizes.find((prize) => prize.id === id)
    const fallbackDraft = persistedPrize ? defaultPrizeDraft(persistedPrize) : { weight: '', enabled: false }
    setPrizeDrafts((current) => ({ ...current, [id]: { ...(current[id] || fallbackDraft), ...patch } }))
    if (editingPrizeId === id) setPrizeForm((current) => ({ ...current, ...(patch.weight === undefined ? {} : { weight: patch.weight }), ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }) }))
  }

  function startEditingPrize(prize: PrizeView) {
    const draft = prizeDrafts[prize.id] || defaultPrizeDraft(prize)
    setEditingPrizeId(prize.id); setPrizeEditorMode(prize.type === 'POINTS' ? 'POINTS' : 'BADGE'); setSelectedBadgeIds([]); setPrizeForm({ ...formFromPrize(prize), weight: draft.weight, enabled: draft.enabled })
  }

  function openBadgeSelector() {
    resetPrizeEditor(); setPrizeEditorMode('BADGE'); setPrizeForm({ ...emptyPrize, type: 'BADGE', sortOrder: String(detail?.prizes.length || 0) }); void loadBadgeOptions()
  }

  function openPointsEditor() {
    resetPrizeEditor(); setPrizeEditorMode('POINTS'); setPrizeForm({ ...emptyPrize, type: 'POINTS', sortOrder: String(detail?.prizes.length || 0) })
  }

  function toggleBadge(id: string) {
    if (joinedBadgeIds.has(id)) return
    setSelectedBadgeIds((current) => current.includes(id) ? current.filter((badgeId) => badgeId !== id) : [...current, id])
  }

  return (
    <section className="space-y-5">
      {message ? <div className="border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" role="status">{message}</div> : null}
      {error ? <div className="border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 dark:bg-red-950/30 dark:text-red-300" role="alert">{error}</div> : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(250px,0.75fr)_minmax(0,1.6fr)]">
        <section className="min-w-0 border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">Themes</p><h2 className="mt-1 text-xl font-black text-slate-900 dark:text-slate-100">主题</h2></div><button type="button" className="border border-red-700 bg-red-800 px-3 py-2 text-xs font-black text-white" onClick={() => { setSelectedId(null); setDetail(null); setForm(emptyForm); resetPrizeEditor(); setMessage(''); setError('') }}>新建主题</button></div>
          <div className="divide-y divide-slate-200 dark:divide-slate-700">{campaigns.length ? campaigns.map((campaign) => <button type="button" key={campaign.id} className={`block w-full p-4 text-left transition ${selectedId === campaign.id ? 'bg-amber-50 dark:bg-amber-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`} onClick={() => void openCampaign(campaign.id)}><div className="flex items-start justify-between gap-3"><strong className="min-w-0 truncate text-sm font-black text-slate-900 dark:text-slate-100">{campaign.title}</strong><span className="shrink-0 text-[10px] font-black text-amber-700 dark:text-amber-300">{statusLabels[campaign.displayStatus] || campaign.displayStatus}</span></div><p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">执药费用 {campaign.drawCost} · 奖品 {campaign.prizeCount} 项</p><p className="mt-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">参与 {campaign.participantCount} 人 · 执药 {campaign.drawCount} 次 · 消耗 {campaign.drawCostTotal}</p><p className="mt-1 text-[10px] font-bold text-slate-400 dark:text-slate-500">{formatDate(campaign.startsAt)} — {formatDate(campaign.endsAt)}</p></button>) : <p className="p-6 text-center text-sm font-bold text-slate-500">还没有主题。先新建「病态三部曲」，再配置奖池。</p>}</div>
        </section>

        <section className="min-w-0 space-y-5">
          <form className="border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900 sm:p-6" onSubmit={(event) => void saveCampaign(event)}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">{selectedId ? 'Theme Editor' : 'New Theme'}</p><h2 className="mt-1 text-xl font-black text-slate-900 dark:text-slate-100">{selectedId ? form.title || '编辑主题' : '新建主题'}</h2></div>{selectedId ? <span className="border border-amber-300 px-2 py-1 text-[10px] font-black text-amber-700 dark:border-amber-700 dark:text-amber-300">{statusLabels[detail?.displayStatus || form.status] || form.status}</span> : null}</div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="admin-form-label">主题名称</span><input className="admin-form-input" value={form.title} onChange={(event) => updateForm('title', event.target.value)} placeholder="病态三部曲" required /></label><label><span className="admin-form-label">主题副标题</span><input className="admin-form-input" value={form.subtitle} onChange={(event) => updateForm('subtitle', event.target.value)} /></label><label><span className="admin-form-label">主题状态</span><select className="admin-form-input" value={form.status} onChange={(event) => updateForm('status', event.target.value)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="sm:col-span-2"><span className="admin-form-label">主题说明</span><textarea className="admin-form-input min-h-20" value={form.description} onChange={(event) => updateForm('description', event.target.value)} /></label><label><span className="admin-form-label">开始时间（北京时间）</span><input className="admin-form-input" type="datetime-local" value={form.startsAt} onChange={(event) => updateForm('startsAt', event.target.value)} /></label><label><span className="admin-form-label">结束时间（北京时间）</span><input className="admin-form-input" type="datetime-local" value={form.endsAt} onChange={(event) => updateForm('endsAt', event.target.value)} /></label><label><span className="admin-form-label">执药费用（挂号费）</span><input className="admin-form-input" type="number" min="1" step="1" value={form.drawCost} onChange={(event) => updateForm('drawCost', event.target.value)} required /></label><label><span className="admin-form-label">主题视觉图 URL（可选）</span><input className="admin-form-input" value={form.visualUrl} onChange={(event) => updateForm('visualUrl', event.target.value)} /></label></div>
            <div className="mt-5 grid gap-3 border-t border-slate-200 pt-4 dark:border-slate-700 sm:grid-cols-2"><label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300"><input type="checkbox" checked={form.duplicateRecycleEnabled} onChange={(event) => updateForm('duplicateRecycleEnabled', event.target.checked)} /> 启用余药回收</label><label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300"><input type="checkbox" checked={form.recycleAfterEndEnabled} onChange={(event) => updateForm('recycleAfterEndEnabled', event.target.checked)} /> 结束后仍可回收</label><label><span className="admin-form-label">回收所需余药</span><input className="admin-form-input" type="number" min="1" step="1" value={form.duplicateRecycleRequired} onChange={(event) => updateForm('duplicateRecycleRequired', event.target.value)} disabled={!form.duplicateRecycleEnabled} /></label><label><span className="admin-form-label">回收奖励挂号费</span><input className="admin-form-input" type="number" min="1" step="1" value={form.duplicateRecycleReward} onChange={(event) => updateForm('duplicateRecycleReward', event.target.value)} disabled={!form.duplicateRecycleEnabled} /></label><label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300"><input type="checkbox" checked={form.probabilityPublic} onChange={(event) => updateForm('probabilityPublic', event.target.checked)} /> 前台公开概率</label><label><span className="admin-form-label">每日执药上限（留空不限）</span><input className="admin-form-input" type="number" min="1" step="1" value={form.dailyDrawLimit} onChange={(event) => updateForm('dailyDrawLimit', event.target.value)} /></label><label><span className="admin-form-label">单用户主题总上限（留空不限）</span><input className="admin-form-input" type="number" min="1" step="1" value={form.totalDrawLimit} onChange={(event) => updateForm('totalDrawLimit', event.target.value)} /></label></div>
            <div className="mt-5 flex flex-wrap gap-2"><button type="submit" className="border border-red-700 bg-red-800 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50" disabled={busy}>{busy ? '保存中…' : selectedId ? '保存主题' : '创建主题'}</button>{selectedId && form.status !== 'ENDED' ? <>{form.status === 'PAUSED' ? <button type="button" className="admin-secondary-button" disabled={busy || !poolSummary.ready} onClick={() => void setStatus('ACTIVE')}>恢复</button> : <button type="button" className="admin-secondary-button" disabled={busy} onClick={() => void setStatus('PAUSED')}>暂停</button>}<button type="button" className="admin-danger-button" disabled={busy} onClick={() => void setStatus('ENDED')}>结束主题</button></> : null}</div>
          </form>

          {!selectedId ? <div className="border border-dashed border-amber-300 bg-amber-50 p-5 text-sm font-bold leading-6 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">先保存主题，随后这里会出现「奖池配置」，可分别添加勋章和任意多条挂号费奖品。</div> : null}

          {selectedId && detail ? <>
            <section className="border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"><div className="border-b border-slate-200 p-5 dark:border-slate-700"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">Statistics</p><h2 className="mt-1 text-xl font-black text-slate-900 dark:text-slate-100">主题统计</h2></div><button type="button" className="admin-secondary-button" onClick={() => void loadDraws(1)}>查看开奖记录</button></div><div className="mt-4 grid grid-cols-2 gap-px overflow-hidden border border-slate-200 bg-slate-200 dark:border-slate-700 dark:bg-slate-700 sm:grid-cols-4"><div className="bg-white p-3 dark:bg-slate-900"><span className="admin-stat-label">累计执药</span><strong className="admin-stat-value">{detail.stats.drawCount}</strong></div><div className="bg-white p-3 dark:bg-slate-900"><span className="admin-stat-label">参与用户</span><strong className="admin-stat-value">{detail.stats.participantCount}</strong></div><div className="bg-white p-3 dark:bg-slate-900"><span className="admin-stat-label">POINTS 返还</span><strong className="admin-stat-value">{detail.stats.pointsRewardTotal}</strong></div><div className="bg-white p-3 dark:bg-slate-900"><span className="admin-stat-label">站内净消耗</span><strong className="admin-stat-value">{detail.stats.netCost}</strong></div></div><p className="mt-3 text-xs font-bold text-slate-500 dark:text-slate-400">执药消耗 {detail.stats.costTotal} − 奖品返还 {detail.stats.pointsRewardTotal} − 余药回收 {detail.stats.recycleRewardTotal} = {detail.stats.netCost}；余药产生 {detail.stats.duplicateProduced} / 已回收 {detail.stats.duplicateRecycled} / 当前统计 {detail.stats.currentDuplicate}。</p></div></section>

            <section className="border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <div className="border-b border-slate-200 p-5 dark:border-slate-700">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">Prize Editor</p><h2 className="mt-1 text-xl font-black text-slate-900 dark:text-slate-100">奖池配置</h2></div><span className={`text-xs font-black ${poolSummary.ready ? 'text-emerald-600 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>奖池状态：{poolSummary.ready ? '正常' : '不可开启'}</span></div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-black text-slate-600 dark:text-slate-300 sm:grid-cols-5"><span>奖品：{poolSummary.prizeCount}</span><span>勋章：{poolSummary.badgeCount}</span><span>挂号费：{poolSummary.pointsCount}</span><span>启用：{poolSummary.enabledCount}</span><span>总权重：{poolSummary.totalWeight}</span></div>
                {!poolSummary.ready ? <p className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{poolSummary.reason}。启用主题前请修正奖池配置。</p> : null}
                <p className="mt-3 text-xs font-bold text-slate-500 dark:text-slate-400">下面的概率是当前编辑草稿预览，权重或启用状态改变后立即刷新；真正开奖仍由服务器 calculatePharmacyProbability / chooseWeightedPharmacyPrize 决定。</p>
                <div className="mt-4 flex flex-wrap gap-2" aria-label="奖池添加入口"><button type="button" className="border border-red-700 bg-red-800 px-4 py-2.5 text-xs font-black text-white" onClick={openBadgeSelector}>＋ 添加勋章</button><button type="button" className="border border-amber-600 bg-amber-500 px-4 py-2.5 text-xs font-black text-white" onClick={openPointsEditor}>＋ 添加挂号费</button></div>
              </div>

              {prizeEditorMode === 'BADGE' && !editingPrizeId ? <form className="border-b border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50" onSubmit={(event) => void saveSelectedBadges(event)}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-black text-slate-900 dark:text-slate-100">Badge Selector</h3><p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">搜索名称或 code，可一次勾选多枚 Badge；当前主题已加入的 Badge 会显示“已加入”。</p></div><button type="button" className="admin-secondary-button" onClick={resetPrizeEditor}>关闭</button></div><div className="mt-3 flex min-w-0 gap-2"><input className="admin-form-input min-w-0 flex-1" aria-label="搜索 Badge 名称或 code" value={badgeSearch} onChange={(event) => setBadgeSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void loadBadgeOptions(badgeSearch) } }} placeholder="搜索勋章名称或 code" /><button type="button" className="admin-secondary-button shrink-0" disabled={badgesLoading} onClick={() => void loadBadgeOptions(badgeSearch)}>{badgesLoading ? '搜索中…' : '搜索'}</button></div><div className="mt-3 max-h-[30rem] space-y-2 overflow-auto">{badges.length ? badges.map((badge) => { const joined = joinedBadgeIds.has(badge.id); const selected = selectedBadgeIds.includes(badge.id); return <label key={badge.id} className={`flex items-start gap-3 border p-3 transition ${joined ? 'cursor-not-allowed border-slate-200 bg-slate-100 opacity-70 dark:border-slate-700 dark:bg-slate-800' : selected ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30' : 'border-slate-200 bg-white hover:border-amber-300 dark:border-slate-700 dark:bg-slate-900'}`}><input type="checkbox" className="mt-2 h-4 w-4" checked={selected} disabled={joined} onChange={() => toggleBadge(badge.id)} aria-label={`选择 ${badge.name}`} /><BadgeIcon badge={badge} size={48} /><span className="min-w-0 flex-1"><strong className="block text-sm font-black text-slate-900 dark:text-slate-100">{badge.name}</strong><code className="mt-1 block text-[10px] font-bold text-slate-500 dark:text-slate-400">{badge.code}</code><span className="mt-1 block text-xs font-black text-amber-700 dark:text-amber-300">{rarityLabels[badge.rarity || 'COMMON'] || badge.rarity || '常规'}</span><span className="mt-2 block whitespace-pre-line text-xs font-bold leading-5 text-slate-600 dark:text-slate-300">当前获取方式：{acquisitionText(badge.acquisitionDescription)}</span></span>{joined ? <span className="shrink-0 text-[10px] font-black text-slate-500">已加入</span> : null}</label> }) : <p className="border border-dashed border-slate-300 p-5 text-center text-xs font-bold text-slate-500 dark:border-slate-600">{badgesLoading ? '正在读取勋章…' : '没有匹配的 Badge'}</p>}</div><div className="mt-4 grid gap-3 sm:grid-cols-3"><label><span className="admin-form-label">统一初始权重</span><input className="admin-form-input" type="number" min="1" step="1" value={prizeForm.weight} onChange={(event) => updatePrize('weight', event.target.value)} /></label><label><span className="admin-form-label">起始排序</span><input className="admin-form-input" type="number" min="0" step="1" value={prizeForm.sortOrder} onChange={(event) => updatePrize('sortOrder', event.target.value)} /></label><div className="self-end"><button type="submit" className="w-full border border-red-700 bg-red-800 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50" disabled={busy || !selectedBadgeIds.length || !currentPrizeFormValid}>加入奖池（{selectedBadgeIds.length}）</button></div></div>{!currentFormWeightValid ? <p className="mt-2 text-xs font-black text-red-600" role="alert">权重必须是正整数，当前不会产生 NaN% 或 Infinity%。</p> : null}{selectedBadges.length ? <p className="mt-3 text-xs font-bold text-slate-600 dark:text-slate-300">已选择：{selectedBadges.map((badge) => badge.name).join('、')}</p> : null}</form> : null}

              {prizeEditorMode === 'POINTS' ? <form className="border-b border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50" onSubmit={(event) => void savePrize(event)}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-black text-slate-900 dark:text-slate-100">{editingPrizeId ? '编辑挂号费奖品' : '添加挂号费奖品'}</h3><p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">同一主题可以添加任意多条不同金额的 POINTS Prize。</p></div><button type="button" className="admin-secondary-button" onClick={resetPrizeEditor}>关闭</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label><span className="admin-form-label">奖励挂号费</span><input className="admin-form-input" aria-label="奖励挂号费" type="number" min="1" step="1" value={prizeForm.rewardAmount} onChange={(event) => updatePrize('rewardAmount', event.target.value)} required /></label><label><span className="admin-form-label">权重</span><input className="admin-form-input" aria-label="POINTS Prize 权重" type="number" min="1" step="1" value={prizeForm.weight} onChange={(event) => updatePrize('weight', event.target.value)} required /></label><label><span className="admin-form-label">排序</span><input className="admin-form-input" type="number" min="0" step="1" value={prizeForm.sortOrder} onChange={(event) => updatePrize('sortOrder', event.target.value)} required /></label><label><span className="admin-form-label">显示名称（可选）</span><input className="admin-form-input" value={prizeForm.name} onChange={(event) => updatePrize('name', event.target.value)} placeholder="挂号费奖励" /></label></div><div className="mt-3 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300"><input type="checkbox" checked={prizeForm.enabled} onChange={(event) => updatePrize('enabled', event.target.checked)} /> 启用</label><button type="submit" className="border border-amber-600 bg-amber-500 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50" disabled={busy || !currentPrizeFormValid}>{editingPrizeId ? '保存奖品' : '加入奖池'}</button>{!currentFormWeightValid || (prizeForm.rewardAmount !== '' && parseAngelGiftPositiveInteger(prizeForm.rewardAmount) === null) ? <span className="text-xs font-black text-red-600" role="alert">权重和奖励金额必须是正整数</span> : null}</div></form> : null}

              {prizeEditorMode === 'BADGE' && editingPrizeId ? <form className="border-b border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50" onSubmit={(event) => void savePrize(event)}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-black text-slate-900 dark:text-slate-100">编辑勋章奖品</h3><p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">已绑定 Badge 不在编辑时更换，避免误改历史奖品身份。</p></div><button type="button" className="admin-secondary-button" onClick={resetPrizeEditor}>关闭</button></div><div className="mt-4 flex items-center gap-3">{editingPrize?.badge ? <><BadgeIcon badge={editingPrize.badge} size={48} /><div><strong className="block text-sm font-black">{editingPrize.badge.name}</strong><code className="block text-[10px] font-bold text-slate-500">{editingPrize.badge.code || editingPrize.badgeId}</code><span className="text-xs font-bold text-amber-700">{rarityLabels[editingPrize.badge.rarity || 'COMMON'] || editingPrize.badge.rarity || '常规'}</span></div></> : <span className="text-sm font-bold text-slate-500">未找到 Badge</span>}</div><div className="mt-4 grid gap-3 sm:grid-cols-3"><label><span className="admin-form-label">权重</span><input className="admin-form-input" type="number" min="1" step="1" value={prizeForm.weight} onChange={(event) => updatePrize('weight', event.target.value)} required /></label><label><span className="admin-form-label">排序</span><input className="admin-form-input" type="number" min="0" step="1" value={prizeForm.sortOrder} onChange={(event) => updatePrize('sortOrder', event.target.value)} required /></label><label><span className="admin-form-label">显示名称（可选）</span><input className="admin-form-input" value={prizeForm.name} onChange={(event) => updatePrize('name', event.target.value)} /></label></div><div className="mt-3 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300"><input type="checkbox" checked={prizeForm.enabled} onChange={(event) => updatePrize('enabled', event.target.checked)} /> 启用</label><button type="submit" className="border border-red-700 bg-red-800 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50" disabled={busy || !currentPrizeFormValid}>保存奖品</button>{!currentFormWeightValid ? <span className="text-xs font-black text-red-600" role="alert">权重必须是正整数</span> : null}</div></form> : null}

              <div className="overflow-x-auto"><div role="table" aria-label="Prize 列表" className="min-w-[760px]"><div role="row" className="grid grid-cols-[minmax(180px,1.1fr)_90px_minmax(220px,1.4fr)_100px_90px_100px_150px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400"><span>奖品</span><span>类型</span><span>内容</span><span>权重</span><span>概率</span><span>状态</span><span>操作</span></div>{detail.prizes.length ? detail.prizes.map((prize) => { const draft = prizeDrafts[prize.id] || defaultPrizeDraft(prize); const rowPreview = previewById.get(prize.id); const badgeOption = badges.find((badge) => badge.id === prize.badgeId); const displayBadge = prize.badge ? { ...prize.badge, code: prize.badge.code || badgeOption?.code, acquisitionDescription: prize.badge.acquisitionDescription || badgeOption?.acquisitionDescription } : badgeOption; const draftChanged = draft.weight !== String(prize.weight) || draft.enabled !== prize.enabled; return <div role="row" key={prize.id} className="grid grid-cols-[minmax(180px,1.1fr)_90px_minmax(220px,1.4fr)_100px_90px_100px_150px] items-center gap-3 border-b border-slate-200 px-4 py-4 text-xs dark:border-slate-700"><div><strong className="block truncate text-sm font-black text-slate-900 dark:text-slate-100">{prizeLabel(prize)}</strong><span className="mt-1 block text-[10px] font-bold text-slate-500">Prize ID {prize.id}</span></div><span className="font-black text-slate-600 dark:text-slate-300">{prize.type === 'BADGE' ? '勋章' : '挂号费'}</span><div className="min-w-0">{prize.type === 'BADGE' && displayBadge ? <div className="flex items-start gap-2"><BadgeIcon badge={displayBadge} size={36} /><span className="min-w-0"><strong className="block truncate font-black">{displayBadge.name}</strong><code className="block truncate text-[10px] font-bold text-slate-500">{displayBadge.code || prize.badgeId}</code><span className="block font-bold text-amber-700">{rarityLabels[displayBadge.rarity || 'COMMON'] || displayBadge.rarity || '常规'}</span><span className="mt-1 block whitespace-pre-line text-[10px] font-bold leading-4 text-slate-500">{acquisitionText(displayBadge.acquisitionDescription)}</span></span></div> : <span className="font-black text-amber-700">+{prize.rewardAmount ?? 0} 挂号费</span>}</div><label className="block"><span className="sr-only">{prizeLabel(prize)} 权重</span><input className={`admin-form-input w-20 ${draft.enabled && parseAngelGiftPositiveInteger(draft.weight) === null ? 'border-red-500' : ''}`} type="number" min="1" step="1" value={draft.weight} onChange={(event) => updatePrizeDraft(prize.id, { weight: event.target.value })} aria-label={`${prizeLabel(prize)} weight`} />{draft.enabled && parseAngelGiftPositiveInteger(draft.weight) === null ? <span className="mt-1 block text-[10px] font-black text-red-600">正整数</span> : null}</label><span className="font-black text-slate-700 dark:text-slate-200">{percentText(rowPreview?.probability || 0)}<small className="mt-1 block font-bold text-slate-400">实际 {percentText(prize.actualRate)}</small></span><label className="flex items-center gap-2 font-black"><input type="checkbox" checked={draft.enabled} onChange={(event) => updatePrizeDraft(prize.id, { enabled: event.target.checked })} aria-label={`${prizeLabel(prize)} enabled`} /><span>{draft.enabled ? '启用' : '停用'}</span></label><div className="flex flex-wrap gap-2"><button type="button" className="admin-secondary-button" onClick={() => startEditingPrize(prize)}>编辑</button>{prize.enabled ? <button type="button" className="admin-danger-button" onClick={() => void disablePrize(prize.id)}>停用</button> : <span className="text-[10px] font-bold text-slate-400">保留历史</span>}{draftChanged ? <span className="basis-full text-[10px] font-black text-amber-700">草稿未保存</span> : null}</div></div> }) : <p className="p-5 text-sm font-bold text-slate-500">还没有奖品。点击上方「添加勋章」或「添加挂号费」开始配置。</p>}</div></div>
            </section>

            <div className="grid gap-2 border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-700 dark:bg-slate-800/50">{detail.prizes.map((prize) => <div key={`stat-${prize.id}`} className="flex flex-wrap items-center justify-between gap-2 font-bold text-slate-500 dark:text-slate-400"><span>{prizeLabel(prize)}</span><span>中奖 {prize.drawCount} · 实际 {percentText(prize.actualRate)} · {prize.type === 'BADGE' ? `新药 ${prize.newBadgeCount} / 余药 ${prize.duplicateCount}` : `累计发放 ${prize.rewardTotal}`}</span></div>)}</div>
            {draws.length ? <section className="border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"><div className="border-b border-slate-200 p-5 dark:border-slate-700"><h2 className="text-xl font-black text-slate-900 dark:text-slate-100">开奖记录</h2></div><div className="divide-y divide-slate-200 dark:divide-slate-700">{draws.map((draw) => <div key={draw.id} className="grid gap-1 p-4 text-xs sm:grid-cols-[150px_120px_minmax(0,1fr)_120px]"><time className="font-bold text-slate-500 dark:text-slate-400">{formatDate(draw.drawAt)}</time><span className="font-bold text-slate-500 dark:text-slate-400">{draw.user?.nickname || draw.user?.uid || '用户'} </span><strong className="font-black text-slate-900 dark:text-slate-100">{draw.prizeName} {draw.isNewBadge ? '· 新药' : draw.isDuplicate ? '· 余药 +1' : draw.prizeType === 'POINTS' ? `· +${draw.rewardAmount || 0}` : ''}</strong><span className="font-bold text-slate-500 dark:text-slate-400">−{draw.drawCost} · 余额 {draw.balanceAfter}</span></div>)}</div><div className="flex justify-between gap-3 p-3"><button type="button" className="admin-secondary-button" disabled={drawPage <= 1 || busy} onClick={() => void loadDraws(drawPage - 1)}>上一页</button><span className="self-center text-xs font-bold text-slate-500">第 {drawPage} 页</span><button type="button" className="admin-secondary-button" disabled={!drawsMore || busy} onClick={() => void loadDraws(drawPage + 1)}>下一页</button></div></section> : null}
          </> : null}
        </section>
      </div>
    </section>
  )
}
