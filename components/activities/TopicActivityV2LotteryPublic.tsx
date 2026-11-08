'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { defaultTopicLotteryConfig, normalizeTopicLotteryConfigForRead, resolveTopicLotteryPrizeImageSrc, type TopicLotteryConfig } from '@/lib/topic-activity-v2-lottery-config'
import { useTopicActivityV2LotteryVisibleRefresh } from '@/components/activities/TopicActivityV2LotteryPolling'
import {
  booleanOr,
  isRecord,
  numberOr,
  stringOr,
  type TopicLotteryPublicPayload,
} from '@/components/activities/TopicActivityV2LotteryTypes'

const buttonClass = 'min-h-10 rounded-sm border border-[var(--border)] px-3 text-sm font-bold disabled:opacity-40'
/** Winners are paginated in the browser so long lists stay readable. */
const WINNERS_PER_PAGE = 20

function readConfig(value: unknown): TopicLotteryConfig {
  try {
    return normalizeTopicLotteryConfigForRead(value)
  } catch {
    return defaultTopicLotteryConfig()
  }
}

function readPayload(value: unknown): TopicLotteryPublicPayload | null {
  if (!isRecord(value)) return null
  const winnerValue = isRecord(value.myWinner) ? value.myWinner : null
  const prizeValue = winnerValue && isRecord(winnerValue.prize) ? winnerValue.prize : null
  const winners = Array.isArray(value.winners)
    ? value.winners.flatMap((item) => {
      if (!isRecord(item)) return []
      return [{
        nickname: stringOr(item.nickname, '匿名用户'),
        uid: stringOr(item.uid),
        avatarUrl: typeof item.avatarUrl === 'string' ? item.avatarUrl : null,
        prizeName: stringOr(item.prizeName, '中奖奖品'),
        wonAt: typeof item.wonAt === 'string' ? item.wonAt : null,
      }]
    })
    : []
  const drawValue = isRecord(value.draw) ? value.draw : null
  const draw = drawValue ? {
    id: stringOr(drawValue.id),
    state: stringOr(drawValue.state, 'DRAWN'),
    frozenAt: typeof drawValue.frozenAt === 'string' ? drawValue.frozenAt : null,
    drawnAt: typeof drawValue.drawnAt === 'string' ? drawValue.drawnAt : null,
    candidateCount: numberOr(drawValue.candidateCount),
    winnerCount: numberOr(drawValue.winnerCount),
    errorCode: typeof drawValue.errorCode === 'string' ? drawValue.errorCode : null,
  } : null
  return {
    enabled: booleanOr(value.enabled),
    config: value.config,
    state: stringOr(value.state, 'COLLECTING'),
    candidateCount: numberOr(value.candidateCount),
    myStatus: stringOr(value.myStatus, 'LOGIN_REQUIRED'),
    myEligibility: typeof value.myEligibility === 'boolean'
      ? value.myEligibility
      : isRecord(value.myEligibility) && typeof value.myEligibility.count === 'number'
        ? { count: value.myEligibility.count }
        : null,
    myWinner: winnerValue && prizeValue && typeof winnerValue.id === 'string'
      ? {
        id: winnerValue.id,
        prize: {
          name: stringOr(prizeValue.name, '中奖奖品'),
          imageUrl: resolveTopicLotteryPrizeImageSrc(prizeValue.imageUrl),
          description: stringOr(prizeValue.description),
        },
        wonAt: typeof winnerValue.wonAt === 'string' ? winnerValue.wonAt : null,
        addressDeadline: typeof winnerValue.addressDeadline === 'string' ? winnerValue.addressDeadline : null,
        shippingStatus: stringOr(winnerValue.shippingStatus, 'WAITING_ADDRESS'),
        addressSaved: booleanOr(winnerValue.addressSaved),
        claimUrl: typeof winnerValue.claimUrl === 'string' ? winnerValue.claimUrl : null,
      }
      : null,
    winners,
    draw,
  }
}

function dateLabel(value: string | null | undefined) {
  if (!value) return '待定'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : value
}

function stateLabel(state: string) {
  return ({
    DISABLED: '未启用',
    NOT_STARTED: '尚未开始',
    COLLECTING: '资格收集中',
    WAITING_REVIEW: '等待审核',
    WAITING_DRAW: '等待开奖',
    READY_TO_DRAW: '可以开奖',
    READY: '等待开奖',
    FROZEN: '资格已锁定',
    DRAWING: '开奖处理中',
    DRAWN: '已开奖',
    FAILED: '开奖失败',
    CANCELLED: '已关闭',
  } as Record<string, string>)[state] || state
}

function statusLabel(status: string) {
  return ({
    LOGIN_REQUIRED: '登录后才能查看你的资格和中奖结果。',
    NOT_ENABLED: '本次抽奖未启用。',
    NOT_ELIGIBLE: '暂未获得本次抽奖资格。',
    ELIGIBLE: '你已获得本次抽奖资格，每个用户仅计一次。',
    SUBMITTED_PENDING: '资格正在核对中，每个用户仅计一次。',
    MISSED_DEADLINE: '资格截止时间已过，暂未获得本次抽奖资格。',
    WON: '恭喜中奖，请在收件截止前提交收货信息。',
    NOT_WON: '本次未中奖，感谢参与。',
    PENDING: '资格正在核对中，每个用户仅计一次。',
    WINNER: '恭喜中奖，请在收件截止前提交收货信息。',
    NOT_WINNER: '本次未中奖，感谢参与。',
  } as Record<string, string>)[status] || ''
}

function safeClaimUrl(value: string | null) {
  return value && value.startsWith('/activities/') && !value.includes('://') ? value : null
}

export function TopicActivityV2LotteryPublic({ activityId, isAuthenticated = false }: { activityId: string; isAuthenticated?: boolean }) {
  const [payload, setPayload] = useState<TopicLotteryPublicPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [winnerPage, setWinnerPage] = useState(1)
  const requestBusy = useRef(false)
  const load = useCallback(async () => {
    if (requestBusy.current) return
    requestBusy.current = true
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/activities/' + encodeURIComponent(activityId) + '/v2/lottery', { credentials: 'same-origin', cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(isRecord(body) && typeof body.message === 'string' ? body.message : '抽奖信息加载失败')
      const next = readPayload(body)
      if (!next) throw new Error('抽奖信息格式不可用')
      setPayload(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '抽奖信息加载失败')
    } finally {
      setLoading(false)
      requestBusy.current = false
    }
  }, [activityId])

  useEffect(() => { void load() }, [load])
  useTopicActivityV2LotteryVisibleRefresh({ enabled: payload?.enabled === true, state: payload?.state || null, onRefresh: load })

  if (loading && !payload) return <section aria-label="活动实物抽奖" className="border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6"><p role="status" className="text-sm">正在加载抽奖信息…</p></section>
  if (error && !payload) return <section aria-label="活动实物抽奖" className="border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6"><p role="alert" className="text-sm text-[var(--danger)]">{error}</p><button type="button" className={buttonClass + ' mt-3'} onClick={() => void load()}>重试</button></section>
  if (!payload || !payload.enabled) return null
  const config = readConfig(payload.config)
  if (!config.enabled) return null
  const winner = payload.myWinner
  const winnerClaimUrl = safeClaimUrl(winner?.claimUrl || null)
  // Winner lists are always public once the draw completed (platform policy).
  // The server never returns winners before DRAWN, so no early leak is possible.
  const showWinners = payload.state === 'DRAWN' && payload.winners.length > 0
  const winnerPageCount = Math.max(1, Math.ceil(payload.winners.length / WINNERS_PER_PAGE))
  const currentWinnerPage = Math.min(Math.max(1, winnerPage), winnerPageCount)
  const visibleWinners = payload.winners.slice((currentWinnerPage - 1) * WINNERS_PER_PAGE, currentWinnerPage * WINNERS_PER_PAGE)

  return <section aria-label="活动实物抽奖" className="space-y-5 border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-xs font-black tracking-[0.16em] text-[var(--primary)]">TOPIC V2 LOTTERY</p><h2 className="mt-1 break-words text-xl font-black">{config.title}</h2>{config.description ? <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--foreground-muted)]">{config.description}</p> : null}</div>
      <span className="shrink-0 border border-[var(--border)] px-2 py-1 text-xs font-bold">{stateLabel(payload.state)}</span>
    </div>
    <div className="grid gap-2 text-sm sm:grid-cols-3"><p>资格人数：{payload.candidateCount}</p><p>开奖时间：{dateLabel(config.drawAt)}</p><p>收件截止：{dateLabel(config.addressDeadline)}</p></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {config.prizes.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((prize) => { const imageSrc = resolveTopicLotteryPrizeImageSrc(prize.imageUrl); return <article key={prize.id} className="min-w-0 border border-[var(--border)] p-3"><div className="flex min-w-0 items-start gap-3">{imageSrc ? <img src={imageSrc} alt="" className="size-16 shrink-0 object-cover" loading="lazy" /> : <div aria-hidden="true" className="grid size-16 shrink-0 place-items-center border border-dashed border-[var(--border)] text-xs text-[var(--foreground-muted)]">实物</div>}<div className="min-w-0"><h3 className="break-words font-bold">{prize.name}</h3><p className="mt-1 text-xs text-[var(--foreground-muted)]">数量：{prize.quantity}</p></div></div>{prize.description ? <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-[var(--foreground-muted)]">{prize.description}</p> : null}</article> })}
    </div>
    <div className="border-t border-[var(--border)] pt-4">
      <h3 className="font-bold">我的抽奖状态</h3>
      {!isAuthenticated || payload.myStatus === 'LOGIN_REQUIRED' ? <p className="mt-2 text-sm">登录后可查看个人资格和中奖结果。<Link href="/login" className="ml-1 font-bold text-[var(--primary)] underline underline-offset-4">去登录</Link></p> : <>
        {statusLabel(payload.myStatus) ? <p className="mt-2 text-sm">{statusLabel(payload.myStatus)}</p> : null}
        {payload.myEligibility === true || (isRecord(payload.myEligibility) && payload.myEligibility.count > 0) ? <p className="mt-1 text-xs text-[var(--foreground-muted)]">资格已记录（{isRecord(payload.myEligibility) ? payload.myEligibility.count : 1} 次）；同一用户多个平台入口不会增加次数。</p> : null}
        {winner ? <div className="mt-3 border border-[color-mix(in_srgb,var(--success)_40%,var(--border))] bg-[color-mix(in_srgb,var(--success)_12%,var(--surface))] p-3"><div className="flex min-w-0 items-start gap-3">{winner.prize.imageUrl ? <img src={winner.prize.imageUrl} alt="" className="size-16 shrink-0 object-cover" /> : null}<div className="min-w-0"><p className="font-black">恭喜中奖：{winner.prize.name}</p><p className="mt-1 text-xs">中奖时间：{dateLabel(winner.wonAt)}</p>{winner.prize.description ? <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">{winner.prize.description}</p> : null}</div></div>{winnerClaimUrl && !['SHIPPED', 'COMPLETED', 'DELIVERED'].includes(winner.shippingStatus) ? <Link href={winnerClaimUrl} className="mt-3 inline-flex min-h-10 items-center border border-[var(--border)] px-3 text-sm font-bold">{winner.addressSaved ? '查看 / 修改收货信息' : '提交收货信息'}</Link> : ['SHIPPED', 'COMPLETED', 'DELIVERED'].includes(winner.shippingStatus) ? <p className="mt-3 text-sm font-bold">奖品已完成配送或发货，收货信息已锁定。</p> : null}</div> : null}
      </>}
    </div>
    {payload.draw ? <div className="border-t border-[var(--border)] pt-4"><h3 className="font-bold">开奖记录</h3><dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-xs text-[var(--foreground-muted)]">开奖时间</dt><dd>{dateLabel(payload.draw.drawnAt || payload.draw.frozenAt)}</dd></div><div><dt className="text-xs text-[var(--foreground-muted)]">开奖批次</dt><dd className="break-all">{payload.draw.id}</dd></div><div><dt className="text-xs text-[var(--foreground-muted)]">候选 / 中奖人数</dt><dd>{payload.draw.candidateCount} 人 / {payload.draw.winnerCount} 人</dd></div><div><dt className="text-xs text-[var(--foreground-muted)]">名单公开</dt><dd>已公开</dd></div></dl><p className="mt-2 text-xs text-[var(--foreground-muted)]">开奖成功后中奖名单自动公开，仅展示昵称、头像、E院ID与奖品；领取状态与收货信息不会在此公开。</p></div> : null}
    {showWinners ? <div className="border-t border-[var(--border)] pt-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-bold">中奖名单</h3><p className="text-xs text-[var(--foreground-muted)]">共 {payload.winners.length} 人 · 对所有人公开</p></div><ul className="mt-3 grid gap-2 sm:grid-cols-2">{visibleWinners.map((item, index) => { const href = item.uid ? '/user/' + encodeURIComponent(item.uid) : null; const identity = <>{item.avatarUrl ? <img src={item.avatarUrl} alt="" className="size-10 shrink-0 rounded-full border border-[var(--border)] object-cover" loading="lazy" /> : <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full border border-[var(--border)] text-xs font-black text-[var(--foreground-muted)]">{item.nickname.slice(0, 1)}</span>}<span className="min-w-0"><span className="block break-words text-sm font-black">{item.nickname}</span>{item.uid ? <span className="block break-words text-xs text-[var(--foreground-muted)]">E院ID：{item.uid}</span> : null}</span></>; return <li key={`${item.uid}-${item.prizeName}-${index}`} className="min-w-0 border border-[var(--border)] px-3 py-2">{href ? <Link href={href} className="flex min-w-0 items-center gap-3 underline-offset-4 hover:underline" aria-label={`查看 ${item.nickname} 的个人主页`}>{identity}</Link> : <div className="flex min-w-0 items-center gap-3">{identity}</div>}<p className="mt-2 break-words text-sm font-bold">奖品：{item.prizeName}</p>{item.wonAt ? <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">中奖时间：{dateLabel(item.wonAt)}</p> : null}</li> })}</ul>{winnerPageCount > 1 ? <nav aria-label="中奖名单分页" className="mt-3 flex flex-wrap items-center gap-2"><button type="button" className={buttonClass} disabled={currentWinnerPage <= 1} onClick={() => setWinnerPage(currentWinnerPage - 1)}>上一页</button><span className="text-xs font-bold">第 {currentWinnerPage} / {winnerPageCount} 页</span><button type="button" className={buttonClass} disabled={currentWinnerPage >= winnerPageCount} onClick={() => setWinnerPage(currentWinnerPage + 1)}>下一页</button></nav> : null}<p className="mt-2 text-xs text-[var(--foreground-muted)]">真实姓名、手机号码、收货地址、身份证信息、邮箱与领奖凭证永不公开。</p></div> : null}
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
  </section>
}
