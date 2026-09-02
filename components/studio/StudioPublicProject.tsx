'use client'

import { useEffect, useRef, useState } from 'react'
import { ShareButton } from '@/components/share/ShareButton'
import type { ShareCardData } from '@/lib/share-card'
import type { BeadProjectData } from '@/lib/studio/beads/types'
import { calculateMaterialList } from '@/lib/studio/beads/grid'
import { renderPatternToCanvas } from '@/lib/studio/beads/renderer'
import { UiIcon } from '@/components/UiIcon'
import styles from './studio.module.css'

type PublicProject = {
  id: string
  title: string
  description: string | null
  thumbnailUrl: string | null
  likeCount: number
  favoriteCount: number
  viewCount: number
  createdAt: string
  updatedAt: string
  author: string
  data: BeadProjectData
}

export function StudioPublicProject({ project }: Readonly<{ project: PublicProject }>) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [message, setMessage] = useState('')
  const [likeCount, setLikeCount] = useState(project.likeCount)
  const [favoriteCount, setFavoriteCount] = useState(project.favoriteCount)
  const [viewCount] = useState(project.viewCount)
  const [isLiked, setIsLiked] = useState(false)
  const [isFavorited, setIsFavorited] = useState(false)
  const [interactionBusy, setInteractionBusy] = useState<'like' | 'favorite' | null>(null)
  const pattern = project.data.pattern
  const materials = calculateMaterialList(pattern)

  useEffect(() => {
    if (!canvasRef.current) return
    renderPatternToCanvas(canvasRef.current, pattern, { displayGrid: true, displayCodes: true, displayCoordinates: true, displayBoardLines: true })
  }, [pattern])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/studio/projects/${encodeURIComponent(project.id)}/interactions`, { cache: 'no-store' })
      .then(async (response) => response.ok ? await response.json() as { likeCount?: number; favoriteCount?: number; isLiked?: boolean; isFavorited?: boolean } : null)
      .then((state) => {
        if (cancelled || !state) return
        if (typeof state.likeCount === 'number') setLikeCount(state.likeCount)
        if (typeof state.favoriteCount === 'number') setFavoriteCount(state.favoriteCount)
        setIsLiked(Boolean(state.isLiked))
        setIsFavorited(Boolean(state.isFavorited))
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [project.id])

  async function toggleInteraction(kind: 'like' | 'favorite') {
    if (interactionBusy) return
    const active = kind === 'like' ? !isLiked : !isFavorited
    setInteractionBusy(kind)
    try {
      const response = await fetch(`/api/studio/projects/${encodeURIComponent(project.id)}/${kind}`, { method: active ? 'POST' : 'DELETE' })
      const body = await response.json().catch(() => null) as { message?: string; likeCount?: number; favoriteCount?: number; isLiked?: boolean; isFavorited?: boolean } | null
      if (response.status === 401) {
        setMessage(`登录后才能${kind === 'like' ? '点赞' : '收藏'}作品。`)
        return
      }
      if (!response.ok || !body) throw new Error(body?.message || '操作失败，请稍后重试。')
      if (typeof body.likeCount === 'number') setLikeCount(body.likeCount)
      if (typeof body.favoriteCount === 'number') setFavoriteCount(body.favoriteCount)
      setIsLiked(Boolean(body.isLiked))
      setIsFavorited(Boolean(body.isFavorited))
      setMessage(kind === 'like' ? (body.isLiked ? '已点赞。' : '已取消点赞。') : (body.isFavorited ? '已收藏。' : '已取消收藏。'))
    } catch {
      setMessage('网络暂时不可用，请稍后重试。')
    } finally {
      setInteractionBusy(null)
    }
  }

  const shareCardData: ShareCardData = {
    type: 'studio',
    contentId: project.id,
    title: project.title,
    description: project.description || '来自贝多芬与我的拼豆图纸',
    image: project.thumbnailUrl,
    url: `/studio/project/${project.id}`,
    author: project.author,
    authorAvatar: null,
    date: project.updatedAt,
    meta: [
      { label: '工具', value: '拼豆图纸' },
      { label: '尺寸', value: `${pattern.width} × ${pattern.height}` },
    ],
  }

  return <main className={styles.publicPage}>
    <header className={styles.publicHeader}>
      <div><span className={styles.sectionKicker}>public project / beads</span><h1 className={styles.publicTitle}>{project.title}</h1><p className={styles.publicDescription}>{project.description || '拼豆图纸作品'}</p></div>
      <ShareButton data={shareCardData} label="分享作品" triggerClassName={`${styles.actionButton} ${styles.actionButtonPrimary}`} />
    </header>
    {message ? <p className={styles.notice} role="status">{message}</p> : null}
    <section className={styles.publicLayout}>
      <div className={styles.publicCanvasCard}><canvas ref={canvasRef} className={styles.publicCanvas} aria-label={`${project.title}拼豆图纸`} /></div>
      <aside className={styles.publicInfoCard}>
        <div className={styles.publicAuthor}><span className={styles.publicAuthorMark}><UiIcon name="user" /></span><div><span>创作者</span><strong>{project.author}</strong></div></div>
        <dl className={styles.publicStats}><div><dt>尺寸</dt><dd>{pattern.width} × {pattern.height} 颗</dd></div><div><dt>底板</dt><dd>{materials.boardCount} 块</dd></div><div><dt>总拼豆</dt><dd>{materials.totalBeads.toLocaleString()} 颗</dd></div><div><dt>颜色</dt><dd>{materials.colorCount} 种</dd></div></dl>
        <p className={styles.publicDate}>更新于 {new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(project.updatedAt))} · 浏览 {viewCount}</p>
        <div className={styles.publicInteractions} aria-label="作品互动">
          <button type="button" className={`${styles.publicInteraction} ${isLiked ? styles.publicInteractionActive : ''}`} onClick={() => void toggleInteraction('like')} disabled={interactionBusy !== null} aria-pressed={isLiked}>{isLiked ? '♥' : '♡'} {likeCount} <span>点赞</span></button>
          <button type="button" className={`${styles.publicInteraction} ${isFavorited ? styles.publicInteractionFavorite : ''}`} onClick={() => void toggleInteraction('favorite')} disabled={interactionBusy !== null} aria-pressed={isFavorited}>{isFavorited ? '★' : '☆'} {favoriteCount} <span>收藏</span></button>
        </div>
        <div className={styles.publicMaterialList}>{materials.materials.slice(0, 12).map((material) => <div key={material.code} className={styles.publicMaterial}><i style={{ background: material.hex }} /><span>{material.code} · {material.name}</span><strong>{material.quantity}</strong></div>)}</div>
      </aside>
    </section>
  </main>
}
