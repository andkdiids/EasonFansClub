import type { Prisma } from '@prisma/client'
import { profileImageUrl, publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { parseUidParam } from '@/lib/uid'
import { normalizeArtistSlug } from './artists'
import { getStudioTool } from './tools'
import type { StudioArtistSummary, StudioCreatorSummary, StudioGalleryProject, StudioGallerySort } from './types'

export const PUBLIC_STUDIO_PROJECT_WHERE = {
  visibility: 'PUBLIC' as const,
  reviewStatus: 'APPROVED' as const,
  User: { status: 'ACTIVE' as const, isDeleted: false },
}

const publicCreatorSelect = {
  id: true,
  uid: true,
  nickname: true,
  avatarUrl: true,
  bio: true,
  status: true,
  isDeleted: true,
  Profile: { select: { avatarUrl: true, bio: true } },
} satisfies Prisma.UserSelect

export type PublicCreatorRecord = Prisma.UserGetPayload<{ select: typeof publicCreatorSelect }>

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
  User: { select: publicCreatorSelect },
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
  const creator = publicCreatorSummary(row.User)
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
    author: creator.name,
    creator,
  }
}

export function publicCreatorSummary(user: PublicCreatorRecord): StudioCreatorSummary {
  const visible = user.status === 'ACTIVE' && !user.isDeleted
  return {
    id: user.id,
    uid: user.uid,
    name: visible ? user.nickname?.trim() || '私家E院' : '私家E院',
    avatar: visible ? profileImageUrl(user.Profile?.avatarUrl || user.avatarUrl) : null,
    description: visible ? user.Profile?.bio || user.bio || null : null,
  }
}

function publicArtistSummary(artist: { id: string; slug: string; name: string; avatar: string | null; description: string | null }): StudioArtistSummary {
  return {
    id: artist.id,
    slug: artist.slug,
    name: artist.name,
    avatar: publicImageUrl(artist.avatar),
    description: artist.description,
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

export async function getPublicCreatorPage(userId: string) {
  const uid = parseUidParam(userId)
  if (uid === null || uid <= 0) return null
  const creator = await prisma.user.findFirst({
    where: { uid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    select: publicCreatorSelect,
  })
  if (!creator) return null

  const rows = await prisma.studioProject.findMany({
    where: { ...PUBLIC_STUDIO_PROJECT_WHERE, userId: creator.id },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: gallerySelect,
  })
  const projects = await addParticipantCounts(rows.map((row) => publicProjectSummary(row, false, false)))
  return {
    creator: publicCreatorSummary(creator),
    projects,
  }
}

async function addParticipantCounts(projects: StudioGalleryProject[]) {
  if (!projects.length) return projects
  const ids = projects.map((project) => project.id)
  const [likes, favorites] = await Promise.all([
    prisma.studioProjectLike.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, userId: true } }),
    prisma.studioProjectFavorite.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, userId: true } }),
  ])
  const participants = new Map<string, Set<string>>()
  for (const row of [...likes, ...favorites]) {
    const users = participants.get(row.projectId) || new Set<string>()
    users.add(row.userId)
    participants.set(row.projectId, users)
  }
  return projects.map((project) => ({ ...project, participantCount: participants.get(project.id)?.size || 0 }))
}

export async function getPublicArtistPage(slug: string) {
  const normalizedSlug = normalizeArtistSlug(slug)
  if (!normalizedSlug) return null
  const artist = await prisma.artist.findUnique({
    where: { slug: normalizedSlug },
    select: { id: true, slug: true, name: true, avatar: true, description: true },
  })
  if (!artist) return null

  const rows = await prisma.studioProject.findMany({
    where: { ...PUBLIC_STUDIO_PROJECT_WHERE, artistId: artist.id },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: gallerySelect,
  })
  const projects = await addParticipantCounts(rows.map((row) => publicProjectSummary(row, false, false)))
  return {
    artist: publicArtistSummary(artist),
    projects,
  }
}

export function isValidStudioProjectId(value: string) {
  return /^[A-Za-z0-9_-]{1,191}$/.test(value)
}

export function projectOwnerDisplayName(value: { nickname: string; status?: string; isDeleted?: boolean }) {
  return value.status === 'ACTIVE' && !value.isDeleted ? value.nickname || '私家E院' : '私家E院'
}
