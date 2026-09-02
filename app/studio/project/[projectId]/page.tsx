import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { StudioPublicProject } from '@/components/studio/StudioPublicProject'
import { getStudioTool } from '@/lib/studio/tools'
import type { BeadProjectData } from '@/lib/studio/beads/types'
import { prisma } from '@/lib/prisma'
import { buildPageMetadata } from '@/lib/share-metadata'
import { PUBLIC_STUDIO_PROJECT_WHERE, projectOwnerDisplayName } from '@/lib/studio/public'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({ title: '公开创作 · 贝多芬与我', description: '查看贝多芬与我公开分享的创作作品。', canonical: '/studio/project' })
}

function isBeadProjectData(value: unknown): value is BeadProjectData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Partial<BeadProjectData>
  const pattern = data.pattern
  if (data.tool !== 'beads' || data.version !== 1 || !pattern || typeof pattern !== 'object' || Array.isArray(pattern)) return false
  return Number.isInteger(pattern.width) && Number.isInteger(pattern.height) && pattern.width > 0 && pattern.height > 0 && Array.isArray(pattern.cells) && Array.isArray(pattern.palette) && pattern.cells.length === pattern.width * pattern.height
}

export default async function StudioPublicProjectPage({ params }: Readonly<{ params: Promise<{ projectId: string }> }>) {
  const { projectId } = await params
  const project = await prisma.studioProject.findFirst({
    where: { id: projectId, OR: [{ visibility: 'PUBLIC', reviewStatus: 'APPROVED' }, { visibility: 'UNLISTED' }] },
    select: { id: true, title: true, description: true, data: true, thumbnailUrl: true, likeCount: true, favoriteCount: true, viewCount: true, createdAt: true, updatedAt: true, User: { select: { nickname: true, isDeleted: true, status: true } } },
  })
  if (!project || !isBeadProjectData(project.data) || !getStudioTool(project.data.tool)) notFound()
  void prisma.studioProject.updateMany({ where: { ...PUBLIC_STUDIO_PROJECT_WHERE, id: project.id }, data: { viewCount: { increment: 1 } } }).catch(() => undefined)
  return <StudioPublicProject project={{ id: project.id, title: project.title, description: project.description, thumbnailUrl: project.thumbnailUrl, likeCount: project.likeCount, favoriteCount: project.favoriteCount, viewCount: project.viewCount, data: project.data, createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString(), author: projectOwnerDisplayName(project.User) }} />
}
