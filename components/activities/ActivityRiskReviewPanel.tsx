'use client'
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from 'react'
import type { ActivityRiskPublicGroupView, ActivityRiskPublicReport, ActivityRiskLevel, ActivityRiskSignal } from '@/lib/activity-risk'

const levelLabel: Record<Exclude<ActivityRiskLevel, 'NONE'>, string> = { LOW: 'LOW · 低风险提示', MEDIUM: 'MEDIUM · 中风险提示', HIGH: 'HIGH · 高风险提示' }
const levelClass: Record<Exclude<ActivityRiskLevel, 'NONE'>, string> = {
  LOW: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
  MEDIUM: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200',
  HIGH: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200',
}
const signalLabel: Record<ActivityRiskSignal, string> = {
  SHARED_DEVICE: '共享匿名设备标识',
  SHARED_IP: '共享 IP',
  SHARED_IP_BURST: 'IP 短时集中报名',
  HIGH_FREQUENCY_IP: 'IP 24 小时高频报名',
  NEW_ACCOUNT_REGISTRATION: '新账号短时间报名',
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
}

function auditSummary(group: ActivityRiskPublicGroupView['registrations'][number]) {
  if (group.auditData.legacyWithoutAuditData) return '历史记录，无设备风控数据'
  const labels = [
    group.auditData.hasIpHash ? 'IP' : '',
    group.auditData.hasDeviceId ? '设备' : '',
    group.auditData.hasUserAgent ? 'UA' : '',
    group.auditData.hasRequestId ? '请求' : '',
  ].filter(Boolean)
  return labels.length ? `已记录：${labels.join(' · ')}` : '部分审计字段缺失'
}

function winnerStatusLabel(status: string, redeemedAt: string | null) {
  if (status === 'REDEEMED') return `已兑奖${redeemedAt ? ` · ${formatDate(redeemedAt)}` : ''}`
  return '中奖待兑奖'
}

function RiskGroup({ group }: Readonly<{ group: ActivityRiskPublicGroupView }>) {
  return (
    <article className={`border p-4 ${levelClass[group.level]}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="border px-2 py-1 text-xs font-black">{levelLabel[group.level]}</span>
            <span className="text-xs font-black">{group.id}</span>
          </div>
          <p className="mt-2 text-sm font-black">关联账号 {group.accountCount} 个 · 报名记录 {group.registrationCount} 条</p>
          <p className="mt-1 text-xs font-bold opacity-80">时间范围：{formatDate(group.windowStart)} — {formatDate(group.windowEnd)}</p>
        </div>
        <span className="text-xs font-black">仅供人工核验，不代表作弊结论</span>
      </div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm font-bold">
        {group.reasons.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
      <p className="mt-3 text-xs font-bold opacity-80">信号：{group.signals.map((signal) => signalLabel[signal]).join(' · ')}</p>
      <details className="mt-3 border-t border-current/15 pt-3">
        <summary className="cursor-pointer text-sm font-black">查看关联账号与活动结果</summary>
        <div className="mt-3 space-y-3">
          {group.registrations.map((registration) => (
            <div key={registration.registrationId} className="border border-current/15 bg-white/60 p-3 dark:bg-slate-950/30">
              <div className="flex items-start gap-3">
                <div className="size-10 shrink-0 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  {registration.avatarUrl ? <img src={registration.avatarUrl} alt="" className="size-full object-cover" /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-black">{registration.nickname} · E院ID {registration.uid}</p>
                  <p className="break-all text-xs font-bold opacity-80">@{registration.username}</p>
                  <p className="mt-1 text-xs font-bold">注册：{formatDate(registration.accountRegisteredAt)} · 报名：{formatDate(registration.activityRegisteredAt)}</p>
                  <p className="mt-1 text-xs font-bold">报名状态：{registration.status} · 账号状态：{registration.accountDeleted ? '已删除' : registration.accountStatus}</p>
                  <p className="mt-1 text-xs font-bold">核销：{registration.checkedInAt ? `${formatDate(registration.checkedInAt)} · ${registration.checkInSource || '—'}` : '未核销'}</p>
                  <p className="mt-1 text-xs font-bold opacity-80">{auditSummary(registration)}</p>
                  {registration.lotteryWins.length ? <div className="mt-2 border-t border-current/15 pt-2 text-xs font-bold">
                    <p className="font-black">抽奖 / 兑奖记录</p>
                    <ul className="mt-1 space-y-1">
                      {registration.lotteryWins.map((winner) => <li key={winner.id}>{winner.lotteryTitle} · {winner.tierName ? `${winner.tierName} · ` : ''}{winner.prizeName} · {winnerStatusLabel(winner.redemptionStatus, winner.redeemedAt)}</li>)}
                    </ul>
                  </div> : <p className="mt-2 text-xs font-bold opacity-80">未发现中奖记录</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </details>
    </article>
  )
}

export function ActivityRiskReviewPanel({ activityId, refreshSignal = 0 }: Readonly<{ activityId: string; refreshSignal?: number }>) {
  const [report, setReport] = useState<ActivityRiskPublicReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/risk`, { credentials: 'same-origin', cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.message || '异常报名分析失败')
      setReport(body as ActivityRiskPublicReport)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '异常报名分析失败')
    } finally {
      setLoading(false)
    }
  }, [activityId])

  useEffect(() => { void load() }, [load, refreshSignal])

  return (
    <section id={`activity-risk-review-${activityId}`} className="mt-5 border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/60 dark:bg-amber-950/20 sm:p-5" aria-label="异常报名审计">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black tracking-[0.18em] text-amber-700 dark:text-amber-300">异常报名</p>
          <h3 className="mt-1 text-xl font-black text-brand-950 dark:text-slate-100">多账号风险审计</h3>
          <p className="mt-1 text-xs font-bold text-slate-600 dark:text-slate-300">只读风险提示：不自动取消报名、不取消抽奖资格、不封禁账号。</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="min-h-9 border border-amber-700 px-3 text-xs font-black text-amber-800 disabled:opacity-50 dark:text-amber-200">{loading ? '分析中…' : '刷新审计'}</button>
      </div>
      {error ? <p role="alert" className="mt-3 border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-black text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</p> : null}
      {report ? <>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-black sm:grid-cols-5">
          <div className="border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/60"><span className="block text-slate-500">全部报名</span><span className="mt-1 block text-lg">{report.summary.totalRegistrations}</span></div>
          <div className="border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/60"><span className="block text-slate-500">无风险信号</span><span className="mt-1 block text-lg">{report.summary.normalCount}</span></div>
          <div className="border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/60"><span className="block text-slate-500">LOW</span><span className="mt-1 block text-lg">{report.summary.lowCount}</span></div>
          <div className="border border-amber-200 bg-amber-50/70 p-3 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200"><span className="block opacity-80">MEDIUM</span><span className="mt-1 block text-lg">{report.summary.mediumCount}</span></div>
          <div className="border border-rose-200 bg-rose-50/70 p-3 text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200"><span className="block opacity-80">HIGH</span><span className="mt-1 block text-lg">{report.summary.highCount}</span></div>
        </div>
        {report.summary.legacyWithoutAuditData ? <p className="mt-3 border border-slate-200 bg-white/60 px-3 py-2 text-xs font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">历史报名 {report.summary.legacyWithoutAuditData} 条没有设备/IP审计字段；缺失数据本身不计入风险。</p> : null}
        <div className="mt-4 space-y-3">
          {report.groups.map((group) => <RiskGroup key={group.id} group={group} />)}
          {!report.groups.length ? <p className="border border-slate-200 bg-white/60 px-3 py-4 text-center text-sm font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">当前规则未发现需要人工复核的风险信号。</p> : null}
        </div>
      </> : loading ? <p className="mt-4 py-5 text-center text-sm font-bold text-slate-500">正在读取报名审计数据…</p> : null}
    </section>
  )
}
