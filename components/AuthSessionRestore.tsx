'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { installAuthenticatedFetchGuard } from '@/lib/client-auth'

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
    return installAuthenticatedFetchGuard()
  }, [])

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
        // Only an explicit `{ user: null }` or a complete user object is
        // authoritative. A malformed 2xx response must not refresh the shell
        // into an anonymous state.
        if (!body || !Object.prototype.hasOwnProperty.call(body, 'user')) return
        if (body.user !== null && typeof body.user?.id !== 'string') return
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
