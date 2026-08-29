'use client'

import { useEffect, useState } from 'react'

export function useIsDesktopMediaQuery() {
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)')
    const sync = () => setIsDesktop(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  return isDesktop
}
