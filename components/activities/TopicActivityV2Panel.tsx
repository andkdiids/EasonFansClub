'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { TopicActivityImagePicker } from '@/components/activities/TopicActivityImagePicker'
import { TopicActivityV2PollPanel, TopicActivityV2TestRunner } from '@/components/activities/TopicActivityV2Interactive'
import { TopicActivityV2Comments } from '@/components/activities/TopicActivityV2Comments'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { normalizeTopicActivityV2Entries, normalizeTopicActivityV2Progress } from '@/components/activities/topic-activity-v2-types'
import type { TopicActivityUploadedAsset } from '@/lib/content-image-browser'
import type { TopicActivityV2PublicProgram } from '@/lib/topic-activity-v2-config'

type Payload = { program: TopicActivityV2PublicProgram | null; entries: unknown; canReview: boolean;
  activity: { activityPostId: string | null; postAuthorId?: string | null; status: string; startsAt: string | null; endsAt: string | null; allowImageAttachments: boolean };
  myProgress: { totalGrantedPoints: number; platformGrantedPoints: number; fixedGrantedPoints: number; remainingPlatformCount: number | null; medal: unknown; submissions: unknown[]; grants: unknown[]; testAttempts?: unknown[]; submittedCount: number; approvedCount: number } | null }
const button = 'min-h-10 rounded-sm border border-[var(--border)] px-4 text-sm font-bold disabled:opacity-40'
function statusLabel(status: string) { return ({ PENDING: '待审核', APPROVED: '已通过', REJECTED: '未通过', GRANTED: '奖励已发放', NOT_STARTED: '尚未提交' } as Record<string, string>)[status] || '暂不可用' }

export function TopicActivityV2Panel({ activityId, isAuthenticated = false, currentUserId, mode = 'activity', showComments = true }: {
  activityId: string; isAuthenticated?: boolean; currentUserId?: string; mode?: 'activity' | 'test'; showComments?: boolean
}) {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeEntry, setActiveEntry] = useState<string | null>(null)
  const [assets, setAssets] = useState<TopicActivityUploadedAsset[]>([])
  const [remark, setRemark] = useState('')
  const [uploading, setUploading] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [confirmTask, setConfirmTask] = useState(false)
  const busy = useRef(false)
  const base = '/api/activities/' + encodeURIComponent(activityId) + '/v2'
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await fetch(base, { credentials: 'same-origin', cache: 'no-store' })
      const value = await response.json().catch(() => null)
      if (!response.ok || !value || !value.activity) throw new Error(value?.message || '活动参与信息加载失败')
      setPayload(value as Payload)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '加载失败') }
    finally { setLoading(false) }
  }, [base])
  useEffect(() => {
    void load()
    const refresh = () => { void load() }
    window.addEventListener('topic-activity-v2-changed', refresh)
    return () => window.removeEventListener('topic-activity-v2-changed', refresh)
  }, [load])
  async function write(url: string, body?: unknown) {
    if (busy.current) return
    busy.current = true; setPending(true); setError(''); setMessage('')
    try {
      const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : '{}' })
      const value = await response.json().catch(() => null)
      if (!response.ok) throw new Error(value?.message || '操作失败，请重试')
      setMessage(value?.pendingReview ? '固定奖励申请已提交，等待管理员审核。' : body ? '任务已提交，等待管理员审核。' : '固定奖励状态已更新。')
      if (body) { setConfirmTask(false); setActiveEntry(null); setAssets([]); setRemark('') }
      await load()
      window.dispatchEvent(new Event('topic-activity-v2-changed'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '提交失败') }
    finally { busy.current = false; setPending(false) }
  }
  function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeEntry || uploading) return
    setConfirmTask(true)
  }
  if (mode === 'test') return <TopicActivityV2TestRunner activityId={activityId} isAuthenticated={isAuthenticated} />
  if (loading && !payload) return <p role="status">正在加载参与信息…</p>
  if (error && !payload) return <div role="alert">{error}<button type="button" onClick={() => void load()} className={button}>重试</button></div>
  const program = payload?.program
  if (!payload || !program?.enabled) return null
  const entries = normalizeTopicActivityV2Entries(payload.entries)
  const progress = normalizeTopicActivityV2Progress(payload.myProgress)
  const active = payload.activity.status === 'PUBLISHED' && (!payload.activity.startsAt || Date.now() >= Date.parse(payload.activity.startsAt)) && (!payload.activity.endsAt || Date.now() <= Date.parse(payload.activity.endsAt))
  return <section aria-label="活动参与与进度" className="space-y-5 border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
    <ConfirmDialog open={confirmTask} title="确认提交这条参与评论？" description="提交会在活动主帖生成一级参与评论。如果活动只允许一次参与评论，删除或撤回不会恢复机会。审核通过后按此入口的历史奖励快照发放，同入口不会重复发奖。" confirmLabel="确认提交" loading={pending} error={error} onCancel={() => { if (!busy.current) setConfirmTask(false) }} onConfirm={() => { if (activeEntry && !uploading) void write(base + '/tasks', { rewardEntryId: activeEntry, assetIds: assets.map((asset) => asset.assetId), remark }) }} />
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">参与活动</h2><button type="button" onClick={() => void load()} className={button} disabled={pending}>刷新进度</button></div>
    {program.showRules && program.materials ? <p className="whitespace-pre-wrap text-sm">{program.materials}</p> : null}
    {!isAuthenticated ? <p className="text-sm"><Link href="/login" className="underline">登录</Link> 后可提交任务、领取奖励和查看参与进度。</p> : null}
    {payload.myProgress ? <section className="space-y-2 border border-[var(--border)] p-3"><h3 className="font-bold">我的参与进度</h3><p className="text-sm">已提交 {payload.myProgress.submittedCount} 次 · 已通过 {payload.myProgress.approvedCount} 次</p><p className="text-sm">固定奖励：{payload.myProgress.fixedGrantedPoints} · 平台奖励：{payload.myProgress.platformGrantedPoints} · 累计：{payload.myProgress.totalGrantedPoints} 挂号费</p><p className="text-sm">{payload.myProgress.remainingPlatformCount === null ? '平台数量不设上限' : '剩余可领奖平台数量：' + payload.myProgress.remainingPlatformCount} · 限定勋章：{payload.myProgress.medal ? '已获得' : '尚未获得'}</p></section> : null}
    {program.fixedReward.enabled ? <section className="space-y-2 border-t border-[var(--border)] pt-4"><h3 className="font-bold">固定奖励{program.showRewards ? ' · ' + program.fixedReward.points + ' 挂号费' : ''}</h3><p className="text-sm">{program.fixedReward.description}</p><p className="text-xs text-[var(--foreground-muted)]">完成指定站内行为后独立领取；不要求完成所有平台任务。</p>{isAuthenticated ? <button type="button" className={button} disabled={pending || Boolean(payload.myProgress?.fixedGrantedPoints)} onClick={() => void write(base + '/fixed-reward')}>{pending ? '处理中…' : payload.myProgress?.fixedGrantedPoints ? '固定奖励已获得' : '领取 / 申请固定奖励'}</button> : null}</section> : null}
    {program.medal.enabled ? <section className="space-y-2 border-t border-[var(--border)] pt-4"><h3 className="font-bold">活动限定勋章</h3><p className="text-sm">{program.medal.description}</p><p className="text-xs text-[var(--foreground-muted)]">首次符合配置的有效参与后授予；多个平台或重复测试不会重复授予。</p></section> : null}
    {program.platformRewards.enabled ? <section className="space-y-3 border-t border-[var(--border)] pt-4"><h3 className="font-bold">平台分享任务</h3><p className="text-xs text-[var(--foreground-muted)]">请主动完成平台分享后提交截图。相同平台的不同入口分别有奖励资格；平台上限按不同平台计数。</p>{entries.filter((entry) => entry.enabled).map((entry) => {
      const entryProgress = progress.find((item) => item.rewardEntryId === entry.id) ?? { status: 'NOT_STARTED', commentId: null, rejectReason: null }
      const state = entryProgress?.status || 'NOT_STARTED'
      const canSubmit = isAuthenticated && active && (state === 'NOT_STARTED' || (['REJECTED', 'GRANTED'].includes(state) && entry.allowResubmit)) && (!entry.startsAt || Date.now() >= Date.parse(entry.startsAt)) && (!entry.endsAt || Date.now() <= Date.parse(entry.endsAt)) && (entry.maxImages === 0 || payload.activity.allowImageAttachments)
      return <article key={entry.id} className="space-y-3 border border-[var(--border)] p-3"><div className="flex flex-wrap justify-between gap-2"><h4 className="font-bold">{entry.platformName} · {entry.title}</h4><span className="text-xs">{statusLabel(state)}</span></div>{program.showRewards ? <p className="text-sm font-bold">{entry.points} 挂号费</p> : null}<p className="whitespace-pre-wrap text-sm">{entry.instructions}</p>{entry.materialRequirement ? <p className="text-sm">素材要求：{entry.materialRequirement}</p> : null}<p className="text-xs text-[var(--foreground-muted)]">截图 {entry.minImages}—{entry.maxImages} 张{entry.startsAt ? ' · 开始：' + new Date(entry.startsAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : ''}{entry.endsAt ? ' · 截止：' + new Date(entry.endsAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : ''}</p>{entryProgress?.commentId && payload.activity.activityPostId ? <Link href={'/posts/' + encodeURIComponent(payload.activity.activityPostId) + '?focus=' + encodeURIComponent(entryProgress.commentId) + '#reply-' + encodeURIComponent(entryProgress.commentId)} className="inline-block text-sm underline">查看提交</Link> : null}{state === 'REJECTED' && entryProgress.rejectReason ? <p className="text-sm text-rose-700">拒绝原因：{entryProgress.rejectReason}</p> : null}{canSubmit ? <button type="button" className={button} onClick={() => { setActiveEntry(activeEntry === entry.id ? null : entry.id); setAssets([]); setRemark('') }}>{state === 'REJECTED' ? '重新提交' : `提交${entry.platformName}截图`}</button> : !active ? <p className="text-xs">当前不在活动参与时间内。</p> : null}
        {activeEntry === entry.id ? <form onSubmit={submitTask} className="space-y-3"><label className="block text-sm">备注<textarea className="mt-1 w-full border border-[var(--border)] bg-[var(--surface)] p-2" maxLength={2000} value={remark} onChange={(event) => setRemark(event.target.value)} /></label>{entry.maxImages ? <TopicActivityImagePicker activityId={activityId} rewardEntryId={entry.id} purpose="FORM_ANSWER" assets={assets} onChange={setAssets} onUploadingChange={setUploading} maxImages={entry.maxImages} disabled={pending} /> : null}<button type="submit" className={button} disabled={pending || uploading || assets.length < entry.minImages}>确认提交待审核</button></form> : null}</article>
    })}</section> : null}
    {program.poll.enabled ? <TopicActivityV2PollPanel activityId={activityId} isAuthenticated={isAuthenticated} /> : null}
    {program.test.enabled ? (() => {
      const attempts = Array.isArray(payload.myProgress?.testAttempts) ? payload.myProgress.testAttempts : []
      const latestAttempt = attempts.find((item): item is { id: string; testId: string; configVersion: number } => Boolean(item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string' && (item as Record<string, unknown>).testId === program.test.id && (item as Record<string, unknown>).configVersion === program.test.version))
      const href = '/activities/' + encodeURIComponent(activityId) + '/test' + (latestAttempt ? '?attemptId=' + encodeURIComponent(latestAttempt.id) : '')
      const label = latestAttempt ? (program.test.allowRetake ? '查看测试结果 / 再次测试' : '查看测试结果') : '参加测试'
      return <Link href={href} className={button + ' inline-flex items-center'}>{label}</Link>
    })() : null}
    {error ? <p role="alert" className="text-red-600">{error}</p> : null}{message ? <p role="status" className="text-sm">{message}</p> : null}
    {showComments && payload.activity.activityPostId && (program.discussionEnabled || program.platformRewards.enabled) ? <TopicActivityV2Comments postId={payload.activity.activityPostId} postAuthorId={payload.activity.postAuthorId || ''} activityId={activityId} currentUserId={currentUserId} allowDiscussion={program.discussionEnabled} /> : null}
  </section>
}
