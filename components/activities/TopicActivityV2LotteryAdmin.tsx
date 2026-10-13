'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityImageUploader, uploadActivityImage, type ActivityImageSelection } from '@/components/activities/ActivityImageUploader'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useTopicActivityV2LotteryVisibleRefresh } from '@/components/activities/TopicActivityV2LotteryPolling'
import {
  defaultTopicLotteryConfig,
  normalizeTopicLotteryConfig,
  type TopicLotteryConfig,
  type TopicLotteryPrizeConfig,
} from '@/lib/topic-activity-v2-lottery-config'
import {
  booleanOr,
  isRecord,
  numberOr,
  stringOr,
  type TopicLotteryAddress,
  type TopicLotteryAddressPayload,
  type TopicLotteryAdminPayload,
  type TopicLotteryDrawView,
  type TopicLotteryEntrySource,
  type TopicLotteryWinnerSummary,
} from '@/components/activities/TopicActivityV2LotteryTypes'

const inputClass = 'mt-1 min-h-10 w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 text-sm disabled:opacity-50'
const buttonClass = 'min-h-9 rounded-sm border border-[var(--border)] px-3 text-sm font-bold disabled:opacity-40'

function uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `prize-${crypto.randomUUID().replaceAll('-', '')}`
  return `prize-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
}

function localTime(value: string | null | undefined) {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? new Date(parsed.getTime() + 8 * 3600_000).toISOString().slice(0, 16) : value
}

function dateLabel(value: string | null | undefined) {
  if (!value) return '待定'
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : value
}

function stateLabel(value: string) {
  return ({ DISABLED: '未启用', NOT_STARTED: '尚未开始', COLLECTING: '资格收集中', WAITING_REVIEW: '等待审核', WAITING_DRAW: '等待开奖', READY_TO_DRAW: '可以开奖', FROZEN: '资格已锁定', DRAWING: '开奖处理中', DRAWN: '已开奖', FAILED: '开奖失败', CANCELLED: '已关闭' } as Record<string, string>)[value] || value
}

function readWinner(value: unknown): TopicLotteryWinnerSummary | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  return {
    id: value.id,
    nickname: stringOr(value.nickname, '匿名用户'),
    uid: stringOr(value.uid, '—'),
    prizeName: stringOr(value.prizeName, '中奖奖品'),
    wonAt: typeof value.wonAt === 'string' ? value.wonAt : null,
    addressDeadline: typeof value.addressDeadline === 'string' ? value.addressDeadline : null,
    addressSaved: booleanOr(value.addressSaved),
    shippingStatus: stringOr(value.shippingStatus, 'WAITING_ADDRESS'),
    shippedAt: typeof value.shippedAt === 'string' ? value.shippedAt : null,
  }
}

function readDraw(value: unknown): TopicLotteryDrawView | null {
  if (!isRecord(value)) return null
  return {
    id: typeof value.id === 'string' ? value.id : undefined,
    state: stringOr(value.state, 'FROZEN'),
    candidateCount: numberOr(value.candidateCount),
    winnerCount: numberOr(value.winnerCount),
    frozenAt: typeof value.frozenAt === 'string' ? value.frozenAt : null,
    drawnAt: typeof value.drawnAt === 'string' ? value.drawnAt : null,
    errorCode: typeof value.errorCode === 'string' ? value.errorCode : typeof value.failedReason === 'string' ? value.failedReason : null,
    failedReason: typeof value.failedReason === 'string' ? value.failedReason : null,
  }
}

function readAdminPayload(value: unknown): TopicLotteryAdminPayload | null {
  if (!isRecord(value)) return null
  if (!('configLocked' in value) && !('state' in value) && !('candidateCount' in value) && !('winners' in value) && !('canShip' in value)) return null
  return {
    config: value.config,
    configLocked: booleanOr(value.configLocked),
    state: stringOr(value.state, 'COLLECTING'),
    candidateCount: numberOr(value.candidateCount),
    pendingSubmissionCount: numberOr(value.pendingSubmissionCount),
    canShip: booleanOr(value.canShip),
    addressEncryptionReady: booleanOr(value.addressEncryptionReady),
    winners: Array.isArray(value.winners) ? value.winners.flatMap((item) => { const winner = readWinner(item); return winner ? [winner] : [] }) : [],
    draw: value.draw === null || value.draw === undefined ? null : readDraw(value.draw),
  }
}

function readAddressPayload(value: unknown): TopicLotteryAddressPayload | null {
  if (!isRecord(value) || !isRecord(value.winner)) return null
  const winner = value.winner
  const address = isRecord(value.address) ? {
    recipient: stringOr(value.address.recipient),
    phone: stringOr(value.address.phone),
    province: stringOr(value.address.province),
    city: stringOr(value.address.city),
    district: stringOr(value.address.district),
    address: stringOr(value.address.address),
    remark: stringOr(value.address.remark),
  } satisfies TopicLotteryAddress : null
  const shipment = isRecord(value.shipment) ? {
    carrier: typeof value.shipment.carrier === 'string' ? value.shipment.carrier : null,
    trackingNumber: typeof value.shipment.trackingNumber === 'string' ? value.shipment.trackingNumber : null,
  } : null
  return {
    winner: { id: stringOr(winner.id), prizeName: stringOr(winner.prizeName, '中奖奖品'), addressDeadline: typeof winner.addressDeadline === 'string' ? winner.addressDeadline : null, shippingStatus: stringOr(winner.shippingStatus, 'WAITING_ADDRESS') },
    address,
    shipment,
  }
}

function imageMapUpdate(current: Record<string, 'uploading' | 'success' | 'error'>, id: string, status: 'uploading' | 'success' | 'error') {
  return { ...current, [id]: status }
}

export function TopicActivityV2LotteryAdmin({ activityId, entries, disabled = false }: { activityId: string; entries: readonly TopicLotteryEntrySource[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [drawLoading, setDrawLoading] = useState(false)
  const [config, setConfig] = useState<TopicLotteryConfig>(defaultTopicLotteryConfig)
  const [configLocked, setConfigLocked] = useState(false)
  const [state, setState] = useState('COLLECTING')
  const [candidateCount, setCandidateCount] = useState(0)
  const [pendingSubmissionCount, setPendingSubmissionCount] = useState(0)
  const [addressEncryptionReady, setAddressEncryptionReady] = useState(false)
  const [canShip, setCanShip] = useState(false)
  const [winners, setWinners] = useState<TopicLotteryWinnerSummary[]>([])
  const [draw, setDraw] = useState<TopicLotteryDrawView | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [imageStatuses, setImageStatuses] = useState<Record<string, 'uploading' | 'success' | 'error'>>({})
  const [confirmDraw, setConfirmDraw] = useState(false)
  const [confirmDeletePii, setConfirmDeletePii] = useState(false)
  const [selectedWinnerId, setSelectedWinnerId] = useState<string | null>(null)
  const [addressLoading, setAddressLoading] = useState(false)
  const [addressPayload, setAddressPayload] = useState<TopicLotteryAddressPayload | null>(null)
  const [shipmentDraft, setShipmentDraft] = useState({ carrier: '', trackingNumber: '' })
  const [shipmentLoading, setShipmentLoading] = useState(false)
  const busy = useRef(false)
  const loadBusy = useRef(false)
  const addressBusy = useRef(false)
  const base = '/api/admin/activities/' + encodeURIComponent(activityId) + '/v2/lottery'
  const locked = disabled || saving
  const fairRulesLocked = locked || configLocked
  const imageUploading = Object.values(imageStatuses).some((status) => status === 'uploading')
  const sortedEntries = useMemo(() => [...entries].sort((a, b) => a.id.localeCompare(b.id)), [entries])

  const applyPayload = useCallback((payload: TopicLotteryAdminPayload) => {
    try {
      setConfig(normalizeTopicLotteryConfig(payload.config))
    } catch {
      throw new Error('抽奖配置格式不可用')
    }
    setConfigLocked(payload.configLocked)
    setState(payload.state)
    setCandidateCount(payload.candidateCount)
    setPendingSubmissionCount(payload.pendingSubmissionCount)
    setAddressEncryptionReady(payload.addressEncryptionReady)
    setCanShip(payload.canShip)
    setWinners(payload.winners)
    setDraw(payload.draw || null)
  }, [])

  const load = useCallback(async () => {
    if (loadBusy.current) return
    loadBusy.current = true
    setLoading(true)
    setError('')
    try {
      const response = await fetch(base, { credentials: 'same-origin', cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(isRecord(body) && typeof body.message === 'string' ? body.message : '抽奖配置加载失败')
      const payload = readAdminPayload(body)
      if (!payload) throw new Error('抽奖配置格式不可用')
      applyPayload(payload)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '抽奖配置加载失败')
    } finally {
      setLoading(false)
      loadBusy.current = false
    }
  }, [applyPayload, base])

  useEffect(() => {
    if (open) void load()
  }, [load, open])
  useTopicActivityV2LotteryVisibleRefresh({ enabled: open && !disabled, state: open ? state : null, onRefresh: load })

  function patchConfig(update: Partial<TopicLotteryConfig>) {
    setConfig((current) => ({ ...current, ...update }))
  }

  function patchPrize(id: string, update: Partial<TopicLotteryPrizeConfig>) {
    setConfig((current) => ({ ...current, prizes: current.prizes.map((prize) => prize.id === id ? { ...prize, ...update } : prize) }))
  }

  function addPrize() {
    setConfig((current) => ({ ...current, prizes: [...current.prizes, { id: uid(), name: '', description: '', imageUrl: null, quantity: 1, sortOrder: current.prizes.length }] }))
  }

  function removePrize(id: string) {
    setConfig((current) => ({ ...current, prizes: current.prizes.filter((prize) => prize.id !== id).map((prize, index) => ({ ...prize, sortOrder: index })) }))
    setImageStatuses((current) => { const next = { ...current }; delete next[id]; return next })
  }

  async function onPrizeImage(id: string, selection: ActivityImageSelection) {
    if (selection.removed) {
      patchPrize(id, { imageUrl: null })
      setImageStatuses((current) => { const next = { ...current }; delete next[id]; return next })
      return
    }
    if (!selection.file) return
    setImageStatuses((current) => imageMapUpdate(current, id, 'uploading'))
    setError('')
    try {
      const url = await uploadActivityImage(selection.file)
      setConfig((current) => current.prizes.some((prize) => prize.id === id) ? { ...current, prizes: current.prizes.map((prize) => prize.id === id ? { ...prize, imageUrl: url } : prize) } : current)
      setImageStatuses((current) => imageMapUpdate(current, id, 'success'))
    } catch (cause) {
      setImageStatuses((current) => imageMapUpdate(current, id, 'error'))
      setError(cause instanceof Error ? cause.message : '奖品图片上传失败')
    }
  }

  async function save() {
    if (busy.current || locked || imageUploading) return
    if (config.enabled && !addressEncryptionReady) {
      setError('收件资料加密未配置，暂不可启用实物抽奖')
      return
    }
    busy.current = true
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(base, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(isRecord(body) && typeof body.message === 'string' ? body.message : '抽奖配置保存失败')
      const payload = readAdminPayload(body)
      if (payload) applyPayload(payload)
      else if (isRecord(body) && body.config !== undefined) setConfig(normalizeTopicLotteryConfig(body.config))
      setMessage('实物抽奖配置已保存。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '抽奖配置保存失败')
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  async function drawNow() {
    if (drawLoading || disabled) return
    setDrawLoading(true)
    setError('')
    try {
      const response = await fetch(base + '/draw', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(isRecord(body) && typeof body.message === 'string' ? body.message : '开奖失败，请稍后重试')
      setConfirmDraw(false)
      setMessage('开奖已确认，结果正在刷新。')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '开奖失败，请稍后重试')
    } finally {
      setDrawLoading(false)
    }
  }

  async function openAddress(winnerId: string) {
    if (!canShip || addressBusy.current) return
    addressBusy.current = true
    setSelectedWinnerId(winnerId)
    setAddressLoading(true)
    setError('')
    try {
      const response = await fetch(base + '/winners/' + encodeURIComponent(winnerId) + '/address', { credentials: 'same-origin', cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(isRecord(body) && typeof body.message === 'string' ? body.message : '收货信息加载失败')
      const value = readAddressPayload(body)
      if (!value) throw new Error('收货信息格式不可用')
      setAddressPayload(value)
      setShipmentDraft({ carrier: value.shipment?.carrier || '', trackingNumber: value.shipment?.trackingNumber || '' })
    } catch (cause) {
      setAddressPayload(null)
      setError(cause instanceof Error ? cause.message : '收货信息加载失败')
    } finally {
      addressBusy.current = false
      setAddressLoading(false)
    }
  }

  async function shipment(action: 'SHIP' | 'DELIVER' | 'EXCEPTION' | 'DELETE_PII') {
    if (!selectedWinnerId || shipmentLoading) return
    setShipmentLoading(true)
    setError('')
    try {
      const response = await fetch(base + '/winners/' + encodeURIComponent(selectedWinnerId) + '/shipment', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(action === 'SHIP' ? { carrier: shipmentDraft.carrier, trackingNumber: shipmentDraft.trackingNumber } : {}) }) })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(isRecord(body) && typeof body.message === 'string' ? body.message : '物流状态更新失败')
      setConfirmDeletePii(false)
      setMessage(action === 'DELETE_PII' ? '收货信息已按保留规则删除。' : '物流状态已更新。')
      await load()
      if (action === 'DELETE_PII') { setAddressPayload((current) => current ? { ...current, address: null, shipment: null } : current) }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '物流状态更新失败')
    } finally {
      setShipmentLoading(false)
    }
  }

  const sourceIds = new Set(config.sourceEntryIds)
  const staleSourceIds = config.sourceEntryIds.filter((id) => !entries.some((entry) => entry.id === id))
  return <section className="mt-5 border border-[var(--border)] bg-[var(--surface)] p-4">
    <ConfirmDialog open={confirmDraw} title="确认开奖？" description={`开奖会锁定候选资格和奖品库存，当前候选 ${candidateCount} 人、待审核提交 ${pendingSubmissionCount} 条。确认后不能重抽或取消中奖。`} confirmLabel="确认开奖" loading={drawLoading} error={error} onCancel={() => { if (!drawLoading) setConfirmDraw(false) }} onConfirm={() => void drawNow()} />
    <ConfirmDialog open={confirmDeletePii} title="确认删除收货信息？" description="删除后仅保留必要的履约状态，不能恢复收货地址。" confirmLabel="删除收货信息" loading={shipmentLoading} error={error} onCancel={() => { if (!shipmentLoading) setConfirmDeletePii(false) }} onConfirm={() => void shipment('DELETE_PII')} />
    <button type="button" className={buttonClass} disabled={disabled || saving} onClick={() => setOpen((current) => !current)}>{open ? '收起实物抽奖配置' : '实物抽奖配置'}</button>
      {open ? <div className="mt-4 space-y-5">
      {loading && !config ? <p role="status">正在加载抽奖配置…</p> : null}
      <div className="flex flex-wrap items-center gap-3 border border-[var(--border)] p-3 text-sm"><p>状态：<span className="font-bold">{stateLabel(state)}</span></p><p>候选资格：<span className="font-bold">{candidateCount}</span></p><p>待审核提交：<span className="font-bold">{pendingSubmissionCount}</span></p>{configLocked ? <span className="border border-amber-500 px-2 py-1 text-xs font-bold text-amber-700">资格与库存已锁定</span> : null}</div>
      {!addressEncryptionReady ? <p role="alert" className="border border-amber-500 p-3 text-sm text-amber-700">收件资料加密未配置，暂不可启用实物抽奖</p> : null}
      <fieldset disabled={locked} className="space-y-5">
        <div className="space-y-3 border border-[var(--border)] p-3"><h3 className="font-bold">基础设置</h3><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={config.enabled} disabled={fairRulesLocked || (!addressEncryptionReady && !config.enabled)} onChange={(event) => patchConfig({ enabled: event.target.checked })} />启用实物抽奖（旧活动默认关闭）</label><label className="block text-sm">抽奖标题<input className={inputClass} value={config.title} onChange={(event) => patchConfig({ title: event.target.value })} /></label><label className="block text-sm">抽奖说明<textarea className={inputClass + ' p-2'} rows={3} value={config.description} onChange={(event) => patchConfig({ description: event.target.value })} /></label><div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">开奖方式<select className={inputClass} value={config.mode} disabled={fairRulesLocked} onChange={(event) => patchConfig({ mode: event.target.value as TopicLotteryConfig['mode'] })}><option value="MANUAL">管理员确认开奖</option><option value="AUTO">按时间自动开奖</option></select></label><label className="block text-sm">保留天数<input className={inputClass} type="number" min={1} max={365} value={config.retentionDays} onChange={(event) => patchConfig({ retentionDays: Number(event.target.value) })} /></label><label className="block text-sm">资格截止（北京时间）<input className={inputClass} type="datetime-local" disabled={fairRulesLocked} value={localTime(config.eligibilityDeadline)} onChange={(event) => patchConfig({ eligibilityDeadline: event.target.value || null })} /></label><label className="block text-sm">开奖时间（北京时间）<input className={inputClass} type="datetime-local" disabled={fairRulesLocked} value={localTime(config.drawAt)} onChange={(event) => patchConfig({ drawAt: event.target.value || null })} /></label><label className="block text-sm">收件截止（北京时间）<input className={inputClass} type="datetime-local" disabled={fairRulesLocked} value={localTime(config.addressDeadline)} onChange={(event) => patchConfig({ addressDeadline: event.target.value || null })} /></label></div><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={config.publishWinners} onChange={(event) => patchConfig({ publishWinners: event.target.checked })} />开奖后公开中奖名单（仅昵称、E院ID和奖品）</label>{configLocked ? <p className="text-xs text-amber-700">已有参与资格，公平规则、资格来源和奖品库存不可修改；展示说明与公开名单设置仍可调整。</p> : null}</div>
        <div className="space-y-3 border border-[var(--border)] p-3"><h3 className="font-bold">资格来源</h3><p className="text-xs text-[var(--foreground-muted)]">勾选现有 V2 平台入口作为资格来源；同一用户多个入口只计一次。</p>{sortedEntries.length ? <div className="grid gap-2 sm:grid-cols-2">{sortedEntries.map((entry) => { const screenshotsReady = Number.isFinite(entry.maxImages) && entry.maxImages >= 1; return <label key={entry.id} className="flex min-w-0 items-start gap-2 border border-[var(--border)] p-2 text-sm"><input type="checkbox" className="mt-1" aria-label={`选择资格来源：${entry.platformName} · ${entry.title || '未命名入口'}`} disabled={fairRulesLocked || !entry.enabled || !screenshotsReady} checked={sourceIds.has(entry.id)} onChange={(event) => patchConfig({ sourceEntryIds: event.target.checked ? [...config.sourceEntryIds, entry.id] : config.sourceEntryIds.filter((id) => id !== entry.id) })} /><span className="min-w-0 break-words">{entry.platformName} · {entry.title || '未命名入口'}{!entry.enabled ? <span className="ml-1 text-xs text-[var(--foreground-muted)]">（已停用）</span> : null}{!screenshotsReady ? <span className="ml-1 text-xs text-amber-700">（需至少1张截图，不能作为抽奖资格来源）</span> : null}</span></label> })}</div> : <p className="text-sm text-[var(--foreground-muted)]">当前没有可选择的平台入口，请先配置 V2 平台奖励入口。</p>}{staleSourceIds.length ? <p className="text-xs text-amber-700">已有来源入口不在当前编辑列表中：{staleSourceIds.join('、')}</p> : null}</div>
        <div className="space-y-3 border border-[var(--border)] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">实物奖品与库存</h3><p className="text-xs text-[var(--foreground-muted)]">奖品编号由界面创建并保持稳定；开奖后不能重抽、取消中奖或修改库存。</p></div><button type="button" className={buttonClass} disabled={fairRulesLocked} onClick={addPrize}>添加奖品</button></div>{config.prizes.length ? <div className="space-y-3">{config.prizes.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((prize, index) => <article key={prize.id} className="space-y-3 border border-[var(--border)] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold">奖品 {index + 1}</h4><button type="button" className={buttonClass} disabled={fairRulesLocked} onClick={() => removePrize(prize.id)}>移除奖品</button></div><div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">奖品名称<input className={inputClass} disabled={fairRulesLocked} value={prize.name} onChange={(event) => patchPrize(prize.id, { name: event.target.value })} /></label><label className="block text-sm">数量<input className={inputClass} type="number" min={1} max={1000} disabled={fairRulesLocked} value={prize.quantity} onChange={(event) => patchPrize(prize.id, { quantity: Number(event.target.value) })} /></label></div><label className="block text-sm">奖品说明<textarea className={inputClass + ' p-2'} rows={2} disabled={fairRulesLocked} value={prize.description} onChange={(event) => patchPrize(prize.id, { description: event.target.value })} /></label><ActivityImageUploader label="奖品图片（公开资源）" initialUrl={prize.imageUrl} disabled={fairRulesLocked || imageUploading} status={imageStatuses[prize.id] === 'uploading' ? 'uploading' : imageStatuses[prize.id] === 'error' ? 'error' : imageStatuses[prize.id] === 'success' ? 'success' : 'idle'} onSelectionChange={(selection) => void onPrizeImage(prize.id, selection)} /><p className="break-all text-xs text-[var(--foreground-muted)]">奖品编号：{prize.id}</p></article>)}</div> : <p className="text-sm text-[var(--foreground-muted)]">尚未配置奖品。</p>}</div>
        <button type="button" className={buttonClass} disabled={locked || imageUploading} onClick={() => void save()}>{saving ? '保存中…' : imageUploading ? '图片上传中…' : '保存实物抽奖配置'}</button>
      </fieldset>
      {state !== 'DRAWN' && state !== 'CANCELLED' ? <div className="space-y-2 border-t border-[var(--border)] pt-4"><h3 className="font-bold">开奖操作</h3><p className="text-xs text-[var(--foreground-muted)]">确认开奖会冻结资格快照和奖品库存，系统不会提供重抽或取消中奖。</p><button type="button" className={buttonClass} disabled={disabled || drawLoading || state === 'DRAWING' || state === 'FAILED'} onClick={() => setConfirmDraw(true)}>{drawLoading ? '开奖中…' : '确认开奖'}</button></div> : null}
      {draw ? <p className="text-xs text-[var(--foreground-muted)]">候选快照：{draw.candidateCount} 人 · 中奖名额：{draw.winnerCount} · {draw.failedReason || draw.errorCode ? `失败原因：${draw.failedReason || draw.errorCode}` : draw.drawnAt ? `开奖完成：${dateLabel(draw.drawnAt)}` : `冻结时间：${dateLabel(draw.frozenAt)}`}</p> : null}
      <section className="space-y-3 border-t border-[var(--border)] pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">中奖记录</h3><span className="text-xs text-[var(--foreground-muted)]">{winners.length} 人</span></div>{winners.length ? <div className="space-y-2">{winners.map((winner) => <article key={winner.id} className="space-y-2 border border-[var(--border)] p-3"><div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><p className="min-w-0 break-words text-sm font-bold">{winner.nickname}（{winner.uid}） · {winner.prizeName}</p><span className="shrink-0 text-xs">{winner.shippingStatus}</span></div><p className="text-xs text-[var(--foreground-muted)]">中奖：{dateLabel(winner.wonAt)} · 收件截止：{dateLabel(winner.addressDeadline)} · 地址{winner.addressSaved ? '已提交' : '未提交'}</p>{canShip ? <button type="button" className={buttonClass} disabled={addressLoading && selectedWinnerId === winner.id} onClick={() => void openAddress(winner.id)}>{addressLoading && selectedWinnerId === winner.id ? '加载中…' : selectedWinnerId === winner.id && addressPayload ? '刷新收货信息' : '查看收货信息'}</button> : null}</article>)}</div> : <p className="text-sm text-[var(--foreground-muted)]">开奖后将在这里显示脱敏中奖状态。{canShip ? '' : '当前账号没有 activity_lottery_shipping 权限，收货信息入口已隐藏。'}</p>}</section>
      {canShip && selectedWinnerId ? <section role="dialog" aria-label="收货信息详情" className="space-y-3 border border-amber-400 bg-[var(--surface)] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold">收货信息详情</h3><p className="text-xs text-[var(--foreground-muted)]">仅当前管理员显式查看；不会出现在公开名单、通知或日志。</p></div><button type="button" className={buttonClass} onClick={() => { setSelectedWinnerId(null); setAddressPayload(null) }}>关闭</button></div>{addressLoading ? <p role="status" className="text-sm">正在加载收货信息…</p> : addressPayload ? <>{addressPayload.address ? <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-xs text-[var(--foreground-muted)]">收件人</dt><dd>{addressPayload.address.recipient}</dd></div><div><dt className="text-xs text-[var(--foreground-muted)]">联系电话</dt><dd>{addressPayload.address.phone}</dd></div><div><dt className="text-xs text-[var(--foreground-muted)]">省市区</dt><dd>{[addressPayload.address.province, addressPayload.address.city, addressPayload.address.district].filter(Boolean).join(' ')}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-[var(--foreground-muted)]">详细地址</dt><dd className="break-words">{addressPayload.address.address}</dd></div>{addressPayload.address.remark ? <div className="sm:col-span-2"><dt className="text-xs text-[var(--foreground-muted)]">备注</dt><dd className="break-words">{addressPayload.address.remark}</dd></div> : null}</dl> : <p className="text-sm">用户尚未提交地址，或地址已按保留规则删除。</p>}<div className="border-t border-[var(--border)] pt-3"><p className="text-sm font-bold">物流：{addressPayload.shipment?.carrier || '未填写'} {addressPayload.shipment?.trackingNumber || ''}</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="block text-sm">承运商<input className={inputClass} value={shipmentDraft.carrier} onChange={(event) => setShipmentDraft((current) => ({ ...current, carrier: event.target.value }))} disabled={shipmentLoading} /></label><label className="block text-sm">运单号<input className={inputClass} value={shipmentDraft.trackingNumber} onChange={(event) => setShipmentDraft((current) => ({ ...current, trackingNumber: event.target.value }))} disabled={shipmentLoading} /></label></div><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={shipmentLoading || !shipmentDraft.carrier.trim() || !shipmentDraft.trackingNumber.trim()} onClick={() => void shipment('SHIP')}>标记已发货</button><button type="button" className={buttonClass} disabled={shipmentLoading} onClick={() => void shipment('DELIVER')}>标记已送达</button><button type="button" className={buttonClass} disabled={shipmentLoading} onClick={() => void shipment('EXCEPTION')}>标记异常</button><button type="button" className={buttonClass} disabled={shipmentLoading || !addressPayload.address} onClick={() => setConfirmDeletePii(true)}>删除收货信息</button></div></div></> : null}</section> : null}
      {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}{message ? <p role="status" className="text-sm">{message}</p> : null}
    </div> : null}
  </section>
}
