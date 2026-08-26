'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { FriendRequestReasonDialog, type FriendRequestSubmitResult } from '@/components/FriendRequestReasonDialog'

type AddFriendStatus = 'NONE' | 'PENDING' | 'FRIEND' | 'RECEIVED'

export function AddFriendButton({
  uid,
  initialStatus,
  targetName = '对方',
  onStatusChange,
}: Readonly<{
  uid: number
  initialStatus: AddFriendStatus
  targetName?: string
  onStatusChange?: (status: AddFriendStatus) => void
}>) {
  const router = useRouter()
  const [status, setStatus] = useState<AddFriendStatus>(initialStatus)
  const [error, setError] = useState('')
  const [reasonDialogOpen, setReasonDialogOpen] = useState(false)
  const conflictStatusRef = useRef<AddFriendStatus | null>(null)

  const applyStatus = (nextStatus: AddFriendStatus) => {
    setStatus(nextStatus)
    onStatusChange?.(nextStatus)
  }

  if (status === 'FRIEND') return null

  async function sendRequest(reason: string): Promise<FriendRequestSubmitResult> {
    if (status !== 'NONE') return { ok: false, message: '好友申请状态已更新，请刷新后重试' }
    setError('')
    try {
      const response = await fetch('/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, message: reason }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        if (response.status === 409 && data.status) {
          conflictStatusRef.current = data.status === 'FRIEND' ? 'FRIEND' : data.status === 'INCOMING_PENDING' ? 'RECEIVED' : 'PENDING'
        }
        const message = typeof data.message === 'string' ? data.message : '发送失败，请稍后重试'
        setError(message)
        return { ok: false, message, code: typeof data.code === 'string' ? data.code : undefined }
      }

      applyStatus('PENDING')
      window.dispatchEvent(new Event('friend-dock:refresh'))
      window.dispatchEvent(new Event('unread-summary:refresh'))
      router.refresh()
      return { ok: true }
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '发送失败，请稍后重试'
      setError(message)
      return { ok: false, message }
    }
  }

  const label =
    status === 'PENDING'
        ? '已发送申请'
        : status === 'RECEIVED'
          ? '对方已申请你'
          : '添加好友'

  return (
    <>
      <div>
        <button
          type="button"
          onClick={() => {
            conflictStatusRef.current = null
            setReasonDialogOpen(true)
          }}
          disabled={status !== 'NONE'}
          className={`rounded-full px-4 py-2 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-70 ${
            status === 'NONE'
              ? 'border border-sky-100 bg-brand-950 text-white shadow-sm hover:bg-brand-800'
              : 'border border-sky-100 bg-sky-50 text-brand-700 shadow-sm'
          }`}
        >
          {label}
        </button>
        {error ? <p className="mt-2 text-xs font-bold text-red-600">{error}</p> : null}
      </div>
      <FriendRequestReasonDialog
        open={reasonDialogOpen}
        targetName={targetName}
        onClose={() => {
          setReasonDialogOpen(false)
          const nextStatus = conflictStatusRef.current
          conflictStatusRef.current = null
          if (nextStatus) {
            setStatus(nextStatus)
            onStatusChange?.(nextStatus)
          } else if (status !== 'NONE') onStatusChange?.(status)
        }}
        onSubmit={sendRequest}
      />
    </>
  )
}

export function FriendRequestDecision({ requestId, onCompleted }: Readonly<{
  requestId: string
  onCompleted?: (action: 'accept' | 'reject') => void
}>) {
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

    window.dispatchEvent(new Event('friend-dock:refresh'))
    window.dispatchEvent(new Event('unread-summary:refresh'))
    onCompleted?.(action)
    router.refresh()
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        onClick={() => decide('accept')}
        disabled={isSubmitting}
        className="rounded-full bg-brand-950 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
      >
        接受
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

export function FriendRequestCancel({ requestId }: Readonly<{ requestId: string }>) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function cancel() {
    if (isSubmitting || !window.confirm('确定取消这条好友申请吗？')) return
    setError('')
    setIsSubmitting(true)
    const response = await fetch(`/api/friends/requests/${requestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    })
    const data = await response.json().catch(() => ({}))
    setIsSubmitting(false)
    if (!response.ok) {
      setError(data.message || '取消失败')
      return
    }
    window.dispatchEvent(new Event('friend-dock:refresh'))
    window.dispatchEvent(new Event('unread-summary:refresh'))
    router.refresh()
  }

  return (
    <div className="mt-3">
      <button type="button" onClick={cancel} disabled={isSubmitting} className="min-h-11 rounded-full bg-white px-4 text-sm font-black text-slate-600 disabled:opacity-60">
        {isSubmitting ? '取消中...' : '取消申请'}
      </button>
      {error ? <p className="mt-2 text-xs font-bold text-red-600">{error}</p> : null}
    </div>
  )
}
