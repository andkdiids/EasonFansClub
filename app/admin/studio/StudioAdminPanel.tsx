'use client'

import { useState } from 'react'

type ProjectRow = {
  id: string
  toolName: string
  title: string
  description: string | null
  reviewStatus: string
  visibility: string
  createdAt: string
  metadata: { width: number | null; height: number | null; totalBeads: number }
  User: { uid: number; nickname: string }
}

export function StudioAdminPanel({ initialProjects }: Readonly<{ initialProjects: ProjectRow[] }>) {
  const [projects, setProjects] = useState(initialProjects)
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState('')

  async function review(projectId: string, reviewStatus: 'APPROVED' | 'REJECTED') {
    setBusyId(projectId)
    setMessage('')
    try {
      const response = await fetch('/api/admin/studio/projects', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, reviewStatus }) })
      const body = await response.json() as { message?: string }
      if (!response.ok) throw new Error(body.message || '审核失败')
      setProjects((current) => current.filter((project) => project.id !== projectId))
      setMessage(reviewStatus === 'APPROVED' ? '作品已通过公开审核。' : '作品已拒绝并恢复为私密。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '审核失败，请稍后重试。')
    } finally {
      setBusyId('')
    }
  }

  return <section className="space-y-4">
    {message ? <p className="border border-emerald-200 bg-emerald-50 p-3 text-sm font-black text-emerald-800" role="status">{message}</p> : null}
    <div className="overflow-hidden border border-sky-100 bg-white/90">
      <div className="border-b border-sky-100 px-4 py-3"><h2 className="text-lg font-black text-brand-950">待审核公开作品</h2><p className="mt-1 text-xs font-bold text-slate-500">只有通过审核的作品才会进入公开访问流程。</p></div>
      <div className="divide-y divide-sky-100">
        {projects.map((project) => <article key={project.id} className="flex flex-wrap items-center justify-between gap-4 p-4"><div className="min-w-0"><strong className="block break-words text-sm font-black text-brand-950">{project.title}</strong><p className="mt-1 text-xs font-bold text-slate-500">{project.toolName} · {project.User.nickname}（UID {project.User.uid}）· {project.metadata.width || '—'} × {project.metadata.height || '—'} 颗</p><p className="mt-1 break-words text-xs font-bold text-slate-400">{project.description || '无描述'}</p></div><div className="flex shrink-0 gap-2"><button type="button" onClick={() => void review(project.id, 'REJECTED')} disabled={busyId === project.id} className="min-h-9 border border-red-200 px-3 text-xs font-black text-red-700 disabled:opacity-50">拒绝</button><button type="button" onClick={() => void review(project.id, 'APPROVED')} disabled={busyId === project.id} className="min-h-9 bg-emerald-700 px-3 text-xs font-black text-white disabled:opacity-50">通过</button></div></article>)}
        {!projects.length ? <p className="p-6 text-sm font-bold text-slate-500">暂无待审核作品。</p> : null}
      </div>
    </div>
  </section>
}
