'use client'

import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MemoirReport } from '@/lib/annual-memoir-report'
import { describeMemoirPage, drawMemoirPage, memoirChapters } from '@/lib/annual-memoir-art'

const duration = 520
const finalPage = memoirChapters.length - 1

function AlbumPage({ report, year, page, layer }: {
  report: MemoirReport; year: number; page: number; layer?: 'outgoing' | 'incoming'
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    if (canvas.current) drawMemoirPage(canvas.current, report, year, page)
  }, [report, year, page])
  return <div data-memoir-layer={layer ?? 'stable'} aria-hidden={layer === 'outgoing' || undefined}
    className="absolute inset-0" style={{ pointerEvents: layer === 'outgoing' ? 'none' : undefined }}>
    <h2 className="sr-only">{memoirChapters[page]}</h2>
    <p className="sr-only">{describeMemoirPage(report, page)}</p>
    <canvas ref={canvas} width={1080} height={1920} aria-hidden="true" className="block h-full w-full" />
  </div>
}

export function MemoirReader({ activityId, year, initialReport, canGenerate }: {
  activityId: string; year: number; initialReport: MemoirReport | null; canGenerate: boolean
}) {
  const [report, setReport] = useState(initialReport)
  const [page, setPage] = useState(-1)
  const [previous, setPrevious] = useState<number | null>(null)
  const timer = useRef<number | null>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const exporting = useRef(false)
  const [exportProgress, setExportProgress] = useState<number | null>(null)
  const [download, setDownload] = useState<Blob | null>(null)
  const url = '/activities/' + encodeURIComponent(activityId)
  const move = useCallback((offset: number) => {
    if (timer.current !== null || page < 0) return
    const next = Math.min(finalPage, Math.max(0, page + offset))
    if (next === page) return
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPrevious(page)
      timer.current = window.setTimeout(() => {
        timer.current = null
        setPrevious(null)
      }, duration)
    }
    setPage(next)
  }, [page])
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current) }, [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (page < 0 || event.altKey || event.ctrlKey || event.metaKey ||
        (event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)))) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      move(event.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [move, page])

  async function generate() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api' + url + '/annual-memoir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }),
      })
      if (!response.ok) throw new Error()
      setReport((await response.json()).snapshot.payload)
      setPage(0)
    } catch {
      setError('暂时无法生成报告，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!report || exporting.current || previous !== null) return
    exporting.current = true
    setError('')
    setExportProgress(0)
    try {
      const { renderMemoirZip } = await import('@/lib/annual-memoir-export')
      const zip = download ?? await renderMemoirZip(report, year, setExportProgress)
      setDownload(zip)
      const objectUrl = URL.createObjectURL(zip)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = '葡萄成熟时-' + year + '.zip'
      document.body.appendChild(anchor)
      try { anchor.click() } finally {
        anchor.remove()
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
      }
    } catch {
      setError('导出失败，请稍后重试。如果内置浏览器无法下载，请用系统浏览器打开。')
    } finally {
      exporting.current = false
      setExportProgress(null)
    }
  }

  return <div className="mx-auto max-w-lg p-4 text-[#4a243e] dark:text-[#f6e4d0]">
    <style>{`
      [data-memoir-layer="outgoing"] { animation: memoir-fade-out ${duration}ms cubic-bezier(.22,1,.36,1) both; }
      [data-memoir-layer="incoming"] { animation: memoir-fade-in ${duration}ms cubic-bezier(.22,1,.36,1) both; }
      @keyframes memoir-fade-out { from { opacity: 1 } to { opacity: 0 } }
      @keyframes memoir-fade-in { from { opacity: 0 } to { opacity: 1 } }
      @media (prefers-reduced-motion: reduce) {
        [data-memoir-layer="outgoing"] { display: none }
        [data-memoir-layer="incoming"] { animation: none }
      }
    `}</style>
    <header className="mb-4"><h1 className="text-2xl font-bold">葡萄成熟时</h1><p>私家E院 {year} 年度回忆录</p></header>
    {report && page >= 0 ? <>
      <section aria-label="年度报告画册" aria-live="polite" className="relative aspect-[9/16] overflow-hidden rounded-sm bg-[#41263c] shadow-lg"
        style={{ touchAction: 'pan-y' }}
        onTouchStart={(event) => {
          const point = event.touches[0]
          touch.current = event.touches.length === 1 && point ? { x: point.clientX, y: point.clientY } : null
        }}
        onTouchCancel={() => { touch.current = null }}
        onTouchEnd={(event) => {
          const start = touch.current
          const end = event.changedTouches[0]
          touch.current = null
          if (!start || !end) return
          const dx = end.clientX - start.x
          if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(end.clientY - start.y)) move(dx < 0 ? 1 : -1)
        }}>
        {previous !== null && <AlbumPage key={previous} report={report} year={year} page={previous} layer="outgoing" />}
        <AlbumPage key={page} report={report} year={year} page={page} layer={previous === null ? undefined : 'incoming'} />
      </section>
      <nav aria-label="报告翻页" className="my-4 flex items-center justify-between gap-3">
        <button type="button" className="min-h-11 px-2 disabled:opacity-50" disabled={page === 0 || previous !== null} onClick={() => move(-1)}>上一页</button>
        <progress aria-label="阅读进度" value={page + 1} max={10} /><span>{page + 1} / 10</span>
        <button type="button" className="min-h-11 px-2 disabled:opacity-50" disabled={page === finalPage || previous !== null} onClick={() => move(1)}>下一页</button>
      </nav>
      {page === finalPage && <button className="rounded bg-[#4a243e] px-4 py-3 text-[#fff1dc]" type="button" disabled={previous !== null || exportProgress !== null} onClick={save}>
        {exportProgress === null ? '保存我的年度报告' : '正在导出 ' + exportProgress + ' / 10'}
      </button>}
    </> : report ? <button className="rounded bg-[#4a243e] px-4 py-3 text-[#fff1dc]" type="button" onClick={() => setPage(0)}>查看我的年度报告</button>
      : canGenerate ? <button type="button" disabled={busy} onClick={generate}>{busy ? '正在生成…' : '生成我的' + year + '年度报告'}</button>
        : <p>当前不在年度报告生成时段。</p>}
    {error && <p role="alert">{error}</p>}
    <Link href={url} className="mt-4 block underline">返回活动详情</Link>
  </div>
}
