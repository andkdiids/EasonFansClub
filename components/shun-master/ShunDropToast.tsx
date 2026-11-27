'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

export function ShunDropToast({ userId }: { userId: string }) {
  const [name, setName] = useState('')
  useEffect(() => {
    let stopped = false
    let lastSeen = ''
    let hide: number | undefined
    const storageKey = `ecfc-shun-drop:${userId}`
    try { lastSeen = localStorage.getItem(storageKey) ?? '' } catch { /* private storage is optional */ }
    async function poll() {
      if (document.visibilityState !== 'visible') return
      try {
        const response = await fetch('/api/shun-master/item-drop', { cache: 'no-store' })
        if (!response.ok || stopped) return
        const data: { drop: { id: string; name: string } | null } = await response.json()
        if (stopped || !data.drop || data.drop.id === lastSeen) return
        lastSeen = data.drop.id
        try { localStorage.setItem(storageKey, lastSeen) } catch { /* in-memory deduplication is retained */ }
        setName(data.drop.name)
        window.dispatchEvent(new Event('shun-item-acquired'))
        window.clearTimeout(hide)
        hide = window.setTimeout(() => setName(''), 7000)
      } catch { /* retry next poll without interrupting the active page */ }
    }
    const interval = window.setInterval(() => void poll(), 15_000)
    void poll()
    return () => {
      stopped = true
      window.clearInterval(interval)
      window.clearTimeout(hide)
    }
  }, [userId])

  return name ? <aside className="fixed bottom-24 right-4 z-50 max-w-[calc(100vw-2rem)] border border-amber-700 bg-neutral-950 p-3 text-amber-100 shadow-lg" role="status">
    <Link href="/shun-master?items=1" onClick={() => setName('')}>
      <strong className="block">意外收获！</strong>
      <span>获得顺大师道具 · {name}</span>
    </Link>
  </aside> : null
}
