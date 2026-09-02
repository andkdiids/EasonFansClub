'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { UiIcon } from '@/components/UiIcon'
import { shareContent } from '@/lib/share'
import { createStudioId, deleteLocalStudioProject, getLocalStudioProject, listLocalStudioProjects, saveLocalStudioProject } from '@/lib/studio/storage'
import { studioProjectEditorPath } from '@/lib/studio/paths'
import { getStudioTool } from '@/lib/studio/tools'
import type { StudioLocalProject, StudioProjectSummary } from '@/lib/studio/types'
import styles from './studio.module.css'

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value))
  } catch {
    return '最近更新'
  }
}

function PatternThumb() {
  return <span className={styles.projectThumbPattern} aria-hidden>{Array.from({ length: 100 }, (_, index) => <i key={index} className={styles.projectThumbCell} />)}</span>
}

function ProjectCard({ project, onDelete, onCopy, onShare }: Readonly<{ project: StudioProjectSummary; onDelete: (project: StudioProjectSummary) => void; onCopy: (project: StudioProjectSummary) => void; onShare: (project: StudioProjectSummary) => void }>) {
  const tool = getStudioTool(project.toolSlug)
  const metadata = project.metadata || {}
  const editorHref = studioProjectEditorPath(project)
  return <article className={styles.projectCard}>
    <div className={styles.projectThumb}>{project.thumbnailUrl ? <img src={project.thumbnailUrl} alt="作品图纸缩略图" /> : <PatternThumb />}</div>
    <div className={styles.projectContent}>
      <div className={styles.projectTopline}><strong className={styles.projectTitle} title={project.title}>{project.title}</strong><span className={styles.toolStatus}>{project.visibility === 'PRIVATE' ? '私密' : '公开'}</span></div>
      <p className={styles.projectMeta}>{tool?.name || '创作项目'} · {formatDate(project.updatedAt)}</p>
      <div className={styles.projectStats}>
        <span className={styles.projectStat}><strong>{metadata.width || '—'} × {metadata.height || '—'}</strong>尺寸</span>
        <span className={styles.projectStat}><strong>{metadata.totalBeads ?? '—'}</strong>颗拼豆</span>
        <span className={styles.projectStat}><strong>{metadata.colorCount ?? '—'}</strong>种颜色</span>
      </div>
      <div className={styles.projectActions}>
        <Link href={editorHref} className={`${styles.projectAction} ${styles.projectActionPrimary}`}>继续编辑</Link>
        {tool?.supportsCraftMode ? <Link href={`${editorHref}&mode=craft`} className={styles.projectAction}>开始制作</Link> : null}
        {tool?.supportsExport ? <Link href={`${editorHref}&export=1`} className={styles.projectAction}>导出</Link> : null}
        {tool?.supportsShare ? <button type="button" className={styles.projectAction} onClick={() => onShare(project)}>分享</button> : null}
        <button type="button" className={styles.projectAction} onClick={() => onCopy(project)}>复制</button>
        <button type="button" className={styles.projectAction} onClick={() => onDelete(project)}>删除</button>
      </div>
    </div>
  </article>
}

export function StudioProjects({ isAuthenticated }: Readonly<{ isAuthenticated: boolean }>) {
  const [projects, setProjects] = useState<StudioProjectSummary[]>([])
  const [filter, setFilter] = useState('all')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const local = listLocalStudioProjects()
      let remote: StudioProjectSummary[] = []
      if (isAuthenticated) {
        try {
          const response = await fetch('/api/studio/projects', { cache: 'no-store' })
          if (response.ok) {
            const body = await response.json() as { projects?: StudioProjectSummary[] }
            remote = Array.isArray(body.projects) ? body.projects : []
          }
        } catch {
          // Local projects remain available during a transient network outage.
        }
      }
      if (cancelled) return
      const merged = new Map<string, StudioProjectSummary>()
      local.forEach((project) => merged.set(project.id, project))
      remote.forEach((project) => merged.set(project.id, project))
      setProjects([...merged.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)))
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [isAuthenticated])

  const visibleProjects = useMemo(() => filter === 'all' ? projects : projects.filter((project) => project.toolSlug === filter), [filter, projects])
  const filters = useMemo(() => [{ slug: 'all', label: '全部' }, ...[...new Set(projects.map((project) => project.toolSlug))].map((slug) => ({ slug, label: getStudioTool(slug)?.name || '创作项目' }))], [projects])

  async function remove(project: StudioProjectSummary) {
    if (!window.confirm(`确定删除“${project.title}”吗？此操作无法恢复。`)) return
    if (isAuthenticated && !project.id.startsWith('local-')) {
      try {
        const response = await fetch(`/api/studio/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' })
        if (!response.ok && response.status !== 404) {
          setMessage('云端项目删除失败，请稍后重试。')
          return
        }
      } catch {
        setMessage('网络暂时不可用，项目仍保留。')
        return
      }
    }
    await deleteLocalStudioProject(project.id)
    setProjects((current) => current.filter((item) => item.id !== project.id))
    setMessage('项目已删除。')
  }

  async function copy(project: StudioProjectSummary) {
    let full = await getLocalStudioProject(project.id)
    if (!full && isAuthenticated && !project.id.startsWith('local-')) {
      try {
        const response = await fetch(`/api/studio/projects/${encodeURIComponent(project.id)}`, { cache: 'no-store' })
        const body = await response.json() as { project?: Partial<StudioLocalProject> & { data?: StudioLocalProject['data'] } }
        const remote = body.project
        if (response.ok && remote && typeof remote.id === 'string' && remote.data) {
          full = {
            ...project,
            ...remote,
            id: remote.id,
            data: remote.data,
          } as StudioLocalProject
        }
      } catch {
        // The message below explains that a full project is needed to copy.
      }
    }
    if (!full) {
      setMessage('云端项目请打开后另存为新项目。')
      return
    }
    const now = new Date().toISOString()
    const duplicate: StudioLocalProject = {
      ...full,
      id: createStudioId(),
      title: `${full.title} 副本`,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      visibility: 'PRIVATE',
      reviewStatus: 'NONE',
    }
    await saveLocalStudioProject(duplicate)
    let copiedProject: StudioProjectSummary = duplicate
    let cloudSyncFailed = false
    if (isAuthenticated) {
      try {
        const response = await fetch('/api/studio/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toolSlug: duplicate.toolSlug, title: duplicate.title, description: duplicate.description, version: duplicate.version, data: duplicate.data }),
        })
        if (response.ok) {
          const body = await response.json() as { project?: Partial<StudioLocalProject> & { data?: StudioLocalProject['data'] } }
          const server = body.project
          const remoteId = typeof server?.id === 'string' ? server.id : ''
          if (remoteId && remoteId !== duplicate.id) {
            await deleteLocalStudioProject(duplicate.id)
            await saveLocalStudioProject({ ...duplicate, ...server, id: remoteId, data: server?.data || duplicate.data })
            copiedProject = {
              id: remoteId,
              toolSlug: server?.toolSlug || duplicate.toolSlug,
              title: server?.title || duplicate.title,
              description: server?.description,
              version: server?.version || duplicate.version,
              thumbnailUrl: server?.thumbnailUrl || duplicate.thumbnailUrl,
              visibility: server?.visibility || 'PRIVATE',
              reviewStatus: server?.reviewStatus || 'NONE',
              createdAt: server?.createdAt || duplicate.createdAt,
              updatedAt: server?.updatedAt || duplicate.updatedAt,
              lastOpenedAt: server?.lastOpenedAt || duplicate.lastOpenedAt,
              metadata: server?.metadata || duplicate.metadata,
            }
          }
        } else cloudSyncFailed = true
      } catch {
        cloudSyncFailed = true
      }
    }
    setProjects((current) => [copiedProject, ...current.filter((item) => item.id !== copiedProject.id)])
    setMessage(cloudSyncFailed ? '已复制到此设备，云端同步稍后可重试。' : '已复制为新项目。')
  }

  async function share(project: StudioProjectSummary) {
    if (!isAuthenticated) {
      setMessage('登录后保存并发布作品，才能生成公开分享链接。')
      return
    }
    if (project.id.startsWith('local-')) {
      setMessage('请先保存到云端，再申请公开分享。')
      return
    }
    if (project.visibility === 'PUBLIC' && project.reviewStatus === 'APPROVED') {
      try {
        const result = await shareContent({ title: project.title, text: '来自贝多芬与我的创作作品', url: `${window.location.origin}/studio/project/${encodeURIComponent(project.id)}` })
        setMessage(result === 'shared' ? '已打开分享面板。' : '作品链接已复制。')
      } catch {
        setMessage('分享已取消。')
      }
      return
    }
    if (project.reviewStatus === 'PENDING') {
      setMessage('作品正在等待公开审核，通过后即可生成分享链接。')
      return
    }
    try {
      const response = await fetch(`/api/studio/projects/${encodeURIComponent(project.id)}/publish`, { method: 'POST' })
      const body = await response.json() as { message?: string; visibility?: StudioProjectSummary['visibility']; reviewStatus?: StudioProjectSummary['reviewStatus'] }
      if (!response.ok) throw new Error(body.message || '提交公开审核失败')
      setProjects((current) => current.map((item) => item.id === project.id ? { ...item, visibility: body.visibility || 'PUBLIC', reviewStatus: body.reviewStatus || 'PENDING' } : item))
      setMessage(body.message || '已提交公开审核。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交公开审核失败，请稍后重试。')
    }
  }

  return <main className={styles.projectsPage}>
    <header className={styles.projectsIntro}>
      <div><span className={styles.sectionKicker}>your work / 03</span><h1 className={styles.projectsIntroTitle}>我的创作</h1><p className={styles.projectsIntroSub}>所有由「贝多芬与我」制作的作品，都在这里继续编辑、导出或整理。</p></div>
      <div className={styles.projectsActions}><Link href="/studio/beads" className={`${styles.actionButton} ${styles.actionButtonPrimary}`}>＋ 开始新创作</Link></div>
    </header>
    <div className={styles.projectsFilter} role="tablist" aria-label="创作工具筛选">
      {filters.map((item) => <button key={item.slug} type="button" className={`${styles.filterButton} ${filter === item.slug ? styles.filterActive : ''}`} role="tab" aria-selected={filter === item.slug} onClick={() => setFilter(item.slug)}>{item.label}</button>)}
    </div>
    {message ? <div className={styles.notice} role="status">{message}</div> : null}
    {loading ? <div className={styles.emptyState}><p>正在读取本地作品…</p></div> : visibleProjects.length ? <div className={styles.projectGrid}>{visibleProjects.map((project) => <ProjectCard key={project.id} project={project} onDelete={remove} onCopy={copy} onShare={share} />)}</div> : <div className={`${styles.emptyState} ${styles.projectEmpty}`}><span className={styles.emptyMark}><UiIcon name="palette" /></span><p>{projects.length ? '这个分类还没有作品' : '还没有创作项目'}</p><small>先完成一张拼豆图纸，它会自动出现在这里。</small><Link href="/studio/beads" className={`${styles.actionButton} ${styles.actionButtonPrimary}`} style={{ marginTop: 16 }}>开始制作</Link></div>}
  </main>
}
