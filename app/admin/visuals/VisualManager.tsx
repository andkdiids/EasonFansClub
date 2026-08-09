'use client'

import { useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
import { HeroBackground } from '@/components/HeroBackground'
import {
  HERO_SCALE_DEFAULT,
  HERO_SCALE_MAX,
  HERO_SCALE_MIN,
  heroFitModes,
  heroMediaTypes,
  normalizeHeroScale,
  type HeroFitMode,
  type HeroMediaType,
  type PageVisualKey,
  type SiteHeroVisualConfig,
} from '@/lib/hero-visuals'
import { resolveHeroSlideVisual, type SiteAppearanceConfig, type SiteHeroSlide } from '@/lib/site-config'

type Device = 'desktop' | 'mobile'
type HeroImageTarget = 'desktopHero' | 'mobileHero'
type DragState = {
  pointerId: number
  device: Device
  startX: number
  startY: number
  positionX: number
  positionY: number
  width: number
  height: number
}

const visualLabels: Record<PageVisualKey, { title: string; description: string }> = {
  login: { title: '登录页', description: '设置登录页背景媒体与桌面、移动端构图。' },
  register: { title: '注册页', description: '设置注册页背景媒体与桌面、移动端构图。' },
  welcome: { title: '欢迎页', description: '设置欢迎页背景媒体与桌面、移动端构图。' },
  home: { title: '首页 Hero', description: '设置首页 Hero 的桌面端 / 移动端图片、媒体、构图与响应式显示。' },
}

const mediaTypeLabels: Record<HeroMediaType, string> = {
  IMAGE: '静态图片',
  ANIMATED_IMAGE: '动态图片',
  VIDEO: '短视频',
}

const fitModeLabels: Record<HeroFitMode, string> = {
  COVER: '填满',
  CONTAIN: '完整显示',
  CUSTOM: '自定义',
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)))

function mediaAccept(mediaType: HeroMediaType) {
  if (mediaType === 'VIDEO') return 'video/mp4,video/webm,.mp4,.webm'
  if (mediaType === 'ANIMATED_IMAGE') return 'image/gif,image/webp,image/png,image/apng,.gif,.webp,.png'
  return 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'
}

export function VisualManager({ initialConfig, visualKey }: Readonly<{ initialConfig: SiteAppearanceConfig; visualKey: PageVisualKey }>) {
  const [config, setConfig] = useState(initialConfig)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [heroUploading, setHeroUploading] = useState<HeroImageTarget | ''>('')
  const [selectedHomeHeroIndex, setSelectedHomeHeroIndex] = useState<number | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const visual = config.heroVisuals[visualKey]
  const homeHeroEntries = config.heroSlides
    .map((slide, index) => ({ slide, index }))
    .filter(({ slide }) => slide.isVisible)
    .sort((a, b) => a.slide.sortOrder - b.slide.sortOrder)
  const defaultHomeHeroIndex = homeHeroEntries[0]?.index ?? null
  const activeHomeHeroEntry = visualKey === 'home'
    ? homeHeroEntries.find(({ index }) => index === selectedHomeHeroIndex) || homeHeroEntries[0]
    : null
  const homeSlide = activeHomeHeroEntry?.slide || null
  const activeHomeHeroIndex = activeHomeHeroEntry?.index ?? defaultHomeHeroIndex
  const editingVisual = visualKey === 'home'
    ? resolveHeroSlideVisual(visual, homeSlide) || visual
    : visual
  const currentMediaType = (visualKey === 'home' ? homeSlide?.mediaType : visual.mediaType) || 'IMAGE'
  const currentMediaUrl = visualKey === 'home'
    ? homeSlide?.mediaUrl || homeSlide?.imageUrl || ''
    : visual.mediaUrl || visual.imageUrl
  const currentPosterUrl = visualKey === 'home' ? homeSlide?.posterUrl || '' : visual.posterUrl || ''
  const previewVisual = editingVisual

  function updateVisual(patch: Partial<SiteHeroVisualConfig>) {
    setConfig((current) => ({
      ...current,
      heroVisuals: {
        ...current.heroVisuals,
        [visualKey]: { ...current.heroVisuals[visualKey], ...patch },
      },
    }))
  }

  function updateHomeSlide(patch: Partial<SiteAppearanceConfig['heroSlides'][number]>) {
    setConfig((current) => {
      const entries = current.heroSlides
        .map((slide, index) => ({ slide, index }))
        .filter(({ slide }) => slide.isVisible)
        .sort((a, b) => a.slide.sortOrder - b.slide.sortOrder)
      const targetIndex = entries.find(({ index }) => index === selectedHomeHeroIndex)?.index ?? entries[0]?.index
      if (targetIndex === undefined) return current
      return {
        ...current,
        heroSlides: current.heroSlides.map((item, index) => index === targetIndex ? { ...item, ...patch } : item),
      }
    })
  }

  function updateComposition(patch: Partial<SiteHeroVisualConfig>) {
    if (visualKey === 'home') {
      updateHomeSlide(patch as Partial<SiteHeroSlide>)
      return
    }
    updateVisual(patch)
  }

  async function save() {
    setSaving(true)
    setMessage('')
    setError('')
    const nextHeroSlides = visualKey === 'home' && activeHomeHeroIndex !== null
      ? config.heroSlides.map((slide, index) => index === activeHomeHeroIndex
        ? {
            ...slide,
            desktopPositionX: editingVisual.desktopPositionX,
            desktopPositionY: editingVisual.desktopPositionY,
            mobilePositionX: editingVisual.mobilePositionX,
            mobilePositionY: editingVisual.mobilePositionY,
            desktopScale: editingVisual.desktopScale,
            mobileScale: editingVisual.mobileScale,
            desktopFitMode: editingVisual.desktopFitMode,
            mobileFitMode: editingVisual.mobileFitMode,
          }
        : slide)
      : config.heroSlides
    const nextConfig = {
      ...config,
      heroSlides: nextHeroSlides,
      heroVisuals: {
        ...config.heroVisuals,
        [visualKey]: { ...config.heroVisuals[visualKey], updatedAt: new Date().toISOString() },
      },
    }
    try {
      const response = await fetch('/api/admin/appearance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: nextConfig }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.message || '保存失败')
        return
      }
      setConfig(data.config)
      setMessage(`${data.config.heroVisuals[visualKey].title} 已保存`)
    } catch {
      setError('保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>, kind: 'media' | 'poster' = 'media') {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setMessage('')
    setError('')
    try {
      const body = new FormData()
      body.append('file', file, file.name)
      body.append('kind', kind)
      body.append('scope', visualKey === 'home' ? 'home' : visualKey)
      if (kind === 'media') body.append('mediaType', currentMediaType)
      const response = await fetch('/api/uploads/hero-media', { method: 'POST', body })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.message || '媒体上传失败')
        return
      }
      if (kind === 'poster') {
        if (visualKey === 'home') updateHomeSlide({ posterUrl: data.url, posterSourceUrl: data.sourceUrl || '' })
        else updateVisual({ posterUrl: data.url, posterSourceUrl: data.sourceUrl || '' })
        setMessage('视频封面已上传，请保存当前设置')
      } else {
        const patch = {
          mediaType: data.mediaType as HeroMediaType,
          mediaUrl: data.url,
          imageUrl: data.mediaType === 'IMAGE' ? data.url : visualKey === 'home' ? homeSlide?.imageUrl || '' : visual.imageUrl,
          sourceUrl: data.sourceUrl || '',
        }
        if (visualKey === 'home') updateHomeSlide(patch)
        else updateVisual(patch)
        setMessage('媒体已上传，请保存当前设置')
      }
    } catch {
      setError('媒体上传失败，请稍后重试')
    } finally {
      setUploading(false)
    }
  }

  async function uploadResponsiveHero(event: ChangeEvent<HTMLInputElement>, target: HeroImageTarget) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setHeroUploading(target)
    setMessage('')
    setError('')
    try {
      const body = new FormData()
      body.append('file', file, file.name)
      body.append('kind', 'media')
      body.append('mediaType', 'IMAGE')
      body.append('scope', target === 'desktopHero' ? 'home-desktop' : 'home-mobile')
      const response = await fetch('/api/uploads/hero-media', { method: 'POST', body })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.message || 'Hero 图片上传失败')
        return
      }
      updateVisual({
        [target]: data.url,
        mediaType: 'IMAGE',
        mediaUrl: '',
        sourceUrl: data.sourceUrl || '',
      })
      setMessage(`${target === 'desktopHero' ? '桌面端' : '移动端'} Hero 图片已上传，请保存当前设置`)
    } catch {
      setError('Hero 图片上传失败，请稍后重试')
    } finally {
      setHeroUploading('')
    }
  }

  function beginDrag(event: PointerEvent<HTMLDivElement>, device: Device) {
    const rect = event.currentTarget.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      device,
      startX: event.clientX,
      startY: event.clientY,
      positionX: device === 'desktop' ? editingVisual.desktopPositionX : editingVisual.mobilePositionX,
      positionY: device === 'desktop' ? editingVisual.desktopPositionY : editingVisual.mobilePositionY,
      width: rect.width,
      height: rect.height,
    }
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const x = clamp(drag.positionX - ((event.clientX - drag.startX) / drag.width) * 100)
    const y = clamp(drag.positionY - ((event.clientY - drag.startY) / drag.height) * 100)
    updateComposition(drag.device === 'desktop'
      ? { desktopPositionX: x, desktopPositionY: y }
      : { mobilePositionX: x, mobilePositionY: y })
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  function changeMediaType(mediaType: HeroMediaType) {
    if (visualKey === 'home') {
      updateHomeSlide({
        mediaType,
        mediaUrl: '',
        sourceUrl: '',
        ...(mediaType === 'IMAGE' ? {} : { posterUrl: '', posterSourceUrl: '' }),
      })
      return
    }
    updateVisual({ mediaType, mediaUrl: '', sourceUrl: '' })
  }

  function clearMedia() {
    if (visualKey === 'home') {
      updateHomeSlide({ mediaType: 'IMAGE', mediaUrl: '', imageUrl: '', sourceUrl: '', posterUrl: '', posterSourceUrl: '' })
    } else {
      updateVisual({ mediaType: 'IMAGE', mediaUrl: '', imageUrl: '', sourceUrl: '', posterUrl: '', posterSourceUrl: '' })
    }
  }

  const resetDevice = (device: Device) => updateComposition(device === 'desktop'
    ? { desktopPositionX: 50, desktopPositionY: 50, desktopScale: HERO_SCALE_DEFAULT, desktopFitMode: 'COVER' }
    : { mobilePositionX: 50, mobilePositionY: 50, mobileScale: HERO_SCALE_DEFAULT, mobileFitMode: 'COVER' })

  return (
    <div className="space-y-6">
      <header className="border-b border-slate-200 pb-6">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-700">Page Visual Settings</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-brand-950 sm:text-4xl">{visualLabels[visualKey].title}</h1>
            <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-500">{visualLabels[visualKey].description}</p>
            {visualKey === 'home' && homeHeroEntries.length ? <label className="mt-4 block max-w-md text-sm font-black text-slate-600">
              选择编辑 Hero
              <select
                value={String(activeHomeHeroIndex ?? '')}
                onChange={(event) => setSelectedHomeHeroIndex(Number(event.target.value))}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-bold text-brand-950"
              >
                {homeHeroEntries.map(({ slide, index }, order) => <option key={`${index}-${slide.sortOrder}`} value={index}>
                  {slide.title.trim() || `Hero ${order + 1}`}
                </option>)}
              </select>
            </label> : null}
          </div>
          <button type="button" disabled={saving} onClick={() => void save()} className="rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-60">
            {saving ? '保存中…' : '保存当前设置'}
          </button>
        </div>
      </header>

      {message ? <p className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}

      <section className="border border-slate-200 bg-white p-5 shadow-[0_8px_26px_rgba(15,23,42,.04)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="min-w-0 flex-1">
            <input aria-label="视觉设置名称" value={visual.title} onChange={(event) => updateVisual({ title: event.target.value })} className="w-full max-w-md border-0 bg-transparent p-0 text-xl font-black text-brand-950 outline-none" />
            <p className="mt-1 text-xs font-bold text-slate-400">配置键：{visualKey}{visual.updatedAt ? ` · 更新于 ${new Date(visual.updatedAt).toLocaleString('zh-CN')}` : ''}</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-black text-slate-600"><input type="checkbox" checked={visual.enabled} onChange={(event) => updateVisual({ enabled: event.target.checked })} />启用背景媒体</label>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(150px,220px)]">
              <VisualPreview visual={previewVisual} pageKey={visualKey} device="desktop" onPointerDown={(event) => beginDrag(event, 'desktop')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
              <VisualPreview visual={previewVisual} pageKey={visualKey} device="mobile" onPointerDown={(event) => beginDrag(event, 'mobile')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
            </div>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <PositionControls
                label="桌面端构图"
                x={editingVisual.desktopPositionX}
                y={editingVisual.desktopPositionY}
                scale={editingVisual.desktopScale}
                fitMode={editingVisual.desktopFitMode}
                onX={(value) => updateComposition({ desktopPositionX: value })}
                onY={(value) => updateComposition({ desktopPositionY: value })}
                onScale={(value) => updateComposition({ desktopScale: value })}
                onFitMode={(value) => updateComposition({ desktopFitMode: value })}
                onReset={() => resetDevice('desktop')}
              />
              <PositionControls
                label="移动端构图"
                x={editingVisual.mobilePositionX}
                y={editingVisual.mobilePositionY}
                scale={editingVisual.mobileScale}
                fitMode={editingVisual.mobileFitMode}
                onX={(value) => updateComposition({ mobilePositionX: value })}
                onY={(value) => updateComposition({ mobilePositionY: value })}
                onScale={(value) => updateComposition({ mobileScale: value })}
                onFitMode={(value) => updateComposition({ mobileFitMode: value })}
                onReset={() => resetDevice('mobile')}
              />
            </div>
          </div>

          <aside className="space-y-4 border-l border-slate-200 pl-0 xl:pl-5">
            {visualKey === 'home' ? <div className="space-y-3 border-b border-slate-200 pb-4">
              <div>
                <p className="text-sm font-black text-brand-950">首页 Hero 图片</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">桌面端和移动端独立保存；移动端未设置时自动使用桌面端图片。</p>
              </div>
              <label className="block cursor-pointer border border-slate-300 bg-white px-3 py-3 hover:bg-slate-50">
                <span className="block text-sm font-black text-brand-700">{heroUploading === 'desktopHero' ? '上传中…' : '桌面端 Hero 图片'}</span>
                <span className="mt-1 block text-xs font-semibold leading-5 text-slate-400">建议比例：16:6（1920×700）</span>
                <span className="mt-1 block truncate text-[11px] font-bold text-slate-500">{visual.desktopHero || visual.imageUrl ? '已设置（桌面端预览）' : '尚未设置'}</span>
                <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => void uploadResponsiveHero(event, 'desktopHero')} className="hidden" />
              </label>
              <label className="block cursor-pointer border border-slate-300 bg-white px-3 py-3 hover:bg-slate-50">
                <span className="block text-sm font-black text-brand-700">{heroUploading === 'mobileHero' ? '上传中…' : '移动端 Hero 图片'}</span>
                <span className="mt-1 block text-xs font-semibold leading-5 text-slate-400">建议比例：9:16（750×1200）</span>
                <span className="mt-1 block truncate text-[11px] font-bold text-slate-500">{visual.mobileHero ? '已设置（移动端预览）' : '未设置，自动使用桌面端'}</span>
                <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => void uploadResponsiveHero(event, 'mobileHero')} className="hidden" />
              </label>
            </div> : null}
            <label className="block text-sm font-black text-slate-600">媒体类型
              <select value={currentMediaType} onChange={(event) => changeMediaType(event.target.value as HeroMediaType)} className="mt-2 w-full border border-slate-200 px-3 py-2 text-sm font-bold outline-none focus:border-sky-400">
                {heroMediaTypes.map((type) => <option key={type} value={type}>{mediaTypeLabels[type]}</option>)}
              </select>
            </label>
            <label className="block text-xs font-black text-slate-500">当前媒体 URL
              <input value={visualKey === 'home' ? (homeSlide?.mediaUrl || homeSlide?.imageUrl || '') : (visual.mediaUrl || visual.imageUrl)} onChange={(event) => visualKey === 'home' ? updateHomeSlide({ mediaUrl: event.target.value, imageUrl: currentMediaType === 'IMAGE' ? event.target.value : homeSlide?.imageUrl || '' }) : updateVisual({ mediaUrl: event.target.value, imageUrl: currentMediaType === 'IMAGE' ? event.target.value : visual.imageUrl })} className="mt-2 w-full border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400" placeholder="https://…" />
            </label>
            <label className="inline-flex cursor-pointer border border-slate-300 bg-white px-4 py-2 text-sm font-black text-brand-700 hover:bg-slate-50">
              {uploading ? '上传中…' : `上传 / 替换${mediaTypeLabels[currentMediaType]}`}
              <input type="file" accept={mediaAccept(currentMediaType)} onChange={(event) => void upload(event)} className="hidden" />
            </label>
            {currentMediaType === 'VIDEO' ? <>
              <p className="text-xs font-semibold leading-6 text-slate-400">建议上传 5–15 秒、1080p、MP4/H.264 视频，大小不超过 8MB；视频封面可改善移动端和弱网体验。</p>
              <label className="inline-flex cursor-pointer border border-slate-300 bg-white px-4 py-2 text-xs font-black text-brand-700 hover:bg-slate-50">
                {uploading ? '上传中…' : currentPosterUrl ? '替换视频封面' : '上传视频封面'}
                <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => void upload(event, 'poster')} className="hidden" />
              </label>
              {currentPosterUrl ? <button type="button" onClick={() => visualKey === 'home' ? updateHomeSlide({ posterUrl: '', posterSourceUrl: '' }) : updateVisual({ posterUrl: '', posterSourceUrl: '' })} className="block text-left text-xs font-black text-red-700">移除视频封面</button> : null}
            </> : <p className="text-xs font-semibold leading-6 text-slate-400">建议上传宽度至少 1920px 的高清原图。系统保留 master，并优先通过降低过大尺寸优化体积，不使用低质量缩略图作为正式媒体。</p>}
            {currentMediaUrl ? <button type="button" onClick={clearMedia} className="block text-left text-xs font-black text-red-700">清除当前媒体</button> : null}
            <p className="text-xs font-semibold leading-6 text-slate-400">后台预览使用与前台相同的 HeroBackground 和构图 resolver；移动端预览比例按当前页面真实容器设置。</p>
          </aside>
        </div>
      </section>
    </div>
  )
}

function VisualPreview({ visual, pageKey, device, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: {
  visual: SiteHeroVisualConfig
  pageKey: PageVisualKey
  device: Device
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
}) {
  const x = device === 'desktop' ? visual.desktopPositionX : visual.mobilePositionX
  const y = device === 'desktop' ? visual.desktopPositionY : visual.mobilePositionY
  const isHome = pageKey === 'home'
  const aspectClass = device === 'desktop'
    ? isHome ? 'hero-preview-desktop' : 'hero-preview-page-desktop'
    : isHome ? 'hero-preview-mobile' : 'hero-preview-page-mobile'
  const overlayClass = pageKey === 'home' ? 'community-hero-overlay' : pageKey === 'welcome' ? 'welcome-overlay' : 'auth-page-overlay'

  return <div>
    <p className="mb-1 text-xs font-black uppercase tracking-[0.16em] text-slate-500">{device === 'desktop' ? '桌面端预览' : '移动端预览'}</p>
    {isHome ? <p className="mb-2 text-[11px] font-semibold text-slate-400">{device === 'desktop' ? '建议比例：16:6（1920×700）' : '建议比例：9:16（750×1200）'}</p> : null}
    <div data-visual-preview={device} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} className={`relative touch-none select-none overflow-hidden border border-slate-300 bg-[#071523] text-white ${aspectClass}`} style={{ cursor: 'grab' }}>
      <HeroBackground visual={visual} positionMode={device} />
      <div className={`pointer-events-none absolute inset-0 ${overlayClass}`} />
      <div className="pointer-events-none absolute inset-x-4 bottom-4 z-[2] sm:inset-x-6 sm:bottom-6"><span className="text-[9px] font-black tracking-[.2em] text-white/65">LIVE PREVIEW</span><strong className="mt-1 block text-base sm:text-xl">{visual.title}</strong></div>
      <span aria-hidden="true" className="pointer-events-none absolute z-[3] size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 shadow-[0_0_0_4px_rgba(0,0,0,.22)]" style={{ left: `${x}%`, top: `${y}%` }} />
      {!visual.imageUrl && !visual.mediaUrl && !visual.desktopHero && !visual.mobileHero ? <span className="pointer-events-none absolute inset-x-0 bottom-3 z-[3] text-center text-xs font-bold text-white/55">暂无媒体，可上传后预览</span> : null}
    </div>
  </div>
}

function PositionControls({ label, x, y, scale, fitMode, onX, onY, onScale, onFitMode, onReset }: {
  label: string
  x: number
  y: number
  scale: number
  fitMode: HeroFitMode
  onX: (value: number) => void
  onY: (value: number) => void
  onScale: (value: number) => void
  onFitMode: (value: HeroFitMode) => void
  onReset: () => void
}) {
  return <fieldset className="border-t border-slate-200 pt-3">
    <legend className="pr-3 text-sm font-black text-brand-950">{label}</legend>
    <label className="mt-3 block text-xs font-bold text-slate-500">显示方式
      <select value={fitMode} onChange={(event) => onFitMode(event.target.value as HeroFitMode)} className="mt-2 w-full border border-slate-200 px-2 py-2 text-xs font-bold text-brand-950">
        {heroFitModes.map((mode) => <option key={mode} value={mode}>{fitModeLabels[mode]}</option>)}
      </select>
    </label>
    <RangeControl label="横向 X" value={x} onChange={onX} />
    <RangeControl label="纵向 Y" value={y} onChange={onY} />
    <RangeControl label="缩放" value={normalizeHeroScale(scale)} min={HERO_SCALE_MIN} max={HERO_SCALE_MAX} onChange={onScale} />
    <button type="button" onClick={onReset} className="mt-3 rounded border border-slate-300 px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50">重置构图</button>
  </fieldset>
}

function RangeControl({ label, value, min = 0, max = 100, onChange }: { label: string; value: number; min?: number; max?: number; onChange: (value: number) => void }) {
  return <label className="mt-3 grid grid-cols-[64px_minmax(0,1fr)_50px] items-center gap-3 text-xs font-bold text-slate-500"><span>{label}</span><input type="range" min={min} max={max} step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-brand-700" /><output className="text-right font-black text-brand-950">{value}%</output></label>
}
