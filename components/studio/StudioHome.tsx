'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { UiIcon } from '@/components/UiIcon'
import { getStudioTool, getVisibleStudioTools, studioCategoryLabel, studioToolStatusLabel } from '@/lib/studio/tools'
import { studioProjectEditorPath } from '@/lib/studio/paths'
import { listLocalStudioProjects } from '@/lib/studio/storage'
import type { StudioProjectSummary } from '@/lib/studio/types'
import styles from './studio.module.css'

function MiniPattern({ large = false }: Readonly<{ large?: boolean }>) {
  const count = large ? 81 : 64
  return <span className={large ? styles.heroArtGrid : styles.toolPreviewGrid} aria-hidden>
    {Array.from({ length: count }, (_, index) => <i key={index} className={large ? styles.heroArtCell : styles.toolPreviewCell} />)}
  </span>
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value))
  } catch {
    return '最近'
  }
}

export function StudioHome() {
  const [projects, setProjects] = useState<StudioProjectSummary[]>([])
  const tools = useMemo(() => getVisibleStudioTools(), [])

  useEffect(() => {
    setProjects(listLocalStudioProjects())
  }, [])

  return (
    <main className={styles.platformPage}>
      <section className={styles.homeHero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>私家E院 · 创作平台</span>
          <h1 className={styles.heroTitle}>贝多芬<span>与我</span></h1>
          <p className={styles.heroSubtitle}>把喜欢的东西，做成自己的。</p>
        </div>
        <div className={styles.heroArt} aria-hidden>
          <MiniPattern large />
          <span className={styles.heroArtNote}>♪</span>
          <span className={styles.heroArtLabel}>MAKE SOMETHING YOU LOVE</span>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div><span className={styles.sectionKicker}>01 / tools</span><h2 className={styles.sectionTitle}>创作工具</h2></div>
          <span className={styles.sectionHint}>{tools.length} 个工具可使用</span>
        </div>
        <div className={styles.toolGrid}>
          {tools.map((tool) => <Link key={tool.slug} href={tool.status === 'COMING_SOON' ? '#' : tool.route} className={`${styles.toolCard} ${tool.featured ? styles.toolCardFeatured : ''}`} aria-disabled={tool.status === 'COMING_SOON' ? true : undefined} onClick={(event) => { if (tool.status === 'COMING_SOON') event.preventDefault() }}>
            <div className={styles.toolCardVisual}>
              <MiniPattern />
              <span className={styles.toolIcon}><UiIcon name={tool.icon} /></span>
            </div>
            <div className={styles.toolCardBody}>
              <div className={styles.toolTopline}><h3 className={styles.toolName}>{tool.name}</h3><span className={styles.toolStatus}>{studioToolStatusLabel(tool.status)}</span></div>
              <p className={styles.toolDescription}>{tool.description}</p>
              <div className={styles.toolTags}><span className={styles.toolTag}>{studioCategoryLabel(tool.category)}</span>{tool.isNew ? <span className={styles.toolTag}>新上线</span> : null}{tool.isBeta ? <span className={styles.toolTag}>测试版</span> : null}</div>
              <div className={styles.toolArrow}><span>开始制作</span><span>↗</span></div>
            </div>
          </Link>)}
        </div>
      </section>

      <section className={styles.recentSection}>
        <div className={styles.sectionHeader}>
          <div><span className={styles.sectionKicker}>02 / your work</span><h2 className={styles.sectionTitle}>最近创作</h2></div>
          {projects.length ? <Link href="/studio/my" className={styles.homeFooterLink}>查看全部 →</Link> : null}
        </div>
        {projects.length ? <div className={styles.recentList}>{projects.slice(0, 4).map((project) => {
          const tool = getStudioTool(project.toolSlug)
          return <div key={project.id} className={styles.recentItem}>
            <span className={styles.recentItemIcon}><UiIcon name={tool?.icon || 'palette'} /></span>
            <span className={styles.recentItemMeta}><strong>{project.title}</strong><span>{tool?.name || '创作项目'} · {formatDate(project.updatedAt)}</span></span>
            <Link href={studioProjectEditorPath(project)} className={styles.recentItemAction}>继续创作</Link>
          </div>
        })}</div> : <div className={styles.emptyState}><span className={styles.emptyMark}><UiIcon name="palette" /></span><p>还没有创作项目</p><small>从拼豆图纸开始，把喜欢的画面留下来。</small></div>}
      </section>

      <footer className={styles.homeFooter}><span className={styles.homeFooterNote}>每一个作品，都从一个想法开始。</span><span className={styles.homeFooterLinks}><Link href="/studio/gallery" className={styles.homeFooterLink}>逛逛创作广场 →</Link><Link href="/studio/beads" className={styles.homeFooterLink}>开始第一件作品 →</Link></span></footer>
    </main>
  )
}
