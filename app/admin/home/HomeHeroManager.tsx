'use client'

import { useState, type ChangeEvent } from 'react'
import type { SiteHeroSlide } from '@/lib/site-config'

const emptySlide = (sortOrder: number): SiteHeroSlide => ({ title: '', subtitle: '', buttonText: '查看详情', href: '#community-content', imageUrl: '', isVisible: true, sortOrder })

export function HomeHeroManager({ initialSlides }: { initialSlides: SiteHeroSlide[] }) {
  const [slides, setSlides] = useState(initialSlides)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  function update(index: number, patch: Partial<SiteHeroSlide>) {
    setSlides((current) => current.map((slide, slideIndex) => slideIndex === index ? { ...slide, ...patch } : slide))
  }

  async function upload(index: number, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(index)
    const body = new FormData()
    body.append('file', file)
    const response = await fetch('/api/uploads/site-image', { method: 'POST', body })
    const data = await response.json().catch(() => null)
    setUploading(null)
    if (!response.ok) {
      setError(data?.message || '图片上传失败')
      return
    }
    update(index, { imageUrl: data.url })
    setMessage('图片已转换为 WebP 并上传 COS，请保存 Hero。')
  }

  async function save() {
    setSaving(true)
    setMessage('')
    setError('')
    const response = await fetch('/api/admin/home/hero', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slides }) })
    const data = await response.json().catch(() => null)
    setSaving(false)
    if (!response.ok) {
      setError(data?.message || '保存失败')
      return
    }
    setSlides(data.slides)
    setMessage(data.message || '已保存')
  }

  return <div className="space-y-6"><section className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-black uppercase tracking-[0.18em] text-sky-700">Home Hero</p><h1 className="mt-2 text-3xl font-black text-brand-950">首页 Hero 管理</h1><p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-slate-600">上传图片、编辑标题与按钮、设置排序和启用状态。前台只展示启用项，并支持自动轮播、左右切换和移动端滑动。</p></div><div className="flex gap-2"><button type="button" onClick={() => setSlides((current) => [...current, emptySlide(current.length + 1)])} className="rounded-full bg-sky-50 px-4 py-3 text-sm font-black text-brand-700">新增 Hero</button><button type="button" disabled={saving} onClick={() => void save()} className="rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-60">{saving ? '保存中…' : '保存全部'}</button></div></div></section>{message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}{error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}<div className="space-y-4">{slides.map((slide, index) => <article key={`${index}-${slide.sortOrder}`} className="grid gap-5 rounded-[26px] border border-sky-100 bg-white/90 p-5 shadow-sm md:grid-cols-[250px_minmax(0,1fr)]"><div><div className="relative aspect-[16/9] overflow-hidden rounded-2xl bg-sky-50">{slide.imageUrl ? <img src={slide.imageUrl} alt={slide.title || `Hero ${index + 1}`} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-sm font-black text-slate-400">暂无图片</div>}</div><label className="mt-3 inline-flex cursor-pointer rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">{uploading === index ? '上传中…' : '上传图片（自动 WebP）'}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => void upload(index, event)} className="hidden" /></label></div><div className="grid gap-3 sm:grid-cols-2"><input value={slide.title} onChange={(event) => update(index, { title: event.target.value })} placeholder="标题" className="rounded-xl border border-sky-100 px-3 py-2 font-bold" /><input value={slide.subtitle} onChange={(event) => update(index, { subtitle: event.target.value })} placeholder="副标题" className="rounded-xl border border-sky-100 px-3 py-2 font-bold" /><input value={slide.buttonText} onChange={(event) => update(index, { buttonText: event.target.value })} placeholder="按钮文字" className="rounded-xl border border-sky-100 px-3 py-2 font-bold" /><input value={slide.href} onChange={(event) => update(index, { href: event.target.value })} placeholder="跳转链接" className="rounded-xl border border-sky-100 px-3 py-2 font-bold" /><input type="number" value={slide.sortOrder} onChange={(event) => update(index, { sortOrder: Number(event.target.value) })} placeholder="排序" className="rounded-xl border border-sky-100 px-3 py-2 font-bold" /><label className="flex items-center gap-2 rounded-xl border border-sky-100 px-3 py-2 text-sm font-black text-slate-600"><input type="checkbox" checked={slide.isVisible} onChange={(event) => update(index, { isVisible: event.target.checked })} />启用</label><button type="button" onClick={() => setSlides((current) => current.filter((_, slideIndex) => slideIndex !== index))} className="justify-self-start rounded-full bg-red-50 px-4 py-2 text-sm font-black text-red-700">删除此 Hero</button></div></article>)}</div></div>
}
