'use client'

import { useEffect, useState } from 'react'

/**
 * Returns the current document visibility without adding any work while the
 * page is visible. Media components use this to stop their own animation
 * loops when the browser tab is backgrounded.
 */
export function usePageVisibility() {
  const [isPageVisible, setIsPageVisible] = useState(() => (
    typeof document === 'undefined' || document.visibilityState === 'visible'
  ))

  useEffect(() => {
    const syncVisibility = () => {
      setIsPageVisible(document.visibilityState === 'visible')
    }

    syncVisibility()
    document.addEventListener('visibilitychange', syncVisibility)
    return () => document.removeEventListener('visibilitychange', syncVisibility)
  }, [])

  return isPageVisible
}
