'use client'

import { useEffect, useState } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'
import { formatUid } from '@/lib/uid'

export type UserMentionUser = {
  id: string
  uid: number
  displayName: string
  avatarUrl: string | null
}

type UserMentionSearchResponse = { users?: UserMentionUser[] }

export function UserMentionPicker({
  open,
  onClose,
  onSelect,
}: Readonly<{
  open: boolean
  onClose: () => void
  onSelect: (user: UserMentionUser) => void
}>) {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<UserMentionUser[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setQuery('')
    setUsers([])
    setError('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const trimmedQuery = query.trim()
    setUsers([])
    setError('')
    if (!trimmedQuery) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void fetch(`/api/users/mention-search?q=${encodeURIComponent(trimmedQuery)}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('用户搜索失败')
          return await response.json() as UserMentionSearchResponse
        })
        .then((data) => setUsers(Array.isArray(data.users) ? data.users.slice(0, 15) : []))
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === 'AbortError') return
          setError(reason instanceof Error ? reason.message : '用户搜索失败，请稍后重试')
          setUsers([])
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false)
        })
    }, 300)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, query])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="flex max-h-[min(680px,calc(100dvh-32px))] w-full max-w-md flex-col border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="user-mention-picker-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="user-mention-picker-title" className="text-lg font-black text-brand-950">@用户</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">纯数字必须输入完整 5 位 UID；名称支持模糊匹配。</p>
          </div>
          <button type="button" className="shrink-0 px-2 py-1 text-lg font-black text-slate-500" aria-label="关闭用户搜索" onClick={onClose}>×</button>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索 UID 或用户名称"
          aria-label="搜索 UID 或用户名称"
          className="mt-4 min-h-11 w-full border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-sm font-bold text-brand-950 outline-none focus:border-brand-500"
        />
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto" aria-live="polite">
          {!query.trim() ? <p className="p-4 text-sm font-bold text-slate-500">输入 UID 或公开名称搜索用户</p> : null}
          {isLoading ? <p className="p-4 text-sm font-bold text-slate-500">搜索中…</p> : null}
          {error ? <p className="p-4 text-sm font-bold text-red-600" role="alert">{error}</p> : null}
          {!isLoading && !error && query.trim() && !users.length ? <p className="p-4 text-sm font-bold text-slate-500">没有匹配用户</p> : null}
          <div className="grid gap-2">
            {users.map((user) => (
              <button
                key={user.id}
                type="button"
                className="flex min-w-0 items-center gap-3 border border-[var(--border)] bg-[var(--surface-subtle)] p-3 text-left transition hover:border-brand-300 hover:bg-sky-50"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(user)}
              >
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full">
                  <SafeAvatar src={user.avatarUrl} name={user.displayName} uid={user.uid} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-black text-brand-950">{user.displayName}</span>
                  <span className="mt-1 block text-xs font-bold text-slate-500">UID {formatUid(user.uid)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
