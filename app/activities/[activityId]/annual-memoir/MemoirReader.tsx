'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import type { MemoirReport } from '@/lib/annual-memoir-report'

export function MemoirReader({ activityId, year, initialReport, canGenerate }: {
  activityId: string; year: number; initialReport: MemoirReport | null; canGenerate: boolean
}) {
  const [report, setReport] = useState(initialReport)
  const [page, setPage] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const touch = useRef<number | null>(null)
  const exporting = useRef(false)
  const [exportProgress, setExportProgress] = useState<number | null>(null)
  const [download, setDownload] = useState<Blob | null>(null)
  const url = `/activities/${encodeURIComponent(activityId)}`
  async function generate() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api${url}/annual-memoir`, {
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
  const chapters = report && [
    ['初次见面', report.nickname, `UID ${report.uid} · ${report.registered} 加入`, report.firstRecordedDay ? `年度首个记录日 ${report.firstRecordedDay}` : '今年的故事，等你写下第一笔。'],
    ['日子有功', `${report.activeDays} 天留下社区记录`, `挂号 ${report.checkIns} 天`, `挂号获得 ${report.checkInExperience} 经验`],
    ['有话好说', `${report.posts} 篇公开帖子 · ${report.replies} 条公开评论`, `送出 ${report.likesGiven} 个赞`, `收到 ${report.likesReceived} 个赞`],
    ['最佳损友', `${report.friends} 段新友谊`],
    ['好久不见', report.followers ? `${report.followers} 位新关注者` : '或许有些相遇还没有发生，但属于你的故事，仍在继续。'],
    ['游戏人间', `完成 ${report.games} 局猜歌游戏`, report.bestScore === null ? '还有许多挑战等着你。' : `单局最高分 ${report.bestScore}`],
    ['闪闪发光', `获得 ${report.badges} 枚勋章`],
    ['我们万岁', `参与 ${report.topics} 场获审核通过的话题活动`, `核销 ${report.verified} 场线下活动`],
    ['年度身份', report.title],
    ['明年今日', report.nickname, report.title, report.message],
  ]
  const move = (offset: number) => setPage((current) => Math.min(9, Math.max(0, current + offset)))
  async function save() {
    if (!chapters || exporting.current) return
    exporting.current = true
    setError('')
    setExportProgress(0)
    try {
      const { renderMemoirZip } = await import('@/lib/annual-memoir-export')
      const zip = download ?? await renderMemoirZip(chapters, year, setExportProgress)
      setDownload(zip)
      const objectUrl = URL.createObjectURL(zip)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `葡萄成熟时-${year}.zip`
      document.body.appendChild(anchor)
      try { anchor.click() } finally {
        anchor.remove()
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
      }
    } catch {
      setError('导出失败，请重试。如果内置浏览器无法下载，请用系统浏览器打开。')
    } finally {
      exporting.current = false
      setExportProgress(null)
    }
  }
  return <main className="mx-auto max-w-lg p-4 text-[#4a243e]">
    <header className="mb-4"><h1 className="text-2xl font-bold">葡萄成熟时</h1><p>私家E院 {year} 年度回忆录</p></header>
    {chapters && page >= 0 ? <>
      <section aria-live="polite" className={`flex aspect-[9/16] flex-col justify-center gap-5 break-words border border-[#c4a374] p-8 ${page % 2 ? 'bg-[#50243f] text-[#fff1dc]' : 'bg-[#fff1dc]'}`}
        onTouchStart={(event) => { touch.current = event.touches[0]?.clientX ?? null }}
        onTouchEnd={(event) => {
          if (touch.current === null) return
          const offset = (event.changedTouches[0]?.clientX ?? touch.current) - touch.current
          if (Math.abs(offset) > 48) move(offset < 0 ? 1 : -1)
          touch.current = null
        }}>
        <span className="text-sm">{year} · {String(page + 1).padStart(2, '0')}</span>
        <h2 className="text-4xl font-bold">{chapters[page][0]}</h2>
        {chapters[page].slice(1).map((line, index) => <p key={index} className="text-lg">{line}</p>)}
      </section>
      <nav aria-label="报告翻页" className="my-4 flex items-center justify-between gap-3">
        <button type="button" disabled={page === 0} onClick={() => move(-1)}>上一页</button>
        <progress aria-label="阅读进度" value={page + 1} max={10} /><span>{page + 1} / 10</span>
        <button type="button" disabled={page === 9} onClick={() => move(1)}>下一页</button>
      </nav>
      {page === 9 && <button type="button" disabled={exportProgress !== null} onClick={save}>
        {exportProgress === null ? '保存我的年度报告' : `正在导出 ${exportProgress} / 10`}
      </button>}
    </> : report ? <button type="button" onClick={() => setPage(0)}>查看我的年度报告</button>
      : canGenerate ? <button type="button" disabled={busy} onClick={generate}>{busy ? '正在生成…' : '生成我的' + year + '年度报告'}</button>
        : <p>当前不在年度报告生成时段。</p>}
    {error && <p role="alert">{error}</p>}
    <Link href={url} className="mt-4 block underline">返回活动详情</Link>
  </main>
}
