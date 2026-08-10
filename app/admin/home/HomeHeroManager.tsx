'use client'

import Link from 'next/link'
import { useState, type ChangeEvent } from 'react'
import { hasHeroMediaAsset } from '@/lib/hero-visuals'
import type { HeroMediaAsset, HeroMediaType, SiteHeroSlide } from '@/lib/site-config'

type HeroDevice = 'desktop' | 'mobile'

const mediaTypeOptions: Array<readonly [HeroMediaType, string]> = [
  ['STATIC_IMAGE', '静态图片'],
  ['ANIMATED_IMAGE', 'GIF / Animated WebP'],
  ['VIDEO', '短视频'],
]

const emptyHeroMedia = (mediaType: HeroMediaType): HeroMediaAsset => ({
  mediaType,
  imageUrl: '',
  mediaUrl: '',
  posterUrl: '',
  sourceUrl: '',
  posterSourceUrl: '',
})

const emptySlide = (sortOrder: number): SiteHeroSlide => ({
  title: '',
  subtitle: '',
  buttonText: '查看详情',
  href: '#community-content',
  imageUrl: '',
  mediaType: 'STATIC_IMAGE',
  mediaUrl: '',
  posterUrl: '',
  sourceUrl: '',
  posterSourceUrl: '',
  showTitle: true,
  showSubtitle: true,
  showButton: true,
  desktopPositionX: 50,
  desktopPositionY: 50,
  mobilePositionX: 50,
  mobilePositionY: 50,
  desktopScale: 100,
  mobileScale: 100,
  desktopFitMode: 'COVER',
  mobileFitMode: 'COVER',
  isVisible: true,
  sortOrder,
})

function mediaAccept(mediaType: HeroMediaType) {
  if (mediaType === 'VIDEO') return 'video/mp4,video/webm,.mp4,.webm'
  if (mediaType === 'ANIMATED_IMAGE') return 'image/gif,image/webp,.gif,.webp'
  return 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'
}

function mediaPreviewUrl(media: HeroMediaAsset | null) {
  return media?.mediaUrl || media?.imageUrl || media?.posterUrl || ''
}

function cacheBustedUrl(url: string, cacheKey?: string) {
  if (!url || !cacheKey) return url
  return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(cacheKey)}`
}

function DeviceMediaPanel({
  device,
  mediaType,
  previewMedia,
  cacheKey,
  hasExplicitMedia,
  uploading,
  onTypeChange,
  onUpload,
  onPosterUpload,
  onClear,
  onPosterClear,
}: {
  device: HeroDevice
  mediaType: HeroMediaType
  previewMedia: HeroMediaAsset | null
  cacheKey?: string
  hasExplicitMedia: boolean
  uploading: string
  onTypeChange: (mediaType: HeroMediaType) => void
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onPosterUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onClear: () => void
  onPosterClear: () => void
}) {
  const previewUrl = cacheBustedUrl(mediaPreviewUrl(previewMedia), cacheKey)
  const posterUrl = cacheBustedUrl(previewMedia?.posterUrl || previewMedia?.imageUrl || '', cacheKey)
  const isVideo = mediaType === 'VIDEO'
  const label = device === 'desktop' ? '桌面端媒体' : '移动端媒体'
  const uploadKey = `${device}:media`
  const posterUploadKey = `${device}:poster`

  return <section className="rounded-2xl border border-sky-100 bg-sky-50/60 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-black text-brand-950">{label}</h3>
        <p className="mt-1 text-xs font-bold text-slate-500">{hasExplicitMedia ? '已上传，可独立替换' : '未上传，请选择类型后上传'}</p>
      </div>
      <span className="text-xs font-black text-sky-700">{mediaType === 'STATIC_IMAGE' ? mediaTypeOptions[0][1] : mediaTypeOptions.find(([value]) => value === mediaType)?.[1] || mediaType}</span>
    </div>
    <div className="relative mt-3 aspect-[16/9] overflow-hidden rounded-xl bg-sky-950">
      {previewUrl && isVideo ? <video src={previewUrl} poster={posterUrl || undefined} muted loop playsInline controls className="h-full w-full object-cover" /> : null}
      {previewUrl && !isVideo ? <img src={previewUrl} alt={label} className="h-full w-full object-cover" /> : null}
      {!previewUrl ? <div className="grid h-full place-items-center px-4 text-center text-xs font-black text-slate-400">暂无媒体，请选择类型后上传</div> : null}
    </div>
    <label className="mt-3 block text-xs font-black text-slate-600">媒体类型
      <select value={mediaType} onChange={(event) => onTypeChange(event.target.value as HeroMediaType)} className="mt-1 w-full rounded-lg border border-sky-100 bg-white px-2 py-2 text-sm font-bold">
        {mediaTypeOptions.map(([value, optionLabel]) => <option key={value} value={value}>{optionLabel}</option>)}
      </select>
    </label>
    <div className="mt-3 flex flex-wrap gap-2">
      <label className="inline-flex cursor-pointer rounded-full bg-white px-3 py-2 text-xs font-black text-brand-700">
        {uploading === uploadKey ? '上传中…' : `上传 / 替换${device === 'desktop' ? '桌面端' : '移动端'}媒体`}
        <input type="file" accept={mediaAccept(mediaType)} onChange={onUpload} className="hidden" />
      </label>
      {hasExplicitMedia ? <button type="button" onClick={onClear} className="rounded-full bg-red-50 px-3 py-2 text-xs font-black text-red-700">清除{device === 'desktop' ? '桌面端' : '移动端'}媒体</button> : null}
    </div>
    {isVideo ? <div className="mt-3 rounded-xl bg-white/80 p-3">
      <p className="text-xs font-bold leading-5 text-slate-500">视频可单独设置封面，移动端会沿用当前设备媒体。</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer rounded-full bg-sky-50 px-3 py-2 text-xs font-black text-brand-700">
          {uploading === posterUploadKey ? '上传中…' : previewMedia?.posterUrl ? '替换视频封面' : '上传视频封面'}
          <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={onPosterUpload} className="hidden" />
        </label>
        {hasExplicitMedia && previewMedia?.posterUrl ? <button type="button" onClick={onPosterClear} className="text-xs font-black text-red-700">移除封面</button> : null}
      </div>
    </div> : null}
  </section>
}

export function HomeHeroManager({ initialSlides }: { initialSlides: SiteHeroSlide[] }) {
  const [slides, setSlides] = useState(initialSlides)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState('')
  const [previewVersions, setPreviewVersions] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  function update(index: number, patch: Partial<SiteHeroSlide>) {
    setSlides((current) => current.map((slide, slideIndex) => slideIndex === index ? { ...slide, ...patch } : slide))
  }

  function selectedMedia(slide: SiteHeroSlide, device: HeroDevice) {
    return (device === 'desktop' ? slide.desktopHeroMedia : slide.mobileHeroMedia) || null
  }

  function explicitMedia(slide: SiteHeroSlide, device: HeroDevice) {
    const media = selectedMedia(slide, device)
    return hasHeroMediaAsset(media) ? media : null
  }

  function markPreviewVersion(index: number, device: HeroDevice) {
    setPreviewVersions((current) => ({ ...current, [`${index}:${device}`]: String(Date.now()) }))
  }

  function syncDesktopLegacy(asset: HeroMediaAsset): Partial<SiteHeroSlide> {
    return {
      mediaType: asset.mediaType,
      mediaUrl: asset.mediaUrl,
      imageUrl: asset.imageUrl,
      posterUrl: asset.posterUrl,
      sourceUrl: asset.sourceUrl,
      posterSourceUrl: asset.posterSourceUrl,
    }
  }

  function changeMediaType(index: number, device: HeroDevice, mediaType: HeroMediaType) {
    const asset = emptyHeroMedia(mediaType)
    update(index, {
      [device === 'desktop' ? 'desktopHeroMedia' : 'mobileHeroMedia']: asset,
      ...(device === 'desktop' ? syncDesktopLegacy(asset) : {}),
    })
  }

  async function upload(index: number, device: HeroDevice, event: ChangeEvent<HTMLInputElement>, kind: 'media' | 'poster' = 'media') {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const slide = slides[index]
    const current = selectedMedia(slide, device) || emptyHeroMedia('STATIC_IMAGE')
    const uploadKey = `${device}:${kind}`
    setUploading(`${index}:${uploadKey}`)
    setMessage('')
    setError('')
    try {
      const body = new FormData()
      body.append('file', file, file.name)
      body.append('kind', kind)
      body.append('scope', `home-${index}-${device}`)
      if (kind === 'media') body.append('mediaType', current.mediaType)
      const response = await fetch('/api/uploads/hero-media', { method: 'POST', body })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.message || 'Hero 媒体上传失败')
        return
      }
      const asset: HeroMediaAsset = kind === 'poster'
        ? { ...current, posterUrl: data.url, posterSourceUrl: data.sourceUrl || '' }
        : {
            ...current,
            mediaType: data.mediaType as HeroMediaType,
            mediaUrl: data.url,
            imageUrl: data.mediaType === 'VIDEO' ? current.imageUrl || '' : data.url,
            sourceUrl: data.sourceUrl || '',
          }
      const patch: Partial<SiteHeroSlide> = {
        [device === 'desktop' ? 'desktopHeroMedia' : 'mobileHeroMedia']: asset,
        ...(device === 'desktop' ? syncDesktopLegacy(asset) : {}),
      }
      update(index, patch)
      markPreviewVersion(index, device)
      setMessage(`${device === 'desktop' ? '桌面端' : '移动端'}媒体已上传，请保存 Hero 配置`)
    } catch {
      setError('Hero 媒体上传失败，请稍后重试')
    } finally {
      setUploading('')
    }
  }

  function clearMedia(index: number, device: HeroDevice) {
    const patch: Partial<SiteHeroSlide> = device === 'desktop'
      ? { desktopHeroMedia: null, mediaType: 'STATIC_IMAGE', mediaUrl: '', imageUrl: '', posterUrl: '', sourceUrl: '', posterSourceUrl: '' }
      : { mobileHeroMedia: null }
    update(index, patch)
  }

  function clearPoster(index: number, device: HeroDevice) {
    const slide = slides[index]
    const current = selectedMedia(slide, device) || emptyHeroMedia('VIDEO')
    const asset = { ...current, posterUrl: '', posterSourceUrl: '' }
    update(index, {
      [device === 'desktop' ? 'desktopHeroMedia' : 'mobileHeroMedia']: asset,
      ...(device === 'desktop' ? syncDesktopLegacy(asset) : {}),
    })
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

  return <div className="space-y-6">
    <section className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-sky-700">Home Hero</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950">首页 Hero 管理</h1>
          <p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-slate-600">每个 Hero 都可以分别上传桌面端和移动端媒体，支持静态图片、GIF、Animated WebP 和短视频。移动端未设置时自动使用桌面端媒体。</p>
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
        const desktopMedia = explicitMedia(slide, 'desktop')
        const mobileMedia = explicitMedia(slide, 'mobile')
        const desktopField = selectedMedia(slide, 'desktop')
        const mobileField = selectedMedia(slide, 'mobile')
        const desktopType = desktopField?.mediaType || 'STATIC_IMAGE'
        const mobileType = mobileField?.mediaType || 'STATIC_IMAGE'
        return <article key={`${index}-${slide.sortOrder}`} className="grid gap-5 rounded-[26px] border border-sky-100 bg-white/90 p-5 shadow-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid gap-3 sm:grid-cols-2 md:col-span-2">
            <DeviceMediaPanel
              device="desktop"
              mediaType={desktopType}
              previewMedia={desktopMedia}
              cacheKey={previewVersions[`${index}:desktop`]}
              hasExplicitMedia={Boolean(desktopMedia)}
              uploading={uploading.replace(`${index}:`, '')}
              onTypeChange={(mediaType) => changeMediaType(index, 'desktop', mediaType)}
              onUpload={(event) => void upload(index, 'desktop', event)}
              onPosterUpload={(event) => void upload(index, 'desktop', event, 'poster')}
              onClear={() => clearMedia(index, 'desktop')}
              onPosterClear={() => clearPoster(index, 'desktop')}
            />
            <DeviceMediaPanel
              device="mobile"
              mediaType={mobileType}
              previewMedia={mobileMedia}
              cacheKey={previewVersions[`${index}:mobile`]}
              hasExplicitMedia={Boolean(mobileMedia)}
              uploading={uploading.replace(`${index}:`, '')}
              onTypeChange={(mediaType) => changeMediaType(index, 'mobile', mediaType)}
              onUpload={(event) => void upload(index, 'mobile', event)}
              onPosterUpload={(event) => void upload(index, 'mobile', event, 'poster')}
              onClear={() => clearMedia(index, 'mobile')}
              onPosterClear={() => clearPoster(index, 'mobile')}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 md:col-span-2">
            <input value={slide.title} onChange={(event) => update(index, { title: event.target.value })} placeholder="标题" className="rounded-xl border border-sky-100 px-3 py-2 font-bold" />
            <input value={slide.subtitle} onChange={(event) => update(index, { subtitle: event.target.value })} placeholder="副标题" className="rounded-xl border border-sky-100 px-3 py-2 font-bold" />
            <input value={slide.buttonText} onChange={(event) => update(index, { buttonText: event.target.value })} placeholder="按钮文字" className="rounded-xl border border-sky-100 px-3 py-2 font-bold" />
            <input value={slide.href} onChange={(event) => update(index, { href: event.target.value })} placeholder="跳转链接" className="rounded-xl border border-sky-100 px-3 py-2 font-bold" />
            <input type="number" value={slide.sortOrder} onChange={(event) => update(index, { sortOrder: Number(event.target.value) })} placeholder="排序" className="rounded-xl border border-sky-100 px-3 py-2 font-bold" />
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-100 px-3 py-2 text-sm font-black text-slate-600">
              <span className="mr-1 text-slate-500">内容显示</span>
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={slide.showTitle !== false} onChange={(event) => update(index, { showTitle: event.target.checked })} />显示标题</label>
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={slide.showSubtitle !== false} onChange={(event) => update(index, { showSubtitle: event.target.checked })} />显示副标题</label>
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={slide.showButton !== false} onChange={(event) => update(index, { showButton: event.target.checked })} />显示按钮</label>
            </div>
            <label className="flex items-center gap-2 rounded-xl border border-sky-100 px-3 py-2 text-sm font-black text-slate-600"><input type="checkbox" checked={slide.isVisible} onChange={(event) => update(index, { isVisible: event.target.checked })} />启用</label>
            <button type="button" onClick={() => setSlides((current) => current.filter((_, slideIndex) => slideIndex !== index))} className="justify-self-start rounded-full bg-red-50 px-4 py-2 text-sm font-black text-red-700">删除此 Hero</button>
          </div>
        </article>
      })}
    </div>
  </div>
}
