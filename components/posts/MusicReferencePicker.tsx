'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'

export type MusicReferenceSong = {
  id: string
  title: string
  artist: string
  coverUrl: string | null
  album: { name: string; artist?: string }
}

type MusicSearchResponse = { songs?: MusicReferenceSong[] }

export function MusicReferencePicker({
  open,
  onClose,
  onSelect,
}: Readonly<{
  open: boolean
  onClose: () => void
  onSelect: (song: MusicReferenceSong) => void
}>) {
  const [query, setQuery] = useState('')
  const [songs, setSongs] = useState<MusicReferenceSong[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSongs([])
    setError('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
      setSongs([])
      setIsLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setIsLoading(true)
      setError('')
      void fetch(`/api/music/search?q=${encodeURIComponent(trimmedQuery)}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('歌曲搜索失败')
          return await response.json() as MusicSearchResponse
        })
        .then((data) => setSongs(Array.isArray(data.songs) ? data.songs.slice(0, 15) : []))
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === 'AbortError') return
          setError(reason instanceof Error ? reason.message : '歌曲搜索失败，请稍后重试')
          setSongs([])
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false)
        })
    }, 300)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, query])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="flex max-h-[min(680px,calc(100dvh-32px))] w-full max-w-lg flex-col border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="music-reference-picker-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="music-reference-picker-title" className="text-lg font-black text-brand-950">引用 EasMusic 歌曲</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">选择真实歌曲后，会插入到当前光标位置。</p>
          </div>
          <button type="button" className="shrink-0 px-2 py-1 text-lg font-black text-slate-500" aria-label="关闭歌曲搜索" onClick={onClose}>×</button>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索歌名、歌手或专辑"
          aria-label="搜索 EasMusic 歌曲"
          className="mt-4 min-h-11 w-full border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-sm font-bold text-brand-950 outline-none focus:border-brand-500"
        />
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto" aria-live="polite">
          {!query.trim() ? <p className="p-4 text-sm font-bold text-slate-500">输入歌名搜索 EasMusic</p> : null}
          {isLoading ? <p className="p-4 text-sm font-bold text-slate-500">搜索中…</p> : null}
          {error ? <p className="p-4 text-sm font-bold text-red-600" role="alert">{error}</p> : null}
          {!isLoading && !error && query.trim() && !songs.length ? <p className="p-4 text-sm font-bold text-slate-500">没有匹配歌曲</p> : null}
          <div className="grid gap-2">
            {songs.map((song) => (
              <button
                key={song.id}
                type="button"
                className="flex min-w-0 items-center gap-3 border border-[var(--border)] bg-[var(--surface-subtle)] p-3 text-left transition hover:border-brand-300 hover:bg-sky-50"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(song)}
              >
                <span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden bg-sky-100 text-xl font-black text-brand-700">
                  {song.coverUrl ? <Image src={song.coverUrl} alt="" fill sizes="48px" className="object-cover" /> : '♪'}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-black text-brand-950">{song.title}</span>
                  <span className="mt-1 block truncate text-xs font-bold text-slate-500">{song.artist || song.album.artist || '未知歌手'} · 《{song.album.name}》</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
