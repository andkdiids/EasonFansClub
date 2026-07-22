'use client'

import { useEffect, useState } from 'react'

type Theme = 'day' | 'midnight'

function resolvedTheme(): Theme {
  if (typeof window === 'undefined') return 'day'
  const saved = window.localStorage.getItem('ecfc-theme')
  if (saved === 'day' || saved === 'midnight') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'midnight' : 'day'
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('day')

  useEffect(() => setTheme(resolvedTheme()), [])

  function toggle() {
    const next = theme === 'day' ? 'midnight' : 'day'
    setTheme(next)
    window.localStorage.setItem('ecfc-theme', next)
    document.documentElement.dataset.theme = next
    document.documentElement.style.colorScheme = next === 'midnight' ? 'dark' : 'light'
  }

  return (
    <button type="button" onClick={toggle} aria-label={theme === 'day' ? '切换到深夜主题' : '切换到日间主题'} className={className}>
      <span aria-hidden="true">{theme === 'day' ? '☾' : '☀'}</span>
    </button>
  )
}
