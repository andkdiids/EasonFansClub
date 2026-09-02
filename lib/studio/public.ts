import type { Prisma } from '@prisma/client'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { getStudioTool } from './tools'
import type { StudioGalleryProject, StudioGallerySort } from './types'

export const PUBLIC_STUDIO_PROJECT_WHERE = {
  visibility: 'PUBLIC' as const,
  reviewStatus: 'APPROVED' as const,
  User: { status: 'ACTIVE' as const, isDeleted: false },
}

const gallerySelect = {
  id: true,
  toolSlug: true,
  title: true,
  description: true,
  version: true,
  data: true,
  thumbnailUrl: true,
  likeCount: true,
  favoriteCount: true,
  viewCount: true,
  downloadCount: true,
  visibility: true,
  reviewStatus: true,
  createdAt: true,
  updatedAt: true,
  lastOpenedAt: true,
  User: { select: { nickname: true } },
} satisfies Prisma.StudioProjectSelect

type GalleryRow = Prisma.StudioProjectGetPayload<{ select: typeof gallerySelect }>

export function studioProjectMetadata(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const pattern = (data as Record<string, unknown>).pattern
  if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern)) return {}
  const row = pattern as Record<string, unknown>
  const cells = Array.isArray(row.cells) ? row.cells : []
  const usedColors = new Set(cells.filter((cell): cell is number => typeof cell === 'number' && cell >= 0))
  return {
    width: typeof row.width === 'number' ? row.width : undefined,
    height: typeof row.height === 'number' ? row.height : undefined,
    totalBeads: cells.filter((cell) => typeof cell === 'number' && cell >= 0).length,
    colorCount: usedColors.size,
  }
}

function publicProjectSummary(row: GalleryRow, liked: boolean, favorited: boolean): StudioGalleryProject {
  return {
    id: row.id,
    toolSlug: row.toolSlug,
    title: row.title,
    description: row.description,
    version: row.version,
    thumbnailUrl: publicImageUrl(row.thumbnailUrl),
    likeCount: row.likeCount,
    favoriteCount: row.favoriteCount,
    viewCount: row.viewCount,
    downloadCount: row.downloadCount,
    isLiked: liked,
    isFavorited: favorited,
    visibility: row.visibility,
    reviewStatus: row.reviewStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastOpenedAt: row.lastOpenedAt?.toISOString() || null,
    metadata: studioProjectMetadata(row.data),
    author: row.User.nickname || '私家E院',
  }
}

export type PublicStudioProjectListOptions = Readonly<{
  sort?: StudioGallerySort
  toolSlug?: string | null
  page?: number
  pageSize?: number
  viewerId?: string | null
}>

export async function listPublicStudioProjects(options: PublicStudioProjectListOptions = {}) {
  const sort = options.sort === 'hot' ? 'hot' : 'latest'
  const pageSize = Math.max(1, Math.min(48, Math.trunc(options.pageSize || 24)))
  const page = Math.max(1, Math.trunc(options.page || 1))
  const selectedTool = options.toolSlug && getStudioTool(options.toolSlug) ? options.toolSlug : null
  const where: Prisma.StudioProjectWhereInput = {
    ...PUBLIC_STUDIO_PROJECT_WHERE,
    ...(selectedTool ? { toolSlug: selectedTool } : {}),
  }
  const orderBy: Prisma.StudioProjectOrderByWithRelationInput[] = sort === 'hot'
    ? [{ likeCount: 'desc' }, { favoriteCount: 'desc' }, { downloadCount: 'desc' }, { viewCount: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }]
    : [{ updatedAt: 'desc' }, { id: 'desc' }]
  const [rows, total] = await Promise.all([
    prisma.studioProject.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize + 1, select: gallerySelect }),
    prisma.studioProject.count({ where }),
  ])
  const visibleRows = rows.slice(0, pageSize)
  const ids = visibleRows.map((row) => row.id)
  const [likes, favorites] = options.viewerId && ids.length
    ? await Promise.all([
      prisma.studioProjectLike.findMany({ where: { userId: options.viewerId, projectId: { in: ids } }, select: { projectId: true } }),
      prisma.studioProjectFavorite.findMany({ where: { userId: options.viewerId, projectId: { in: ids } }, select: { projectId: true } }),
    ])
    : [[], []]
  const likeIds = new Set(likes.map((row) => row.projectId))
  const favoriteIds = new Set(favorites.map((row) => row.projectId))
  return {
    projects: visibleRows.map((row) => publicProjectSummary(row, likeIds.has(row.id), favoriteIds.has(row.id))),
    page,
    pageSize,
    total,
    hasMore: rows.length > pageSize,
    sort,
    toolSlug: selectedTool,
  }
}

export function isValidStudioProjectId(value: string) {
  return /^[A-Za-z0-9_-]{1,191}$/.test(value)
}

export function projectOwnerDisplayName(value: { nickname: string; status?: string; isDeleted?: boolean }) {
  return value.status === 'ACTIVE' && !value.isDeleted ? value.nickname || '私家E院' : '私家E院'
}
