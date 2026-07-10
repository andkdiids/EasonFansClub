'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type AddFriendStatus = 'NONE' | 'PENDING' | 'FRIEND' | 'RECEIVED'

export function AddFriendButton({
  uid,
  initialStatus,
}: Readonly<{ uid: number; initialStatus: AddFriendStatus }>) {
  const router = useRouter()
  const [status, setStatus] = useState<AddFriendStatus>(initialStatus)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function sendRequest() {
    if (isSubmitting || status !== 'NONE') return
    setError('')
    setIsSubmitting(true)

    const response = await fetch('/api/friends/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid }),
    })
    const data = await response.json().catch(() => ({}))
    setIsSubmitting(false)

    if (!response.ok) {
      setError(data.message || '发送失败')
      return
    }

    setStatus(data.status === 'FRIEND' ? 'FRIEND' : 'PENDING')
    router.refresh()
  }

  const label =
    status === 'FRIEND'
      ? '已是好友'
      : status === 'PENDING'
        ? '等待通过'
        : status === 'RECEIVED'
          ? '对方已申请你'
          : isSubmitting
            ? '发送中...'
            : '添加好友'

  return (
    <div>
      <button
        onClick={sendRequest}
        disabled={isSubmitting || status !== 'NONE'}
        className={`rounded-full px-4 py-2 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-70 ${
          status === 'NONE' ? 'bg-brand-950 text-white hover:bg-brand-800' : 'bg-sky-100 text-brand-700'
        }`}
      >
        {label}
      </button>
      {error ? <p className="mt-2 text-xs font-bold text-red-600">{error}</p> : null}
    </div>
  )
}

export function FriendRequestDecision({ requestId }: Readonly<{ requestId: string }>) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function decide(action: 'accept' | 'reject') {
    if (isSubmitting) return
    setError('')
    setIsSubmitting(true)

    const response = await fetch(`/api/friends/requests/${requestId}/${action}`, {
      method: 'POST',
    })
    const data = await response.json().catch(() => ({}))
    setIsSubmitting(false)

    if (!response.ok) {
      setError(data.message || '操作失败')
      return
    }

    router.refresh()
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        onClick={() => decide('accept')}
        disabled={isSubmitting}
        className="rounded-full bg-brand-950 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
      >
        同意
      </button>
      <button
        onClick={() => decide('reject')}
        disabled={isSubmitting}
        className="rounded-full bg-white px-4 py-2 text-sm font-black text-slate-600 disabled:opacity-60"
      >
        拒绝
      </button>
      {error ? <p className="w-full text-xs font-bold text-red-600">{error}</p> : null}
    </div>
  )
}
