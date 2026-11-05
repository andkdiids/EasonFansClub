'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function PostScheduleCancelButton({ postId }: Readonly<{ postId: string }>) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function cancel() {
    if (pending) return
    setPending(true)
    setError('')
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/schedule`, { method: 'DELETE' })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(typeof data?.message === 'string' ? data.message : '取消定时发布失败')
        return
      }
      router.refresh()
    } catch {
      setError('网络连接失败，取消定时发布未完成')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mt-3">
      <button type="button" disabled={pending} onClick={() => void cancel()} className="rounded-full border border-violet-300 bg-white px-4 py-2 text-sm font-black text-violet-800 disabled:opacity-50">
        {pending ? '取消中…' : '取消定时发布'}
      </button>
      {error ? <p role="alert" className="mt-2 text-sm font-bold text-red-700">{error}</p> : null}
    </div>
  )
}
