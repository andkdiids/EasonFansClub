'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { CassetteField } from '@/components/music/cassette/CassetteField'
import { CassetteRecorder } from '@/components/music/cassette/CassetteRecorder'
import { CassetteTapeVisual } from '@/components/music/cassette/CassetteTape'
import { useMusicPlayer, type MusicPreviewTrack } from '@/components/music/MusicPlayerProvider'
import { useCassetteDrag } from '@/hooks/useCassetteDrag'
import { createCassetteSeed, selectCassetteSongs } from '@/lib/music-cassette'
import type { CassetteMachinePhase, CassetteSong } from '@/types/music-cassette'

const INSERT_DURATION_MS = 820
const EJECT_DURATION_MS = 360
const INITIAL_CASSETTE_SEED = 20260803

function toCassetteSong(track: MusicPreviewTrack, knownSongs: readonly CassetteSong[]): CassetteSong {
  return knownSongs.find((song) => song.id === track.id) || {
    ...track,
    albumId: '',
    albumTitle: track.albumName || 'EasMusic',
    releaseYear: 0,
    previewDuration: track.isFullPlayback ? track.previewDuration || 60 : Math.min(60, track.previewDuration || 60),
    isFullPlayback: track.isFullPlayback,
  }
}

export function EasMusicCassetteHero({ songs }: Readonly<{ songs: CassetteSong[] }>) {
  const player = useMusicPlayer()
  const deckRef = useRef<HTMLElement | null>(null)
  const timersRef = useRef<Set<number>>(new Set())
  const previousBatchIdsRef = useRef<ReadonlySet<string>>(new Set())
  // Keep the first render deterministic for SSR hydration, then restore the
  // original random cassette selection once the client has mounted.
  const [seed, setSeed] = useState(INITIAL_CASSETTE_SEED)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null)
  const [overDeck, setOverDeck] = useState(false)
  const [transition, setTransition] = useState<'idle' | 'inserting' | 'ejecting'>('idle')
  const tapes = useMemo(() => selectCassetteSongs(songs, 8, seed, previousBatchIdsRef.current), [seed, songs])
  const selectedTrack = tapes.find((song) => song.id === selectedId) || null
  const activeTrack = player.track ? toCassetteSong(player.track, songs) : null
  const activeTapeIndex = activeTrack ? tapes.findIndex((song) => song.id === activeTrack.id) : -1
  const previousDisabled = activeTapeIndex <= 0
  const nextDisabled = activeTapeIndex < 0 || activeTapeIndex >= tapes.length - 1
  const draggingIndex = draggingId ? tapes.findIndex((song) => song.id === draggingId) : -1
  const draggingTrack = draggingIndex >= 0 ? tapes[draggingIndex] : null

  const schedule = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer)
      callback()
    }, delay)
    timersRef.current.add(timer)
  }, [])

  useEffect(() => {
    setSeed(createCassetteSeed())
    const timers = timersRef.current
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const runInsertion = useCallback((song: CassetteSong) => {
    setTransition('inserting')
    setSelectedId(song.id)
    schedule(() => {
      setTransition('idle')
      void player.playTrack(song, tapes)
    }, INSERT_DURATION_MS)
  }, [player, schedule, tapes])

  const insertSong = useCallback((song: CassetteSong) => {
    if (transition !== 'idle' || player.loading) return
    player.playInsertionSound()
    void player.prepareTrack(song, tapes)
    if (player.track) {
      setTransition('ejecting')
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
    onDragPoint: setDragPoint,
  })

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
         <div className="easmusic-cassette-heading-copy">
          <span>CASSETTE SAMPLER · 60 SEC</span>
          <h1 id="easmusic-cassette-title">把一首歌，放进今晚</h1>
          <p>拖动一盘随机歌曲磁带到中央录音机，试听公开的 60 秒片段。</p>
        </div>
         <button
           className="easmusic-cassette-refresh-button"
          type="button"
          onClick={() => {
            cancelDrag()
            setSelectedId(null)
            previousBatchIdsRef.current = new Set(tapes.map((song) => song.id))
            setSeed(createCassetteSeed())
          }}
          disabled={!songs.length || transition !== 'idle'}
        >
          换一批磁带
        </button>
      </header>
      {tapes.length ? (
        <>
          <div className="easmusic-cassette-stage easmusic-cassette-stage--stacked" data-dragging={draggingId ? 'true' : 'false'} data-mobile-layout="stacked">
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
              overDeck={overDeck}
              error={player.error}
              audioRef={player.audioRef}
              analyserNode={player.analyserNode}
              analysisMode={player.audioAnalysisMode}
              onAnalysisModeChange={player.reportAudioAnalysisMode}
              previousDisabled={previousDisabled}
              nextDisabled={nextDisabled}
              onTogglePlayback={() => {
                if (player.track) void player.playTrack(player.track)
              }}
              onPrevious={() => void player.previous()}
              onNext={() => void player.next()}
            />
          </div>
          {selectedTrack ? (
            <div
              className="easmusic-cassette-selection"
              data-has-cover={selectedTrack.coverUrl ? 'true' : 'false'}
              aria-live="polite"
            >
                <span className="easmusic-cassette-selection-label">已选择</span>
                {selectedTrack.coverUrl ? (
                  <Image
                    src={selectedTrack.coverUrl}
                    alt={`${selectedTrack.albumTitle} 专辑封面`}
                    width={44}
                    height={44}
                    sizes="44px"
                    className="easmusic-selected-album-cover"
                  />
                ) : null}
                <div className="easmusic-cassette-selection-copy">
                  <strong>{selectedTrack.title}</strong>
                  <small>{selectedTrack.albumTitle} · {selectedTrack.releaseYear || selectedTrack.language}</small>
                </div>
                <button type="button" onClick={() => insertSong(selectedTrack)} disabled={transition !== 'idle' || player.loading}>
                  {activeTrack ? '更换为这盘磁带' : '放入录音机'}
                </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="easmusic-cassette-empty">
          <strong>磁带架暂时是空的</strong>
          <p>待公开试听片段准备完成后，这里会自动出现可播放的歌曲。</p>
        </div>
      )}
      {/* While dragging, the tape floats in a body-level layer so it escapes
          the hero's overflow/stacking context and can travel over the whole
          page; the original tape stays behind as a ghost. */}
      {draggingTrack && dragPoint
        ? createPortal(
          <div className="easmusic-drag-layer" aria-hidden="true">
            <div
              className="easmusic-tape easmusic-tape-float"
              style={{ '--float-x': `${dragPoint.x}px`, '--float-y': `${dragPoint.y}px` } as CSSProperties}
            >
              <CassetteTapeVisual song={draggingTrack} index={draggingIndex} priority />
            </div>
          </div>,
          document.body,
        )
        : null}
    </section>
  )
}
