import Link from 'next/link'
import { getVisibleStudioTools } from '@/lib/studio/tools'
import type { StudioCreatorSummary, StudioGalleryProject } from '@/lib/studio/types'
import styles from './studio.module.css'

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '最近更新'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}

function PatternThumb() {
  return <span className={styles.artistProjectPattern} aria-hidden>{Array.from({ length: 100 }, (_, index) => <i key={index} />)}</span>
}

function CreatorProjectCard({ project }: Readonly<{ project: StudioGalleryProject }>) {
  const tool = getVisibleStudioTools().find((item) => item.slug === project.toolSlug)
  return <Link href={`/studio/project/${encodeURIComponent(project.id)}`} className={styles.artistProjectCard} aria-label={`查看作品：${project.title}`}>
    <div className={styles.artistProjectThumb}>{project.thumbnailUrl ? <img src={project.thumbnailUrl} alt="作品封面" loading="lazy" /> : <PatternThumb />}</div>
    <div className={styles.artistProjectContent}>
      <h3 title={project.title}>{project.title}</h3>
      <p>{tool?.name || project.toolSlug} · 创建于 {formatDate(project.createdAt)}</p>
      <div className={styles.artistProjectFacts}><span>作者：{project.author}</span><span>参与 {project.participantCount || 0} 人</span></div>
    </div>
  </Link>
}

export function CreatorProfile({ creator, projects }: Readonly<{ creator: StudioCreatorSummary; projects: StudioGalleryProject[] }>) {
  return <main className={styles.artistPage}>
    <Link href="/studio/gallery" className={styles.artistBack}>← 返回创作广场</Link>
    <section className={styles.artistHero} aria-labelledby="creator-profile-title">
      <span className={styles.artistAvatar}>{creator.avatar ? <img src={creator.avatar} alt={`${creator.name}头像`} /> : creator.name.slice(0, 1)}</span>
      <div className="min-w-0">
        <span className={styles.artistKicker}>ARTIST</span>
        <h1 id="creator-profile-title" className={styles.artistName}>{creator.name}</h1>
        <p className={styles.artistDescription}>{creator.description || '用作品留下属于自己的声音。'}</p>
      </div>
    </section>
    <div className={styles.artistWorksHeader}><h2>作品列表</h2><span>{projects.length} 件公开作品</span></div>
    {projects.length ? <section className={styles.artistWorksGrid} aria-label={`${creator.name}作品列表`}>{projects.map((project) => <CreatorProjectCard key={project.id} project={project} />)}</section> : <div className={styles.artistEmpty}><p>暂时还没有公开作品</p><small>作品通过审核后，会出现在这里。</small></div>}
  </main>
}
