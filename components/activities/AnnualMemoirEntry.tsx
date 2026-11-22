import Link from 'next/link'
import { publicImageUrl } from '@/lib/images'
import type { readMemoirEntry } from '@/lib/annual-memoir-entry'
import { AnnualMemoirCountdown, AnnualMemoirReserve } from './AnnualMemoirReserve'

export function AnnualMemoirEntry({ entry, detail = false }: {
  entry: NonNullable<Awaited<ReturnType<typeof readMemoirEntry>>>; detail?: boolean
}) {
  const { config, reservation, state, hasSnapshot, ended } = entry
  if (!state.visible && !hasSnapshot) return null
  const href = `/activities/${encodeURIComponent(config.activityId)}`
  const label = hasSnapshot ? '查看我的年度报告' : state.canGenerate ? '生成我的' + config.year + '年度报告' :
    ended ? '活动已结束' : reservation ? '已预约成功' : state.canReserve ? '预约我的年度回忆录' : '敬请期待'
  const cover = publicImageUrl(config.activity.coverUrl)
  return <section className="my-4 border border-[#c4a374] bg-[#4a243e] p-4 text-[#fff1dc]">
    {!detail && cover && <Link href={href} aria-label={config.activity.title}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={cover} alt={config.activity.title} className="mb-3 max-h-56 w-full object-contain" />
    </Link>}
    <h2 className="text-xl font-bold">{config.activity.title}</h2>
    <p>{label}</p>
    {detail && <p>预约奖励：{reservation?.points ?? config.reservationPoints} 挂号费{(reservation ? reservation.badgeId : config.reservationBadgeId) ? '与指定勋章' : ''}；生成报告后可参与年度限定勋章结算。</p>}
    {detail && reservation && <p>挂号费：{reservation.points === 0 ? '未启用' : reservation.pointsGrantedAt ? '已到账' : '待发放'} · 勋章：{!reservation.badgeId ? '未启用' : reservation.badgeGrantedAt ? '已到账' : '待发放'}</p>}
    {!ended && !state.canGenerate && !hasSnapshot && <p>报告开放：{new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(config.reportOpensAt)}（北京时间）</p>}
    {!ended && !state.canGenerate && !hasSnapshot && <AnnualMemoirCountdown target={config.reportOpensAt.getTime()} serverNow={entry.serverNow} />}
    {detail && state.canReserve && !reservation && <AnnualMemoirReserve endpoint={`/api${href}/annual-memoir/reservation`} />}
    {(hasSnapshot || state.canGenerate) && <Link className="underline" href={`${href}/annual-memoir`}>{label}</Link>}
    {!detail && <Link className="ml-3 underline" href={href}>活动详情</Link>}
  </section>
}
