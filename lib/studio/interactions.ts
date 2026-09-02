import { prisma } from '@/lib/prisma'
import { PUBLIC_STUDIO_PROJECT_WHERE } from './public'

export type StudioProjectInteractionKind = 'like' | 'favorite'

export type StudioProjectInteractionState = {
  projectId: string
  likeCount: number
  favoriteCount: number
  isLiked: boolean
  isFavorited: boolean
}

export async function getStudioProjectInteractionState(projectId: string, userId?: string | null): Promise<StudioProjectInteractionState | null> {
  const project = await prisma.studioProject.findFirst({
    where: { ...PUBLIC_STUDIO_PROJECT_WHERE, id: projectId },
    select: { id: true, likeCount: true, favoriteCount: true },
  })
  if (!project) return null
  const [like, favorite] = userId
    ? await Promise.all([
      prisma.studioProjectLike.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { id: true } }),
      prisma.studioProjectFavorite.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { id: true } }),
    ])
    : [null, null]
  return {
    projectId: project.id,
    likeCount: project.likeCount,
    favoriteCount: project.favoriteCount,
    isLiked: Boolean(like),
    isFavorited: Boolean(favorite),
  }
}

export async function setStudioProjectInteraction(input: Readonly<{
  projectId: string
  userId: string
  kind: StudioProjectInteractionKind
  active: boolean
}>) {
  return prisma.$transaction(async (tx) => {
    // Serialize counter updates for one project so a double-click or two
    // simultaneous users cannot make the denormalized counts drift.
    await tx.$queryRaw`SELECT \`id\` FROM \`StudioProject\` WHERE \`id\` = ${input.projectId} FOR UPDATE`
    const project = await tx.studioProject.findFirst({
      where: { ...PUBLIC_STUDIO_PROJECT_WHERE, id: input.projectId },
      select: { id: true },
    })
    if (!project) return null

    if (input.kind === 'like') {
      if (input.active) {
        const existing = await tx.studioProjectLike.findUnique({ where: { projectId_userId: { projectId: input.projectId, userId: input.userId } }, select: { id: true } })
        if (!existing) {
          await tx.studioProjectLike.create({ data: { projectId: input.projectId, userId: input.userId } })
          await tx.studioProject.update({ where: { id: input.projectId }, data: { likeCount: { increment: 1 } }, select: { id: true } })
        }
      } else {
        const deleted = await tx.studioProjectLike.deleteMany({ where: { projectId: input.projectId, userId: input.userId } })
        if (deleted.count) {
          await tx.studioProject.updateMany({ where: { id: input.projectId, likeCount: { gt: 0 } }, data: { likeCount: { decrement: 1 } } })
        }
      }
    } else if (input.active) {
      const existing = await tx.studioProjectFavorite.findUnique({ where: { projectId_userId: { projectId: input.projectId, userId: input.userId } }, select: { id: true } })
      if (!existing) {
        await tx.studioProjectFavorite.create({ data: { projectId: input.projectId, userId: input.userId } })
        await tx.studioProject.update({ where: { id: input.projectId }, data: { favoriteCount: { increment: 1 } }, select: { id: true } })
      }
    } else {
      const deleted = await tx.studioProjectFavorite.deleteMany({ where: { projectId: input.projectId, userId: input.userId } })
      if (deleted.count) {
        await tx.studioProject.updateMany({ where: { id: input.projectId, favoriteCount: { gt: 0 } }, data: { favoriteCount: { decrement: 1 } } })
      }
    }

    const updated = await tx.studioProject.findUnique({ where: { id: input.projectId }, select: { id: true, likeCount: true, favoriteCount: true } })
    if (!updated) return null
    const [like, favorite] = await Promise.all([
      tx.studioProjectLike.findUnique({ where: { projectId_userId: { projectId: input.projectId, userId: input.userId } }, select: { id: true } }),
      tx.studioProjectFavorite.findUnique({ where: { projectId_userId: { projectId: input.projectId, userId: input.userId } }, select: { id: true } }),
    ])
    return {
      projectId: updated.id,
      likeCount: updated.likeCount,
      favoriteCount: updated.favoriteCount,
      isLiked: Boolean(like),
      isFavorited: Boolean(favorite),
    } satisfies StudioProjectInteractionState
  }, { timeout: 15_000, maxWait: 5_000 })
}
