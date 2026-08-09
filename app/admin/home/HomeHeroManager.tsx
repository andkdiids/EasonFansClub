'use client'

import Link from 'next/link'
import { useState, type ChangeEvent } from 'react'
import type { HeroMediaType } from '@/lib/hero-visuals'
import type { SiteHeroSlide } from '@/lib/site-config'

const mediaTypeOptions: Array<readonly [HeroMediaType, string]> = [
  ['IMAGE', '静态图片'],
  ['ANIMATED_IMAGE', '动态图片'],
  ['VIDEO', '短视频'],
]

const emptySlide = (sortOrder: number): SiteHeroSlide => ({
  title: '',
  subtitle: '',
  buttonText: '查看详情',
  href: '#community-content',
  imageUrl: '',
  mediaType: 'IMAGE',
  mediaUrl: '',
  posterUrl: '',
  sourceUrl: '',
  isVisible: true,
  sortOrder,
})

function mediaAccept(mediaType: HeroMediaType) {
  if (mediaType === 'VIDEO') return 'video/mp4,video/webm,.mp4,.webm'
  if (mediaType === 'ANIMATED_IMAGE') return 'image/gif,image/webp,image/png,image/apng,.gif,.webp,.png'
  return 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'
}

function currentMediaUrl(slide: SiteHeroSlide) {
  return slide.mediaUrl || (slide.mediaType === 'IMAGE' || !slide.mediaType ? slide.imageUrl : '')
}

export function HomeHeroManager({ initialSlides }: { initialSlides: SiteHeroSlide[] }) {
  const [slides, setSlides] = useState(initialSlides)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState('')
  const [saving, setSaving] = useState(false)

  function update(index: number, patch: Partial<SiteHeroSlide>) {
    setSlides((current) => current.map((slide, slideIndex) => slideIndex === index ? { ...slide, ...patch } : slide))
  }

  function changeMediaType(index: number, mediaType: HeroMediaType) {
    const slide = slides[index]
    update(index, {
      mediaType,
      mediaUrl: mediaType === 'IMAGE' ? slide.imageUrl || slide.mediaUrl || '' : '',
      ...(mediaType === 'VIDEO' ? {} : { posterUrl: '' }),
    })
  }

  async function upload(index: number, event: ChangeEvent<HTMLInputElement>, kind: 'media' | 'poster' = 'media') {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const slide = slides[index]
    const uploadKey = `${index}:${kind}`
    setUploading(uploadKey)
    setMessage('')
    setError('')
    try {
      const body = new FormData()
      body.append('file', file, file.name)
      body.append('kind', kind)
      body.append('scope', 'home')
      if (kind === 'media') body.append('mediaType', slide.mediaType || 'IMAGE')
      const response = await fetch('/api/uploads/hero-media', { method: 'POST', body })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.message || 'Hero 媒体上传失败')
        return
      }
      if (kind === 'poster') {
        update(index, { posterUrl: data.url, posterSourceUrl: data.sourceUrl || '' })
        setMessage('视频封面已上传，请保存 Hero 配置')
      } else {
        update(index, {
          mediaType: data.mediaType as HeroMediaType,
          mediaUrl: data.url,
          sourceUrl: data.sourceUrl || '',
          imageUrl: data.mediaType === 'IMAGE' ? data.url : slide.imageUrl,
        })
        setMessage('Hero 媒体已上传到 COS，请保存配置')
      }
    } catch {
      setError('Hero 媒体上传失败，请稍后重试')
    } finally {
      setUploading('')
    }
  }

  function clearMedia(index: number) {
    update(index, { mediaType: 'IMAGE', mediaUrl: '', imageUrl: '', posterUrl: '', sourceUrl: '', posterSourceUrl: '' })
  }

  async function save() {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/admin/home/hero', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slides }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.message || '保存失败')
        return
      }
      setSlides(data.slides)
      setMessage(data.message || '首页 Hero 已保存')
    } catch {
      setError('保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-sky-700">Home Hero</p>
            <h1 className="mt-2 text-3xl font-black text-brand-950">首页 Hero 管理</h1>
            <p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-slate-600">
              支持静态图片、动态 GIF / Animated WebP 和短视频。视频建议使用 5–15 秒、MP4 / H.264、无音轨或静音文件，大小不超过 8MB。
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/visuals/home" className="rounded-full border border-sky-200 bg-white px-4 py-3 text-sm font-black text-brand-700">页面视觉设置</Link>
            <button type="button" onClick={() => setSlides((current) => [...current, emptySlide(current.length + 1)])} className="rounded-full bg-sky-50 px-4 py-3 text-sm font-black text-brand-700">新增 Hero</button>
            <button type="button" disabled={saving} onClick={() => void save()} className="rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-60">{saving ? '保存中…' : '保存全部'}</button>
          </div>
        </div>
      </section>

      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}

      <div className="space-y-4">
        {slides.map((slide, index) => {
          const mediaType = slide.mediaType || 'IMAGE'
          const mediaUrl = currentMediaUrl(slide)
          const previewUrl = mediaType === 'IMAGE' ? mediaUrl : slide.mediaUrl
          return (
            <article key={`${index}-${slide.sortOrder}`} className="grid gap-5 rounded-[26px] border border-sky-100 bg-white/90 p-5 shadow-sm md:grid-cols-[250px_minmax(0,1fr)]">
              <div>
                <div className="relative aspect-[16/9] overflow-hidden rounded-2xl bg-sky-950">
                  {previewUrl && mediaType === 'VIDEO' ? <video src={previewUrl} poster={slide.posterUrl || slide.imageUrl || undefined} muted loop playsInline controls className="h-full w-full object-cover" /> : null}
                  {previewUrl && mediaType !== 'VIDEO' ? <img src={previewUrl} alt={slide.title || `Hero ${index + 1}`} className="h-full w-full object-cover" /> : null}
                  {!previewUrl ? <div className="grid h-full place-items-center px-4 text-center text-sm font-black text-slate-400">暂无媒体，可先选择类型后上传</div> : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">
                    {uploading === `${index}:media` ? '上传中…' : '上传 / 替换媒体'}
                    <input type="file" accept={mediaAccept(mediaType)} onChange={(event) => void upload(index, event)} className="hidden" />
                  </label>
                  {mediaUrl ? <button type="button" onClick={() => clearMedia(index)} className="rounded-full bg-red-50 px-4 py-2 text-sm font-black text-red-700">清除当前媒体</button> : null}
                </div>
                {mediaType === 'VIDEO' ? (
                  <div className="mt-3 rounded-xl bg-sky-50 p-3">
                    <p className="text-xs font-bold leading-5 text-slate-500">建议上传视频封面，可改善移动端和弱网体验。</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className="inline-flex cursor-pointer rounded-full bg-white px-3 py-2 text-xs font-black text-brand-700">
                        {uploading === `${index}:poster` ? '上传中…' : slide.posterUrl ? '替换视频封面' : '上传视频封面'}
                        <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => void upload(index, event, 'poster')} className="hidden" />
                      </label>
                      {slide.posterUrl ? <button type="button" onClick={() => update(index, { posterUrl: '' })} className="text-xs font-black text-red-700">移除封面</button> : null}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-black text-slate-600 sm:col-span-2">Hero 媒体类型
                  <select value={mediaType} onChange={(event) => changeMediaType(index, event.target.value as HeroMediaType)} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2 font-bold">
                    {mediaTypeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <input value={slide.title} onChange={(event) => update(index, { title: event.target.value })} placeholder="标题" className="rounded-xl border border-sky-100 px-3 py-2 font-bold" />
                <input value={slide.subtitle} onChange={(event) => update(index, { subtitle: event.target.value })} placeholder="副标题" className="rounded-xl border border-sky-100 px-3 py-2 font-bold" />
                <input value={slide.buttonText} onChange={(event) => update(index, { buttonText: event.target.value })} placeholder="按钮文字" className="rounded-xl border border-sky-100 px-3 py-2 font-bold" />
                <input value={slide.href} onChange={(event) => update(index, { href: event.target.value })} placeholder="跳转链接" className="rounded-xl border border-sky-100 px-3 py-2 font-bold" />
                <input type="number" value={slide.sortOrder} onChange={(event) => update(index, { sortOrder: Number(event.target.value) })} placeholder="排序" className="rounded-xl border border-sky-100 px-3 py-2 font-bold" />
                <label className="flex items-center gap-2 rounded-xl border border-sky-100 px-3 py-2 text-sm font-black text-slate-600"><input type="checkbox" checked={slide.isVisible} onChange={(event) => update(index, { isVisible: event.target.checked })} />启用</label>
                <button type="button" onClick={() => setSlides((current) => current.filter((_, slideIndex) => slideIndex !== index))} className="justify-self-start rounded-full bg-red-50 px-4 py-2 text-sm font-black text-red-700">删除此 Hero</button>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
