'use client'

import React, { useState } from 'react'

export function AndroidDownloadShareButton({ url }: { url: string }) {
  const [status, setStatus] = useState('')

  async function sharePage() {
    if (typeof navigator === 'undefined') return

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: '私家E院 Android 内测版', text: '查看并下载私家E院 Android 内测版', url })
        setStatus('已打开分享菜单')
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      setStatus('下载页链接已复制')
    } catch {
      setStatus('请复制浏览器地址栏中的下载页链接')
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button type="button" onClick={() => void sharePage()} className="min-h-11 rounded-full border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
        分享下载页
      </button>
      <span role="status" aria-live="polite" className="min-h-5 text-xs text-slate-500">{status}</span>
    </div>
  )
}
