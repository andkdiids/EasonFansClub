'use client'

import { useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
import { HeroBackground } from '@/components/HeroBackground'
import { heroVisualKeys, type HeroVisualKey, type SiteHeroVisualConfig } from '@/lib/hero-visuals'
import type { SiteAppearanceConfig } from '@/lib/site-config'

type Device = 'desktop' | 'mobile'
type DragState = { pointerId: number; key: HeroVisualKey; device: Device; startX: number; startY: number; positionX: number; positionY: number; width: number; height: number }

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)))

export function VisualManager({ initialConfig }: Readonly<{ initialConfig: SiteAppearanceConfig }>) {
  const [config, setConfig] = useState(initialConfig)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [savingKey, setSavingKey] = useState<HeroVisualKey | ''>('')
  const [uploadingKey, setUploadingKey] = useState<HeroVisualKey | ''>('')
  const dragRef = useRef<DragState | null>(null)

  function updateVisual(key: HeroVisualKey, patch: Partial<SiteHeroVisualConfig>) {
    setConfig((current) => ({ ...current, heroVisuals: { ...current.heroVisuals, [key]: { ...current.heroVisuals[key], ...patch } } }))
  }

  async function save(key: HeroVisualKey) {
    setSavingKey(key); setMessage(''); setError('')
    const nextConfig = { ...config, heroVisuals: { ...config.heroVisuals, [key]: { ...config.heroVisuals[key], updatedAt: new Date().toISOString() } } }
    const response = await fetch('/api/admin/appearance', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: nextConfig }) })
    const data = await response.json().catch(() => null)
    setSavingKey('')
    if (!response.ok) { setError(data?.message || '保存失败'); return }
    setConfig(data.config)
    setMessage(`${data.config.heroVisuals[key].title} 已保存`)
  }

  async function upload(key: HeroVisualKey, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploadingKey(key); setMessage(''); setError('')
    const body = new FormData(); body.append('file', file)
    const response = await fetch('/api/uploads/site-image', { method: 'POST', body })
    const data = await response.json().catch(() => null)
    setUploadingKey(''); event.target.value = ''
    if (!response.ok) { setError(data?.message || '上传失败'); return }
    updateVisual(key, { imageUrl: data.url })
    setMessage('图片已上传，请确认桌面与移动端位置后保存')
  }

  function beginDrag(event: PointerEvent<HTMLDivElement>, key: HeroVisualKey, device: Device) {
    const visual = config.heroVisuals[key]
    const rect = event.currentTarget.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId, key, device, startX: event.clientX, startY: event.clientY,
      positionX: device === 'desktop' ? visual.desktopPositionX : visual.mobilePositionX,
      positionY: device === 'desktop' ? visual.desktopPositionY : visual.mobilePositionY,
      width: rect.width, height: rect.height,
    }
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const x = clamp(drag.positionX - ((event.clientX - drag.startX) / drag.width) * 100)
    const y = clamp(drag.positionY - ((event.clientY - drag.startY) / drag.height) * 100)
    updateVisual(drag.key, drag.device === 'desktop' ? { desktopPositionX: x, desktopPositionY: y } : { mobilePositionX: x, mobilePositionY: y })
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  return <div className="space-y-6">
    <header className="border-b border-slate-200 pb-6">
      <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-700">Visual Management</p>
      <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">视觉管理 / Hero 管理</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-500">图片资源与裁剪焦点在这里维护；页面布局编辑器继续只负责模块位置。拖动预览中的图片或使用滑块，可分别设置桌面与手机显示位置。</p>
    </header>

    {message ? <p className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
    {error ? <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}
    <datalist id="hero-position-steps"><option value="0" /><option value="25" /><option value="50" /><option value="75" /><option value="100" /></datalist>

    {heroVisualKeys.map((key) => {
      const visual = config.heroVisuals[key]
      return <section key={key} data-visual-key={key} className="border border-slate-200 bg-white p-5 shadow-[0_8px_26px_rgba(15,23,42,.04)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="min-w-0 flex-1"><input aria-label={`${visual.title}名称`} value={visual.title} onChange={(event) => updateVisual(key, { title: event.target.value })} className="w-full max-w-md border-0 bg-transparent p-0 text-xl font-black text-brand-950 outline-none" /><p className="mt-1 text-xs font-bold text-slate-400">配置键：{key}{visual.updatedAt ? ` · 更新于 ${new Date(visual.updatedAt).toLocaleString('zh-CN')}` : ''}</p></div>
          <label className="flex items-center gap-2 text-sm font-black text-slate-600"><input type="checkbox" checked={visual.enabled} onChange={(event) => updateVisual(key, { enabled: event.target.checked })} />启用背景</label>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_290px]">
          <div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
              <VisualPreview visual={visual} device="desktop" onPointerDown={(event) => beginDrag(event, key, 'desktop')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
              <VisualPreview visual={visual} device="mobile" onPointerDown={(event) => beginDrag(event, key, 'mobile')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
            </div>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <PositionControls label="桌面位置" x={visual.desktopPositionX} y={visual.desktopPositionY} onX={(value) => updateVisual(key, { desktopPositionX: value })} onY={(value) => updateVisual(key, { desktopPositionY: value })} />
              <PositionControls label="移动端位置" x={visual.mobilePositionX} y={visual.mobilePositionY} onX={(value) => updateVisual(key, { mobilePositionX: value })} onY={(value) => updateVisual(key, { mobilePositionY: value })} />
            </div>
          </div>

          <aside className="space-y-4 border-l border-slate-200 pl-0 xl:pl-5">
            <label className="block text-xs font-black text-slate-500">图片 URL<input value={visual.imageUrl} onChange={(event) => updateVisual(key, { imageUrl: event.target.value })} className="mt-2 w-full border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400" placeholder="https://..." /></label>
            <label className="inline-flex cursor-pointer border border-slate-300 bg-white px-4 py-2 text-sm font-black text-brand-700 hover:bg-slate-50">{uploadingKey === key ? '上传中…' : '上传 JPG / PNG / WebP'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => upload(key, event)} className="hidden" /></label>
            <p className="text-xs font-semibold leading-6 text-slate-400">沿用站点 Supabase Storage 上传接口。焦点字段已在配置中预留，当前版本以桌面/移动独立 position 为准。</p>
            <button type="button" disabled={savingKey === key} onClick={() => save(key)} className="w-full bg-brand-950 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{savingKey === key ? '保存中…' : '保存当前位置'}</button>
          </aside>
        </div>
      </section>
    })}
  </div>
}

function VisualPreview({ visual, device, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: { visual: SiteHeroVisualConfig; device: Device; onPointerDown: (event: PointerEvent<HTMLDivElement>) => void; onPointerMove: (event: PointerEvent<HTMLDivElement>) => void; onPointerUp: (event: PointerEvent<HTMLDivElement>) => void; onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void }) {
  const x = device === 'desktop' ? visual.desktopPositionX : visual.mobilePositionX
  const y = device === 'desktop' ? visual.desktopPositionY : visual.mobilePositionY
  return <div><p className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500">{device === 'desktop' ? 'Desktop Preview' : 'Mobile Preview'}</p><div data-visual-preview={device} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} className={`relative touch-none select-none overflow-hidden border border-slate-300 bg-[#071523] text-white ${device === 'desktop' ? 'aspect-[16/7]' : 'mx-auto aspect-[9/16] w-full max-w-[220px]'}`} style={{ cursor: 'grab' }}>
    <HeroBackground visual={visual} positionMode={device} />
    <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/60 via-black/15 to-black/25" />
    <div className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2"><span className="text-[10px] font-black tracking-[.2em] text-white/65">LIVE PREVIEW</span><strong className="mt-1 block text-lg sm:text-2xl">{visual.title}</strong></div>
    <span aria-hidden="true" className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 shadow-[0_0_0_4px_rgba(0,0,0,.22)]" style={{ left: `${x}%`, top: `${y}%` }} />
    {!visual.imageUrl ? <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs font-bold text-white/55">暂无图片，可上传后预览</span> : null}
  </div></div>
}

function PositionControls({ label, x, y, onX, onY }: { label: string; x: number; y: number; onX: (value: number) => void; onY: (value: number) => void }) {
  return <fieldset className="border-t border-slate-200 pt-3"><legend className="pr-3 text-sm font-black text-brand-950">{label}</legend><RangeControl label="横向 X" value={x} onChange={onX} /><RangeControl label="纵向 Y" value={y} onChange={onY} /></fieldset>
}

function RangeControl({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="mt-3 grid grid-cols-[64px_minmax(0,1fr)_38px] items-center gap-3 text-xs font-bold text-slate-500"><span>{label}</span><input type="range" min="0" max="100" step="1" list="hero-position-steps" value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-brand-700" /><output className="text-right font-black text-brand-950">{value}%</output></label>
}
