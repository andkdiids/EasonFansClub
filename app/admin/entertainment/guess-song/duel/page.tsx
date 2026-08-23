import Link from 'next/link'
import { requireAdminPage } from '@/components/AdminAccess'
import { getDuelAdminMatches } from '@/lib/guess-song-duel-service'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—'
}
export default async function AdminGuessSongDuelPage() {
  await requireAdminPage('/admin/entertainment/guess-song/duel', 'entertainment_manage')
  const matches = await getDuelAdminMatches(100)

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">听听后台</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950">听听·对决管理</h1>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">查看比赛结算、奖励、断线原因和异常答题审计。管理员不能在此页改写胜负。</p>
        </div>
        <Link href="/admin/entertainment/guess-song" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:border-brand-200 hover:text-brand-700">
          返回听听题库
        </Link>
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-black text-slate-700">最近 {matches.length} 场</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-black uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Match / 房间</th>
                <th className="px-4 py-3">玩家</th>
                <th className="px-4 py-3">比分 / 胜者</th>
                <th className="px-4 py-3">状态 / 原因</th>
                <th className="px-4 py-3">奖励 / 风控</th>
                <th className="px-4 py-3">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {matches.map((match) => {
                const winner = match.players.find((player) => player.userId === match.winnerId)?.name || (match.isDraw ? '平局' : '—')
                return (
                  <tr key={match.id} className="align-top">
                    <td className="px-4 py-4 font-mono text-xs text-slate-600">
                      <div>{match.id}</div>
                      <div className="mt-1 font-sans font-bold">房间 {match.roomCode} · {match.mode === 'BUZZER' ? '抢答模式' : '比分模式'}</div>
                    </td>
                    <td className="px-4 py-4 font-bold text-slate-800">
                      {match.players.map((player) => <div key={player.userId}>{player.name} · {match.mode === 'SCORE' ? `基础 ${player.baseCorrectCount} / 30` : `比分 ${player.correctCount}`}</div>)}
                    </td>
                    <td className="px-4 py-4 font-bold text-slate-800">{winner}</td>
                    <td className="px-4 py-4">
                      <div className="font-bold text-slate-800">{match.status}</div>
                      <div className="mt-1 text-xs text-slate-500">{match.finishReason || '—'}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-bold text-slate-800">+{match.rewardGranted ? match.rewardAmount : 0}</div>
                      <div className="mt-1 text-xs text-slate-500">{match.rewardReason}</div>
                      {match.rewardedAt ? <div className="mt-1 text-xs text-slate-500">到账 {formatDate(match.rewardedAt)}</div> : null}
                      <div className={match.isSuspicious ? 'mt-1 text-xs font-bold text-rose-600' : 'mt-1 text-xs text-slate-500'}>{match.isSuspicious ? 'suspicious' : '正常'}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">
                      <div>{formatDate(match.startedAt)}</div>
                      <div className="mt-1">结束 {formatDate(match.finishedAt)}</div>
                      <details className="mt-2">
                        <summary className="cursor-pointer font-bold text-brand-700">查看详情</summary>
                        <div className="mt-2 max-w-sm space-y-1 rounded-lg bg-slate-50 p-2 font-mono text-[11px]">
                          {match.questions.map((question) => {
                            const answers = match.answers.filter((answer) => answer.questionId === question.id)
                            return <div key={question.id}>Q{question.questionIndex} {question.songTitle} · {answers.map((answer) => `${answer.userId.slice(0, 6)}:${answer.selectedOptionKey}${answer.isCorrect ? '✓' : '×'}`).join(' / ') || '未作答'}</div>
                          })}
                        </div>
                      </details>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!matches.length ? <p className="px-4 py-10 text-center text-sm font-bold text-slate-500">暂无对决记录。</p> : null}
      </section>
    </main>
  )
}
