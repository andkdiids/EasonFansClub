import { prisma } from '@/lib/prisma'
import { buildProfilePostWhere } from '@/lib/post-moderation'

export type ProfilePostGroupPreview = {
  id: string
  name: string
  sortOrder: number
  itemCount: number
  previewPostIds: string[]
}

export async function getProfilePostGroupPreviews(userId: string, includePending: boolean): Promise<ProfilePostGroupPreview[]> {
  const groups = await prisma.userPostGroup.findMany({
    where: { userId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, sortOrder: true },
  })
  if (!groups.length) return []

  const postWhere = buildProfilePostWhere(userId, includePending)
  if (!includePending) Object.assign(postWhere, { status: 'PUBLISHED' as const })
  const groupIds = groups.map((group) => group.id)
  const counts = await prisma.post.groupBy({
    by: ['userPostGroupId'],
    where: { ...postWhere, userPostGroupId: { in: groupIds } },
    _count: { _all: true },
  })
  const countByGroup = new Map(counts.flatMap((row) => row.userPostGroupId ? [[row.userPostGroupId, row._count._all] as const] : []))

  const previews = await Promise.all(groups.map(async (group) => {
    const posts = await prisma.post.findMany({
      where: { ...postWhere, userPostGroupId: group.id },
      orderBy: [{ profilePinnedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 4,
      select: { id: true },
    })
    return {
      ...group,
      itemCount: countByGroup.get(group.id) || 0,
      previewPostIds: posts.map((post) => post.id),
    }
  }))

  return includePending ? previews : previews.filter((group) => group.itemCount > 0)
}
