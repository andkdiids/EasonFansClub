'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function DeleteCommentButton({
  endpoint,
  label = '删除',
}: Readonly<{
  endpoint: string
  label?: string
}>) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  async function deleteComment() {
    if (isDeleting) return
    setError('')
    setMessage('')
    setIsDeleting(true)
    const response = await fetch(endpoint, { method: 'DELETE' })
    const data = await response.json().catch(() => ({}))
    setIsDeleting(false)

    if (!response.ok) {
      setError(data.message || '删除失败')
      return
    }

    setConfirmDelete(false)
    setMessage('删除成功')
    router.refresh()
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => setConfirmDelete(true)}
        disabled={isDeleting}
        className="rounded-full bg-red-50 px-3 py-1 text-xs font-black text-red-600 disabled:opacity-60"
      >
        {isDeleting ? '删除中...' : label}
      </button>

      {confirmDelete ? (
        <span className="fixed inset-0 z-50 grid place-items-center bg-slate-950/25 px-4 backdrop-blur-sm">
          <span className="block w-full max-w-sm rounded-[24px] border border-sky-100 bg-white p-6 text-left shadow-2xl shadow-sky-900/15">
            <strong className="block text-xl font-black text-brand-950">确认删除评论</strong>
            <span className="mt-3 block text-sm font-bold leading-7 text-slate-600">删除后普通用户无法再看到这条评论，是否继续？</span>
            <span className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={isDeleting}
                className="rounded-full bg-sky-50 px-5 py-3 text-sm font-black text-brand-700 disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                onClick={deleteComment}
                disabled={isDeleting}
                className="rounded-full bg-red-600 px-5 py-3 text-sm font-black text-white disabled:opacity-60"
              >
                {isDeleting ? '删除中...' : '确认删除'}
              </button>
            </span>
          </span>
        </span>
      ) : null}

      {message ? <span className="text-xs font-bold text-emerald-600">{message}</span> : null}
      {error ? <span className="text-xs font-bold text-red-600">{error}</span> : null}
    </span>
  )
}
