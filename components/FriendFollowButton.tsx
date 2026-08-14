'use client'

import { useEffect, useState } from 'react'

export function FriendFollowButton({
  userId,
  initialFollowed,
  compact = false,
  hideWhenFollowed = false,
  onChanged,
}: Readonly<{
  userId: string
  initialFollowed: boolean
  compact?: boolean
  hideWhenFollowed?: boolean
  onChanged?: (followed: boolean) => void
}>) {
  const [followed, setFollowed] = useState(initialFollowed)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setFollowed(initialFollowed)
  }, [initialFollowed])

  async function toggleFollow() {
    if (isSubmitting) return
    setError('')
    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/friends/${encodeURIComponent(userId)}/follow`, {
        method: followed ? 'DELETE' : 'POST',
        credentials: 'same-origin',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '操作失败，请稍后重试')

      const nextFollowed = data.followed === true
      setFollowed(nextFollowed)
      onChanged?.(nextFollowed)
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : '操作失败，请稍后重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (hideWhenFollowed && followed) return null

  const buttonClass = compact
    ? 'inline-flex h-6 shrink-0 items-center rounded-full border border-[var(--border)] bg-transparent px-1.5 text-[11px] font-black leading-none text-[var(--primary)] transition hover:bg-[var(--accent)] disabled:cursor-wait disabled:opacity-60'
    : 'inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2.5 text-sm font-black text-[var(--primary)] shadow-sm transition hover:bg-[var(--accent)] disabled:cursor-wait disabled:opacity-60'

  return (
    <span className={`inline-flex min-w-0 items-center ${compact ? 'gap-1' : 'flex-wrap gap-1.5'}`}>
      <button type="button" onClick={() => void toggleFollow()} disabled={isSubmitting} className={buttonClass}>
        {isSubmitting ? '处理中…' : followed ? '取消关注' : '关注'}
      </button>
      {error ? <span role="alert" className="text-[11px] font-bold text-[var(--danger)]">{error}</span> : null}
    </span>
  )
}
