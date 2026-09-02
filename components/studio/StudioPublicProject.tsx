'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShareButton } from '@/components/share/ShareButton'
import type { ShareCardData } from '@/lib/share-card'
import type { BeadProjectData } from '@/lib/studio/beads/types'
import { calculateMaterialList } from '@/lib/studio/beads/grid'
import { createBrandedBeadPatternJpg, createBrandedBeadPatternPdf } from '@/lib/studio/beads/branded-export'
import { isStudioGalleryPath, STUDIO_GALLERY_RETURN_STORAGE_KEY } from '@/lib/studio/navigation'
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
  downloadCount: number
  createdAt: string
  updatedAt: string
  author: string
  data: BeadProjectData
}

type DownloadFormat = 'PDF' | 'JPG'

export function StudioPublicProject({ project }: Readonly<{ project: PublicProject }>) {
  const router = useRouter()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [message, setMessage] = useState('')
  const [likeCount, setLikeCount] = useState(project.likeCount)
  const [favoriteCount, setFavoriteCount] = useState(project.favoriteCount)
  const [viewCount] = useState(project.viewCount)
  const [downloadCount, setDownloadCount] = useState(project.downloadCount)
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false)
  const [isLiked, setIsLiked] = useState(false)
  const [isFavorited, setIsFavorited] = useState(false)
  const [interactionBusy, setInteractionBusy] = useState<'like' | 'favorite' | null>(null)
  const [downloadBusy, setDownloadBusy] = useState(false)
  const downloadBusyRef = useRef(false)
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

  function returnToGallery() {
    let fromGallery = isStudioGalleryPath(document.referrer)
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(STUDIO_GALLERY_RETURN_STORAGE_KEY) || 'null') as { id?: unknown; path?: unknown } | null
      fromGallery = fromGallery || (stored?.id === project.id && typeof stored.path === 'string' && isStudioGalleryPath(stored.path))
      if (fromGallery) window.sessionStorage.removeItem(STUDIO_GALLERY_RETURN_STORAGE_KEY)
    } catch {
      // Private browsing may make sessionStorage unavailable; the referrer check remains.
    }
    if (fromGallery) router.back()
    else router.push('/studio/gallery')
  }

  async function downloadPattern(format: DownloadFormat) {
    if (downloadBusyRef.current || downloadBusy) return
    downloadBusyRef.current = true
    setDownloadBusy(true)
    setDownloadMenuOpen(false)
    let downloadStarted = false
    try {
      const name = (project.title.trim() || '拼豆图纸').replace(/[\\/:*?"<>|]/g, '_')
      const projectUrl = `/studio/project/${encodeURIComponent(project.id)}`
      const file = format === 'PDF'
        ? await createBrandedBeadPatternPdf({ pattern, title: project.title, projectUrl })
        : await createBrandedBeadPatternJpg({ pattern, title: project.title, projectUrl })
      const filename = `${name}.${format === 'PDF' ? 'pdf' : 'jpg'}`
      const url = URL.createObjectURL(file)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      downloadStarted = true
      window.setTimeout(() => URL.revokeObjectURL(url), 1200)

      const response = await fetch(`/api/studio/projects/${encodeURIComponent(project.id)}/download`, { method: 'POST' })
      const body = await response.json().catch(() => null) as { downloadCount?: number; message?: string } | null
      if (!response.ok) throw new Error(body?.message || '下载统计暂时未同步')
      if (typeof body?.downloadCount === 'number') setDownloadCount(body.downloadCount)
      setMessage(`图纸 ${format} 已开始下载。`)
    } catch {
      setMessage(downloadStarted ? '图纸已开始下载，但下载统计暂时未同步。' : '图纸生成失败，请稍后重试。')
    } finally {
      downloadBusyRef.current = false
      setDownloadBusy(false)
    }
  }

  const shareCardData: ShareCardData = {
    type: 'studio',
    contentId: project.id,
    title: project.title,
    description: project.description || '来自贝多芬与我的拼豆图纸',
    image: project.thumbnailUrl,
    url: `/studio/project/${encodeURIComponent(project.id)}`,
    author: project.author,
    authorAvatar: null,
    date: project.updatedAt,
    meta: [
      { label: '工具', value: '拼豆图纸' },
      { label: '尺寸', value: `${pattern.width} × ${pattern.height}` },
    ],
  }

  const paletteBrand = pattern.palette.find((color) => color.brand && color.series)
  return <main className={styles.publicPage}>
    <header className={styles.publicHeader}>
      <button type="button" className={styles.publicBackButton} onClick={returnToGallery}>← 返回创作广场</button>
      <div className={styles.publicHeaderTitle}><span className={styles.publicHeaderKicker}>拼豆图纸作品</span><h1 className={styles.publicTitle}>{project.title}</h1><p className={styles.publicDescription}>{project.description || '把喜欢的画面，一颗一颗拼出来。'}</p></div>
      <div className={styles.publicHeaderActions}>
        <div className={styles.publicDownloadWrap}>
          <button type="button" className={styles.publicHeaderAction} onClick={() => setDownloadMenuOpen((open) => !open)} disabled={downloadBusy} aria-haspopup="menu" aria-expanded={downloadMenuOpen}><UiIcon name="download" /><span>下载</span><small>{downloadCount}</small></button>
          {downloadMenuOpen ? <div className={styles.publicDownloadMenu} role="menu" aria-label="选择下载格式"><button type="button" role="menuitem" onClick={() => void downloadPattern('PDF')}><strong>PDF</strong><span>中文打印稿、材料与二维码</span></button><button type="button" role="menuitem" onClick={() => void downloadPattern('JPG')}><strong>JPG</strong><span>高清图纸、网格与色号</span></button></div> : null}
        </div>
        <ShareButton data={shareCardData} label="↗ 分享" triggerClassName={`${styles.publicHeaderAction} ${styles.publicShareAction}`} ariaLabel="分享作品" />
      </div>
    </header>
    {message ? <p className={styles.notice} role="status">{message}</p> : null}
    <section className={styles.publicLayout}>
      <div className={styles.publicCanvasCard}><canvas ref={canvasRef} className={styles.publicCanvas} aria-label={`${project.title}拼豆图纸`} /></div>
      <aside className={styles.publicInfoCard}>
        <div className={styles.publicAuthor}><span className={styles.publicAuthorMark}><UiIcon name="user" /></span><div><span>创作者</span><strong>{project.author}</strong></div></div>
        <dl className={styles.publicStats}><div><dt>尺寸</dt><dd>{pattern.width} × {pattern.height} 颗</dd></div><div><dt>拼豆板</dt><dd>{materials.boardCount} 块</dd></div><div><dt>豆子数量</dt><dd>{materials.totalBeads.toLocaleString()} 颗</dd></div><div><dt>颜色数量</dt><dd>{materials.colorCount} 种</dd></div></dl>
        <p className={styles.publicDate}>更新于 {new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(project.updatedAt))} · 浏览 {viewCount}</p>
        <div className={styles.publicInteractions} aria-label="作品互动">
          <button type="button" className={`${styles.publicInteraction} ${isLiked ? styles.publicInteractionActive : ''}`} onClick={() => void toggleInteraction('like')} disabled={interactionBusy !== null} aria-pressed={isLiked}>{isLiked ? '♥' : '♡'} {likeCount} <span>点赞</span></button>
          <button type="button" className={`${styles.publicInteraction} ${isFavorited ? styles.publicInteractionFavorite : ''}`} onClick={() => void toggleInteraction('favorite')} disabled={interactionBusy !== null} aria-pressed={isFavorited}>{isFavorited ? '★' : '☆'} {favoriteCount} <span>收藏</span></button>
        </div>
        <div className={styles.publicMaterialList}><p className={styles.publicMaterialHeading}>{paletteBrand ? `${paletteBrand.brand} ${paletteBrand.series} · 材料` : '材料清单'}</p>{materials.materials.slice(0, 12).map((material) => <div key={material.code} className={styles.publicMaterial}><i style={{ background: material.hex }} /><span>{material.code} · {material.name}</span><strong>{material.quantity}</strong></div>)}</div>
      </aside>
    </section>
  </main>
}
