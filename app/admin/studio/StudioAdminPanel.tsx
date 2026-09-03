'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { calculateMaterialList } from '@/lib/studio/beads/grid'
import { renderPatternToCanvas } from '@/lib/studio/beads/renderer'
import type { BeadPatternGrid } from '@/lib/studio/beads/types'
import { getStudioReviewPaletteLabel } from '@/lib/studio/review-data'

type ProjectRow = {
  id: string
  toolName: string
  title: string
  description: string | null
  reviewStatus: string
  visibility: string
  thumbnailUrl: string | null
  createdAt: string
  updatedAt: string
  pattern: BeadPatternGrid | null
  metadata: { width: number | null; height: number | null; totalBeads: number; colorCount: number }
  User: { uid: number; nickname: string }
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatDimensions(width: number | null, height: number | null) {
  return width && height ? `${width} × ${height}` : '—'
}

function PatternCanvas({ pattern, label, large = false }: Readonly<{ pattern: BeadPatternGrid | null; label: string; large?: boolean }>) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current || !pattern) return
    renderPatternToCanvas(canvasRef.current, pattern, {
      displayGrid: true,
      displayCodes: large,
      displayCoordinates: large,
      displayBoardLines: true,
    })
  }, [large, pattern])

  if (!pattern) return <div className="flex min-h-32 items-center justify-center text-xs font-black text-slate-400">暂无图纸预览</div>
  return <canvas ref={canvasRef} className="block max-h-full max-w-full object-contain" aria-label={label} />
}

function PatternPreview({ thumbnailUrl, pattern, label, large = false }: Readonly<{ thumbnailUrl: string | null; pattern: BeadPatternGrid | null; label: string; large?: boolean }>) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showStoredThumbnail = Boolean(thumbnailUrl && thumbnailUrl !== failedUrl)

  if (showStoredThumbnail) {
    return <Image src={thumbnailUrl || ''} alt={label} width={480} height={480} unoptimized onError={() => setFailedUrl(thumbnailUrl)} className="block h-full w-full object-contain" />
  }
  return <PatternCanvas pattern={pattern} label={label} large={large} />
}

function DetailField({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div className="border border-slate-100 bg-slate-50/70 p-3"><dt className="text-[10px] font-black tracking-[0.12em] text-slate-400">{label}</dt><dd className="mt-1 break-words text-sm font-black text-brand-950">{value}</dd></div>
}

export function StudioAdminPanel({ initialProjects, initialProjectId }: Readonly<{ initialProjects: ProjectRow[]; initialProjectId?: string | null }>) {
  const [projects, setProjects] = useState(initialProjects)
  const [selectedProject, setSelectedProject] = useState<ProjectRow | null>(null)
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState('')

  useEffect(() => {
    if (!initialProjectId) return
    const project = projects.find((item) => item.id === initialProjectId)
    if (!project) return
    setSelectedProject(project)
    const timer = window.setTimeout(() => {
      document.getElementById(`studio-review-project-${project.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [initialProjectId, projects])

  useEffect(() => {
    if (!selectedProject) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedProject(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectedProject])

  async function review(projectId: string, reviewStatus: 'APPROVED' | 'REJECTED') {
    setBusyId(projectId)
    setMessage('')
    try {
      const response = await fetch('/api/admin/studio/projects', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, reviewStatus }) })
      const body = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(body?.message || '审核失败')
      setProjects((current) => current.filter((project) => project.id !== projectId))
      setSelectedProject((current) => current?.id === projectId ? null : current)
      setMessage(reviewStatus === 'APPROVED' ? '作品已通过公开审核，作者将收到通知。' : '作品已拒绝并恢复为私密，作者将收到通知。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '审核失败，请稍后重试。')
    } finally {
      setBusyId('')
    }
  }

  return <section className="space-y-4">
    {message ? <p className="border border-emerald-200 bg-emerald-50 p-3 text-sm font-black text-emerald-800" role="status">{message}</p> : null}
    <div className="overflow-hidden border border-sky-100 bg-white/90">
      <div className="border-b border-sky-100 px-4 py-3"><h2 className="text-lg font-black text-brand-950">待审核公开作品</h2><p className="mt-1 text-xs font-bold text-slate-500">只有通过审核的作品才会进入公开访问流程；点击缩略图或详情可查看完整图纸。</p></div>
      <div className="divide-y divide-sky-100">
        {projects.map((project) => <article key={project.id} id={`studio-review-project-${project.id}`} className={`grid gap-4 p-4 sm:p-5 lg:grid-cols-[220px_minmax(0,1fr)_auto] lg:items-center ${project.id === initialProjectId ? 'bg-amber-50/45' : ''}`}>
          <button type="button" onClick={() => setSelectedProject(project)} className="group min-w-0 border border-sky-100 bg-sky-50/35 p-2 text-left hover:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-300" aria-label={`查看${project.title}的审核详情`}>
            <div className="flex h-40 items-center justify-center overflow-hidden bg-white sm:h-44"><PatternPreview thumbnailUrl={project.thumbnailUrl} pattern={project.pattern} label={`${project.title}图纸缩略图`} /></div>
            <span className="mt-2 block text-[10px] font-black text-sky-700 group-hover:text-sky-900">查看完整详情 →</span>
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><strong className="break-words text-base font-black text-brand-950">{project.title}</strong><span className="border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-800">待审核</span></div>
            <p className="mt-2 text-xs font-bold text-slate-500">作者：{project.User.nickname}（UID {project.User.uid}）</p>
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
              <DetailField label="尺寸" value={formatDimensions(project.metadata.width, project.metadata.height)} />
              <DetailField label="色板" value={getStudioReviewPaletteLabel(project.pattern)} />
              <DetailField label="使用颜色" value={`${project.metadata.colorCount} 种`} />
              <DetailField label="总拼豆" value={`${project.metadata.totalBeads.toLocaleString()} 颗`} />
            </dl>
            <p className="mt-3 text-xs font-bold text-slate-400">创建时间：{formatDateTime(project.createdAt)} · 更新于：{formatDateTime(project.updatedAt)}</p>
            <p className="mt-2 break-words text-xs font-bold text-slate-500">{project.description || '无描述'}</p>
          </div>
          <div className="flex shrink-0 gap-2 lg:flex-col">
            <button type="button" onClick={() => setSelectedProject(project)} className="min-h-9 border border-sky-200 px-3 text-xs font-black text-sky-700 hover:border-sky-400 hover:bg-sky-50">查看详情</button>
            <button type="button" onClick={() => void review(project.id, 'REJECTED')} disabled={busyId === project.id} className="min-h-9 border border-red-200 px-3 text-xs font-black text-red-700 disabled:opacity-50">拒绝</button>
            <button type="button" onClick={() => void review(project.id, 'APPROVED')} disabled={busyId === project.id} className="min-h-9 bg-emerald-700 px-3 text-xs font-black text-white disabled:opacity-50">通过</button>
          </div>
        </article>)}
        {!projects.length ? <p className="p-6 text-sm font-bold text-slate-500">暂无待审核作品。</p> : null}
      </div>
    </div>

    {selectedProject ? (() => {
      const materials = selectedProject.pattern ? calculateMaterialList(selectedProject.pattern) : null
      return <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/55 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProject(null) }}>
        <section role="dialog" aria-modal="true" aria-labelledby="studio-review-detail-title" className="mx-auto max-w-6xl overflow-hidden border border-sky-100 bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
          <header className="flex items-start justify-between gap-4 border-b border-sky-100 px-5 py-4 sm:px-7"><div><p className="text-[10px] font-black tracking-[0.18em] text-sky-700">STUDIO REVIEW · BEADS</p><h2 id="studio-review-detail-title" className="mt-1 break-words text-xl font-black text-brand-950">{selectedProject.title}</h2><p className="mt-1 text-xs font-bold text-slate-500">审核详情 · {selectedProject.User.nickname}（UID {selectedProject.User.uid}）</p></div><button type="button" onClick={() => setSelectedProject(null)} className="min-h-9 min-w-9 border border-slate-200 text-lg font-black text-slate-500 hover:border-slate-400" aria-label="关闭审核详情">×</button></header>
          <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]">
            <div className="space-y-4">
              <section className="border border-sky-100 bg-sky-50/35 p-3 sm:p-4"><h3 className="text-sm font-black text-brand-950">作品预览</h3><div className="mt-3 flex min-h-56 items-center justify-center overflow-hidden bg-white sm:min-h-72"><PatternPreview thumbnailUrl={selectedProject.thumbnailUrl} pattern={selectedProject.pattern} label={`${selectedProject.title}作品预览`} large /></div></section>
              <section className="border border-sky-100 bg-white p-3 sm:p-4"><h3 className="text-sm font-black text-brand-950">图纸网格</h3><p className="mt-1 text-xs font-bold text-slate-400">使用现有 Pattern Grid renderer，仅在后台生成预览，不上传原始图片。</p><div className="mt-3 flex max-h-[560px] min-h-56 items-center justify-center overflow-auto bg-slate-50 p-3 sm:min-h-72"><PatternCanvas pattern={selectedProject.pattern} label={`${selectedProject.title}图纸网格`} large /></div></section>
            </div>
            <div className="space-y-4">
              <section className="border border-sky-100 bg-white p-4"><h3 className="text-sm font-black text-brand-950">作品信息</h3><dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1"><DetailField label="作者" value={`${selectedProject.User.nickname}（UID ${selectedProject.User.uid}）`} /><DetailField label="尺寸" value={formatDimensions(selectedProject.metadata.width, selectedProject.metadata.height)} /><DetailField label="色板" value={getStudioReviewPaletteLabel(selectedProject.pattern)} /><DetailField label="创建时间" value={formatDateTime(selectedProject.createdAt)} /><DetailField label="更新时间" value={formatDateTime(selectedProject.updatedAt)} /></dl><p className="mt-3 break-words text-xs font-bold leading-6 text-slate-500">{selectedProject.description || '无描述'}</p></section>
              <section className="border border-sky-100 bg-white p-4"><h3 className="text-sm font-black text-brand-950">颜色统计 / 材料统计</h3>{materials ? <><div className="mt-3 grid grid-cols-3 gap-2"><DetailField label="总拼豆" value={materials.totalBeads.toLocaleString()} /><DetailField label="使用颜色" value={`${materials.colorCount} 种`} /><DetailField label="底板" value={`${materials.boardCount} 块`} /></div><ul className="mt-3 max-h-[420px] divide-y divide-slate-100 overflow-y-auto border-t border-slate-100">{materials.materials.map((material) => <li key={`${material.brand}-${material.series}-${material.code}`} className="flex items-center gap-2 py-2 text-xs"><i className="h-5 w-5 shrink-0 border border-black/15" style={{ backgroundColor: material.hex }} aria-hidden /><span className="min-w-0 flex-1 truncate font-black text-slate-700">{material.code} · {material.name}</span><span className="shrink-0 font-black text-brand-950">{material.quantity}</span><span className="shrink-0 text-[10px] font-bold text-slate-400">{material.packs} 包</span></li>)}</ul></> : <p className="mt-3 text-xs font-bold text-slate-400">暂无有效材料数据。</p>}</section>
            </div>
          </div>
        </section>
      </div>
    })() : null}
  </section>
}
