'use client'

import { useState } from 'react'
import type { LivePhotoConfig } from '@/lib/live-photo-config'

type AssetRow = {
  id: string
  ownerUid: number | null
  status: string
  pairing: string
  durationMs: number | null
  size: number | null
  errorCode: string | null
  createdAt: string
}

export function LivePhotoAdminPanel({
  initialConfig, initialPublicConfig, stats, assets,
}: Readonly<{
  initialConfig: LivePhotoConfig
  initialPublicConfig: ReturnType<typeof import('@/lib/live-photo-config').publicLivePhotoConfig>
  stats: { total: number; ready: number; failed: number; processing: number; successRate: number; videoBytes: number; coverBytes: number; orphanCandidates: number
    failures: { code: string; count: number }[] }
  assets: AssetRow[]
}>) {
  const [config, setConfig] = useState(initialConfig)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [orphanCount, setOrphanCount] = useState(stats.orphanCandidates)

  async function cleanup() {
    setCleaning(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/live-photo/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxAgeHours: 24 }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || '清理失败')
      setOrphanCount((current) => Math.max(0, current - (payload.cleaned ?? 0)))
      setMessage(`已清理 ${payload.cleaned ?? 0} 个无引用资源`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '清理失败')
    } finally {
      setCleaning(false)
    }
  }

  async function save(reset = false) {
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/live-photo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset, config }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || '保存失败')
      setConfig({ ...initialConfig, ...payload.config })
      setMessage('配置已保存并生效')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const numberField = (key: keyof LivePhotoConfig, label: string, step = 1) => (
    <label className="block text-sm font-bold text-slate-700">
      {label}
      <input
        type="number"
        step={step}
        value={Number(config[key])}
        onChange={(event) => setConfig((current) => ({ ...current, [key]: Number(event.target.value) }))}
        className="mt-1 block w-full rounded border border-slate-200 px-3 py-2 text-sm"
      />
    </label>
  )

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-black text-slate-900">实况照片管理</h1>
        <p className="mt-1 text-sm text-slate-600">配置 Web/H5 实况照片规格与转码策略；已发布媒体在功能关闭后仍正常展示。</p>
      </header>

      <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm sm:grid-cols-3">
        <span>媒体总数：{stats.total}</span>
        <span>处理成功：{stats.ready}（{stats.successRate}%）</span>
        <span>处理中：{stats.processing}</span>
        <span>失败：{stats.failed}</span>
        <span>动态视频占用：{(stats.videoBytes / 1024 / 1024).toFixed(1)} MB</span>
        <span>静态封面占用：{(stats.coverBytes / 1024 / 1024).toFixed(1)} MB</span>
        <span>待清理候选：{orphanCount}</span>
        <span>公开配置上限：{initialPublicConfig.maxDurationSeconds} 秒 / {(initialPublicConfig.maxUploadBytes / 1024 / 1024).toFixed(0)} MB</span>
        <span className="sm:col-span-3">
          转码失败原因：{stats.failures.length ? stats.failures.map((failure) => `${failure.code} ×${failure.count}`).join(' · ') : '暂无失败记录'}
        </span>
      </section>

      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <input type="checkbox" checked={config.enabled} onChange={(event) => setConfig((current) => ({ ...current, enabled: event.target.checked }))} />
          实况照片功能总开关
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <input type="checkbox" checked={config.keepAudio} onChange={(event) => setConfig((current) => ({ ...current, keepAudio: event.target.checked }))} />
          保留原始现场声音
        </label>
        {numberField('maxDurationSeconds', '最大视频时长（秒）')}
        {numberField('maxUploadBytes', '最大原始上传（字节）', 1024 * 1024)}
        {numberField('maxVideoEdge', '视频长边最大值（px）')}
        {numberField('maxFps', '最高帧率（fps）')}
        {numberField('quality', 'H.264 CRF（越小越清晰）')}
        {numberField('transcodeConcurrency', '转码并发数')}
        {numberField('maxAssetBytes', '压缩后目标体积（字节）', 1024 * 1024)}
      </section>

      <div className="flex items-center gap-3">
        <button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">保存配置</button>
        <button type="button" disabled={saving} onClick={() => void save(true)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50">恢复默认</button>
        <button type="button" disabled={cleaning || orphanCount === 0} onClick={() => void cleanup()}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50">清理无引用资源</button>
        {message ? <span className="text-sm font-bold text-emerald-700" role="status">{message}</span> : null}
      </div>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr><th className="p-2">媒体 ID</th><th className="p-2">上传者 UID</th><th className="p-2">状态</th><th className="p-2">配对</th><th className="p-2">时长</th><th className="p-2">体积</th><th className="p-2">失败码</th><th className="p-2">创建时间</th></tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={asset.id} className="border-t border-slate-100">
                <td className="p-2 font-mono">{asset.id.slice(0, 12)}…</td>
                <td className="p-2">{asset.ownerUid ?? '-'}</td>
                <td className="p-2">{asset.status}</td>
                <td className="p-2">{asset.pairing}</td>
                <td className="p-2">{asset.durationMs ? `${(asset.durationMs / 1000).toFixed(1)}s` : '-'}</td>
                <td className="p-2">{asset.size ? `${(asset.size / 1024 / 1024).toFixed(1)} MB` : '-'}</td>
                <td className="p-2">{asset.errorCode || '-'}</td>
                <td className="p-2">{new Date(asset.createdAt).toLocaleString('zh-CN')}</td>
              </tr>
            ))}
            {!assets.length ? <tr><td colSpan={8} className="p-4 text-center text-slate-500">暂无媒体处理记录</td></tr> : null}
          </tbody>
        </table>
      </section>
    </div>
  )
}
