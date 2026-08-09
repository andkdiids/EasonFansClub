'use client'

import { useRef, useState } from 'react'

type Avatar = { id: string; url: string; enabled: boolean; createdAt: string }

export function DefaultAvatarManager({ initialAvatars }: Readonly<{ initialAvatars: Avatar[] }>) {
  const [avatars, setAvatars] = useState(initialAvatars)
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function upload() {
    const file = fileRef.current?.files?.[0]
    if (!file || busyId) return
    setBusyId('upload')
    setError('')
    setMessage('')
    const formData = new FormData()
    formData.set('file', file)
    const response = await fetch('/api/admin/default-avatars', { method: 'POST', body: formData })
    const data = await response.json().catch(() => ({}))
    setBusyId('')
    if (!response.ok) {
      setError(data.message || '上传失败')
      return
    }
    setAvatars(data.avatars || [])
    setMessage(`${data.message}${data.assignedCount ? `，已为 ${data.assignedCount} 位未设置头像的用户完成分配` : ''}`)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function toggle(item: Avatar) {
    if (busyId) return
    setBusyId(item.id)
    setError('')
    setMessage('')
    const response = await fetch('/api/admin/default-avatars', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, enabled: !item.enabled }),
    })
    const data = await response.json().catch(() => ({}))
    setBusyId('')
    if (!response.ok) {
      setError(data.message || '状态更新失败')
      return
    }
    setAvatars(data.avatars || [])
    setMessage(data.message || '状态已更新')
  }

  async function remove(item: Avatar) {
    if (busyId || !window.confirm('确定将该头像移出默认头像池吗？已有用户会继续保留此头像。')) return
    setBusyId(item.id)
    setError('')
    setMessage('')
    const response = await fetch(`/api/admin/default-avatars?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' })
    const data = await response.json().catch(() => ({}))
    setBusyId('')
    if (!response.ok) {
      setError(data.message || '删除失败')
      return
    }
    setAvatars(data.avatars || [])
    setMessage(data.message || '头像已移出分配池')
  }

  return (
    <div className="space-y-5">
      <section className="border border-sky-100 bg-white/90 p-6 shadow-sm">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Default Avatars</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950">默认头像管理</h1>
        <p className="mt-3 text-sm font-bold leading-6 text-slate-500">上传 JPG、PNG 或 WebP，系统将自动转换为 WebP。未设置个人头像的用户只会分配一次，并在全站保持一致。</p>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-sky-100 pt-5">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="max-w-full text-sm font-bold text-slate-600" />
          <button type="button" onClick={upload} disabled={Boolean(busyId)} className="min-h-11 bg-brand-950 px-5 text-sm font-black text-white disabled:opacity-50">
            {busyId === 'upload' ? '转换上传中…' : '转换并上传 WebP'}
          </button>
        </div>
        {message ? <p className="mt-4 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-4 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
      </section>

      <section className="border border-sky-100 bg-white/90 p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-brand-950">头像池</h2>
          <span className="text-sm font-bold text-slate-500">{avatars.filter((item) => item.enabled).length} 个已启用</span>
        </div>
        {!avatars.length ? <p className="mt-5 bg-sky-50 p-5 text-sm font-bold text-slate-500">尚未上传系统默认头像。未设置头像的用户会暂时显示 UID 首字符。</p> : null}
        <div className="mt-5 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {avatars.map((item) => (
            <article key={item.id} className="border border-sky-100 bg-sky-50/60 p-4">
              <img src={item.url} alt="系统默认头像" className="aspect-square w-full bg-white object-cover" />
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className={`px-2 py-1 text-xs font-black ${item.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{item.enabled ? '已启用' : '已停用'}</span>
                <time className="text-xs font-bold text-slate-400">{new Date(item.createdAt).toLocaleDateString('zh-CN')}</time>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => toggle(item)} disabled={Boolean(busyId)} className="min-h-11 border border-sky-100 bg-white text-sm font-black text-brand-700 disabled:opacity-50">{item.enabled ? '停用' : '启用'}</button>
                <button type="button" onClick={() => remove(item)} disabled={Boolean(busyId)} className="min-h-11 border border-red-100 bg-white text-sm font-black text-red-600 disabled:opacity-50">删除</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
