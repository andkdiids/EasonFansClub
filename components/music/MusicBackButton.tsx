'use client'

import { useRouter } from 'next/navigation'

export function MusicBackButton({ fallbackHref, label }: Readonly<{
  fallbackHref: string
  label: string
}>) {
  const router = useRouter()
  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 text-sm font-black text-sky-300/80 transition hover:text-white"
      onClick={() => {
        if (window.history.length > 1) router.back()
        else router.push(fallbackHref)
      }}
    >
      ← {label}
    </button>
  )
}
