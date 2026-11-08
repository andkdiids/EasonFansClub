/* eslint-disable @next/next/no-img-element */
import Link from 'next/link'
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

function publicRewardStatusLabel(status: ActivityLotteryPublicView['prizes'][number]['winners'][number]['rewardStatus']) {
  if (status === 'FULFILLED') return '已发放'
  if (status === 'FAILED') return '发放失败，请联系管理员'
  if (status === 'PENDING') return '奖励待发放'
  if (status === 'REDEEMABLE') return '可兑奖'
  if (status === 'WAITING_FOR_CHECK_IN') return '待现场核销后兑奖'
  if (status === 'EXPIRED') return '已失效'
  if (status === 'REDEEMED') return '已兑奖'
  return '无需自动发放'
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
              <p className="shrink-0 text-xs font-bold text-[var(--foreground-muted)]">{lottery.status === 'DRAWN' ? `已开奖${lottery.drawnAt ? ` · ${activityDateLabel(lottery.drawnAt)}` : ''}` : lottery.status === 'RESULTS_UNAVAILABLE' ? '开奖记录暂不可用' : `尚未开奖${lottery.drawAt ? ` · 计划 ${activityDateLabel(lottery.drawAt)}` : ''}`}</p>
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
            {lottery.status === 'RESULTS_UNAVAILABLE' ? <p role="status" className="mt-3 text-xs font-bold text-[var(--foreground-muted)]">该批次存在已开奖标记，但中奖记录不完整，暂不公开，管理员可在完整开奖记录中核查。</p> : null}
            {lottery.status === 'DRAWN' ? (
              <section className="mt-4 border-t border-[var(--border)] pt-3" aria-label="中奖名单">
                <h5 className="text-sm font-black text-[var(--foreground)]">中奖名单</h5>
                {lottery.prizes.some((prize) => prize.winners.length) ? (
                  <div className="mt-3 space-y-3">
                    {lottery.prizes.filter((prize) => prize.winners.length).map((prize) => (
                      <div key={prize.id} className="rounded-lg bg-[var(--surface-subtle)] p-3">
                        <h6 className="text-xs font-black text-[var(--foreground)]">{prize.tierName || '中奖奖项'} · {prize.name}</h6>
                        <ul className="mt-2 space-y-2">
                          {prize.winners.map((winner, index) => {
                            const profileHref = winner.uid ? `/user/${encodeURIComponent(String(winner.uid))}` : null
                            const avatar = winner.avatarUrl
                              ? <img src={winner.avatarUrl} alt="" className="size-full object-cover" loading="lazy" />
                              : winner.nickname.slice(0, 1)
                            const avatarClass = 'grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--navigation-active)] text-xs font-black text-[var(--primary)]'
                            return (
                              <li key={`${prize.id}:${winner.wonAt}:${index}`} className="flex items-center gap-3">
                                {profileHref ? <Link href={profileHref} className={avatarClass} aria-label={`查看 ${winner.nickname} 的个人主页`}>{avatar}</Link> : <div className={avatarClass}>{avatar}</div>}
                                <div className="min-w-0 flex-1">
                                  <p className="break-words text-sm font-black text-[var(--foreground)]">{profileHref ? <Link href={profileHref} className="underline-offset-4 hover:underline">{winner.nickname}</Link> : winner.nickname} · {winner.prizeName}</p>
                                  <p className="mt-0.5 text-xs font-bold text-[var(--foreground-muted)]">开奖时间：{activityDateLabel(lottery.drawnAt || winner.wonAt)} · {publicRewardStatusLabel(winner.rewardStatus)}{winner.rewardAt ? ` · ${activityDateLabel(winner.rewardAt)}` : ''}</p>
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : <p className="mt-2 text-xs font-bold text-[var(--foreground-muted)]">当前没有可公开的中奖记录。</p>}
              </section>
            ) : null}
            {lottery.status === 'DRAWN' ? <p className="mt-3 text-xs font-bold text-[var(--foreground-muted)]">本次有效报名 {lottery.eligibleCount ?? 0} 人，实际中奖 {lottery.winnerCount ?? 0} 人。</p> : null}
            {lottery.winner ? <div className="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--success)_12%,var(--surface))] px-3 py-2 text-sm font-black text-[var(--success)]">恭喜中奖：{lottery.winner.tierName} · {lottery.winner.prizeName} · {winnerStatusLabel(lottery.winner)}{lottery.winner.redeemedAt ? ` · ${activityDateLabel(lottery.winner.redeemedAt)}` : ''}</div> : lottery.status === 'DRAWN' && isRegistered ? <p className="mt-3 text-xs font-bold text-[var(--foreground-muted)]">本次未中奖。</p> : null}
          </article>
        ))}
      </div>
    </section>
  )
}
