'use client'

import * as React from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  legacyHtmlToRichContent,
  plainTextToRichContent,
  richTextColorClass,
  richTextFontSizeClass,
  validateRichPostContent,
  type RichTextBlockNode,
  type RichTextContent,
  type RichTextInlineNode,
  type RichTextMark,
} from '@/lib/rich-text'
import { formatUid } from '@/lib/uid'
import { getMusicPlaybackUrl } from '@/lib/music-playback'

export type PostMusicReferenceDisplay = {
  id: string
  title: string
  artist: string
  album: string
  coverUrl?: string | null
}

type RichPostContentProps = {
  richContent?: unknown | null
  fallbackContent: string
  className?: string
  musicReferences?: readonly PostMusicReferenceDisplay[]
  enableSongPlayback?: boolean
  scopeKey?: string
}

type PostSongPlayerContextValue = {
  songId: string
  playing: boolean
  loading: boolean
  ended: boolean
  ready: boolean
  unavailable: boolean
  toggle: () => void
}

const PostSongPlayerContext = React.createContext<PostSongPlayerContextValue | null>(null)

function resetPostSongAudio(audio: HTMLAudioElement) {
  audio.pause()
  try {
    audio.currentTime = 0
  } catch {
    // The media element can be in an unloaded state during teardown.
  }
  audio.removeAttribute('src')
  audio.load()
}

function PostScopedSongPlayer({
  songId,
  scopeKey,
  children,
}: Readonly<{
  songId: string
  scopeKey?: string
  children: ReactNode
}>) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const requestControllerRef = useRef<AbortController | null>(null)
  const requestGenerationRef = useRef(0)
  const playerScopeRef = useRef(`${scopeKey || ''}:${songId}`)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [ended, setEnded] = useState(false)
  const [ready, setReady] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [resolvedUrl, setResolvedUrl] = useState('')

  const stopPlayback = useCallback(() => {
    requestGenerationRef.current += 1
    requestControllerRef.current?.abort()
    requestControllerRef.current = null
    const audio = audioRef.current
    if (audio) resetPostSongAudio(audio)
    setPlaying(false)
    setLoading(false)
    setEnded(false)
    setReady(false)
    setUnavailable(false)
    setResolvedUrl('')
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.preload = 'metadata'

    const onPlaying = () => {
      setPlaying(true)
      setLoading(false)
      setEnded(false)
    }
    const onPause = () => setPlaying(false)
    const onEnded = () => {
      setPlaying(false)
      setLoading(false)
      setEnded(true)
    }
    const onError = () => {
      if (!audio.currentSrc && !audio.src) return
      setPlaying(false)
      setLoading(false)
      setUnavailable(true)
    }

    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    return () => {
      requestGenerationRef.current += 1
      requestControllerRef.current?.abort()
      requestControllerRef.current = null
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      resetPostSongAudio(audio)
    }
  }, [])

  useEffect(() => {
    const nextScope = `${scopeKey || ''}:${songId}`
    if (playerScopeRef.current === nextScope) return
    playerScopeRef.current = nextScope
    stopPlayback()
  }, [scopeKey, songId, stopPlayback])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio || loading || unavailable) return

    if (ready && resolvedUrl && audio.currentSrc) {
      if (!audio.paused) {
        audio.pause()
        return
      }
      if (audio.ended || ended) {
        audio.currentTime = 0
        setEnded(false)
      }
      setLoading(true)
      void audio.play().catch(() => {
        setPlaying(false)
        setLoading(false)
        setUnavailable(true)
      })
      return
    }

    const generation = requestGenerationRef.current + 1
    requestGenerationRef.current = generation
    const controller = new AbortController()
    requestControllerRef.current = controller
    setLoading(true)
    setPlaying(false)
    setEnded(false)
    setUnavailable(false)

    void (async () => {
      try {
        const response = await fetch(getMusicPlaybackUrl(songId), {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })
        let payload: unknown = null
        try {
          payload = await response.json()
        } catch {
          payload = null
        }
        const body = payload && typeof payload === 'object'
          ? payload as { ok?: unknown; url?: unknown; isFullPlayback?: unknown }
          : null
        if (requestGenerationRef.current !== generation) return
        if (!response.ok || body?.ok !== true || body.isFullPlayback !== true || typeof body.url !== 'string' || !body.url) {
          setUnavailable(true)
          return
        }

        audio.src = body.url
        audio.currentTime = 0
        audio.load()
        setResolvedUrl(body.url)
        setReady(true)
        try {
          await audio.play()
        } catch {
          if (requestGenerationRef.current === generation) {
            setPlaying(false)
            setUnavailable(true)
          }
        }
      } catch (error) {
        if (requestGenerationRef.current !== generation) return
        if (error instanceof DOMException && error.name === 'AbortError') return
        setUnavailable(true)
      } finally {
        if (requestGenerationRef.current === generation) {
          requestControllerRef.current = null
          setLoading(false)
        }
      }
    })()
  }, [ended, loading, ready, resolvedUrl, songId, unavailable])

  const contextValue = useMemo<PostSongPlayerContextValue>(() => ({
    songId,
    playing,
    loading,
    ended,
    ready,
    unavailable,
    toggle,
  }), [ended, loading, playing, ready, songId, toggle, unavailable])

  return (
    <PostSongPlayerContext.Provider value={contextValue}>
      {children}
      <audio ref={audioRef} className="post-scoped-song-audio" aria-hidden="true" preload="metadata" />
    </PostSongPlayerContext.Provider>
  )
}

function renderMarks(content: ReactNode, marks: RichTextMark[] | undefined, key: string) {
  return (marks || []).reduce<ReactNode>((current, mark, index) => {
    if (mark.type === 'bold') return <strong key={key + '-bold-' + index}>{current}</strong>
    if (mark.type === 'italic') return <em key={key + '-italic-' + index}>{current}</em>
    if (mark.type === 'strike') return <s key={key + '-strike-' + index}>{current}</s>
    if (mark.type === 'code') return <code key={key + '-code-' + index}>{current}</code>
    if (mark.type === 'link') {
      return (
        <a key={key + '-link-' + index} href={mark.attrs.href} target="_blank" rel="noopener noreferrer">
          {current}
        </a>
      )
    }
    if (mark.type === 'textColor') {
      return <span key={key + '-color-' + index} className={richTextColorClass(mark.attrs.token)}>{current}</span>
    }
    return <span key={key + '-size-' + index} className={richTextFontSizeClass(mark.attrs.token)}>{current}</span>
  }, content)
}

function formatReferenceDate(value: string | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

type RichPostRenderContext = {
  musicReferences: ReadonlyMap<string, PostMusicReferenceDisplay>
  enableSongPlayback: boolean
}

function MusicReferenceInline({
  node,
  context,
}: Readonly<{
  node: Extract<RichTextInlineNode, { type: 'musicReference' }>
  context: RichPostRenderContext
}>) {
  const player = useContext(PostSongPlayerContext)
  const currentSong = context.musicReferences.get(node.attrs.songId)
  const title = currentSong?.title || node.attrs.title || '歌曲引用'
  const artist = currentSong?.artist || node.attrs.artist || ''
  const album = currentSong?.album || node.attrs.album || ''
  const coverUrl = currentSong?.coverUrl || null
  const songPlayer = context.enableSongPlayback && player?.songId === node.attrs.songId ? player : null
  const playLabel = songPlayer?.unavailable
    ? '暂不可播放'
    : songPlayer?.loading
      ? '加载中…'
      : songPlayer?.playing
        ? '❚❚ 暂停'
        : songPlayer?.ready && !songPlayer.ended
          ? '▶ 继续播放'
          : '▶ 播放'

  return (
    <span className="rich-text-music-reference" role="group" aria-label={`歌曲引用：${title}`}>
      <Link
        href={`/music/song/${encodeURIComponent(node.attrs.songId)}`}
        className="rich-text-music-reference-link"
        aria-label={`查看歌曲：${title}`}
      >
        <span className="rich-text-music-reference-icon" aria-hidden="true">
          {coverUrl ? <Image src={coverUrl} alt="" width={40} height={40} className="rich-text-music-reference-cover" /> : '♪'}
        </span>
        <span className="rich-text-music-reference-copy">
          <strong>{title}</strong>
          {artist || album ? <small>{[artist, album ? `《${album}》` : ''].filter(Boolean).join(' · ')}</small> : null}
        </span>
      </Link>
      {songPlayer ? (
        <button
          type="button"
          className="rich-text-music-reference-play"
          aria-label={playLabel}
          disabled={songPlayer.unavailable || songPlayer.loading}
          onClick={(event) => {
            event.stopPropagation()
            songPlayer.toggle()
          }}
        >
          {playLabel}
        </button>
      ) : null}
    </span>
  )
}

function renderInline(node: RichTextInlineNode, key: string, context: RichPostRenderContext) {
  if (node.type === 'hardBreak') return <br key={key} />
  if (node.type === 'musicReference') {
    return <MusicReferenceInline key={key} node={node} context={context} />
  }
  if (node.type === 'postReference') {
    const unavailable = node.attrs.available === false
    const title = unavailable ? '该引用帖子已不可用' : node.attrs.title || '引用帖子'
    const author = unavailable ? '' : node.attrs.authorName || '未知作者'
    const uid = unavailable || node.attrs.authorUid === undefined ? '' : `UID ${formatUid(node.attrs.authorUid)}`
    const card = (
      <>
        <span className="rich-text-post-reference-icon" aria-hidden="true">↗</span>
        <span className="rich-text-post-reference-copy">
          <strong>引用帖子</strong>
          <span>《{title}》</span>
          <small>{[author, uid].filter(Boolean).join(' · ')}</small>
        </span>
      </>
    )
    if (unavailable) {
      return <span key={key} className="rich-text-post-reference is-unavailable" aria-label="该引用帖子已不可用">{card}</span>
    }
    return (
      <Link
        key={key}
        href={`/posts/${encodeURIComponent(node.attrs.postId)}`}
        className="rich-text-post-reference"
        aria-label={`查看引用帖子：${title}`}
      >
        {card}
      </Link>
    )
  }
  if (node.type === 'activityReference') {
    const unavailable = node.attrs.available === false
    const title = unavailable ? '该引用活动已不可用' : node.attrs.title || node.attrs.titleSnapshot || '引用活动'
    const cover = node.attrs.coverUrl || node.attrs.bannerUrl
    const dateText = [formatReferenceDate(node.attrs.startsAt), formatReferenceDate(node.attrs.endsAt)].filter(Boolean).join(' - ')
    const details = [dateText, node.attrs.locationName, node.attrs.statusLabel].filter(Boolean).join(' · ')
    const card = (
      <>
        <span className="rich-text-activity-reference-icon" aria-hidden="true">
          {cover ? <Image src={cover} alt="" width={40} height={40} className="rich-text-reference-media" /> : '活动'}
        </span>
        <span className="rich-text-activity-reference-copy">
          <strong>引用活动</strong>
          <span>{title}</span>
          {details ? <small>{details}</small> : null}
        </span>
      </>
    )
    if (unavailable) {
      return <span key={key} className="rich-text-activity-reference is-unavailable" aria-label="该引用活动已不可用">{card}</span>
    }
    return (
      <Link
        key={key}
        href={`/activities/${encodeURIComponent(node.attrs.activityId)}`}
        className="rich-text-activity-reference"
        aria-label={`查看引用活动：${title}`}
      >
        {card}
      </Link>
    )
  }
  if (node.type === 'materialReference') {
    const unavailable = node.attrs.available === false
    const title = unavailable ? '该引用物料已不可用' : node.attrs.title || node.attrs.titleSnapshot || '引用物料'
    const details = [
      node.attrs.cost === undefined ? '' : `挂号费 ${node.attrs.cost}`,
      node.attrs.stockRemaining === undefined ? '' : `库存 ${node.attrs.stockRemaining}`,
      node.attrs.stateLabel,
      node.attrs.linkedActivityTitle,
    ].filter(Boolean).join(' · ')
    const card = (
      <>
        <span className="rich-text-material-reference-icon" aria-hidden="true">
          {node.attrs.coverImageUrl ? <Image src={node.attrs.coverImageUrl} alt="" width={40} height={40} className="rich-text-reference-media" /> : '物料'}
        </span>
        <span className="rich-text-material-reference-copy">
          <strong>引用物料</strong>
          <span>{title}</span>
          {details ? <small>{details}</small> : null}
        </span>
      </>
    )
    if (unavailable) {
      return <span key={key} className="rich-text-material-reference is-unavailable" aria-label="该引用物料已不可用">{card}</span>
    }
    return (
      <Link
        key={key}
        href={`/material-redemptions/${encodeURIComponent(node.attrs.materialId)}`}
        className="rich-text-material-reference"
        aria-label={`查看引用物料：${title}`}
      >
        {card}
      </Link>
    )
  }
  if (node.type === 'userMention') {
    const displayName = node.attrs.available === false ? '用户已不可用' : node.attrs.displayName || '用户已不可用'
    const label = `@${displayName}`
    if (node.attrs.available === false || node.attrs.uid === undefined) {
      return <span key={key} className="rich-text-user-mention is-unavailable">{label}</span>
    }
    return (
      <Link
        key={key}
        href={`/user/${formatUid(node.attrs.uid)}`}
        className="rich-text-user-mention"
        aria-label={`查看用户：${displayName}`}
      >
        {label}
      </Link>
    )
  }
  if (node.type !== 'text') return null
  return <span key={key}>{renderMarks(node.text, node.marks, key)}</span>
}

function renderInlineContent(content: RichTextInlineNode[] | undefined, key: string, context: RichPostRenderContext) {
  return (content || []).map((node, index) => renderInline(node, key + '-' + index, context))
}

function renderBlock(block: RichTextBlockNode, key: string, context: RichPostRenderContext): ReactNode {
  if (block.type === 'paragraph') {
    return <p key={key}>{renderInlineContent(block.content, key, context)}</p>
  }
  if (block.type === 'heading') {
    const tag = ('h' + block.attrs.level) as 'h1' | 'h2' | 'h3'
    const Heading = tag
    return <Heading key={key}>{renderInlineContent(block.content, key, context)}</Heading>
  }
  if (block.type === 'bulletList') {
    return <ul key={key}>{(block.content || []).map((item, index) => renderBlock(item, key + '-item-' + index, context))}</ul>
  }
  if (block.type === 'orderedList') {
    const start = block.attrs?.start && block.attrs.start > 1 ? block.attrs.start : undefined
    return <ol key={key} start={start}>{(block.content || []).map((item, index) => renderBlock(item, key + '-item-' + index, context))}</ol>
  }
  if (block.type === 'listItem') {
    return <li key={key}>{(block.content || []).map((child, index) => renderBlock(child, key + '-block-' + index, context))}</li>
  }
  if (block.type === 'blockquote') {
    return <blockquote key={key}>{(block.content || []).map((child, index) => renderBlock(child, key + '-block-' + index, context))}</blockquote>
  }
  if (block.type === 'horizontalRule') return <hr key={key} />
  return (
    <pre key={key}>
      <code>{(block.content || []).map((node) => node.text).join('')}</code>
    </pre>
  )
}

function findFirstMusicReference(value: RichTextContent): Extract<RichTextInlineNode, { type: 'musicReference' }> | null {
  let found: Extract<RichTextInlineNode, { type: 'musicReference' }> | null = null
  const visitInline = (node: RichTextInlineNode) => {
    if (!found && node.type === 'musicReference') found = node
  }
  const visitBlock = (block: RichTextBlockNode): void => {
    if (found) return
    if (block.type === 'paragraph' || block.type === 'heading') {
      block.content?.forEach(visitInline)
      return
    }
    if (block.type === 'listItem' || block.type === 'blockquote') {
      block.content?.forEach(visitBlock)
      return
    }
    if (block.type === 'bulletList' || block.type === 'orderedList') block.content?.forEach(visitBlock)
  }
  value.content.forEach(visitBlock)
  return found as Extract<RichTextInlineNode, { type: 'musicReference' }> | null
}

export function RichPostContent({
  richContent,
  fallbackContent,
  className = '',
  musicReferences = [],
  enableSongPlayback = true,
  scopeKey,
}: RichPostContentProps) {
  const result = validateRichPostContent(richContent)
  const legacy = legacyHtmlToRichContent(fallbackContent)
  const fallbackDocument = legacy || (fallbackContent ? plainTextToRichContent(fallbackContent) : null)
  const document = result.valid && (result.value.content.length > 0 || !fallbackDocument)
    ? result.value
    : fallbackDocument
  const wrapperClassName = className ? 'rich-post-content ' + className : 'rich-post-content'
  const musicReferenceMap = useMemo(() => new Map(musicReferences.map((song) => [song.id, song])), [musicReferences])

  if (!document) {
    return <div className={wrapperClassName + ' whitespace-pre-wrap break-words'}>{fallbackContent}</div>
  }

  const renderContext: RichPostRenderContext = {
    musicReferences: musicReferenceMap,
    enableSongPlayback,
  }
  const firstReference = findFirstMusicReference(document)
  const firstSong = firstReference
    ? musicReferenceMap.get(firstReference.attrs.songId) || {
        id: firstReference.attrs.songId,
        title: firstReference.attrs.title || '歌曲引用',
        artist: firstReference.attrs.artist || '',
        album: firstReference.attrs.album || '',
      }
    : null
  const contentMarkup = (
    <div className={wrapperClassName}>
      {document.content.map((block, index) => renderBlock(block, 'block-' + index, renderContext))}
    </div>
  )

  if (enableSongPlayback && firstSong) {
    return <PostScopedSongPlayer key={`${scopeKey || ''}:${firstSong.id}`} songId={firstSong.id} scopeKey={scopeKey}>{contentMarkup}</PostScopedSongPlayer>
  }
  return contentMarkup
}
