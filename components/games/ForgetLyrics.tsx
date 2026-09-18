'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { MusicCover } from '@/components/music/MusicCover'
import { useMusicPlayer, type MusicPreviewTrack } from '@/components/music/MusicPlayerProvider'
import type { ForgetLyricsData, ForgetLyricsRange, ForgetLyricsSort, ForgetLyricsSong } from '@/lib/forget-lyrics'

type ForgetLyricsResponse = { ok?: boolean; data?: ForgetLyricsData; message?: string }

function rangeLabel(range: ForgetLyricsRange) {
  return range === 'today' ? '今日' : range === '7d' ? '近 7 天' : '全部'
}

function buildTrack(song: ForgetLyricsSong): MusicPreviewTrack {
  return {
    id: song.id,
    songId: song.id,
    title: song.title,
    artist: song.artist,
    albumName: song.albumName,
    coverUrl: song.coverUrl,
    previewUrl: song.previewUrl,
    previewDuration: song.previewDuration,
    isFullPlayback: song.isFullPlayback,
  }
}

function ForgetLyricsSongRow({ song, queue }: Readonly<{ song: ForgetLyricsSong; queue: MusicPreviewTrack[] }>) {
  const player = useMusicPlayer()
  const active = player.track?.id === song.id
  const playing = active && player.playing
  const loading = active && player.loading

  function togglePlayback() {
    if (!song.previewUrl || loading) return
    if (playing) {
      player.pause()
      return
    }
    void player.playTrack(buildTrack(song), queue)
  }

  return (
    <article className="forget-lyrics-song-row">
      <Link href={`/music/song/${encodeURIComponent(song.id)}`} className="forget-lyrics-song-link">
        <MusicCover src={song.coverUrl} alt={`${song.title}封面`} className="forget-lyrics-song-cover" sizes="56px" />
        <span className="forget-lyrics-song-copy">
          <strong>{song.title}</strong>
          <small>{song.albumName}</small>
          <em>错过 {song.wrongCount} 次</em>
        </span>
      </Link>
      <button
        type="button"
        className="forget-lyrics-play"
        disabled={!song.previewUrl || loading}
        aria-label={!song.previewUrl ? `${song.title}暂无试听` : playing ? `暂停${song.title}` : `播放${song.title}`}
        aria-pressed={playing}
        onClick={togglePlayback}
      >
        {loading ? '…' : playing ? '❚❚' : '▶'}
      </button>
    </article>
  )
}

function ForgetLyricsSongList({ items, emptyMessage = '今天没有忘记歌词。' }: Readonly<{ items: ForgetLyricsSong[]; emptyMessage?: string }>) {
  const queue = useMemo(() => items.filter((song) => song.previewUrl).map(buildTrack), [items])
  if (!items.length) return <p className="forget-lyrics-empty">{emptyMessage}</p>
  return <div className="forget-lyrics-song-list">{items.map((song) => <ForgetLyricsSongRow key={song.id} song={song} queue={queue} />)}</div>
}

async function loadForgetLyrics(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { cache: 'no-store', signal })
  const payload = await response.json().catch(() => null) as ForgetLyricsResponse | null
  if (!response.ok || !payload?.ok || !payload.data) throw new Error(payload?.message || '忘记歌词暂时无法读取')
  return payload.data
}

export function ForgetLyricsSection() {
  const [data, setData] = useState<ForgetLyricsData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    loadForgetLyrics('/api/entertainment/forget-lyrics?range=today&sort=recent&surface=home&limit=5', controller.signal)
      .then(setData)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : '忘记歌词暂时无法读取')
      })
    return () => controller.abort()
  }, [])

  return (
    <section className="forget-lyrics-section" aria-labelledby="forget-lyrics-title">
      <header className="forget-lyrics-heading">
        <div>
          <p>那些没听出来的歌，再认识一次。</p>
          <h2 id="forget-lyrics-title">忘记歌词</h2>
        </div>
        <Link href="/games/forget-lyrics">查看全部 <span aria-hidden="true">›</span></Link>
      </header>
      {error ? <p className="forget-lyrics-empty" role="status">{error}</p> : data ? <ForgetLyricsSongList items={data.items} /> : <p className="forget-lyrics-empty" role="status">正在读取今天的错歌…</p>}
    </section>
  )
}

export function ForgetLyricsPage() {
  const [range, setRange] = useState<ForgetLyricsRange>('today')
  const [sort, setSort] = useState<ForgetLyricsSort>('recent')
  const [data, setData] = useState<ForgetLyricsData | null>(null)
  const [error, setError] = useState('')
  const query = useMemo(() => new URLSearchParams({ range, sort }).toString(), [range, sort])

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    setData(null)
    loadForgetLyrics(`/api/entertainment/forget-lyrics?${query}`, controller.signal)
      .then(setData)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : '忘记歌词暂时无法读取')
      })
    return () => controller.abort()
  }, [query])

  return (
    <main className="forget-lyrics-page games-full-width">
      <div className="forget-lyrics-page-inner">
        <Link href="/games/guess-song" className="forget-lyrics-back">← 返回听听</Link>
        <header className="forget-lyrics-page-heading">
          <p>听听答错的歌曲，只属于你。</p>
          <h1>我的忘记歌词</h1>
          <span>历史会保留；答对不会抹掉曾经错过的次数。</span>
        </header>
        <nav className="forget-lyrics-tabs" aria-label="忘记歌词时间范围">
          {(['today', '7d', 'all'] as const).map((item) => <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)}>{rangeLabel(item)}</button>)}
        </nav>
        <div className="forget-lyrics-sort" role="group" aria-label="忘记歌词排序">
          <span>排序</span>
          <button type="button" aria-pressed={sort === 'recent'} onClick={() => setSort('recent')}>最近错过</button>
          <button type="button" aria-pressed={sort === 'most'} onClick={() => setSort('most')}>错得最多</button>
        </div>
        {error ? <p className="forget-lyrics-page-message" role="alert">{error}</p> : data ? <><p className="forget-lyrics-count">{rangeLabel(range)} · {data.total} 首</p><ForgetLyricsSongList items={data.items} emptyMessage="当前范围没有忘记歌词。" /></> : <p className="forget-lyrics-page-message" role="status">正在读取…</p>}
      </div>
    </main>
  )
}
