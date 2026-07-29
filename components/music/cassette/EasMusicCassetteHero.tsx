'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CassetteField } from '@/components/music/cassette/CassetteField'
import { CassetteRecorder } from '@/components/music/cassette/CassetteRecorder'
import { useMusicPlayer, type MusicPreviewTrack } from '@/components/music/MusicPlayerProvider'
import { useCassetteDrag } from '@/hooks/useCassetteDrag'
import { createCassetteSeed, selectCassetteSongs } from '@/lib/music-cassette'
import type { CassetteMachinePhase, CassetteSong } from '@/types/music-cassette'

const INSERT_DURATION_MS = 820
const EJECT_DURATION_MS = 360

function playCassetteInsertSound() {
  // Original in-browser synthesis: no sampled or third-party audio asset is used.
  const AudioContextClass = window.AudioContext
    || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return
  const context = new AudioContextClass()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'triangle'
  oscillator.frequency.setValueAtTime(220, context.currentTime)
  oscillator.frequency.exponentialRampToValueAtTime(92, context.currentTime + 0.24)
  gain.gain.setValueAtTime(0.0001, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + 0.3)
  oscillator.onended = () => void context.close()
}

function toCassetteSong(track: MusicPreviewTrack, knownSongs: readonly CassetteSong[]): CassetteSong {
  return knownSongs.find((song) => song.id === track.id) || {
    ...track,
    albumId: '',
    albumTitle: track.albumName || 'EasMusic',
    releaseYear: 0,
    previewDuration: Math.min(60, track.previewDuration || 60),
  }
}

export function EasMusicCassetteHero({ songs }: Readonly<{ songs: CassetteSong[] }>) {
  const player = useMusicPlayer()
  const deckRef = useRef<HTMLElement | null>(null)
  const timersRef = useRef<Set<number>>(new Set())
  const [seed, setSeed] = useState(() => createCassetteSeed())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overDeck, setOverDeck] = useState(false)
  const [transition, setTransition] = useState<'idle' | 'inserting' | 'ejecting'>('idle')
  const [pendingTrack, setPendingTrack] = useState<CassetteSong | null>(null)
  const tapes = useMemo(() => selectCassetteSongs(songs, 8, seed), [seed, songs])
  const selectedTrack = tapes.find((song) => song.id === selectedId) || null
  const activeTrack = player.track ? toCassetteSong(player.track, songs) : null

  const schedule = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer)
      callback()
    }, delay)
    timersRef.current.add(timer)
  }, [])

  useEffect(() => () => {
    for (const timer of timersRef.current) window.clearTimeout(timer)
    timersRef.current.clear()
  }, [])

  const runInsertion = useCallback((song: CassetteSong) => {
    setTransition('inserting')
    setPendingTrack(song)
    setSelectedId(song.id)
    schedule(() => {
      setTransition('idle')
      setPendingTrack(null)
      void player.playTrack(song, tapes)
    }, INSERT_DURATION_MS)
  }, [player, schedule, tapes])

  const insertSong = useCallback((song: CassetteSong) => {
    if (transition !== 'idle' || player.loading) return
    playCassetteInsertSound()
    void player.prepareTrack(song, tapes)
    if (player.track) {
      setTransition('ejecting')
      setPendingTrack(song)
      player.pause()
      schedule(() => {
        player.eject()
        runInsertion(song)
      }, EJECT_DURATION_MS)
      return
    }
    runInsertion(song)
  }, [player, runInsertion, schedule, tapes, transition])

  const onDragState = useCallback((songId: string | null, nextOverDeck: boolean) => {
    setDraggingId(songId)
    setOverDeck(nextOverDeck)
  }, [])

  const { bind, cancelDrag } = useCassetteDrag({
    deckRef,
    disabled: transition !== 'idle' || player.loading,
    onDrop: insertSong,
    onDragState,
  })

  const eject = useCallback(() => {
    if (!player.track || transition !== 'idle') return
    setTransition('ejecting')
    player.pause()
    schedule(() => {
      player.eject()
      setTransition('idle')
      setSelectedId(null)
    }, EJECT_DURATION_MS)
  }, [player, schedule, transition])

  let phase: CassetteMachinePhase = 'idle'
  if (transition === 'inserting') phase = 'inserting'
  else if (transition === 'ejecting') phase = 'ejecting'
  else if (draggingId) phase = 'dragging'
  else if (player.error && activeTrack) phase = 'error'
  else if (player.loading && activeTrack) phase = 'loading'
  else if (player.playing && activeTrack) phase = 'playing'
  else if (player.ended && activeTrack) phase = 'ended'
  else if (activeTrack) phase = 'paused'

  return (
    <section className="easmusic-cassette-hero" aria-labelledby="easmusic-cassette-title">
      <header className="easmusic-cassette-heading">
        <div>
          <span>CASSETTE SAMPLER · 60 SEC</span>
          <h1 id="easmusic-cassette-title">把一首歌，放进今晚</h1>
          <p>拖动一盘随机歌曲磁带到中央录音机，试听公开的 60 秒片段。</p>
        </div>
        <button
          type="button"
          onClick={() => {
            cancelDrag()
            setSelectedId(null)
            setSeed(createCassetteSeed())
          }}
          disabled={!songs.length || transition !== 'idle'}
        >
          换一批磁带
        </button>
      </header>
      {tapes.length ? (
        <>
          <div className="easmusic-cassette-stage" data-dragging={draggingId ? 'true' : 'false'}>
            <CassetteField
              songs={tapes}
              selectedId={selectedId}
              draggingId={draggingId}
              onSelect={(song) => setSelectedId(song.id)}
              bindDrag={bind}
            />
            <CassetteRecorder
              ref={deckRef}
              phase={phase}
              track={activeTrack}
              pendingTrack={pendingTrack}
              overDeck={overDeck}
              elapsed={player.elapsed}
              duration={player.duration}
              muted={player.muted}
              error={player.error}
              onTogglePlayback={() => {
                if (player.track) void player.playTrack(player.track)
              }}
              onEject={eject}
              onToggleMuted={player.toggleMuted}
            />
          </div>
          <div className="easmusic-cassette-selection" aria-live="polite">
            {selectedTrack ? (
              <>
                <span>已选择</span>
                <strong>{selectedTrack.title}</strong>
                <small>{selectedTrack.albumTitle} · {selectedTrack.releaseYear || selectedTrack.language}</small>
                <button type="button" onClick={() => insertSong(selectedTrack)} disabled={transition !== 'idle' || player.loading}>
                  {activeTrack ? '更换为这盘磁带' : '放入录音机'}
                </button>
              </>
            ) : (
              <p>桌面端可直接拖入；触屏与键盘用户可先选择磁带，再点击“放入录音机”。</p>
            )}
          </div>
        </>
      ) : (
        <div className="easmusic-cassette-empty">
          <strong>磁带架暂时是空的</strong>
          <p>待公开试听片段准备完成后，这里会自动出现可播放的歌曲。</p>
        </div>
      )}
    </section>
  )
}
