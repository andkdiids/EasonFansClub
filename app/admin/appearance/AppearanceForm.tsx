'use client'

import { useState, type ChangeEvent } from 'react'
import type { SiteAppearanceConfig } from '@/lib/site-config'

type Section = 'text' | 'colors' | 'images' | 'nav' | 'hero'

export function AppearanceForm({ initialConfig }: { initialConfig: SiteAppearanceConfig }) {
  const [config, setConfig] = useState(initialConfig)
  const [section, setSection] = useState<Section>('text')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [uploadingKey, setUploadingKey] = useState('')

  async function save(nextConfig = config) {
    setMessage('')
    setError('')
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
    setMessage('配置已保存，刷新前台页面后生效')
  }

  async function reset() {
    setMessage('')
    setError('')
    const response = await fetch('/api/admin/appearance', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      setError(data?.message || '恢复默认失败')
      return
    }
    setConfig(data.config)
    setMessage('已恢复默认配置')
  }

  async function uploadImage(key: keyof SiteAppearanceConfig['images'], event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploadingKey(key)
    setMessage('')
    setError('')

    const body = new FormData()
    body.append('file', file)
    const response = await fetch('/api/uploads/site-image', { method: 'POST', body })
    const data = await response.json().catch(() => null)
    setUploadingKey('')

    if (!response.ok) {
      setError(data?.message || '上传失败')
      event.target.value = ''
      return
    }

    setConfig((current) => ({
      ...current,
      images: { ...current.images, [key]: data.url },
    }))
    setMessage('图片已上传，请点击保存配置')
  }

  return (
    <div className="rounded-[28px] border border-sky-100 bg-white/88 p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-sky-700">Appearance</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950">网站外观配置</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => save()} className="rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white">保存配置</button>
          <button onClick={reset} className="rounded-full bg-sky-50 px-5 py-3 text-sm font-black text-brand-700">恢复默认</button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {[
          ['text', '文字'],
          ['colors', '颜色'],
          ['images', '图片'],
          ['nav', '导航栏'],
          ['hero', '首页轮播'],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSection(key as Section)}
            className={`rounded-full px-4 py-2 text-sm font-black ${section === key ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {section === 'text' ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(config.text).map(([key, value]) => (
              <label key={key} className="block">
                <span className="text-sm font-black text-slate-600">{key}</span>
                <input
                  value={value}
                  onChange={(event) => setConfig((current) => ({ ...current, text: { ...current.text, [key]: event.target.value } }))}
                  className="mt-2 w-full rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none"
                />
              </label>
            ))}
          </div>
        ) : null}

        {section === 'colors' ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(config.colors).map(([key, value]) => (
              <label key={key} className="block rounded-2xl bg-sky-50/70 p-4">
                <span className="text-sm font-black text-slate-600">{key}</span>
                <div className="mt-2 flex gap-3">
                  <input
                    type="color"
                    value={value}
                    onChange={(event) => setConfig((current) => ({ ...current, colors: { ...current.colors, [key]: event.target.value } }))}
                    className="h-12 w-16 rounded-xl"
                  />
                  <input
                    value={value}
                    onChange={(event) => setConfig((current) => ({ ...current, colors: { ...current.colors, [key]: event.target.value } }))}
                    className="min-w-0 flex-1 rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none"
                  />
                </div>
              </label>
            ))}
          </div>
        ) : null}

        {section === 'images' ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(config.images).map(([key, value]) => (
              <div key={key} className="rounded-2xl bg-sky-50/70 p-4">
                <p className="text-sm font-black text-slate-600">{key}</p>
                <div className="mt-3 overflow-hidden rounded-2xl bg-white">
                  {value ? <img src={value} alt={key} className="h-32 w-full object-cover" /> : <div className="grid h-32 place-items-center text-sm font-bold text-slate-400">暂无图片</div>}
                </div>
                <input
                  value={value}
                  onChange={(event) => setConfig((current) => ({ ...current, images: { ...current.images, [key]: event.target.value } }))}
                  className="mt-3 w-full rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none"
                  placeholder="https://PROJECT_REF.supabase.co/storage/v1/object/public/..."
                />
                <label className="mt-3 inline-block cursor-pointer rounded-full bg-white px-4 py-2 text-sm font-black text-brand-700 shadow-sm">
                  {uploadingKey === key ? '上传中...' : '上传图片'}
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => uploadImage(key as keyof SiteAppearanceConfig['images'], event)} className="hidden" />
                </label>
              </div>
            ))}
          </div>
        ) : null}

        {section === 'nav' ? (
          <div className="space-y-4">
            {config.nav.map((item, index) => (
              <div key={`${item.href}-${index}`} className="grid gap-3 rounded-2xl bg-sky-50/70 p-4 md:grid-cols-6">
                <input value={item.icon} onChange={(event) => updateNav(index, 'icon', event.target.value)} className="rounded-xl border border-sky-100 px-3 py-2 font-bold" />
                <input value={item.label} onChange={(event) => updateNav(index, 'label', event.target.value)} className="rounded-xl border border-sky-100 px-3 py-2 font-bold" />
                <input value={item.href} onChange={(event) => updateNav(index, 'href', event.target.value)} className="rounded-xl border border-sky-100 px-3 py-2 font-bold" />
                <input value={item.title} onChange={(event) => updateNav(index, 'title', event.target.value)} className="rounded-xl border border-sky-100 px-3 py-2 font-bold" />
                <input type="number" value={item.sortOrder} onChange={(event) => updateNav(index, 'sortOrder', Number(event.target.value))} className="rounded-xl border border-sky-100 px-3 py-2 font-bold" />
                <label className="flex items-center gap-2 text-sm font-black text-slate-600">
                  <input type="checkbox" checked={item.isVisible} onChange={(event) => updateNav(index, 'isVisible', event.target.checked)} />
                  显示
                </label>
              </div>
            ))}
          </div>
        ) : null}

        {section === 'hero' ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-sky-100 bg-white p-4">
              <h2 className="text-lg font-black text-brand-950">Hero 全局样式</h2>
              <p className="mt-1 text-sm font-bold text-slate-500">文字内容和链接按每张轮播设置；字号、按钮、留白和圆角对所有轮播生效。</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-5">
                <HeroStyleSelect label="标题字号" value={config.heroStyle.titleSize} options={[['small', '小'], ['medium', '中'], ['large', '大'], ['extra-large', '特大']]} onChange={(value) => updateHeroStyle('titleSize', value)} />
                <HeroStyleSelect label="描述字号" value={config.heroStyle.descriptionSize} options={[['small', '小'], ['medium', '中'], ['large', '大']]} onChange={(value) => updateHeroStyle('descriptionSize', value)} />
                <HeroStyleSelect label="按钮大小" value={config.heroStyle.buttonSize} options={[['small', '小'], ['medium', '中'], ['large', '大']]} onChange={(value) => updateHeroStyle('buttonSize', value)} />
                <HeroStyleSelect label="Hero 高度" value={config.heroStyle.height} options={[['compact', '紧凑'], ['standard', '标准'], ['spacious', '宽松']]} onChange={(value) => updateHeroStyle('height', value)} />
                <HeroStyleSelect label="圆角" value={config.heroStyle.radius} options={[['small', '小'], ['medium', '中'], ['large', '大']]} onChange={(value) => updateHeroStyle('radius', value)} />
              </div>
            </div>
            {config.heroSlides.map((item, index) => (
              <div key={index} className="grid gap-3 rounded-2xl bg-sky-50/70 p-4 md:grid-cols-2">
                <input value={item.title} onChange={(event) => updateHero(index, 'title', event.target.value)} className="rounded-xl border border-sky-100 px-3 py-2 font-bold" placeholder="标题" />
                <input value={item.subtitle} onChange={(event) => updateHero(index, 'subtitle', event.target.value)} className="rounded-xl border border-sky-100 px-3 py-2 font-bold" placeholder="副标题" />
                <input value={item.buttonText} onChange={(event) => updateHero(index, 'buttonText', event.target.value)} className="rounded-xl border border-sky-100 px-3 py-2 font-bold" placeholder="按钮文字" />
                <input value={item.href} onChange={(event) => updateHero(index, 'href', event.target.value)} className="rounded-xl border border-sky-100 px-3 py-2 font-bold" placeholder="链接" />
                <input value={item.imageUrl} onChange={(event) => updateHero(index, 'imageUrl', event.target.value)} className="rounded-xl border border-sky-100 px-3 py-2 font-bold" placeholder="图片 URL" />
                <div className="flex items-center gap-4">
                  <input type="number" value={item.sortOrder} onChange={(event) => updateHero(index, 'sortOrder', Number(event.target.value))} className="w-24 rounded-xl border border-sky-100 px-3 py-2 font-bold" />
                  <label className="flex items-center gap-2 text-sm font-black text-slate-600">
                    <input type="checkbox" checked={item.isVisible} onChange={(event) => updateHero(index, 'isVisible', event.target.checked)} />
                    显示
                  </label>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {message ? <p className="mt-5 rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-5 rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-600">{error}</p> : null}
    </div>
  )

  function updateNav(index: number, key: keyof SiteAppearanceConfig['nav'][number], value: string | boolean | number) {
    setConfig((current) => ({
      ...current,
      nav: current.nav.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item)),
    }))
  }

  function updateHero(index: number, key: keyof SiteAppearanceConfig['heroSlides'][number], value: string | boolean | number) {
    setConfig((current) => ({
      ...current,
      heroSlides: current.heroSlides.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item)),
    }))
  }

  function updateHeroStyle(key: keyof SiteAppearanceConfig['heroStyle'], value: string) {
    setConfig((current) => ({ ...current, heroStyle: { ...current.heroStyle, [key]: value } }))
  }
}

function HeroStyleSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<readonly [string, string]>; onChange: (value: string) => void }) {
  return (
    <label className="text-sm font-black text-slate-600">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-xl border border-sky-100 bg-sky-50/60 px-3 py-2 font-bold outline-none">
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  )
}
