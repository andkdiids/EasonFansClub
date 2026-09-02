'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'

export type MaterialReferenceMaterial = {
  id: string
  title: string
  coverImageUrl: string | null
  cost: number
  stockRemaining: number
  state: string
  stateLabel: string
  linkedActivity: { id: string; title: string } | null
}

type MaterialReferenceSearchResponse = { materials?: MaterialReferenceMaterial[] }

export function MaterialReferencePicker({
  open,
  onClose,
  onSelect,
}: Readonly<{
  open: boolean
  onClose: () => void
  onSelect: (material: MaterialReferenceMaterial) => void
}>) {
  const [query, setQuery] = useState('')
  const [materials, setMaterials] = useState<MaterialReferenceMaterial[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setQuery('')
    setMaterials([])
    setError('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const trimmedQuery = query.trim()
    setMaterials([])
    setError('')
    if (!trimmedQuery) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void fetch(`/api/material-redemptions/reference-search?q=${encodeURIComponent(trimmedQuery)}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('物料搜索失败')
          return await response.json() as MaterialReferenceSearchResponse
        })
        .then((data) => setMaterials(Array.isArray(data.materials) ? data.materials.slice(0, 15) : []))
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === 'AbortError') return
          setError(reason instanceof Error ? reason.message : '物料搜索失败，请稍后重试')
          setMaterials([])
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false)
        })
    }, 300)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, query])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="flex max-h-[min(680px,calc(100dvh-32px))] w-full max-w-lg flex-col border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="material-reference-picker-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="material-reference-picker-title" className="text-lg font-black text-brand-950">引用物料</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">引用物料定义本身，库存与兑换状态会按最新数据更新。</p>
          </div>
          <button type="button" className="shrink-0 px-2 py-1 text-lg font-black text-slate-500" aria-label="关闭物料搜索" onClick={onClose}>×</button>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索物料名称或关联活动"
          aria-label="搜索引用物料"
          className="mt-4 min-h-11 w-full border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-sm font-bold text-brand-950 outline-none focus:border-brand-500"
        />
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto" aria-live="polite">
          {!query.trim() ? <p className="p-4 text-sm font-bold text-slate-500">输入物料名称或关联活动搜索</p> : null}
          {isLoading ? <p className="p-4 text-sm font-bold text-slate-500">搜索中…</p> : null}
          {error ? <p className="p-4 text-sm font-bold text-red-600" role="alert">{error}</p> : null}
          {!isLoading && !error && query.trim() && !materials.length ? <p className="p-4 text-sm font-bold text-slate-500">没有匹配的公开物料</p> : null}
          <div className="grid gap-2">
            {materials.map((material) => (
              <button
                key={material.id}
                type="button"
                className="flex min-w-0 items-center gap-3 border border-[var(--border)] bg-[var(--surface-subtle)] p-3 text-left transition hover:border-brand-300 hover:bg-sky-50"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(material)}
              >
                <span className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-amber-100 text-xl font-black text-amber-700">
                  {material.coverImageUrl ? <Image src={material.coverImageUrl} alt="" fill sizes="56px" className="object-cover" /> : '物料'}
                </span>
                <span className="min-w-0">
                  <span className="block break-words font-black text-brand-950">{material.title}</span>
                  <span className="mt-1 block break-words text-xs font-bold text-slate-500">
                    {[`所需挂号费 ${material.cost}`, `库存 ${material.stockRemaining}`, material.stateLabel, material.linkedActivity?.title].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
