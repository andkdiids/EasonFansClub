'use client'

import { useRouter } from 'next/navigation'

export function BackButton({ fallbackHref = '/', label = '返回上一页' }: Readonly<{ fallbackHref?: string; label?: string }>) {
  const router = useRouter()
  function goBack() {
    if (window.history.length > 1) return router.back()
    router.push(fallbackHref)
  }
  return <button type="button" onClick={goBack} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-sky-100 bg-white/88 px-4 py-2 text-sm font-black text-brand-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-sky-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" aria-label={label}><span aria-hidden="true">←</span><span>{label}</span></button>
}
