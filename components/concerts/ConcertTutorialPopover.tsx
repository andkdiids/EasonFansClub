'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import type { EventView } from '@/components/concerts/concert-types'
import { publicImageUrl } from '@/lib/images'

type Tutorial = EventView['tutorials'][number]

function safeExternalUrl(value: string | null) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : null
  } catch { return null }
}

export function ConcertTutorialPopover({ tutorials, registrationUrl }: Readonly<{
  tutorials: Tutorial[]
  registrationUrl: string | null
}>) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (window.location.hash === '#tutorials') setOpen(true)
  }, [])

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return <div id="tutorials" ref={containerRef} className="relative scroll-mt-24">
    <button ref={triggerRef} type="button" aria-expanded={open} aria-controls="concert-registration-guide" onClick={() => setOpen((value) => !value)} className="inline-flex min-h-10 items-center border border-white/40 bg-slate-950/75 px-3 text-xs font-black text-white shadow-sm backdrop-blur-sm hover:bg-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:min-h-11 sm:px-4 sm:text-sm">
      登记抽签指南 <span className="ml-2" aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    {open ? <section id="concert-registration-guide" role="dialog" aria-modal="false" aria-labelledby="concert-registration-guide-title" className="fixed inset-x-3 top-20 z-[100] max-h-[calc(100dvh-6rem)] overflow-y-auto border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--foreground)] shadow-2xl sm:inset-x-auto sm:right-5 sm:w-[min(34rem,calc(100vw-2.5rem))] sm:p-5">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
        <div><h2 id="concert-registration-guide-title" className="text-lg font-black">登记抽签步骤</h2><p className="mt-1 text-xs leading-5 text-[var(--foreground-muted)]">请以主办方最新公告为准。</p></div>
        <button ref={closeRef} type="button" onClick={() => { setOpen(false); triggerRef.current?.focus() }} aria-label="关闭登记抽签指南" className="grid h-10 w-10 shrink-0 place-items-center border border-[var(--border)] text-lg font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)]">×</button>
      </header>
      <p className="mt-3 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">登记与购票操作均在外部官方服务完成。私家E院不会收集外部账号密码，请勿在本站填写。</p>
      {tutorials.length ? <div className="mt-3 space-y-3">{tutorials.map((tutorial) => <article key={tutorial.id} className="border border-[var(--border)] bg-[var(--background)] p-3">
        <h3 className="font-black">{tutorial.title}</h3>
        {tutorial.summary ? <p className="mt-1 text-xs leading-5 text-[var(--foreground-muted)]">{tutorial.summary}</p> : null}
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6">{Array.isArray(tutorial.steps) ? tutorial.steps.map((raw, index) => {
          const step = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as { title?: unknown; body?: unknown; imageUrl?: unknown; imageAlt?: unknown; caution?: unknown; linkUrl?: unknown; linkLabel?: unknown } : {}
          const imageUrl = typeof step.imageUrl === 'string' ? publicImageUrl(step.imageUrl) : null
          const linkUrl = typeof step.linkUrl === 'string' ? safeExternalUrl(step.linkUrl) : null
          return <li key={`${tutorial.id}-${index}`}>
            <strong>{typeof step.title === 'string' ? step.title : '步骤'}</strong>{typeof step.body === 'string' ? <span>：{step.body}</span> : null}
            {imageUrl ? <figure className="mt-2"><a href={imageUrl} target="_blank" rel="noopener noreferrer" aria-label={`打开大图：${typeof step.imageAlt === 'string' ? step.imageAlt : step.title || '教程图片'}`}><Image src={imageUrl} alt={typeof step.imageAlt === 'string' ? step.imageAlt : typeof step.title === 'string' ? step.title : '教程图片'} width={1600} height={900} className="h-auto max-h-72 w-full border border-[var(--border)] object-contain" unoptimized /></a></figure> : null}
            {typeof step.caution === 'string' && step.caution ? <p className="mt-2 border-l-2 border-amber-500 px-3 py-1 text-xs leading-5 text-amber-800 dark:text-amber-200">注意：{step.caution}</p> : null}
            {linkUrl ? <a className="mt-1 inline-block min-h-9 text-sm font-bold text-[var(--primary)]" href={linkUrl} target="_blank" rel="noopener noreferrer">{typeof step.linkLabel === 'string' && step.linkLabel ? step.linkLabel : '打开相关链接'} ↗</a> : null}
          </li>
        }) : null}</ol>
        {tutorial.type === 'TICKETING' && registrationUrl ? <a className="mt-2 inline-flex min-h-10 items-center font-bold text-[var(--primary)]" href={registrationUrl} target="_blank" rel="noopener noreferrer">查看外部登记服务 ↗</a> : null}
      </article>)}</div> : <p className="mt-3 text-sm text-[var(--foreground-muted)]">管理员暂未发布详细步骤，请查看主办方官方通知。</p>}
    </section> : null}
  </div>
}
