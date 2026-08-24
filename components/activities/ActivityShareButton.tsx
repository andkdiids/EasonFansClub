'use client'

import { useState } from 'react'

export function ActivityShareButton({ title }: Readonly<{ title: string }>) {
  const [message, setMessage] = useState('')

  async function share() {
    const url = window.location.href
    try {
      if (navigator.share) {
        await navigator.share({ title, url })
        setMessage('已打开分享面板')
      } else {
        await navigator.clipboard.writeText(url)
        setMessage('链接已复制')
      }
    } catch {
      setMessage('分享已取消')
    }
    window.setTimeout(() => setMessage(''), 2200)
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={() => void share()} className="min-h-10 rounded-full border border-sky-200 bg-white px-4 text-sm font-black text-brand-700 hover:bg-sky-50 dark:border-slate-600 dark:bg-slate-900 dark:text-sky-200 dark:hover:bg-slate-800">分享活动</button>
      {message ? <span role="status" className="text-xs font-black text-emerald-600 dark:text-emerald-300">{message}</span> : null}
    </span>
  )
}
