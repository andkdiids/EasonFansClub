'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

/**
 * Re-check the HttpOnly session cookie when the app shell is hydrated. The
 * server already renders from the cookie; this handles a stale shell (for
 * example after a browser restores a tab or a session changed in another
 * context) without persisting authentication in React state.
 */
export function AuthSessionRestore({ initialUserId }: Readonly<{ initialUserId: string | null }>) {
  const router = useRouter()
  const didRequest = useRef(false)

  useEffect(() => {
    if (didRequest.current) return
    didRequest.current = true
    let cancelled = false

    void fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (cancelled || !response.ok) return
        const body = await response.json().catch(() => null) as { user?: { id?: unknown } | null } | null
        if (cancelled) return
        const resolvedUserId = typeof body?.user?.id === 'string' ? body.user.id : null
        if (resolvedUserId !== initialUserId) router.refresh()
      })
      .catch(() => {
        // A transient bootstrap failure must not discard the server-rendered
        // session. The next navigation or visibility refresh retries it.
      })

    return () => {
      cancelled = true
    }
  }, [initialUserId, router])

  return null
}
