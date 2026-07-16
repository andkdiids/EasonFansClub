'use client'

import { useEffect } from 'react'

function isEditable(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, [contenteditable="true"]'))
}

export function VirtualKeyboardManager() {
  useEffect(() => {
    const root = document.documentElement
    const baseline = window.innerHeight
    let focusOpen = false
    let restoreTimer: number | null = null

    const update = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight
      const keyboardOpen = focusOpen && baseline - viewportHeight > 140
      if (keyboardOpen) root.dataset.keyboardOpen = 'true'
      else delete root.dataset.keyboardOpen
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!isEditable(event.target)) return
      focusOpen = true
      update()
      window.setTimeout(() => (event.target as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' }), 80)
    }
    const onFocusOut = () => {
      focusOpen = false
      if (restoreTimer !== null) window.clearTimeout(restoreTimer)
      restoreTimer = window.setTimeout(update, 120)
    }
    window.visualViewport?.addEventListener('resize', update)
    window.addEventListener('resize', update)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      if (restoreTimer !== null) window.clearTimeout(restoreTimer)
      delete root.dataset.keyboardOpen
      window.visualViewport?.removeEventListener('resize', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])
  return null
}
