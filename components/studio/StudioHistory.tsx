'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { UiIcon } from '@/components/UiIcon'
import { getStudioTool } from '@/lib/studio/tools'
import { listRecentStudioEvents, listLocalStudioProjects } from '@/lib/studio/storage'
import type { StudioRecentTool, StudioProjectSummary } from '@/lib/studio/types'
import styles from './studio.module.css'

function dateTime(value: string) {
  try {
    return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  } catch {
    return '最近'
  }
}

const eventLabels: Record<StudioRecentTool['event'], string> = {
  tool_open: '打开工具',
  project_create: '创建项目',
  project_save: '保存作品',
  project_open: '打开作品',
  project_export: '导出作品',
  project_publish: '提交公开审核',
}

export function StudioHistory() {
  const [events, setEvents] = useState<StudioRecentTool[]>([])
  const [projects, setProjects] = useState<StudioProjectSummary[]>([])
  useEffect(() => {
    setEvents(listRecentStudioEvents())
    setProjects(listLocalStudioProjects())
  }, [])
  const projectEvents = projects.slice(0, 5).map((project) => ({ toolSlug: project.toolSlug, event: 'project_open' as const, occurredAt: project.lastOpenedAt || project.updatedAt, project }))
  const timeline = [...events.slice(0, 8).map((event) => ({ ...event, project: undefined })), ...projectEvents]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 10)

  return <main className={styles.projectsPage}>
    <header className={styles.projectsIntro}><div><span className={styles.sectionKicker}>activity / 04</span><h1 className={styles.projectsIntroTitle}>最近使用</h1><p className={styles.projectsIntroSub}>记录有意义的创作动作，方便你回到刚才的工作。</p></div><div className={styles.projectsActions}><Link href="/studio/beads" className={`${styles.actionButton} ${styles.actionButtonPrimary}`}>＋ 开始新创作</Link></div></header>
    {timeline.length ? <div className={styles.historyTimeline}>{timeline.map((item, index) => {
      const tool = getStudioTool(item.toolSlug)
      const project = 'project' in item ? item.project : undefined
      return <div key={`${item.occurredAt}-${item.toolSlug}-${index}`} className={styles.historyItem}><i className={styles.historyMarker} /><div className={styles.historyContent}><span className={styles.historyDate}>{dateTime(item.occurredAt)}</span><strong>{project?.title || tool?.name || '创作工具'}</strong><p>{project ? '最近打开的创作项目' : eventLabels[item.event]}</p>{project ? <Link href={`/studio/${project.toolSlug}?project=${encodeURIComponent(project.id)}`} className={styles.historyLink}>继续编辑 →</Link> : null}</div></div>
    })}</div> : <div className={styles.emptyState} style={{ marginTop: 28 }}><span className={styles.emptyMark}><UiIcon name="activity" /></span><p>还没有最近记录</p><small>打开工具或保存作品后，这里会留下足迹。</small></div>}
  </main>
}
