'use client'

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { PharmacyDrawView, PharmacyHistoryItem, PharmacyPageData } from '@/lib/pharmacy'

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

function errorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string') return payload.message
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') return payload.error
  return fallback
}

function ResultModal({ draw, duplicateTotal, duplicateRequired, cost, onClose, onContinue }: { draw: PharmacyDrawView; duplicateTotal: number; duplicateRequired: number | null; cost: number; onClose: () => void; onContinue: () => void }) {
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

  const isNew = draw.isNewBadge
  const isDuplicate = draw.isDuplicate
  const isPoints = draw.prizeType === 'POINTS'
  const title = isNew ? '新药入柜' : isDuplicate ? '这味药，你已经有了。' : isPoints ? '药房找零' : '请接收你的药'
  return (
    <div className="angel-gift-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} className="angel-gift-result-modal" role="dialog" aria-modal="true" aria-labelledby="angel-gift-result-title">
        <button ref={closeRef} type="button" className="angel-gift-modal-close" onClick={onClose} aria-label="关闭结果">×</button>
        <p className="angel-gift-modal-kicker">执药记录 · {formatDate(draw.drawAt)}</p>
        <h2 id="angel-gift-result-title">{title}</h2>
        {draw.badge ? <div className={`angel-gift-result-badge ${draw.badge.imageUrl ? '' : 'is-empty'}`}>
          {draw.badge.imageUrl ? <Image src={draw.badge.imageUrl} alt={`${draw.badge.name}勋章`} width={76} height={76} unoptimized /> : <span aria-hidden="true">?</span>}
          <div><strong>{draw.badge.name}</strong><span>{rarityLabels[draw.badge.rarity || 'COMMON'] || draw.badge.rarity || '常规处方'}</span></div>
        </div> : null}
        {isNew ? <p className="angel-gift-result-copy">「{draw.prizeName}」已收入你的勋章药柜。</p> : null}
        {isDuplicate ? <div className="angel-gift-result-copy"><strong>余药 +1</strong><span>当前余药 {duplicateTotal} / {duplicateRequired || '—'}</span><small>{duplicateRequired ? `集齐 ${duplicateRequired} 份余药，可前往药房回收。` : '本期未开启余药回收。'}</small></div> : null}
        {isPoints ? <div className="angel-gift-points-result"><strong>+{formatFee(draw.rewardAmount || 0)} 挂号费</strong>{(draw.rewardAmount || 0) >= cost ? <span>这次的药，算药房请你的。</span> : null}</div> : null}
        <div className="angel-gift-result-balance"><span>本次执药</span><strong>−{formatFee(draw.drawCost)} 挂号费</strong><span>当前挂号费</span><strong>{formatFee(draw.balanceAfter)}</strong></div>
        <div className="angel-gift-modal-actions"><button type="button" className="angel-gift-button secondary" onClick={onClose}>{isNew ? '收下' : '知道了'}</button><button type="button" className="angel-gift-button primary" onClick={onContinue}>继续执药 · {draw.drawCost}</button></div>
      </div>
    </div>
  )
}

export function AngelGiftClient({ initialData }: Props) {
  const [data, setData] = useState(initialData)
  const [drawing, setDrawing] = useState(false)
  const [phase, setPhase] = useState('')
  const [result, setResult] = useState<PharmacyDrawView | null>(null)
  const [error, setError] = useState('')
  const [skipAnimation, setSkipAnimation] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [recycleBusy, setRecycleBusy] = useState(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyPage, setHistoryPage] = useState(1)
  const drawKeyRef = useRef<string | null>(null)
  const recycleKeyRef = useRef<string | null>(null)

  const campaign = data.campaign
  const user = data.user
  const required = data.duplicate.required
  const canRecycle = Boolean(user && campaign?.duplicateRecycleEnabled && required && data.duplicate.total >= required && !recycleBusy)
  const status = campaign?.status || null
  const isLimitReached = Boolean(user && campaign && ((campaign.dailyDrawLimit !== null && user.todayCount >= campaign.dailyDrawLimit) || (campaign.totalDrawLimit !== null && user.totalCount >= campaign.totalDrawLimit)))
  const insufficient = Boolean(user && campaign && user.balance < campaign.drawCost)
  const canDraw = Boolean(campaign && user && status === 'ACTIVE' && campaign.prizePoolValid && !isLimitReached && !insufficient && !drawing)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { setReducedMotion(query.matches); if (query.matches) setSkipAnimation(true) }
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    drawKeyRef.current = null
    recycleKeyRef.current = null
  }, [campaign?.id])

  useEffect(() => {
    if (!drawing) return
    setPhase('正在核对处方……')
    const first = window.setTimeout(() => setPhase('药房正在配药……'), 480)
    const second = window.setTimeout(() => setPhase('请接收你的药。'), 960)
    return () => { window.clearTimeout(first); window.clearTimeout(second) }
  }, [drawing])

  const collectionProgress = useMemo(() => {
    if (!campaign) return { collected: 0, total: 0 }
    return { collected: campaign.cabinet.filter((badge) => !badge.locked && badge.obtainedAt).length, total: campaign.cabinet.length }
  }, [campaign])

  async function reloadPage() {
    const query = campaign ? `?campaignId=${encodeURIComponent(campaign.id)}` : ''
    const response = await fetch(`/api/angel-gift${query}`, { cache: 'no-store' })
    const payload = await response.json().catch(() => null) as { ok?: boolean; data?: PharmacyPageData; message?: string }
    if (!response.ok || !payload.ok || !payload.data) throw new Error(errorMessage(payload, '药房信息暂时无法刷新'))
    setData(payload.data)
    setHistoryPage(1)
  }

  async function draw() {
    if (!campaign || !user || drawing) return
    setError('')
    setDrawing(true)
    const idempotencyKey = drawKeyRef.current || makeIdempotencyKey('draw')
    drawKeyRef.current = idempotencyKey
    const requestStarted = fetch('/api/angel-gift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId: campaign.id, idempotencyKey }),
    })
    const minimumAnimation = skipAnimation || reducedMotion ? Promise.resolve() : new Promise<void>((resolve) => window.setTimeout(resolve, 1500))
    try {
      const [response] = await Promise.all([requestStarted, minimumAnimation])
      const payload = await response.json().catch(() => null) as { ok?: boolean; data?: { draw: PharmacyDrawView; page?: PharmacyPageData | null; duplicateTotal?: number; duplicateRequired?: number | null }; message?: string }
      if (!response.ok || !payload.ok || !payload.data?.draw) throw new Error(errorMessage(payload, '药房暂时无法完成执药，请稍后重试'))
      const nextPage = payload.data.page
      if (nextPage) setData(nextPage)
      else setData((current) => ({ ...current, user: current.user ? { ...current.user, balance: payload.data!.draw.balanceAfter } : current.user, duplicate: { ...current.duplicate, total: payload.data!.duplicateTotal ?? current.duplicate.total, required: payload.data!.duplicateRequired !== undefined ? payload.data!.duplicateRequired : current.duplicate.required } }))
      drawKeyRef.current = null
      setHistoryPage(1)
      setResult(payload.data.draw)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '药房暂时无法完成执药，请稍后重试')
    } finally {
      setDrawing(false)
      setPhase('')
    }
  }

  async function recycle() {
    if (!campaign || !canRecycle) return
    setRecycleBusy(true)
    setError('')
    const idempotencyKey = recycleKeyRef.current || makeIdempotencyKey('recycle')
    recycleKeyRef.current = idempotencyKey
    try {
      const response = await fetch('/api/angel-gift/recycle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId: campaign.id, idempotencyKey }) })
      const payload = await response.json().catch(() => null) as { ok?: boolean; data?: { page?: PharmacyPageData | null; balance?: number; duplicateTotal?: number; duplicateRequired?: number }; message?: string }
      if (!response.ok || !payload.ok) throw new Error(errorMessage(payload, '余药回收暂时无法完成'))
      recycleKeyRef.current = null
      if (payload.data?.page) setData(payload.data.page)
      else {
        setData((current) => ({ ...current, user: current.user && payload.data?.balance !== undefined ? { ...current.user, balance: payload.data.balance } : current.user, duplicate: { ...current.duplicate, total: payload.data?.duplicateTotal ?? current.duplicate.total, required: payload.data?.duplicateRequired ?? current.duplicate.required } }))
        await reloadPage()
      }
      setHistoryPage(1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '余药回收暂时无法完成')
    } finally {
      setRecycleBusy(false)
    }
  }

  async function loadMoreHistory() {
    if (!campaign || historyBusy || !data.historyHasMore) return
    setHistoryBusy(true)
    try {
      const nextPage = historyPage + 1
      const response = await fetch(`/api/angel-gift/history?campaignId=${encodeURIComponent(campaign.id)}&page=${nextPage}&pageSize=10`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null) as { ok?: boolean; data?: { items: PharmacyHistoryItem[]; hasMore: boolean }; message?: string }
      if (!response.ok || !payload.ok || !payload.data) throw new Error(errorMessage(payload, '执药记录暂时无法加载'))
      setData((current) => ({ ...current, history: [...current.history, ...payload.data!.items], historyHasMore: payload.data!.hasMore }))
      setHistoryPage(nextPage)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '执药记录暂时无法加载')
    } finally {
      setHistoryBusy(false)
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

  return (
    <section className="angel-gift-page" aria-labelledby="angel-gift-title">
      <header className="angel-gift-heading">
        <div><p className="angel-gift-kicker">E院药房 / RX</p><h1 id="angel-gift-title">天使的礼物</h1><p>有些药，不写在处方上。</p></div>
        <div className="angel-gift-balance" aria-label="当前挂号费"><span>挂号费</span><strong>{user ? formatFee(user.balance) : '—'}</strong></div>
      </header>

      {!data.isAuthenticated ? <div className="angel-gift-login-note"><span>登录后才能执药、收藏勋章并保留余药。</span><Link href="/login?redirect=%2Fangel-gift">登录后进入药房 →</Link></div> : null}
      {error ? <div className="angel-gift-alert" role="alert">{error}</div> : null}

      {campaign ? <>
        <section className="angel-gift-theme-card" aria-labelledby="angel-gift-theme-title">
          {campaign.visualUrl ? <Image className="angel-gift-theme-visual" src={campaign.visualUrl} alt={`${campaign.title}主题视觉`} width={112} height={76} unoptimized /> : null}
          <div><span className="angel-gift-label">本期主题</span><h2 id="angel-gift-theme-title">{campaign.title}</h2>{campaign.subtitle ? <p className="angel-gift-theme-subtitle">{campaign.subtitle}</p> : null}{campaign.description ? <p className="angel-gift-theme-description">{campaign.description}</p> : null}</div>
          <div className={`angel-gift-status is-${status?.toLowerCase()}`}><span>{status ? statusLabels[status] : '—'}</span>{campaign.endsAt && status !== 'ENDED' ? <small>至 {formatDate(campaign.endsAt)}</small> : null}</div>
        </section>

        <section className={`angel-gift-pharmacy-box ${drawing ? 'is-drawing' : ''}`} aria-label="E院药房">
          <div className="angel-gift-box-stamp">Rx</div><div className="angel-gift-box-mark">E院药房</div><div className="angel-gift-box-name">ANGEL&apos;S GIFT</div><div className="angel-gift-box-cn">天使的礼物</div><div className="angel-gift-box-line" />
          <div className="angel-gift-box-phase" aria-live="polite">{drawing ? phase : '请把手伸进不知道名字的处方里。'}</div>
          <button type="button" className="angel-gift-draw-button" onClick={() => void draw()} disabled={!canDraw} aria-disabled={!canDraw}>{drawing ? '配药中…' : `执药 · ${campaign.drawCost}`}</button>
          <p className="angel-gift-box-note">每次执药消耗 {campaign.drawCost} 挂号费</p>
        </section>

        <div className="angel-gift-controls"><span>{statusHint()}</span><label><input type="checkbox" checked={skipAnimation} onChange={(event) => setSkipAnimation(event.target.checked)} /> 跳过动画</label></div>
        <div className="angel-gift-limits">{campaign.dailyDrawLimit !== null ? <span>今日 {user?.todayCount || 0} / {campaign.dailyDrawLimit}</span> : null}{campaign.totalDrawLimit !== null ? <span>本期 {user?.totalCount || 0} / {campaign.totalDrawLimit}</span> : null}{campaign.probabilityPublic ? <span>本期概率公开</span> : null}</div>

        <section className="angel-gift-panel" aria-labelledby="angel-gift-cabinet-title">
          <div className="angel-gift-panel-heading"><div><span className="angel-gift-label">Angel&apos;s Gift</span><h2 id="angel-gift-cabinet-title">本期药柜</h2></div><strong>{collectionProgress.collected} <em>/ {collectionProgress.total}</em></strong></div>
          <div className="angel-gift-cabinet-grid">{campaign.cabinet.length ? campaign.cabinet.map((badge) => <div className={`angel-gift-cabinet-item ${badge.locked ? 'is-locked' : ''} ${badge.obtainedAt ? '' : 'is-uncollected'}`} key={badge.id}>{badge.imageUrl ? <Image src={badge.imageUrl} alt={`${badge.name}勋章`} width={78} height={78} unoptimized /> : <span className="angel-gift-locked-mark" aria-hidden="true">?</span>}<strong>{badge.locked ? '尚未收录' : badge.name}</strong><small>{badge.locked ? '隐藏处方' : badge.obtainedAt ? rarityLabels[badge.rarity || 'COMMON'] || badge.rarity || '常规处方' : '尚未收录'}</small>{badge.obtainedAt ? <time dateTime={badge.obtainedAt}>{formatDate(badge.obtainedAt, true)}</time> : null}</div>) : <p className="angel-gift-empty">本期药柜还没有勋章奖品。</p>}</div>
        </section>

        {campaign.probabilityPublic ? <section className="angel-gift-panel angel-gift-prize-panel" aria-labelledby="angel-gift-prizes-title"><div className="angel-gift-panel-heading"><div><span className="angel-gift-label">Prescription Index</span><h2 id="angel-gift-prizes-title">本期处方索引</h2></div></div><div className="angel-gift-prize-list">{campaign.prizes.map((prize) => <div key={prize.id}><span>{prize.badge?.locked ? '???' : prize.name}</span><strong>{prize.probability === null ? '—' : `${prize.probability.toFixed(2)}%`}</strong></div>)}</div></section> : null}

        <section className="angel-gift-panel angel-gift-duplicate-panel" aria-labelledby="angel-gift-duplicate-title"><div className="angel-gift-panel-heading"><div><span className="angel-gift-label">余药库存</span><h2 id="angel-gift-duplicate-title">余药</h2></div><strong>{data.duplicate.total} <em>/ {required || '—'}</em></strong></div><p>{campaign.duplicateRecycleEnabled && required ? data.duplicate.total < required ? `还差 ${required - data.duplicate.total} 份` : `已集齐 ${required} 份，可以回收。` : '本期未开启余药回收。'}</p>{data.duplicate.byBadge.length ? <div className="angel-gift-duplicate-items">{data.duplicate.byBadge.map((entry) => <span key={entry.badgeId}>{entry.imageUrl ? <Image src={entry.imageUrl} alt="" width={22} height={22} unoptimized /> : null}{entry.badgeName} ×{entry.quantity}</span>)}</div> : null}<button type="button" className="angel-gift-button primary" disabled={!canRecycle} onClick={() => void recycle()}>{recycleBusy ? '回收中…' : required ? '回收余药' : '暂不回收'}</button></section>

        {data.isAuthenticated ? <section className="angel-gift-panel angel-gift-history-panel" aria-labelledby="angel-gift-history-title"><div className="angel-gift-panel-heading"><div><span className="angel-gift-label">执药流水</span><h2 id="angel-gift-history-title">执药记录</h2></div></div>{data.history.length ? <div className="angel-gift-history-list">{data.history.map((item) => <div className="angel-gift-history-row" key={`${item.kind}-${item.id}`}><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time><span>{item.kind === 'DRAW' ? `−${item.drawCost || 0} 挂号费` : `余药 ×${item.quantity || 0}`}</span><strong>{item.result || '—'}</strong>{item.kind === 'RECYCLE' ? <em>+{item.rewardAmount || 0} 挂号费</em> : null}</div>)}</div> : <p className="angel-gift-empty">还没有本期执药记录。</p>}{data.historyHasMore ? <button type="button" className="angel-gift-more-button" disabled={historyBusy} onClick={() => void loadMoreHistory()}>{historyBusy ? '加载中…' : '加载更多记录'}</button> : null}</section> : null}
      </> : <section className="angel-gift-empty-state"><span aria-hidden="true">Rx</span><h2>药房尚未开出本期处方</h2><p>管理员配置主题后，这里会显示当前正在进行的主题。</p></section>}

      {drawing ? <div className="angel-gift-drawing-live" aria-live="polite">{phase}</div> : null}
      {result ? <ResultModal draw={result} duplicateTotal={data.duplicate.total} duplicateRequired={data.duplicate.required} cost={campaign?.drawCost || result.drawCost} onClose={() => setResult(null)} onContinue={() => { setResult(null); void draw() }} /> : null}
    </section>
  )
}
