'use client'

import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { describeMemoirPage, drawMemoirPage, memoirChapters, type MemoirAlbum } from '@/lib/annual-memoir-art'
import { loadMemoirBadges } from '@/lib/annual-memoir-badges'
import { MemoirImageGallery } from './MemoirImageGallery'

const duration = 520
const finalPage = memoirChapters.length - 1

function AlbumPage({ report, year, page, layer, badgeImages }: {
  report: MemoirAlbum; year: number; page: number; layer?: 'outgoing' | 'incoming'
  badgeImages?: ReadonlyMap<string, HTMLImageElement>
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    if (canvas.current) drawMemoirPage(canvas.current, report, year, page, badgeImages)
  }, [report, year, page, badgeImages])
  return <div data-memoir-layer={layer ?? 'stable'} aria-hidden={layer === 'outgoing' || undefined}
    className="absolute inset-0" style={{ pointerEvents: layer === 'outgoing' ? 'none' : undefined }}>
    <h2 className="sr-only">{memoirChapters[page]}</h2>
    <p className="sr-only">{describeMemoirPage(report, page)}</p>
    <canvas ref={canvas} width={1080} height={1920} aria-hidden="true" className="block h-full w-full" />
  </div>
}

export function MemoirReader({ activityId, year, initialReport, preview = false, previewCase = 'posts' }: {
  activityId: string; year: number; initialReport: MemoirAlbum; preview?: boolean; previewCase?: string
}) {
  const [report, setReport] = useState(initialReport)
  const [page, setPage] = useState(0)
  const [showHint, setShowHint] = useState(true)
  const [previous, setPrevious] = useState<number | null>(null)
  const timer = useRef<number | null>(null)
  const position = useRef(0)
  const touch = useRef<{ x: number; y: number; id: number } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState('')
  const exporting = useRef(false)
  const [exportProgress, setExportProgress] = useState<number | null>(null)
  const [gallery, setGallery] = useState<File[] | null>(null)
  const [wechat, setWechat] = useState(false)
  useLayoutEffect(() => {
    const reader = dialog.current
    const overflow = document.body.style.overflow
    const rootOverflow = document.documentElement.style.overflow
    if (reader?.showModal) reader.showModal()
    else reader?.setAttribute('open', '')
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      if (reader?.close) reader.close()
      else reader?.removeAttribute('open')
      document.body.style.overflow = overflow
      document.documentElement.style.overflow = rootOverflow
    }
  }, [])
  useEffect(() => { setWechat(/MicroMessenger/i.test(navigator.userAgent)) }, [])
  const preparedBadges = useRef<{ key: string; promise: ReturnType<typeof loadMemoirBadges> } | null>(null)
  const [badgeImages, setBadgeImages] = useState<ReadonlyMap<string, HTMLImageElement>>()
  const prepareBadges = useCallback((badges: MemoirAlbum['badgeCollage']) => {
    const key = JSON.stringify(badges?.map(({ imageUrl }) => imageUrl) ?? [])
    if (preparedBadges.current?.key !== key) preparedBadges.current = { key, promise: loadMemoirBadges(badges) }
    return preparedBadges.current.promise
  }, [])
  const collage = report?.badgeCollage
  useEffect(() => {
    if (!collage?.length) return
    let current = true
    void prepareBadges(collage).then((images) => { if (current) setBadgeImages(images) })
    return () => { current = false }
  }, [collage, prepareBadges])
  const url = '/activities/' + encodeURIComponent(activityId)
  const exitUrl = preview ? '/admin' + url + '/annual-memoir-edit' : url
  const move = useCallback((offset: number) => {
    if (timer.current !== null || gallery || exporting.current) return
    const current = position.current
    const next = Math.min(finalPage, Math.max(0, current + offset))
    if (next === current) return
    position.current = next
    setShowHint(false)
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPrevious(current)
      timer.current = window.setTimeout(() => {
        timer.current = null
        setPrevious(null)
      }, duration)
    }
    setPage(next)
  }, [gallery])
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current) }, [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (gallery || event.altKey || event.ctrlKey || event.metaKey ||
        (event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)))) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      move(event.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [move, gallery])

  async function save(asImages: boolean) {
    if (exporting.current || previous !== null) return
    exporting.current = true
    setError('')
    setExportProgress(0)
    try {
      const { renderMemoirZip, renderMemoirImages } = await import('@/lib/annual-memoir-export')
      let exportReport = report
      if (!preview) {
        const response = await fetch('/api' + url + '/annual-memoir', { cache: 'no-store' })
        if (!response.ok) throw new Error()
        const data = await response.json()
        if (!data.snapshot?.payload) throw new Error()
        exportReport = data.snapshot.payload
        setReport(exportReport)
      }
      const prepared = prepareBadges(exportReport.badgeCollage)
      if (asImages) {
        setGallery(await renderMemoirImages(exportReport, year, setExportProgress, prepared))
        return
      }
      const zip = await renderMemoirZip(exportReport, year, setExportProgress, prepared)
      const objectUrl = URL.createObjectURL(zip)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = '葡萄成熟时-' + year + '.zip'
      dialog.current?.appendChild(anchor)
      try { anchor.click() } finally {
        anchor.remove()
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
      }
    } catch {
      setError('暂时无法准备图片，请重试。')
    } finally {
      exporting.current = false
      setExportProgress(null)
    }
  }


  return <dialog ref={dialog} aria-label="葡萄成熟时年度回忆录" className="memoir-reader"
    onCancel={(event) => {
      event.preventDefault()
      if (gallery) setGallery(null)
      else window.location.assign(exitUrl)
    }}>
    <style>{`
      .memoir-reader {
        position:fixed; inset:0; margin:0; border:0; width:100%; height:100vh;
        max-width:none; max-height:none; box-sizing:border-box; overflow:hidden;
        background:radial-gradient(ellipse at 50% 34%,#54364e,#251627 77%); color:#f7e9d6;
        padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px)
          env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);
        overscroll-behavior:none;
      }
      @supports(height:100dvh) { .memoir-reader {height:100dvh} }
      .memoir-reader[open] {display:grid; grid-template-rows:44px minmax(0,1fr) 76px;}
      .memoir-reader::backdrop {background:#251627}
      .memoir-reader-bar {display:flex; align-items:center; justify-content:space-between; gap:8px; padding-inline:12px;}
      .memoir-reader-bar select {max-width:clamp(8rem,46vw,14rem);color:#f7e9d6;background:#41263c;border:1px solid #925d7a;font-size:13px}
      .memoir-reader button,.memoir-exit {min-height:44px;padding:4px 8px;touch-action:manipulation;}
      .memoir-reader button:disabled {opacity:.4}
      .memoir-exit {font-size:27px;min-width:44px;text-align:center}
      .memoir-stage {width:100%;height:100%;min-height:0;container-type:size;position:relative;touch-action:pan-y pinch-zoom}
      .memoir-stage [data-memoir-layer] {
        position:absolute; inset:50% auto auto 50%; transform:translate(-50%,-50%);
        width:min(100vw,calc((100vh - 120px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px))*0.5625));
        height:min(177.777778vw,calc(100vh - 120px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px)));
        width:min(100cqw,56.25cqh); height:min(177.777778cqw,100cqh);
      }
      .memoir-stage canvas {display:block;position:absolute;inset:0;width:100%;height:100%}
      .memoir-footer-action {display:flex;flex-wrap:wrap;align-items:center;justify-content:center;font-size:13px}
      .memoir-swipe-hint {animation:memoir-hint 3.8s ease-in-out forwards}
      .memoir-gallery {grid-row:1/-1;display:grid;grid-template-rows:44px minmax(0,1fr) auto; text-align:center; min-height:0}
      .memoir-gallery header,.memoir-gallery footer div {display:flex;align-items:center;justify-content:space-between;padding:0 12px;gap:6px}
      .memoir-gallery footer {padding:5px 0;font-size:13px}
      .memoir-gallery-image {display:grid;min-height:0;place-items:center}
      .memoir-gallery img {width:100%;height:100%;min-height:0;object-fit:contain;}
      [data-memoir-layer="outgoing"] { animation: memoir-fade-out 520ms cubic-bezier(.22,1,.36,1) both; }
      [data-memoir-layer="incoming"] { animation: memoir-fade-in 520ms cubic-bezier(.22,1,.36,1) both; }
      @keyframes memoir-fade-out { from { opacity: 1 } to { opacity: 0 } }
      @keyframes memoir-fade-in { from { opacity: 0 } to { opacity: 1 } }
      @keyframes memoir-hint { 0%,100% {opacity:0} 20%,65% {opacity:1} 75% {transform:translateX(7px)} }
      @media (pointer:coarse) { .memoir-arrow {display:none} .memoir-reader footer {justify-content:center} }
      @media (prefers-reduced-motion:reduce) {
        [data-memoir-layer="outgoing"] {display:none}
        [data-memoir-layer="incoming"],.memoir-swipe-hint {animation:none}
      }
`}</style>
    {gallery ? <MemoirImageGallery files={gallery} close={() => setGallery(null)} /> : <>
      <header className="memoir-reader-bar">
        <Link prefetch={false} href={exitUrl} aria-label="关闭年度回忆录" className="memoir-exit">×</Link>
        {preview && <select aria-label="合成预览身份" value={previewCase} onChange={(event) => {
          window.location.assign('/admin' + url + '/annual-memoir-preview?sample=' + encodeURIComponent(event.target.value))
        }}>
          <option value="posts">合成预览 · 发帖活跃</option>
          <option value="games">合成预览 · 游戏活跃</option>
          <option value="badges">合成预览 · 勋章丰富</option>
          <option value="social">合成预览 · 社交活跃</option>
          <option value="activities">合成预览 · 活动活跃</option>
          <option value="quiet">合成预览 · 低活跃</option>
        </select>}
        <span role="status">{page + 1} / {memoirChapters.length}</span>
      </header>
      <section aria-label="年度报告画册" className="memoir-stage"
        onTouchStart={(event) => {
          const point = event.touches[0]
          if (event.touches.length !== 1 || !point || point.clientX <= 24 || point.clientX >= innerWidth - 24) {
            touch.current = null
            return
          }
          touch.current = { x: point.clientX, y: point.clientY, id: point.identifier }
        }}
        onTouchCancel={() => { touch.current = null }}
        onTouchEnd={(event) => {
          const start = touch.current
          touch.current = null
          const end = start && Array.from(event.changedTouches).find(({ identifier }) => identifier === start.id)
          if (!start || !end || event.touches.length) return
          const dx = end.clientX - start.x
          if (Math.abs(dx) >= 48 && Math.abs(dx) > 1.5 * Math.abs(end.clientY - start.y)) move(dx > 0 ? 1 : -1)
        }}>
        {previous !== null && <AlbumPage key={previous} report={report} year={year} page={previous} badgeImages={badgeImages} layer="outgoing" />}
        <AlbumPage key={page} report={report} year={year} page={page} badgeImages={badgeImages} layer={previous === null ? undefined : 'incoming'} />
      </section>
      <footer className="memoir-reader-bar">
        <button className="memoir-arrow" type="button" disabled={page === 0 || previous !== null} onClick={() => move(-1)}>上一页</button>
        <div className="memoir-footer-action">
          {showHint && page === 0 && <span className="memoir-swipe-hint">向右轻滑，翻开下一页 →</span>}
          {page === finalPage && <>
            {(!wechat || preview) && <button type="button" disabled={previous !== null || exportProgress !== null} onClick={() => void save(false)}>下载全部图片（ZIP）</button>}
            <button type="button" disabled={previous !== null || exportProgress !== null} onClick={() => void save(true)}>{wechat ? '逐张保存图片' : '查看单张 JPG'}</button>
          </>}
          {exportProgress !== null && <span role="status">正在准备 {exportProgress} / 10</span>}
          {error && <span role="alert">{error}</span>}
        </div>
        <button className="memoir-arrow" type="button" disabled={page === finalPage || previous !== null} onClick={() => move(1)}>下一页</button>
      </footer>
    </>}
  </dialog>
}
