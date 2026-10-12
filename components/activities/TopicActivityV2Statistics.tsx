'use client'
import { useCallback, useEffect, useState } from 'react'

type Statistics = Record<string, unknown> & { platforms?: Array<{ platformKey: string; submittedUsers: number; submittedCount: number; approvedUsers: number; rewardCount: number; points: number }>;
  entries?: Array<{ rewardEntryId: string; submissionCount: number; rewardCount: number }>; resultDistribution?: Array<{ resultId: string; count: number }>;
  pollResults?: Array<{ label: string; count: number; percentage: number }> }
const labels = { participantCount: '总参与人数', submittedUsers: '提交人数', submissionCount: '提交次数', approvedCount: '通过次数', rejectedCount: '拒绝次数',
  platformRewardPoints: '平台奖励总额', fixedRewardPoints: '固定奖励总额', totalPoints: '挂号费总额', medalUsers: '勋章获得人数', pollParticipants: '投票人数', testParticipants: '测试人数', testAttempts: '测试完成次数' }

export function TopicActivityV2Statistics({ activityId }: { activityId: string }) {
  const [statistics, setStatistics] = useState<Statistics | null>(null), [error, setError] = useState('')
  const load = useCallback(async () => {
    try { const response = await fetch('/api/admin/activities/' + encodeURIComponent(activityId) + '/v2', { cache: 'no-store', credentials: 'same-origin' }); const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.message || '统计加载失败'); setStatistics(body.statistics); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '统计加载失败') }
  }, [activityId])
  useEffect(() => { void load() }, [load])
  return <section className="space-y-3 border-t border-[var(--border)] pt-4"><div className="flex justify-between"><h3 className="font-bold">活动统计</h3><button type="button" onClick={() => void load()} className="text-sm underline">刷新</button></div>{error ? <p role="alert">{error}</p> : null}{statistics ? <>
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">{Object.entries(labels).map(([key, label]) => <div key={key}><dt className="text-xs text-[var(--foreground-muted)]">{label}</dt><dd className="font-bold">{typeof statistics[key] === 'number' ? statistics[key] as number : 0}</dd></div>)}</dl>
    {statistics.platforms?.map((row) => <p key={row.platformKey} className="text-sm">平台 {row.platformKey}：{row.submittedUsers} 人 / {row.submittedCount} 次提交 · {row.approvedUsers} 人通过 · {row.rewardCount} 次发奖 · {row.points} 挂号费</p>)}
    {statistics.entries?.map((row) => <p key={row.rewardEntryId} className="break-all text-xs">入口 {row.rewardEntryId}：{row.submissionCount} 次提交 · {row.rewardCount} 次发奖</p>)}
    {statistics.pollResults?.map((row) => <p key={row.label} className="text-sm">投票 {row.label}：{row.count} 票 · {row.percentage}%（参与人数口径）</p>)}
    {statistics.resultDistribution?.map((row) => <p key={row.resultId} className="text-sm">测试结果 {row.resultId}：{row.count} 次</p>)}
  </> : !error ? <p>正在读取统计…</p> : null}</section>
}
