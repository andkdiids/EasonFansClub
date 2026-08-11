'use client'

import { useEffect } from 'react'

/**
 * Stop the browser's image ghost/URL drag without touching application-level
 * pointer or sortable interactions. Explicitly draggable containers remain
 * available for editors that own the drag gesture.
 */
export function DisableNativeImageDrag() {
  useEffect(() => {
    function preventNativeImageDrag(event: DragEvent) {
      const target = event.target
      if (!(target instanceof HTMLImageElement)) return
      if (target.closest('[data-allow-native-image-drag="true"], [draggable="true"]')) return
      event.preventDefault()
    }

    document.addEventListener('dragstart', preventNativeImageDrag, true)
    return () => document.removeEventListener('dragstart', preventNativeImageDrag, true)
  }, [])

  return null
}
