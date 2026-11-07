import Link from 'next/link'
import { requireAdminPage } from '@/components/AdminAccess'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function formatTime(value: Date | null | undefined) {
  if (!value) return '—'
  return value.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

function stateLabel(state: string) {
  return ({ FROZEN: '已冻结', DRAWING: '开奖中', DRAWN: '已开奖', FAILED: '失败待重试' } as Record<string, string>)[state] || state
}

/**
 * Read-only administrator view of topic-activity lottery draws.
 * No shipping ciphertext, phone number, recipient name or address is ever
 * selected or rendered here; those require the separate
 * activity_lottery_shipping permission and the dedicated address endpoint.
 */
export default async function AdminLotteryRecordsPage({ searchParams }: { searchParams: Promise<{ activityId?: string }> }) {
  await requireAdminPage('/admin/activities/lottery-records', 'activity_manage')
  const { activityId } = await searchParams
  const draws = await prisma.topicActivityLotteryDraw.findMany({
    where: activityId ? { activityId } : {},
    orderBy: [{ createdAt: 'desc' }],
    take: 100,
    select: {
      id: true,
      activityId: true,
      state: true,
      frozenAt: true,
      startedAt: true,
      drawnAt: true,
      candidateCount: true,
      winnerCount: true,
      errorCode: true,
      Activity: { select: { title: true } },
      Config: { select: { lotteryId: true } },
    },
  })
  const lotteryIds = draws.map((draw) => draw.Config.lotteryId)
  const winners = lotteryIds.length ? await prisma.lotteryEntry.findMany({
    where: { lotteryId: { in: lotteryIds } },
    orderBy: [{ wonAt: 'asc' }],
    take: 1000,
    select: {
      id: true,
      lotteryId: true,
      wonAt: true,
      User: { select: { nickname: true, uid: true } },
      LotteryPrize: { select: { name: true } },
      TopicShipping: { select: { shippingStatus: true, addressCiphertext: true, addressUpdatedAt: true } },
    },
  }) : []
  const audits = activityId ? await prisma.topicActivityLotteryAudit.findMany({
    where: { activityId },
    orderBy: [{ createdAt: 'desc' }],
    take: 30,
    select: { id: true, action: true, createdAt: true },
  }) : []

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-5 sm:py-9">
      <section className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 sm:p-8">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Topic Activity Lottery</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950 dark:text-slate-100">话题活动开奖记录</h1>
        <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600 dark:text-slate-300">
          只读查看开奖批次、开奖时间、奖品、中奖用户、领取与收货信息提交状态。收货地址与联系电话不在此展示，需 activity_lottery_shipping 权限在活动管理中单独查看。
        </p>
        <Link href="/admin/activities" className="mt-4 inline-flex min-h-10 items-center rounded-full border border-sky-200 px-4 py-2 text-sm font-black text-brand-700">返回活动中心管理</Link>
      </section>

      {!draws.length ? <section className="rounded-[28px] border border-sky-100 bg-white/90 p-6 text-sm font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900/90">当前没有已生成的开奖批次。开奖记录会在开奖事务内创建；未开奖活动不会提前产生中奖信息。</section> : null}

      {draws.map((draw) => {
        const rows = winners.filter((winner) => winner.lotteryId === draw.Config.lotteryId)
        return <section key={draw.id} className="space-y-4 rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/90">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><h2 className="break-words text-xl font-black text-brand-950 dark:text-slate-100">{draw.Activity.title || '未命名活动'}</h2><p className="mt-1 break-all text-xs font-bold text-slate-500">批次 {draw.id} · 活动 {draw.activityId}</p></div>
            <span className="shrink-0 rounded-full border border-sky-200 px-3 py-1 text-xs font-black text-brand-700">{stateLabel(draw.state)}</span>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-xs font-bold text-slate-500">冻结时间</dt><dd>{formatTime(draw.frozenAt)}</dd></div>
            <div><dt className="text-xs font-bold text-slate-500">开奖时间</dt><dd>{formatTime(draw.drawnAt)}</dd></div>
            <div><dt className="text-xs font-bold text-slate-500">候选 / 中奖人数</dt><dd>{draw.candidateCount} 人 / {draw.winnerCount} 人</dd></div>
            <div><dt className="text-xs font-bold text-slate-500">状态 / 错误码</dt><dd>{stateLabel(draw.state)}{draw.errorCode ? ` · ${draw.errorCode}` : ''}</dd></div>
          </dl>
          <div className="border-t border-sky-100 pt-4 dark:border-slate-700"><h3 className="font-black">中奖记录（{rows.length}）</h3>
            {rows.length ? <div className="mt-3 space-y-2">{rows.map((winner) => <article key={winner.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-100 px-3 py-2 text-sm dark:border-slate-700"><span className="break-words">{winner.User.nickname}（E院ID {winner.User.uid}） · {winner.LotteryPrize?.name || '活动奖品'}</span><span className="text-xs font-bold text-slate-500">收货信息{winner.TopicShipping?.addressCiphertext ? '已提交' : '未提交'} · 领取状态 {winner.TopicShipping?.shippingStatus || 'WAITING_ADDRESS'} · 中奖 {formatTime(winner.wonAt)}</span></article>)}</div> : <p className="mt-2 text-sm text-slate-500">该批次暂无中奖记录。</p>}
          </div>
        </section>
      })}

      {activityId ? <section className="space-y-2 rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/90"><h2 className="text-lg font-black">操作记录（最近 {audits.length} 条）</h2>{audits.length ? <ul className="space-y-1 text-sm">{audits.map((audit) => <li key={audit.id} className="flex flex-wrap justify-between gap-2 border-b border-sky-50 py-1 dark:border-slate-800"><span className="font-bold">{audit.action}</span><span className="text-xs text-slate-500">{formatTime(audit.createdAt)}</span></li>)}</ul> : <p className="text-sm text-slate-500">暂无操作记录。</p>}</section> : null}
    </main>
  )
}
