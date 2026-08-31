'use client'

import { useEffect, useState } from 'react'
import { ActivityLotteryManager } from '@/components/activities/ActivityLotteryManager'

type ActivityLotteryEntryProps = Readonly<{
  activityId: string | null
  activityTitle: string
  activityEndAt: string | null
  disabled?: boolean
  onPrepareActivity: () => Promise<boolean>
}>

/**
 * The lottery manager needs a persisted activity id. For a new activity we
 * keep the entry visible in the form and save a draft only when the admin
 * explicitly starts adding a lottery; this prevents orphan lottery rows.
 */
export function ActivityLotteryEntry({ activityId, activityTitle, activityEndAt, disabled = false, onPrepareActivity }: ActivityLotteryEntryProps) {
  const [preparing, setPreparing] = useState(false)
  const [openAfterPrepare, setOpenAfterPrepare] = useState(false)

  useEffect(() => {
    if (!activityId) setOpenAfterPrepare(false)
  }, [activityId])

  if (activityId) {
    return <ActivityLotteryManager key={activityId} activityId={activityId} activityTitle={activityTitle} activityEndAt={activityEndAt} openOnMount={openAfterPrepare} />
  }

  async function prepareActivity() {
    if (preparing || disabled) return
    setPreparing(true)
    try {
      if (await onPrepareActivity()) setOpenAfterPrepare(true)
    } finally {
      setPreparing(false)
    }
  }

  return (
    <section aria-label="活动抽奖" className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 text-[var(--foreground)] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black tracking-[0.18em] text-[var(--primary)]">活动抽奖（可选）</p>
          <p className="mt-1 text-sm font-black text-[var(--foreground)]">暂无抽奖活动</p>
          <p className="mt-1 text-xs font-bold leading-5 text-[var(--foreground-muted)]">保存草稿后可添加多个独立抽奖；抽奖资格自动继承有效活动报名。</p>
        </div>
        <button type="button" onClick={() => void prepareActivity()} disabled={preparing || disabled} className="min-h-10 rounded-full bg-violet-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
          {preparing ? '保存草稿中…' : '+ 添加抽奖'}
        </button>
      </div>
      <p className="mt-3 text-xs font-bold leading-5 text-[var(--foreground-muted)]">
        {activityEndAt ? '开奖时间必须早于活动结束时间。' : '请先设置活动结束时间，再添加自动抽奖。'}
      </p>
    </section>
  )
}
