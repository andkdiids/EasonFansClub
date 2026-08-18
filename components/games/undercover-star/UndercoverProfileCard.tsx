import type { UndercoverRoomState } from '@/lib/undercover-star-protocol'

type ProfileStats = {
  totalGames: number
  totalWins: number
  totalLosses: number
  winRate: number
  xp: number
  level: number
}

type ActiveMatch = { matchId: string; roomId: string; status: 'PLAYING' | 'FINISHED' } | null

export function UndercoverProfileCard({ stats, activeMatch, activeRoom, onViewHistory }: {
  stats: ProfileStats | null
  activeMatch: ActiveMatch
  activeRoom: UndercoverRoomState | null
  onViewHistory: () => void
}) {
  const lastFinished = activeMatch?.status === 'FINISHED'
  const hasPending = activeMatch?.status === 'PLAYING' || Boolean(activeRoom)
  const hasHistory = lastFinished || hasPending

  return (
    <section className="border border-sky-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-black text-brand-950">卧底巨星档案</h2>
        {stats ? <span className="rounded bg-brand-950 px-3 py-2 text-sm font-black text-white">Lv.{stats.level} · {stats.xp} XP</span> : null}
      </div>
      {stats ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="border border-sky-100 p-4"><span className="text-xs font-bold text-slate-500">参与场次</span><strong className="mt-2 block text-2xl font-black text-brand-950">{stats.totalGames}</strong></div>
          <div className="border border-sky-100 p-4"><span className="text-xs font-bold text-slate-500">胜利场次</span><strong className="mt-2 block text-2xl font-black text-brand-950">{stats.totalWins}</strong></div>
          <div className="border border-sky-100 p-4"><span className="text-xs font-bold text-slate-500">失败场次</span><strong className="mt-2 block text-2xl font-black text-brand-950">{stats.totalLosses}</strong></div>
          <div className="border border-sky-100 p-4"><span className="text-xs font-bold text-slate-500">胜率</span><strong className="mt-2 block text-2xl font-black text-brand-950">{stats.winRate}%</strong></div>
        </div>
      ) : (
        <p className="mt-6 text-sm font-bold text-slate-500">还没有战绩，开一局试试吧。</p>
      )}
      <div className="mt-6 border-t border-sky-50 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-black text-brand-950">历史对局</h3>
          {hasHistory ? (
            <button type="button" onClick={onViewHistory} className="text-xs font-black text-brand-700 hover:underline">查看全部 →</button>
          ) : (
            <span className="text-xs font-bold text-slate-400">暂无</span>
          )}
        </div>
        <div className="mt-3">
          {lastFinished ? (
            <button type="button" onClick={onViewHistory} className="flex w-full items-center justify-between border border-sky-100 p-3 text-left transition hover:border-brand-400">
              <span><strong className="block text-sm font-black text-brand-950">上一局已结算</strong><small className="text-xs font-bold text-slate-500">点击查看本局结果</small></span>
              <span className="text-xs font-black text-brand-700">查看结果 →</span>
            </button>
          ) : hasPending ? (
            <button type="button" onClick={onViewHistory} className="flex w-full items-center justify-between border border-sky-100 p-3 text-left transition hover:border-brand-400">
              <span><strong className="block text-sm font-black text-brand-950">你有一局尚未结束</strong><small className="text-xs font-bold text-slate-500">点击继续当前对局</small></span>
              <span className="text-xs font-black text-brand-700">继续对局 →</span>
            </button>
          ) : (
            <p className="text-sm font-bold text-slate-400">暂无最近对局记录。</p>
          )}
        </div>
      </div>
    </section>
  )
}
