'use client'

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { PharmacyDrawView, PharmacyHistoryItem, PharmacyPageData } from '@/lib/pharmacy'
import { ALLOWED_PHARMACY_DRAW_COUNTS, calculateAvailablePharmacyDraws, type PharmacyDrawCount } from '@/lib/pharmacy-draw-options'
import { getAngelGiftDrawConfirmationStorageKey, getAngelGiftShanghaiDateKey, shouldConfirmAngelGiftDraw } from '@/lib/angel-gift-draw-confirmation'

type Props = { initialData: PharmacyPageData }

const statusLabels: Record<string, string> = {
  DRAFT: '准备中',
  SCHEDULED: '待开始',
  ACTIVE: '进行中',
  PAUSED: '药房暂时停诊',
  ENDED: '已结束',
}

const rarityLabels: Record<string, string> = {
  LIMITED: '限定处方',
  LEGENDARY: '传说处方',
  EPIC: '稀有处方',
  RARE: '特别处方',
  COMMON: '常规处方',
}

function formatFee(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatDate(value: string | null | undefined, withYear = false) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', ...(withYear ? { year: 'numeric' as const } : {}), month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function makeIdempotencyKey(prefix: string) {
  const uuid = typeof window !== 'undefined' && window.crypto && 'randomUUID' in window.crypto
    ? window.crypto.randomUUID()
    : typeof window !== 'undefined' && window.crypto
      ? Array.from(window.crypto.getRandomValues(new Uint32Array(4))).join('-')
      : String(Date.now())
  return `${prefix}-${uuid}`.slice(0, 191)
}

type PendingDrawRequest = { key: string; drawCount: PharmacyDrawCount }

function pendingDrawStorageKey(userId: string, campaignId: string) {
  return `angel-gift:pending-draw:${userId}:${campaignId}`
}

function parsePendingDrawRequest(value: string | null): PendingDrawRequest | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as { key?: unknown; drawCount?: unknown }
    if (typeof parsed.key !== 'string' || !parsed.key || parsed.key.length > 191 || !ALLOWED_PHARMACY_DRAW_COUNTS.includes(parsed.drawCount as PharmacyDrawCount)) return null
    return { key: parsed.key, drawCount: parsed.drawCount as PharmacyDrawCount }
  } catch {
    return null
  }
}

function readPendingDrawRequest(userId: string, campaignId: string) {
  if (typeof window === 'undefined') return null
  const key = pendingDrawStorageKey(userId, campaignId)
  try {
    const stored = parsePendingDrawRequest(window.sessionStorage.getItem(key))
    if (stored) return stored
  } catch { /* Fall back to local storage when session storage is unavailable. */ }
  try { return parsePendingDrawRequest(window.localStorage.getItem(key)) } catch { return null }
}

function persistPendingDrawRequest(userId: string, campaignId: string, request: PendingDrawRequest) {
  if (typeof window === 'undefined') return false
  const key = pendingDrawStorageKey(userId, campaignId)
  const value = JSON.stringify(request)
  try { window.sessionStorage.setItem(key, value); return true } catch { /* Try the persistent fallback. */ }
  try { window.localStorage.setItem(key, value); return true } catch { return false }
}

function clearPendingDrawRequest(userId: string, campaignId: string) {
  if (typeof window === 'undefined') return
  const key = pendingDrawStorageKey(userId, campaignId)
  try { window.sessionStorage.removeItem(key) } catch { /* Storage is optional. */ }
  try { window.localStorage.removeItem(key) } catch { /* Storage is optional. */ }
}

function errorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string') return payload.message
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') return payload.error
  return fallback
}

function ResultModal({ draws, duplicateTotal, duplicateRequired, cost, onClose, onContinue }: { draws: PharmacyDrawView[]; duplicateTotal: number; duplicateRequired: number | null; cost: number; onClose: () => void; onContinue: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute('disabled'))
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (first && last && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
          event.preventDefault()
          const target = event.shiftKey ? last : first
          target.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [onClose])

  const firstDraw = draws[0]
  const lastDraw = draws[draws.length - 1]
  const isBatch = draws.length > 1
  const title = isBatch ? `本次执药结果 · ${draws.length} 次` : firstDraw.isNewBadge ? '新药入柜' : firstDraw.isDuplicate ? '这味药，你已经有了。' : firstDraw.prizeType === 'POINTS' ? '药房找零' : '请接收你的药'
  const renderDraw = (draw: PharmacyDrawView) => {
    const isNew = draw.isNewBadge
    const isDuplicate = draw.isDuplicate
    const isPoints = draw.prizeType === 'POINTS'
    return <div className="angel-gift-result-entry" key={draw.id}>
      {draw.badge ? <div className={`angel-gift-result-badge ${draw.badge.imageUrl ? '' : 'is-empty'}`}>
        {draw.badge.imageUrl ? <Image src={draw.badge.imageUrl} alt={`${draw.badge.name}勋章`} width={76} height={76} unoptimized /> : <span aria-hidden="true">?</span>}
        <div><strong>{draw.badge.name}</strong><span>{rarityLabels[draw.badge.rarity || 'COMMON'] || draw.badge.rarity || '常规处方'}</span></div>
      </div> : <div className="angel-gift-result-text"><strong>{draw.prizeName}</strong>{isPoints ? <span>+{formatFee(draw.rewardAmount || 0)} 挂号费</span> : null}</div>}
      {isNew ? <p className="angel-gift-result-copy">「{draw.prizeName}」已收入你的勋章药柜。</p> : null}
      {isDuplicate ? <div className="angel-gift-result-copy"><strong>余药 +1</strong><span>当前余药 {duplicateTotal} / {duplicateRequired || '—'}</span><small>{duplicateRequired ? `集齐 ${duplicateRequired} 份余药，可前往药房回收。` : '本期未开启余药回收。'}</small></div> : null}
      {isPoints ? <div className="angel-gift-points-result"><strong>+{formatFee(draw.rewardAmount || 0)} 挂号费</strong>{(draw.rewardAmount || 0) >= cost ? <span>这次的药，算药房请你的。</span> : null}</div> : null}
    </div>
  }
  return (
    <div className="angel-gift-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} className="angel-gift-result-modal" role="dialog" aria-modal="true" aria-labelledby="angel-gift-result-title">
        <button ref={closeRef} type="button" className="angel-gift-modal-close" onClick={onClose} aria-label="关闭结果">×</button>
        <p className="angel-gift-modal-kicker">执药记录 · {formatDate(firstDraw.drawAt)}</p>
        <h2 id="angel-gift-result-title">{title}</h2>
        {isBatch ? <div className="angel-gift-batch-results">{draws.map(renderDraw)}</div> : renderDraw(firstDraw)}
        <div className="angel-gift-result-balance"><span>本次执药</span><strong>−{formatFee(lastDraw.drawCost * draws.length)} 挂号费</strong><span>当前挂号费</span><strong>{formatFee(lastDraw.balanceAfter)}</strong></div>
        <div className="angel-gift-modal-actions"><button type="button" className="angel-gift-button secondary" onClick={onClose}>{firstDraw.isNewBadge ? '收下' : '知道了'}</button><button type="button" className="angel-gift-button primary" onClick={onContinue}>继续执药 · {lastDraw.drawCost}</button></div>
      </div>
    </div>
  )
}

function DrawConfirmationModal({ drawCount, campaignComplete, cost, onCancel, onConfirm }: { drawCount: PharmacyDrawCount; campaignComplete: boolean; cost: number; onCancel: () => void; onConfirm: (suppressToday: boolean) => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [suppressToday, setSuppressToday] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute('disabled'))
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (first && last && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [onCancel])

  const copy = campaignComplete
    ? drawCount === 1
      ? '你已集齐本期药柜全部奖励，继续参与仍会按当前规则正常抽取。'
      : `你已集齐本期药柜全部奖励，即将进行 ${drawCount} 连抽，是否仍要参与？`
    : `即将进行 ${drawCount} 连抽，是否继续？`
  function handleConfirm() {
    if (submitting) return
    setSubmitting(true)
    onConfirm(suppressToday)
  }
  return (
    <div className="angel-gift-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div ref={dialogRef} className="angel-gift-result-modal angel-gift-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="angel-gift-draw-confirm-title" aria-describedby="angel-gift-draw-confirm-copy">
        <p className="angel-gift-modal-kicker">执药前确认</p>
        <h2 id="angel-gift-draw-confirm-title">{campaignComplete ? '当期奖励已全部拥有' : '确认参与抽取'}</h2>
        <p id="angel-gift-draw-confirm-copy" className="angel-gift-confirm-copy">{copy}</p>
        <p className="angel-gift-confirm-cost">本次消耗 {formatFee(cost * drawCount)} 挂号费</p>
        <label className="angel-gift-confirm-checkbox"><input type="checkbox" checked={suppressToday} onChange={(event) => setSuppressToday(event.target.checked)} />今日不再提醒</label>
        <div className="angel-gift-modal-actions"><button ref={cancelRef} type="button" className="angel-gift-button secondary" onClick={onCancel} disabled={submitting}>取消</button><button type="button" className="angel-gift-button primary" onClick={handleConfirm} disabled={submitting} aria-busy={submitting}>{submitting ? '处理中…' : campaignComplete ? '仍要参与' : '继续抽取'}</button></div>
      </div>
    </div>
  )
}

function RecycleAllConfirmationModal({ recyclableCount, recyclableTypeCount, rewardAmount, onCancel, onConfirm }: { recyclableCount: number; recyclableTypeCount: number; rewardAmount: number; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button, [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute('disabled'))
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (first && last && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [onCancel])

  return (
    <div className="angel-gift-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div ref={dialogRef} className="angel-gift-result-modal angel-gift-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="angel-gift-recycle-confirm-title" aria-describedby="angel-gift-recycle-confirm-copy">
        <p className="angel-gift-modal-kicker">余药回收确认</p>
        <h2 id="angel-gift-recycle-confirm-title">确认一键回收</h2>
        <p id="angel-gift-recycle-confirm-copy" className="angel-gift-confirm-copy">将回收本期全部 {recyclableCount} 枚余药，涉及 {recyclableTypeCount} 种勋章，共获得 {formatFee(rewardAmount)} 挂号费。</p>
        <div className="angel-gift-modal-actions"><button ref={cancelRef} type="button" className="angel-gift-button secondary" onClick={onCancel}>暂不回收</button><button type="button" className="angel-gift-button primary" onClick={onConfirm}>确认全部回收</button></div>
      </div>
    </div>
  )
}

export function AngelGiftClient({ initialData }: Props) {
  const [data, setData] = useState(initialData)
  const [selectedCampaignId, setSelectedCampaignId] = useState(initialData.campaign?.id || '')
  const [campaignLoading, setCampaignLoading] = useState(false)
  const [drawPhases, setDrawPhases] = useState<Record<string, string>>({})
  const [pendingDrawCounts, setPendingDrawCounts] = useState<Record<string, PharmacyDrawCount>>({})
  const [resultsByCampaign, setResultsByCampaign] = useState<Record<string, PharmacyDrawView[]>>({})
  const [error, setError] = useState('')
  const [skipAnimation, setSkipAnimation] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [recycleBusyByCampaign, setRecycleBusyByCampaign] = useState<Record<string, boolean>>({})
  const [recycleAllConfirm, setRecycleAllConfirm] = useState(false)
  const [recycleSuccess, setRecycleSuccess] = useState('')
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyPage, setHistoryPage] = useState(1)
  const [drawConfirmation, setDrawConfirmation] = useState<PharmacyDrawCount | null>(null)
  const [drawConfirmationSubmitting, setDrawConfirmationSubmitting] = useState(false)
  const selectedCampaignIdRef = useRef(initialData.campaign?.id || '')
  const campaignDataCacheRef = useRef(new Map<string, PharmacyPageData>(initialData.campaign ? [[initialData.campaign.id, initialData]] : []))
  const selectionRequestRef = useRef(0)
  const historyRequestRef = useRef(0)
  const drawKeysByCampaignRef = useRef(new Map<string, PendingDrawRequest>())
  const drawInFlightByCampaignRef = useRef(new Set<string>())
  const recycleKeysByCampaignRef = useRef(new Map<string, string>())
  const recycleAllKeysByCampaignRef = useRef(new Map<string, string>())

  const campaign = data.campaign?.id === selectedCampaignId ? data.campaign : null
  const result = campaign ? resultsByCampaign[campaign.id] || null : null
  const upcomingCampaign = data.upcomingCampaign
  const user = data.user
  const pendingCampaignId = campaign?.id
  const pendingUserId = user?.id
  const required = data.duplicate.required
  const recycleBusy = Boolean(campaign && recycleBusyByCampaign[campaign.id])
  const canRecycle = Boolean(user && campaign?.duplicateRecycleEnabled && required && data.duplicate.total >= required && !recycleBusy)
  const canRecycleAll = Boolean(user && campaign?.duplicateRecycleEnabled && data.duplicate.recyclableCount > 0 && !recycleBusy)
  const status = campaign?.status || null
  const campaignComplete = Boolean(campaign?.collection.collectionComplete)
  const isLimitReached = Boolean(user && campaign && ((campaign.dailyDrawLimit !== null && user.todayCount >= campaign.dailyDrawLimit) || (campaign.totalDrawLimit !== null && user.totalCount >= campaign.totalDrawLimit)))
  const insufficient = Boolean(user && campaign && user.balance < campaign.drawCost)
  const availableDraws = campaign && user
    ? calculateAvailablePharmacyDraws({ balance: user.balance, cost: campaign.drawCost, todayCount: user.todayCount, dailyLimit: campaign.dailyDrawLimit, totalCount: user.totalCount, totalLimit: campaign.totalDrawLimit })
    : 0
  const campaignIsDrawing = Boolean(campaign && drawPhases[campaign.id])
  const pendingDrawCount = campaign ? pendingDrawCounts[campaign.id] : undefined

  function cacheAndApplyCampaignPage(campaignId: string, page: PharmacyPageData) {
    const balance = page.user?.balance
    if (balance !== undefined) {
      for (const [cachedId, cachedPage] of campaignDataCacheRef.current) {
        if (cachedPage.user) campaignDataCacheRef.current.set(cachedId, { ...cachedPage, user: { ...cachedPage.user, balance } })
      }
    }
    campaignDataCacheRef.current.set(campaignId, page)
    if (selectedCampaignIdRef.current === campaignId) setData(page)
    else if (balance !== undefined) setData((current) => current.user ? { ...current, user: { ...current.user, balance } } : current)
  }

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { setReducedMotion(query.matches); if (query.matches) setSkipAnimation(true) }
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    if (!pendingCampaignId || !pendingUserId) return
    const stored = readPendingDrawRequest(pendingUserId, pendingCampaignId)
    if (!stored || drawKeysByCampaignRef.current.has(pendingCampaignId)) return
    drawKeysByCampaignRef.current.set(pendingCampaignId, stored)
    setPendingDrawCounts((current) => ({ ...current, [pendingCampaignId]: stored.drawCount }))
  }, [pendingCampaignId, pendingUserId])

  const collectionProgress = useMemo(() => {
    if (!campaign) return { collected: 0, total: 0 }
    return { collected: campaign.cabinet.filter((badge) => !badge.locked && badge.obtainedAt).length, total: campaign.cabinet.length }
  }, [campaign])

  async function reloadPage(campaignId: string) {
    const query = `?campaignId=${encodeURIComponent(campaignId)}`
    const response = await fetch(`/api/angel-gift${query}`, { cache: 'no-store' })
    const payload = await response.json().catch(() => null) as { ok?: boolean; data?: PharmacyPageData; message?: string }
    if (!response.ok || !payload.ok || !payload.data) throw new Error(errorMessage(payload, '药房信息暂时无法刷新'))
    if (payload.data.campaign?.id !== campaignId) throw new Error('返回的主题与当前选择不一致')
    cacheAndApplyCampaignPage(campaignId, payload.data)
    return payload.data
  }

  async function selectCampaign(campaignId: string) {
    if (!campaignId || campaignId === selectedCampaignIdRef.current) return
    selectedCampaignIdRef.current = campaignId
    setSelectedCampaignId(campaignId)
    setError('')
    setHistoryPage(1)
    setHistoryBusy(false)
    historyRequestRef.current += 1
    setDrawConfirmation(null)
    setDrawConfirmationSubmitting(false)
    setRecycleAllConfirm(false)
    setRecycleSuccess('')
    const requestId = ++selectionRequestRef.current
    const cached = campaignDataCacheRef.current.get(campaignId)
    if (cached) setData(cached)
    setCampaignLoading(true)
    try {
      const response = await fetch(`/api/angel-gift?campaignId=${encodeURIComponent(campaignId)}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null) as { ok?: boolean; data?: PharmacyPageData; message?: string }
      if (!response.ok || !payload?.ok || !payload.data || payload.data.campaign?.id !== campaignId) throw new Error(errorMessage(payload, '所选主题暂时无法加载'))
      campaignDataCacheRef.current.set(campaignId, payload.data)
      if (requestId === selectionRequestRef.current && selectedCampaignIdRef.current === campaignId) setData(payload.data)
    } catch (caught) {
      if (requestId === selectionRequestRef.current) setError(caught instanceof Error ? caught.message : '所选主题暂时无法加载')
    } finally {
      if (requestId === selectionRequestRef.current) setCampaignLoading(false)
    }
  }

  async function draw(requestedCount: PharmacyDrawCount = 1) {
    if (!campaign || !user || campaignLoading || drawPhases[campaign.id] || drawInFlightByCampaignRef.current.has(campaign.id) || !ALLOWED_PHARMACY_DRAW_COUNTS.includes(requestedCount)) return
    const campaignId = campaign.id
    const pending = drawKeysByCampaignRef.current.get(campaignId) || readPendingDrawRequest(user.id, campaignId)
    if (pending && pending.drawCount !== requestedCount) {
      setError(`上次 ${pending.drawCount} 次抽奖的结果尚未确认，请先使用相同次数恢复结果。`)
      return
    }
    if (!pending && (availableDraws < requestedCount || status !== 'ACTIVE' || !campaign.prizePoolValid || isLimitReached)) return
    setError('')
    const request = pending || { key: makeIdempotencyKey('draw'), drawCount: requestedCount }
    if (!pending && !persistPendingDrawRequest(user.id, campaignId, request)) {
      setError('浏览器无法安全保存本次请求编号，请检查存储权限后重试。为避免结果未知时重复扣费，本次未发送抽奖请求。')
      return
    }
    drawKeysByCampaignRef.current.set(campaignId, request)
    setPendingDrawCounts((current) => ({ ...current, [campaignId]: request.drawCount }))
    setDrawPhases((current) => ({ ...current, [campaignId]: '正在核对处方……' }))
    drawInFlightByCampaignRef.current.add(campaignId)
    const first = window.setTimeout(() => setDrawPhases((current) => ({ ...current, [campaignId]: '药房正在配药……' })), 480)
    const second = window.setTimeout(() => setDrawPhases((current) => ({ ...current, [campaignId]: '请接收你的药。' })), 960)
    const requestStarted = fetch('/api/angel-gift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId, idempotencyKey: request.key, drawCount: requestedCount }),
    })
    const minimumAnimation = skipAnimation || reducedMotion ? Promise.resolve() : new Promise<void>((resolve) => window.setTimeout(resolve, 1500))
    let uncertainOutcome = true
    try {
      const [response] = await Promise.all([requestStarted, minimumAnimation])
      const payload = await response.json().catch(() => null) as { ok?: boolean; code?: string; data?: { draw: PharmacyDrawView; draws?: PharmacyDrawView[]; page?: PharmacyPageData | null; duplicateTotal?: number; duplicateRequired?: number | null }; message?: string }
      const nextDraws = payload.data?.draws?.length ? payload.data.draws : payload.data?.draw ? [payload.data.draw] : []
      if (!response.ok || !payload.ok || !payload.data || !nextDraws.length) {
        if (response.status < 500 && payload.code !== 'IDEMPOTENCY_KEY_INVALID') {
          uncertainOutcome = false
          drawKeysByCampaignRef.current.delete(campaignId)
          setPendingDrawCounts((current) => { const next = { ...current }; delete next[campaignId]; return next })
          clearPendingDrawRequest(user.id, campaignId)
        }
        throw new Error(errorMessage(payload, '药房暂时无法完成执药，请稍后重试'))
      }
      const nextPage = payload.data.page
      if (nextPage?.campaign?.id === campaignId) cacheAndApplyCampaignPage(campaignId, nextPage)
      else {
        try { await reloadPage(campaignId) } catch (refreshError) { console.error('[angel-gift.draw.refresh]', refreshError) }
        if (selectedCampaignIdRef.current === campaignId) setData((current) => ({ ...current, user: current.user ? { ...current.user, balance: payload.data!.draw.balanceAfter } : current.user, duplicate: { ...current.duplicate, total: payload.data!.duplicateTotal ?? current.duplicate.total, required: payload.data!.duplicateRequired !== undefined ? payload.data!.duplicateRequired : current.duplicate.required } }))
      }
      uncertainOutcome = false
      drawKeysByCampaignRef.current.delete(campaignId)
      setPendingDrawCounts((current) => { const next = { ...current }; delete next[campaignId]; return next })
      clearPendingDrawRequest(user.id, campaignId)
      if (selectedCampaignIdRef.current === campaignId) setHistoryPage(1)
      setResultsByCampaign((current) => ({ ...current, [campaignId]: nextDraws }))
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '药房暂时无法完成执药，请稍后重试'
      if (selectedCampaignIdRef.current === campaignId) {
        setError(uncertainOutcome ? `${message} 抽奖结果尚未确认；再次选择相同抽取次数会复用原请求编号并恢复原结果，不会重复扣费。` : message)
      }
    } finally {
      window.clearTimeout(first)
      window.clearTimeout(second)
      drawInFlightByCampaignRef.current.delete(campaignId)
      setDrawPhases((current) => { const next = { ...current }; delete next[campaignId]; return next })
    }
  }

  function isDrawConfirmationSuppressedToday(campaignId: string) {
    if (typeof window === 'undefined') return false
    try {
      const dateKey = getAngelGiftShanghaiDateKey()
      return window.localStorage.getItem(getAngelGiftDrawConfirmationStorageKey(campaignId, dateKey)) === '1'
    } catch {
      return false
    }
  }

  function suppressDrawConfirmationToday(campaignId: string) {
    if (typeof window === 'undefined') return
    try {
      const dateKey = getAngelGiftShanghaiDateKey()
      window.localStorage.setItem(getAngelGiftDrawConfirmationStorageKey(campaignId, dateKey), '1')
    } catch {
      // Private browsing and blocked storage should not prevent drawing.
    }
  }

  function requestDraw(requestedCount: PharmacyDrawCount = 1) {
    const storedPending = campaign && user ? readPendingDrawRequest(user.id, campaign.id) : null
    const pending = campaign ? pendingDrawCounts[campaign.id] || storedPending?.drawCount : undefined
    if (!campaign || !user || campaignLoading || drawPhases[campaign.id] || drawInFlightByCampaignRef.current.has(campaign.id) || drawConfirmationSubmitting || !ALLOWED_PHARMACY_DRAW_COUNTS.includes(requestedCount)) return
    if (pending && pending !== requestedCount) {
      setError(`上次 ${pending} 次抽奖的结果尚未确认，请先使用相同次数恢复结果。`)
      return
    }
    if (pending === requestedCount) {
      void draw(requestedCount)
      return
    }
    if (!pending && availableDraws < requestedCount) return
    const shouldConfirm = shouldConfirmAngelGiftDraw({ drawCount: requestedCount, campaignComplete, suppressToday: isDrawConfirmationSuppressedToday(campaign.id) })
    if (!shouldConfirm) {
      void draw(requestedCount)
      return
    }
    setDrawConfirmation(requestedCount)
  }

  function cancelDrawConfirmation() {
    setDrawConfirmation(null)
    setDrawConfirmationSubmitting(false)
  }

  function confirmDraw(suppressToday: boolean) {
    if (!campaign || !drawConfirmation || drawConfirmationSubmitting) return
    const requestedCount = drawConfirmation
    setDrawConfirmationSubmitting(true)
    if (suppressToday) suppressDrawConfirmationToday(campaign.id)
    setDrawConfirmation(null)
    void draw(requestedCount).finally(() => setDrawConfirmationSubmitting(false))
  }

  async function recycle() {
    if (!campaign || !canRecycle) return
    const campaignId = campaign.id
    setRecycleBusyByCampaign((current) => ({ ...current, [campaignId]: true }))
    setError('')
    const idempotencyKey = recycleKeysByCampaignRef.current.get(campaignId) || makeIdempotencyKey('recycle')
    recycleKeysByCampaignRef.current.set(campaignId, idempotencyKey)
    try {
      const response = await fetch('/api/angel-gift/recycle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId, idempotencyKey }) })
      const payload = await response.json().catch(() => null) as { ok?: boolean; data?: { page?: PharmacyPageData | null; balance?: number; duplicateTotal?: number; duplicateRequired?: number }; message?: string }
      if (!response.ok || !payload.ok) throw new Error(errorMessage(payload, '余药回收暂时无法完成'))
      recycleKeysByCampaignRef.current.delete(campaignId)
      if (payload.data?.page?.campaign?.id === campaignId) cacheAndApplyCampaignPage(campaignId, payload.data.page)
      else {
        try { await reloadPage(campaignId) } catch (refreshError) { console.error('[angel-gift.recycle.refresh]', refreshError) }
      }
      if (selectedCampaignIdRef.current === campaignId) setHistoryPage(1)
    } catch (caught) {
      if (selectedCampaignIdRef.current === campaignId) setError(caught instanceof Error ? caught.message : '余药回收暂时无法完成')
    } finally {
      setRecycleBusyByCampaign((current) => { const next = { ...current }; delete next[campaignId]; return next })
    }
  }

  async function recycleAll() {
    if (!campaign || !canRecycleAll) return
    const campaignId = campaign.id
    setRecycleBusyByCampaign((current) => ({ ...current, [campaignId]: true }))
    setError('')
    setRecycleSuccess('')
    const idempotencyKey = recycleAllKeysByCampaignRef.current.get(campaignId) || makeIdempotencyKey('recycle-all')
    recycleAllKeysByCampaignRef.current.set(campaignId, idempotencyKey)
    try {
      const response = await fetch('/api/angel-gift/recycle/all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId, idempotencyKey }) })
      const payload = await response.json().catch(() => null) as { ok?: boolean; data?: { page?: PharmacyPageData | null; recycledCount?: number; rewardAmount?: number }; message?: string }
      if (!response.ok || !payload.ok) throw new Error(errorMessage(payload, '余药回收暂时无法完成'))
      recycleAllKeysByCampaignRef.current.delete(campaignId)
      if (payload.data?.page?.campaign?.id === campaignId) cacheAndApplyCampaignPage(campaignId, payload.data.page)
      else { try { await reloadPage(campaignId) } catch (refreshError) { console.error('[angel-gift.recycle-all.refresh]', refreshError) } }
      if (selectedCampaignIdRef.current === campaignId) {
        setHistoryPage(1)
        setRecycleSuccess(payload.data?.recycledCount
          ? `已回收 ${payload.data.recycledCount} 枚余药，共获得 ${formatFee(payload.data.rewardAmount || 0)} 挂号费`
          : '暂无可回收余药')
      }
    } catch (caught) {
      if (selectedCampaignIdRef.current === campaignId) setError(caught instanceof Error ? caught.message : '余药回收暂时无法完成')
    } finally {
      setRecycleBusyByCampaign((current) => { const next = { ...current }; delete next[campaignId]; return next })
    }
  }

  async function loadMoreHistory() {
    if (!campaign || historyBusy || !data.historyHasMore) return
    const campaignId = campaign.id
    const requestId = ++historyRequestRef.current
    setHistoryBusy(true)
    try {
      const nextPage = historyPage + 1
      const response = await fetch(`/api/angel-gift/history?campaignId=${encodeURIComponent(campaignId)}&page=${nextPage}&pageSize=10`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null) as { ok?: boolean; data?: { items: PharmacyHistoryItem[]; hasMore: boolean }; message?: string }
      if (!response.ok || !payload.ok || !payload.data) throw new Error(errorMessage(payload, '执药记录暂时无法加载'))
      if (requestId === historyRequestRef.current && selectedCampaignIdRef.current === campaignId) {
        setData((current) => {
          if (current.campaign?.id !== campaignId) return current
          const next = { ...current, history: [...current.history, ...payload.data!.items], historyHasMore: payload.data!.hasMore }
          campaignDataCacheRef.current.set(campaignId, next)
          return next
        })
        setHistoryPage(nextPage)
      }
    } catch (caught) {
      if (requestId === historyRequestRef.current) setError(caught instanceof Error ? caught.message : '执药记录暂时无法加载')
    } finally {
      if (requestId === historyRequestRef.current) setHistoryBusy(false)
    }
  }

  function statusHint() {
    if (!campaign) return '当前没有正在展示的主题，请稍后再来。'
    if (status === 'SCHEDULED') return `主题将于 ${formatDate(campaign.startsAt)} 开始。`
    if (status === 'PAUSED') return '药房暂时停诊，已有药柜、余药和记录仍可查看。'
    if (status === 'ENDED') return '本期已经结束，已有勋章、余药和执药记录仍会保留。'
    if (status === 'ACTIVE' && !campaign.prizePoolValid) return '奖池配置异常，请联系管理员。'
    if (isLimitReached) return campaign.dailyDrawLimit !== null && user && user.todayCount >= campaign.dailyDrawLimit ? '今日已执完。' : '本期已执完。'
    if (insufficient && campaign) return `挂号费不够，今天的药先欠着。还需要 ${formatFee(campaign.drawCost - (user?.balance || 0))}。`
    return ''
  }

  function canRequestDraw(drawCount: PharmacyDrawCount) {
    if (!campaign || !user || campaignLoading || campaignIsDrawing || drawInFlightByCampaignRef.current.has(campaign.id)) return false
    if (pendingDrawCount === drawCount) return true
    return status === 'ACTIVE' && campaign.prizePoolValid && !isLimitReached && availableDraws >= drawCount
  }

  const upcomingPreview = upcomingCampaign && upcomingCampaign.id !== campaign?.id ? <section className="angel-gift-theme-card angel-gift-upcoming-card" aria-labelledby="angel-gift-upcoming-title">
    {upcomingCampaign.visualUrl ? <Image className="angel-gift-theme-visual" src={upcomingCampaign.visualUrl} alt={`${upcomingCampaign.title}主题视觉`} width={112} height={76} unoptimized /> : null}
    <div><span className="angel-gift-label">下期预告</span><h2 id="angel-gift-upcoming-title">{upcomingCampaign.title}</h2>{upcomingCampaign.subtitle ? <p className="angel-gift-theme-subtitle">{upcomingCampaign.subtitle}</p> : null}{upcomingCampaign.description ? <p className="angel-gift-theme-description">{upcomingCampaign.description}</p> : null}</div>
    <div className="angel-gift-status"><span>待开始</span><small>开始于 {formatDate(upcomingCampaign.startsAt, true)}</small></div>
  </section> : null

  return (
    <section className="angel-gift-page" aria-labelledby="angel-gift-title">
      <header className="angel-gift-heading">
        <div><p className="angel-gift-kicker">E院药房 / RX</p><h1 id="angel-gift-title">天使的礼物</h1><p>有些药，不写在处方上。</p></div>
        <div className="angel-gift-balance" aria-label="当前挂号费"><span>挂号费</span><strong>{user ? formatFee(user.balance) : '—'}</strong></div>
      </header>

      {!data.isAuthenticated ? <div className="angel-gift-login-note"><span>登录后才能执药、收藏勋章并保留余药。</span><Link href="/login?redirect=%2Fangel-gift">登录后进入药房 →</Link></div> : null}
      {data.campaignOptions.length > 1 ? <div className="angel-gift-campaign-selector">
        <label htmlFor="angel-gift-campaign-select">选择抽奖期</label>
        <select id="angel-gift-campaign-select" value={selectedCampaignId} onChange={(event) => void selectCampaign(event.target.value)} aria-label="选择天使的礼物抽奖期">
          {data.campaignOptions.map((option) => <option key={option.id} value={option.id}>{option.title} · {statusLabels[option.status] || option.status} · 每次 {formatFee(option.drawCost)} 挂号费{option.endsAt ? ` · 至 ${formatDate(option.endsAt, true)}` : ''}</option>)}
        </select>
        {campaignLoading ? <span role="status" aria-live="polite">正在读取本期药柜…</span> : null}
      </div> : campaignLoading ? <p className="angel-gift-campaign-loading" role="status" aria-live="polite">正在读取所选主题…</p> : null}
      {error ? <div className="angel-gift-alert" role="alert">{error}</div> : null}

      {campaign ? <>
        {upcomingPreview}

        <section className="angel-gift-theme-card" aria-labelledby="angel-gift-theme-title">
          {campaign.visualUrl ? <Image className="angel-gift-theme-visual" src={campaign.visualUrl} alt={`${campaign.title}主题视觉`} width={112} height={76} unoptimized /> : null}
          <div><span className="angel-gift-label">本期主题</span><h2 id="angel-gift-theme-title">{campaign.title}</h2>{campaign.subtitle ? <p className="angel-gift-theme-subtitle">{campaign.subtitle}</p> : null}{campaign.description ? <p className="angel-gift-theme-description">{campaign.description}</p> : null}</div>
          <div className={`angel-gift-status is-${status?.toLowerCase()}`}><span>{status ? statusLabels[status] : '—'}</span>{campaign.endsAt && status !== 'ENDED' ? <small>至 {formatDate(campaign.endsAt)}</small> : null}</div>
        </section>

        <section className={`angel-gift-pharmacy-box ${campaignIsDrawing ? 'is-drawing' : ''}`} aria-label="E院药房">
          <div className="angel-gift-box-stamp">Rx</div><div className="angel-gift-box-mark">E院药房</div><div className="angel-gift-box-name">ANGEL&apos;S GIFT</div><div className="angel-gift-box-cn">天使的礼物</div><div className="angel-gift-box-line" />
          <div className="angel-gift-box-phase" aria-live="polite">{campaignIsDrawing ? drawPhases[campaign.id] : '请把手伸进不知道名字的处方里。'}</div>
          <div className="angel-gift-draw-actions" aria-label="执药次数">
            <button type="button" className="angel-gift-draw-button angel-gift-draw-option" onClick={() => requestDraw(1)} disabled={!canRequestDraw(1)} aria-disabled={!canRequestDraw(1)}>{campaignIsDrawing ? '配药中…' : pendingDrawCount === 1 ? '恢复上次结果' : '执药 1 次'}</button>
            {availableDraws >= 5 || pendingDrawCount === 5 ? <button type="button" className="angel-gift-draw-button angel-gift-draw-option" onClick={() => requestDraw(5)} disabled={!canRequestDraw(5)} aria-disabled={!canRequestDraw(5)}>{pendingDrawCount === 5 ? '恢复上次 5 连抽' : '执药 5 次'}</button> : null}
            {availableDraws >= 10 || pendingDrawCount === 10 ? <button type="button" className="angel-gift-draw-button angel-gift-draw-option" onClick={() => requestDraw(10)} disabled={!canRequestDraw(10)} aria-disabled={!canRequestDraw(10)}>{pendingDrawCount === 10 ? '恢复上次 10 连抽' : '执药 10 次'}</button> : null}
          </div>
          <p className="angel-gift-box-note">每次执药消耗 {campaign.drawCost} 挂号费</p>
        </section>

        <div className="angel-gift-controls"><span>{statusHint()}</span><label><input type="checkbox" checked={skipAnimation} onChange={(event) => setSkipAnimation(event.target.checked)} /> 跳过动画</label></div>
        <div className="angel-gift-limits">{campaign.dailyDrawLimit !== null ? <span>今日 {user?.todayCount || 0} / {campaign.dailyDrawLimit}</span> : null}{user ? <span>本期累计抽取 {user.totalCount} 次</span> : null}{campaign.totalDrawLimit !== null ? <span>本期上限 {user?.totalCount || 0} / {campaign.totalDrawLimit}</span> : null}{campaign.probabilityPublic ? <span>本期概率公开</span> : null}</div>

        <section className="angel-gift-panel" aria-labelledby="angel-gift-cabinet-title">
          <div className="angel-gift-panel-heading"><div><span className="angel-gift-label">Angel&apos;s Gift</span><h2 id="angel-gift-cabinet-title">本期药柜</h2></div><strong>{collectionProgress.collected} <em>/ {collectionProgress.total}</em></strong></div>
          <div className="angel-gift-cabinet-grid">{campaign.cabinet.length ? campaign.cabinet.map((badge) => <div className={`angel-gift-cabinet-item ${badge.locked ? 'is-locked' : ''} ${badge.obtainedAt ? '' : 'is-uncollected'}`} key={badge.id}>{badge.imageUrl ? <Image src={badge.imageUrl} alt={`${badge.name}勋章`} width={78} height={78} unoptimized /> : <span className="angel-gift-locked-mark" aria-hidden="true">?</span>}<strong>{badge.locked ? '尚未收录' : badge.name}</strong><small>{badge.locked ? '隐藏处方' : badge.obtainedAt ? rarityLabels[badge.rarity || 'COMMON'] || badge.rarity || '常规处方' : '尚未收录'}</small>{badge.obtainedAt ? <time dateTime={badge.obtainedAt}>{formatDate(badge.obtainedAt, true)}</time> : null}</div>) : <p className="angel-gift-empty">本期药柜还没有勋章奖品。</p>}</div>
        </section>

        {campaign.probabilityPublic ? <section className="angel-gift-panel angel-gift-prize-panel" aria-labelledby="angel-gift-prizes-title"><div className="angel-gift-panel-heading"><div><span className="angel-gift-label">Prescription Index</span><h2 id="angel-gift-prizes-title">本期处方索引</h2></div></div><div className="angel-gift-prize-list">{campaign.prizes.map((prize) => <div key={prize.id}><span>{prize.badge?.locked ? '???' : prize.name}</span><strong>{prize.probability === null ? '—' : `${prize.probability.toFixed(2)}%`}</strong></div>)}</div></section> : null}

        <section className="angel-gift-panel angel-gift-duplicate-panel" aria-labelledby="angel-gift-duplicate-title"><div className="angel-gift-panel-heading"><div><span className="angel-gift-label">余药库存</span><h2 id="angel-gift-duplicate-title">余药</h2></div><strong>{data.duplicate.total} <em>/ {required || '—'}</em></strong></div><p>{campaign.duplicateRecycleEnabled && required ? data.duplicate.total < required ? `还差 ${required - data.duplicate.total} 份` : `已集齐 ${required} 份，可以回收。` : '本期未开启余药回收。'}</p>{data.duplicate.byBadge.length ? <div className="angel-gift-duplicate-items">{data.duplicate.byBadge.map((entry) => <span key={entry.badgeId}>{entry.imageUrl ? <Image src={entry.imageUrl} alt="" width={22} height={22} unoptimized /> : null}{entry.badgeName} ×{entry.quantity}</span>)}</div> : null}<div className="angel-gift-recycle-all"><p>{data.duplicate.recyclableCount > 0 ? `共 ${data.duplicate.recyclableCount} 枚可回收 · 可获得 ${formatFee(data.duplicate.recyclableReward)} 挂号费` : '暂无可回收余药'}</p><button type="button" className="angel-gift-button primary" disabled={!canRecycleAll} onClick={() => setRecycleAllConfirm(true)}>{recycleBusy ? '回收中…' : '一键回收'}</button></div>{recycleSuccess ? <p className="angel-gift-recycle-success" role="status">{recycleSuccess}</p> : null}<button type="button" className="angel-gift-button secondary" disabled={!canRecycle} onClick={() => void recycle()}>{recycleBusy ? '回收中…' : required ? '回收余药' : '暂不回收'}</button></section>

        {data.isAuthenticated ? <section className="angel-gift-panel angel-gift-history-panel" aria-labelledby="angel-gift-history-title"><div className="angel-gift-panel-heading"><div><span className="angel-gift-label">执药流水</span><h2 id="angel-gift-history-title">执药记录</h2></div></div>{data.history.length ? <div className="angel-gift-history-list">{data.history.map((item) => <div className="angel-gift-history-row" key={`${item.kind}-${item.id}`}><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time><span>{item.kind === 'DRAW' ? `−${item.drawCost || 0} 挂号费` : `余药 ×${item.quantity || 0}`}</span><strong>{item.result || '—'}</strong>{item.kind === 'RECYCLE' ? <em>+{item.rewardAmount || 0} 挂号费</em> : null}</div>)}</div> : <p className="angel-gift-empty">还没有本期执药记录。</p>}{data.historyHasMore ? <button type="button" className="angel-gift-more-button" disabled={historyBusy} onClick={() => void loadMoreHistory()}>{historyBusy ? '加载中…' : '加载更多记录'}</button> : null}</section> : null}
      </> : campaignLoading ? <p className="angel-gift-campaign-loading" role="status" aria-live="polite">正在加载所选主题的奖池与参与记录…</p> : <>{upcomingPreview}<section className="angel-gift-empty-state"><span aria-hidden="true">Rx</span><h2>药房尚未开出本期处方</h2><p>当前暂无正在进行的主题，待开始主题仅作为下期预告展示。</p></section></>}

      {campaignIsDrawing && campaign ? <div className="angel-gift-drawing-live" aria-live="polite">{drawPhases[campaign.id]}</div> : null}
      {drawConfirmation ? <DrawConfirmationModal drawCount={drawConfirmation} campaignComplete={campaignComplete} cost={campaign?.drawCost || 0} onCancel={cancelDrawConfirmation} onConfirm={confirmDraw} /> : null}
      {recycleAllConfirm ? <RecycleAllConfirmationModal recyclableCount={data.duplicate.recyclableCount} recyclableTypeCount={data.duplicate.recyclableTypeCount} rewardAmount={data.duplicate.recyclableReward} onCancel={() => setRecycleAllConfirm(false)} onConfirm={() => { setRecycleAllConfirm(false); void recycleAll() }} /> : null}
      {result && campaign ? <ResultModal draws={result} duplicateTotal={data.duplicate.total} duplicateRequired={data.duplicate.required} cost={campaign.drawCost || result[0].drawCost} onClose={() => setResultsByCampaign((current) => { const next = { ...current }; delete next[campaign.id]; return next })} onContinue={() => { setResultsByCampaign((current) => { const next = { ...current }; delete next[campaign.id]; return next }); requestDraw(1) }} /> : null}
    </section>
  )
}
