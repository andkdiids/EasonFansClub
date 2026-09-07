'use client'

import { useEffect } from 'react'

export function ForumDiscoveryDetailController({ children, hasReplyTarget = false }: Readonly<{
  children: React.ReactNode
  hasReplyTarget?: boolean
}>) {
  useEffect(() => {
    if (hasReplyTarget || window.location.hash) return
    window.scrollTo({ left: 0, top: 0, behavior: 'auto' })
  }, [hasReplyTarget])

  return <>{children}</>
}
