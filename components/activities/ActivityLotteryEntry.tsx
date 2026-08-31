'use client'

import { useEffect, useState } from 'react'
import { ActivityLotteryManager } from '@/components/activities/ActivityLotteryManager'

type ActivityLotteryEntryProps = Readonly<{
  activityId: string | null
  activityTitle: string
  registrationEndAt: string | null
  disabled?: boolean
  onPrepareActivity: () => Promise<boolean>
}>

/**
 * The lottery manager needs a persisted activity id. For a new activity we
 * keep the entry visible in the form and save a draft only when the admin
 * explicitly starts adding a lottery; this prevents orphan lottery rows.
 */
export function ActivityLotteryEntry({ activityId, activityTitle, registrationEndAt, disabled = false, onPrepareActivity }: ActivityLotteryEntryProps) {
  const [preparing, setPreparing] = useState(false)
  const [openAfterPrepare, setOpenAfterPrepare] = useState(false)

  useEffect(() => {
    if (!activityId) setOpenAfterPrepare(false)
  }, [activityId])

  if (activityId) {
    return <ActivityLotteryManager key={activityId} activityId={activityId} activityTitle={activityTitle} registrationEndAt={registrationEndAt} openOnMount={openAfterPrepare} />
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
    <section aria-label="活动抽奖" className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/60 dark:bg-violet-950/20 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black tracking-[0.18em] text-violet-700 dark:text-violet-300">活动抽奖（可选）</p>
          <p className="mt-1 text-sm font-black text-brand-950 dark:text-slate-100">暂无抽奖活动</p>
          <p className="mt-1 text-xs font-bold leading-5 text-slate-600 dark:text-slate-300">保存草稿后可添加多个独立抽奖；抽奖资格自动继承有效活动报名。</p>
        </div>
        <button type="button" onClick={() => void prepareActivity()} disabled={preparing || disabled} className="min-h-10 rounded-full bg-violet-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
          {preparing ? '保存草稿中…' : '+ 添加抽奖'}
        </button>
      </div>
      <p className="mt-3 text-xs font-bold leading-5 text-slate-500 dark:text-slate-400">
        {registrationEndAt ? '开奖时间不得早于活动报名结束时间。' : '请先设置报名结束时间，再添加自动抽奖。'}
      </p>
    </section>
  )
}
