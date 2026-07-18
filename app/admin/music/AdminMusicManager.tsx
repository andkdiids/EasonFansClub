'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

type MusicSongItem = {
  id: string
  title: string
  artist: string
  albumId: string
  trackNumber: number
  releaseYear: number
  coverUrl?: string | null
  composer?: string | null
  lyricist?: string | null
  arranger?: string | null
  producer?: string | null
  story?: string | null
}

type MusicAlbumItem = {
  id: string
  name: string
  artist: string
  releaseYear: number
  coverUrl?: string | null
  description?: string | null
  language: string
  songs: MusicSongItem[]
}

const emptyAlbumForm = { name: '', artist: '陈奕迅', releaseYear: '', coverUrl: '', description: '', language: '粤语' }
const emptySongForm = { title: '', albumId: '', trackNumber: '', artist: '陈奕迅', releaseYear: '', coverUrl: '', lyricist: '', composer: '', arranger: '', producer: '', story: '' }
const fieldClass = 'w-full rounded-2xl border border-sky-100 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-sky-100'

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.message || '操作失败')
  return data
}

export function AdminMusicManager() {
  const [albums, setAlbums] = useState<MusicAlbumItem[]>([])
  const [albumForm, setAlbumForm] = useState(emptyAlbumForm)
  const [songForm, setSongForm] = useState(emptySongForm)
  const [editingAlbumId, setEditingAlbumId] = useState<string | null>(null)
  const [editingSongId, setEditingSongId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await requestJson('/api/admin/music')
      const nextAlbums = data.albums || []
      setAlbums(nextAlbums)
      setSongForm((current) => current.albumId || !nextAlbums[0]
        ? current
        : { ...current, albumId: nextAlbums[0].id, artist: nextAlbums[0].artist, releaseYear: String(nextAlbums[0].releaseYear) })
    } catch (err) {
      setError(err instanceof Error ? err.message : '音乐资料加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function submitAlbum(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    setMessage('')
    try {
      const url = editingAlbumId ? `/api/admin/music/albums/${editingAlbumId}` : '/api/admin/music/albums'
      const data = await requestJson(url, {
        method: editingAlbumId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(albumForm),
      })
      setMessage(data.message)
      setAlbumForm(emptyAlbumForm)
      setEditingAlbumId(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '专辑保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitSong(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    setMessage('')
    try {
      const url = editingSongId ? `/api/admin/music/songs/${editingSongId}` : '/api/admin/music/songs'
      const data = await requestJson(url, {
        method: editingSongId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(songForm),
      })
      setMessage(data.message)
      const selectedAlbum = albums.find((album) => album.id === songForm.albumId)
      setSongForm({ ...emptySongForm, albumId: selectedAlbum?.id || albums[0]?.id || '', artist: selectedAlbum?.artist || '陈奕迅', releaseYear: selectedAlbum ? String(selectedAlbum.releaseYear) : '' })
      setEditingSongId(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '歌曲保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  function editAlbum(album: MusicAlbumItem) {
    setEditingAlbumId(album.id)
    setAlbumForm({ name: album.name, artist: album.artist, releaseYear: String(album.releaseYear), coverUrl: album.coverUrl || '', description: album.description || '', language: album.language })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function editSong(song: MusicSongItem) {
    setEditingSongId(song.id)
    setSongForm({
      title: song.title,
      albumId: song.albumId,
      trackNumber: String(song.trackNumber),
      artist: song.artist,
      releaseYear: String(song.releaseYear),
      coverUrl: song.coverUrl || '',
      lyricist: song.lyricist || '',
      composer: song.composer || '',
      arranger: song.arranger || '',
      producer: song.producer || '',
      story: song.story || '',
    })
    document.querySelector('[data-song-form]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function removeAlbum(album: MusicAlbumItem) {
    if (!window.confirm(`确定删除专辑《${album.name}》吗？专辑内的 ${album.songs.length} 首歌曲也会一并删除。`)) return
    try {
      const data = await requestJson(`/api/admin/music/albums/${album.id}`, { method: 'DELETE' })
      setMessage(data.message)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '专辑删除失败')
    }
  }

  async function removeSong(song: MusicSongItem) {
    if (!window.confirm(`确定删除歌曲《${song.title}》吗？`)) return
    try {
      const data = await requestJson(`/api/admin/music/songs/${song.id}`, { method: 'DELETE' })
      setMessage(data.message)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '歌曲删除失败')
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-5 sm:py-8">
      <section className="rounded-[30px] border border-sky-100 bg-white/88 p-6 shadow-sm sm:p-8">
        <p className="text-sm font-black tracking-[0.18em] text-brand-700">EasMusic 管理</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">陈奕迅音乐资料库</h1>
        <p className="mt-3 text-sm font-bold leading-7 text-slate-600">维护专辑与歌曲资料。本阶段不上传音乐文件，也不启用在线播放。</p>
        <Link href="/admin/music/import" className="mt-5 inline-flex rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">批量导入 Excel / CSV →</Link>
      </section>

      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-600">{error}</p> : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <form onSubmit={submitAlbum} className="rounded-[26px] border border-sky-100 bg-white/88 p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-2xl font-black text-brand-950">{editingAlbumId ? '编辑专辑' : '新增专辑'}</h2>
            {editingAlbumId ? <button type="button" onClick={() => { setEditingAlbumId(null); setAlbumForm(emptyAlbumForm) }} className="text-xs font-black text-brand-700">取消编辑</button> : null}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input required value={albumForm.name} onChange={(e) => setAlbumForm({ ...albumForm, name: e.target.value })} className={fieldClass} placeholder="专辑名称" />
            <input required value={albumForm.releaseYear} onChange={(e) => setAlbumForm({ ...albumForm, releaseYear: e.target.value })} className={fieldClass} type="number" min="1900" max="2100" placeholder="发行年份" />
            <input value={albumForm.artist} onChange={(e) => setAlbumForm({ ...albumForm, artist: e.target.value })} className={fieldClass} placeholder="艺术家" />
            <select value={albumForm.language} onChange={(e) => setAlbumForm({ ...albumForm, language: e.target.value })} className={fieldClass}>
              <option value="粤语">粤语</option><option value="国语">国语</option><option value="英语">英语</option><option value="其他">其他</option>
            </select>
            <input value={albumForm.coverUrl} onChange={(e) => setAlbumForm({ ...albumForm, coverUrl: e.target.value })} className={`${fieldClass} sm:col-span-2`} placeholder="封面图片 URL" />
            <textarea value={albumForm.description} onChange={(e) => setAlbumForm({ ...albumForm, description: e.target.value })} className={`${fieldClass} min-h-32 sm:col-span-2`} placeholder="专辑简介" />
          </div>
          <button disabled={submitting} className="mt-4 rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-60">{submitting ? '保存中...' : editingAlbumId ? '保存专辑' : '新增专辑'}</button>
        </form>

        <div className="rounded-[26px] border border-sky-100 bg-white/88 p-5 shadow-sm sm:p-6">
          <h2 className="text-2xl font-black text-brand-950">专辑管理</h2>
          {loading ? <p className="mt-4 text-sm font-bold text-slate-500">正在加载...</p> : albums.length === 0 ? <p className="mt-4 rounded-2xl bg-sky-50 p-4 text-sm font-bold text-slate-500">还没有专辑，请先新增第一张专辑。</p> : (
            <div className="mt-4 space-y-3">
              {albums.map((album) => (
                <article key={album.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-sky-50/55 p-4">
                  <div className="min-w-0">
                    <h3 className="truncate font-black text-brand-950">{album.name}</h3>
                    <p className="mt-1 text-xs font-bold text-slate-500">{album.releaseYear} · {album.language} · {album.songs.length} 首歌曲</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => editAlbum(album)} className="rounded-full bg-white px-3 py-2 text-xs font-black text-brand-700">编辑</button>
                    <button type="button" onClick={() => void removeAlbum(album)} className="rounded-full bg-red-50 px-3 py-2 text-xs font-black text-red-600">删除</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section data-song-form className="grid scroll-mt-24 gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <form onSubmit={submitSong} className="rounded-[26px] border border-sky-100 bg-white/88 p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-2xl font-black text-brand-950">{editingSongId ? '编辑歌曲' : '新增歌曲'}</h2>
            {editingSongId ? <button type="button" onClick={() => { setEditingSongId(null); setSongForm({ ...emptySongForm, albumId: albums[0]?.id || '' }) }} className="text-xs font-black text-brand-700">取消编辑</button> : null}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input required value={songForm.title} onChange={(e) => setSongForm({ ...songForm, title: e.target.value })} className={fieldClass} placeholder="歌曲名称" />
            <select required value={songForm.albumId} onChange={(e) => { const album = albums.find((item) => item.id === e.target.value); setSongForm({ ...songForm, albumId: e.target.value, artist: album?.artist || songForm.artist, releaseYear: album ? String(album.releaseYear) : songForm.releaseYear }) }} className={fieldClass}>
              <option value="">选择所属专辑</option>{albums.map((album) => <option key={album.id} value={album.id}>{album.name}（{album.releaseYear}）</option>)}
            </select>
            <input required value={songForm.trackNumber} onChange={(e) => setSongForm({ ...songForm, trackNumber: e.target.value })} className={fieldClass} type="number" min="1" max="999" placeholder="专辑曲序" />
            <input value={songForm.artist} onChange={(e) => setSongForm({ ...songForm, artist: e.target.value })} className={fieldClass} placeholder="歌手" />
            <input value={songForm.lyricist} onChange={(e) => setSongForm({ ...songForm, lyricist: e.target.value })} className={fieldClass} placeholder="作词" />
            <input value={songForm.composer} onChange={(e) => setSongForm({ ...songForm, composer: e.target.value })} className={fieldClass} placeholder="作曲" />
            <input value={songForm.arranger} onChange={(e) => setSongForm({ ...songForm, arranger: e.target.value })} className={fieldClass} placeholder="编曲" />
            <input value={songForm.producer} onChange={(e) => setSongForm({ ...songForm, producer: e.target.value })} className={fieldClass} placeholder="制作人" />
            <input value={songForm.coverUrl} onChange={(e) => setSongForm({ ...songForm, coverUrl: e.target.value })} className={`${fieldClass} sm:col-span-2`} placeholder="单曲封面 URL（可留空使用专辑封面）" />
            <textarea value={songForm.story} onChange={(e) => setSongForm({ ...songForm, story: e.target.value })} className={`${fieldClass} min-h-36 sm:col-span-2`} placeholder="歌曲故事" />
          </div>
          <button disabled={submitting || albums.length === 0} className="mt-4 rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-60">{submitting ? '保存中...' : editingSongId ? '保存歌曲' : '新增歌曲'}</button>
        </form>

        <div className="rounded-[26px] border border-sky-100 bg-white/88 p-5 shadow-sm sm:p-6">
          <h2 className="text-2xl font-black text-brand-950">歌曲管理</h2>
          <div className="mt-4 space-y-4">
            {albums.flatMap((album) => album.songs.map((song) => ({ ...song, albumName: album.name }))).length === 0 ? <p className="rounded-2xl bg-sky-50 p-4 text-sm font-bold text-slate-500">还没有歌曲资料。</p> : albums.flatMap((album) => album.songs.map((song) => ({ ...song, albumName: album.name }))).map((song) => (
              <article key={song.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-100 pb-4 last:border-0 last:pb-0">
                <div className="min-w-0">
                  <h3 className="truncate font-black text-brand-950"><span className="mr-2 text-brand-500">{String(song.trackNumber).padStart(2, '0')}</span>{song.title}</h3>
                  <p className="mt-1 text-xs font-bold text-slate-500">{song.albumName}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => editSong(song)} className="rounded-full bg-sky-50 px-3 py-2 text-xs font-black text-brand-700">编辑</button>
                  <button type="button" onClick={() => void removeSong(song)} className="rounded-full bg-red-50 px-3 py-2 text-xs font-black text-red-600">删除</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
