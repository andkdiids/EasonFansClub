'use client'

import { useEffect } from 'react'

export function ForumDiscoveryDetailController({ children }: Readonly<{ children: React.ReactNode }>) {
  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(max-width: 767px)')
    const sync = () => {
      if (media.matches) root.dataset.forumDetailDiscover = 'true'
      else delete root.dataset.forumDetailDiscover
    }
    sync()
    media.addEventListener('change', sync)
    window.addEventListener('ecfc:forum-theme-change', sync)
    return () => {
      media.removeEventListener('change', sync)
      window.removeEventListener('ecfc:forum-theme-change', sync)
      delete root.dataset.forumDetailDiscover
    }
  }, [])

  return <>{children}</>
}
