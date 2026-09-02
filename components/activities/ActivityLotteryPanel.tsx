/* eslint-disable @next/next/no-img-element */
import { activityDateLabel } from '@/lib/activity'
import type { ActivityLotteryPublicView } from '@/lib/activity-lottery'

function prizeTypeLabel(prize: ActivityLotteryPublicView['prizes'][number]) {
  if (prize.prizeType !== 'VIRTUAL') return '实物奖品'
  if (prize.virtualPrizeType === 'BADGE') return `虚拟·勋章${prize.badge?.name ? ` · ${prize.badge.name}` : ''}`
  return `虚拟·挂号费${prize.registrationFeeAmount ? ` · ${prize.registrationFeeAmount}` : ''}`
}

function winnerStatusLabel(winner: NonNullable<ActivityLotteryPublicView['winner']>) {
  if (winner.prizeType === 'VIRTUAL') {
    if (winner.fulfillmentStatus === 'FULFILLED' || winner.fulfillmentStatus === 'NOT_REQUIRED') return winner.virtualPrizeType === 'BADGE' ? `勋章${winner.badge?.name ? `「${winner.badge.name}」` : ''}已自动发放` : '挂号费已自动到账'
    if (winner.fulfillmentStatus === 'FAILED') return '虚拟奖品发放失败，请联系管理员'
    return '虚拟奖品自动发放中'
  }
  if (winner.redemptionState === 'REDEEMED') return '已兑奖'
  if (winner.redemptionState === 'REDEEMABLE') return '可兑奖'
  if (winner.redemptionState === 'EXPIRED') return '已失效'
  return '待核销后兑奖'
}

export function ActivityLotteryPanel({ lotteries, isRegistered, embedded = false }: Readonly<{ lotteries: ActivityLotteryPublicView[]; isRegistered: boolean; embedded?: boolean }>) {
  if (!lotteries.length) return null
  const shellClass = embedded
    ? 'mt-5 border-t border-[color-mix(in_srgb,var(--success)_40%,var(--border))] pt-5'
    : 'mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 text-sm text-[var(--foreground)] sm:p-5'
  return (
    <section aria-label="活动抽奖" className={shellClass}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-black tracking-[0.18em] text-[var(--primary)]">活动抽奖</p>
          <h3 className="mt-1 text-lg font-black text-[var(--foreground)] sm:text-xl">报名后自动获得抽奖资格</h3>
        </div>
        <span className="rounded-full bg-[var(--surface)] px-3 py-1 text-xs font-black text-[var(--primary)]">{isRegistered ? '已自动参与' : '报名活动后自动参与'}</span>
      </div>
      <div className="mt-4 space-y-3">
        {lotteries.map((lottery) => (
          <article key={lottery.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="break-words font-black text-[var(--foreground)]">{lottery.title}</h4>
                {lottery.description ? <p className="mt-1 whitespace-pre-wrap break-words text-xs font-bold leading-5 text-[var(--foreground-muted)]">{lottery.description}</p> : null}
              </div>
              <p className="shrink-0 text-xs font-bold text-[var(--foreground-muted)]">{lottery.status === 'DRAWN' ? `已开奖${lottery.drawnAt ? ` · ${activityDateLabel(lottery.drawnAt)}` : ''}` : `开奖时间：${lottery.drawAt ? activityDateLabel(lottery.drawAt) : '待定'}`}</p>
            </div>
            <ul className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
              {lottery.prizes.map((prize) => (
                <li key={prize.id} className="flex min-w-0 items-center gap-3">
                  <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-[var(--navigation-active)]">
                    {(prize.imageUrl || prize.badge?.imageUrl) ? <img src={prize.imageUrl || prize.badge?.imageUrl || ''} alt="" className="size-full object-cover" /> : null}
                  </div>
                  <span className="min-w-0 break-words font-bold text-[var(--foreground)]">{prize.tierName || '中奖奖项'} · {prize.name} · {prizeTypeLabel(prize)} ×{prize.quantity}</span>
                </li>
              ))}
            </ul>
            {lottery.status === 'DRAWN' ? <p className="mt-3 text-xs font-bold text-[var(--foreground-muted)]">本次有效报名 {lottery.eligibleCount ?? 0} 人，实际中奖 {lottery.winnerCount ?? 0} 人。</p> : null}
            {lottery.winner ? <div className="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--success)_12%,var(--surface))] px-3 py-2 text-sm font-black text-[var(--success)]">恭喜中奖：{lottery.winner.tierName} · {lottery.winner.prizeName} · {winnerStatusLabel(lottery.winner)}{lottery.winner.redeemedAt ? ` · ${activityDateLabel(lottery.winner.redeemedAt)}` : ''}</div> : lottery.status === 'DRAWN' && isRegistered ? <p className="mt-3 text-xs font-bold text-[var(--foreground-muted)]">本次未中奖。</p> : null}
          </article>
        ))}
      </div>
    </section>
  )
}
