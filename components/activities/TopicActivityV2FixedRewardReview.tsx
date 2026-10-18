'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'

type FixedRewardClaim = {
  id: string
  userId: string
  userName?: string | null
  rewardSnapshot?: { approvalStatus?: string }
  status: 'PENDING' | 'APPROVED' | 'GRANTED' | 'REJECTED' | 'CANCELLED' | 'PROCESSING' | 'FAILED'
  points?: number | null
  platformName?: string | null
  title?: string | null
  createdAt?: string | null
}

type TopicActivityV2FixedRewardReviewProps = { activityId: string; disabled?: boolean }

export function TopicActivityV2FixedRewardReview({ activityId, disabled = false }: Readonly<TopicActivityV2FixedRewardReviewProps>) {
  const [claims, setClaims] = useState<FixedRewardClaim[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [action, setAction] = useState<{ claim: FixedRewardClaim; status: 'APPROVED' | 'REJECTED' } | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')
  const busy = useRef(false)

  const load = useCallback(async () => {
    if (!activityId) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/v2/fixed-reward`, { credentials: 'same-origin', cache: 'no-store' })
      const data = await response.json().catch(() => null) as { claims?: unknown; message?: string } | null
      if (!response.ok) throw new Error(data?.message || '固定奖励审核列表加载失败')
      setClaims(Array.isArray(data?.claims) ? data.claims.flatMap((claim) => {
        if (!claim || typeof claim !== 'object') return []
        const row = claim as FixedRewardClaim & { User?: { nickname?: string | null } | null }
        if (typeof row.id !== 'string' || typeof row.userId !== 'string') return []
        const status = ['PENDING', 'APPROVED', 'GRANTED', 'REJECTED', 'CANCELLED', 'PROCESSING', 'FAILED'].includes(row.status) ? row.status : 'CANCELLED'
        return [{ ...row, status, userName: row.userName || row.User?.nickname || null }]
      }) : [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '固定奖励审核列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [activityId])

  useEffect(() => { void load() }, [load])

  async function confirm() {
    if (!action || busy.current || disabled) return
    busy.current = true
    setActionLoading(true)
    setActionError('')
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/v2/fixed-reward`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: action.claim.userId, status: action.status }),
      })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '固定奖励审核失败')
      setAction(null)
      await load()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '固定奖励审核失败')
    } finally {
      busy.current = false
      setActionLoading(false)
    }
  }

return <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/60 dark:bg-amber-950/20"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-black text-slate-900 dark:text-slate-100">固定奖励人工审核</h3><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">逐条确认发放或拒绝；这里没有批量发放按钮，每次操作都会留下服务端审核记录。</p></div><button type="button" disabled={disabled || loading} onClick={() => void load()} className="min-h-9 rounded-lg border border-amber-300 px-3 text-xs font-black text-amber-800 disabled:opacity-50 dark:border-amber-800 dark:text-amber-200">刷新</button></div>{loading ? <p className="mt-3 text-sm font-bold text-slate-600 dark:text-slate-300">加载中…</p> : error ? <p role="alert" className="mt-3 text-sm font-bold text-rose-700">{error}</p> : claims.length ? <div className="mt-3 space-y-2">{claims.map((claim) => <div key={claim.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white/80 p-3 dark:border-amber-900/50 dark:bg-slate-950/40"><div className="min-w-0"><p className="truncate text-sm font-black text-slate-900 dark:text-slate-100">{claim.userName || claim.userId}</p><p className="mt-1 text-xs font-bold text-slate-600 dark:text-slate-300">{claim.platformName || '固定奖励'}{claim.title ? ` · ${claim.title}` : ''}{typeof claim.points === 'number' ? ` · ${claim.points} 挂号费` : ''}</p><p className="mt-1 text-[11px] font-bold text-slate-500">状态：{claim.status === 'PENDING' ? claim.rewardSnapshot?.approvalStatus === 'APPROVED' ? '已审核，待统一发放' : '待审核' : ['APPROVED', 'GRANTED'].includes(claim.status) ? '已发放' : claim.status === 'PROCESSING' ? '发放中' : claim.status === 'FAILED' ? '发放待重试' : claim.status === 'REJECTED' ? '已拒绝' : '已取消'}</p></div>{claim.status === 'PENDING' && claim.rewardSnapshot?.approvalStatus !== 'APPROVED' ? <div className="flex shrink-0 gap-2"><button type="button" disabled={disabled || actionLoading} onClick={() => { setActionError(''); setAction({ claim, status: 'APPROVED' }) }} className="min-h-9 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white disabled:opacity-50">审核发放</button><button type="button" disabled={disabled || actionLoading} onClick={() => { setActionError(''); setAction({ claim, status: 'REJECTED' }) }} className="min-h-9 rounded-lg border border-rose-300 px-3 text-xs font-black text-rose-700 disabled:opacity-50">拒绝</button></div> : null}</div>)}</div> : <p className="mt-3 text-sm font-bold text-slate-600 dark:text-slate-300">暂无待处理固定奖励。</p>}
    <ConfirmDialog open={Boolean(action)} title={action?.status === 'APPROVED' ? '确认发放这条固定奖励？' : '确认拒绝这条固定奖励？'} description={action?.status === 'APPROVED' ? '确认后记录审核结果，并按活动设置立即或在指定时间发放；重复点击不会重复发放。' : '确认拒绝后，该固定奖励申请不会发放。'} confirmLabel={action?.status === 'APPROVED' ? '确认发放' : '确认拒绝'} loading={actionLoading} error={actionError} onConfirm={() => void confirm()} onCancel={() => { if (!actionLoading) { setActionError(''); setAction(null) } }} />
  </section>
}
