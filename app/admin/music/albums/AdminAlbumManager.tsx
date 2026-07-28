'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

type Album = { id: string; name: string; artist: string; releaseYear: number; language: string; coverUrl?: string | null; status: 'DRAFT' | 'PUBLISHED'; displayOrder: number; isFeatured: boolean; featuredOrder?: number | null; songs: unknown[] }
const field = 'w-full rounded-2xl border border-sky-100 bg-white px-4 py-2.5 text-sm font-bold outline-none focus:border-brand-300'
const initialForm = { albumName: '', artist: '陈奕迅', releaseDate: '', releaseYear: '', language: '粤语', company: '', description: '', story: '', displayOrder: '0', isFeatured: false, featuredOrder: '0' }

export function AdminAlbumManager() {
  const router = useRouter()
  const [albums, setAlbums] = useState<Album[]>([])
  const [form, setForm] = useState(initialForm)
  const [cover, setCover] = useState<File | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => { const response = await fetch('/api/admin/music'); const data = await response.json().catch(() => null); if (response.ok) setAlbums(data.albums || []); else setError(data?.message || '专辑加载失败') }, [])
  useEffect(() => { void load() }, [load])

  async function create(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/admin/music/albums', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.message || '创建失败')
      if (cover) { const upload = new FormData(); upload.set('file', cover); upload.set('entityType', 'album'); upload.set('entityId', data.album.id); const uploadResponse = await fetch('/api/admin/music/covers', { method: 'POST', body: upload }); const uploadData = await uploadResponse.json().catch(() => null); if (!uploadResponse.ok) throw new Error(`专辑已创建，但${uploadData?.message || '封面上传失败'}`) }
      setMessage('专辑已创建'); setForm(initialForm); setCover(null); router.push(`/admin/music/albums/${data.album.id}`)
    } catch (err) { setError(err instanceof Error ? err.message : '创建失败') } finally { setBusy(false) }
  }

  async function remove(album: Album) { if (!window.confirm(`确定删除《${album.name}》及其全部歌曲吗？`)) return; const response = await fetch(`/api/admin/music/albums/${album.id}`, { method: 'DELETE' }); const data = await response.json().catch(() => null); if (!response.ok) return setError(data?.message || '删除失败'); setMessage('专辑已删除'); await load() }

  return <main className="mx-auto max-w-6xl space-y-6 px-4 py-7 sm:px-5"><section className="rounded-[30px] border border-sky-100 bg-white/90 p-6 shadow-sm"><Link href="/admin/music" className="text-sm font-black text-brand-700">← EasMusic 管理</Link><h1 className="mt-4 text-4xl font-black text-brand-950">专辑管理</h1></section>
    {message ? <p className="rounded-2xl bg-emerald-50 p-3 text-sm font-black text-emerald-700">{message}</p> : null}{error ? <p className="rounded-2xl bg-red-50 p-3 text-sm font-black text-red-600">{error}</p> : null}
    <form onSubmit={create} className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7"><h2 className="text-2xl font-black text-brand-950">创建专辑草稿</h2><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><input required value={form.albumName} onChange={(e) => setForm({ ...form, albumName: e.target.value })} className={field} placeholder="专辑名称" /><input value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} className={field} placeholder="艺术家" /><input required type="number" min="1900" max="2100" value={form.releaseYear} onChange={(e) => setForm({ ...form, releaseYear: e.target.value })} className={field} placeholder="发行年份" /><input type="date" value={form.releaseDate} onChange={(e) => setForm({ ...form, releaseDate: e.target.value })} className={field} /><input value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} className={field} placeholder="语言" /><input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className={field} placeholder="唱片公司" /><input type="number" min="0" value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: e.target.value })} className={field} placeholder="普通展示排序" /><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setCover(e.target.files?.[0] || null)} className={`${field} text-xs`} /><label className={`${field} flex items-center gap-3`}><input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} className="h-4 w-4" />设为精选专辑</label><input type="number" min="0" disabled={!form.isFeatured} value={form.featuredOrder} onChange={(e) => setForm({ ...form, featuredOrder: e.target.value })} className={`${field} disabled:bg-slate-50 disabled:text-slate-400`} placeholder="精选排序（越小越靠前）" /><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={`${field} min-h-28 sm:col-span-2`} placeholder="专辑介绍" /><textarea value={form.story} onChange={(e) => setForm({ ...form, story: e.target.value })} className={`${field} min-h-28 sm:col-span-2`} placeholder="专辑故事" /></div><button disabled={busy} className="mt-5 rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? '创建并处理封面...' : '创建专辑'}</button></form>
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{albums.map((album) => <article key={album.id} className="overflow-hidden rounded-[26px] border border-sky-100 bg-white/90 shadow-sm"><div className="relative aspect-[16/9] bg-sky-50">{album.coverUrl ? <Image src={album.coverUrl} alt={`${album.name}封面`} fill sizes="(max-width: 640px) 100vw, 33vw" className="object-cover" /> : <div className="grid h-full place-items-center text-4xl text-brand-500">♪</div>}</div><div className="p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black text-brand-950">{album.name}</h2><p className="mt-1 text-xs font-bold text-slate-500">{album.releaseYear} · {album.language} · {album.songs.length} 首</p></div><div className="flex flex-col items-end gap-1"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${album.status === 'PUBLISHED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{album.status === 'PUBLISHED' ? '已发布' : '草稿'}</span>{album.isFeatured ? <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-black text-brand-700">精选 · {album.featuredOrder ?? 0}</span> : null}</div></div><div className="mt-4 flex gap-2"><Link href={`/admin/music/albums/${album.id}`} className="rounded-full bg-brand-950 px-4 py-2 text-xs font-black text-white">管理</Link><button type="button" onClick={() => void remove(album)} className="rounded-full bg-red-50 px-4 py-2 text-xs font-black text-red-600">删除</button></div></div></article>)}</section>
  </main>
}
