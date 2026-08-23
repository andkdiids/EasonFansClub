import { prisma } from '@/lib/prisma'

export type EasMusicLikeState = {
  liked: boolean
  likeCount: number
}

const emptyLikeState: EasMusicLikeState = { liked: false, likeCount: 0 }

function uniqueIds(ids: readonly string[]) {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
}

export async function getEasMusicSongLikeStates(songIds: readonly string[], userId?: string) {
  const ids = uniqueIds(songIds)
  const result = new Map<string, EasMusicLikeState>()
  if (!ids.length) return result

  const [counts, userLikes] = await Promise.all([
    prisma.musicSongLike.groupBy({
      by: ['songId'],
      where: { songId: { in: ids } },
      _count: { _all: true },
    }),
    userId
      ? prisma.musicSongLike.findMany({ where: { songId: { in: ids }, userId }, select: { songId: true } })
      : Promise.resolve([] as Array<{ songId: string }>),
  ])
  const likedIds = new Set(userLikes.map((like) => like.songId))
  const countById = new Map(counts.map((row) => [row.songId, row._count._all]))

  for (const id of ids) {
    result.set(id, { liked: likedIds.has(id), likeCount: countById.get(id) || 0 })
  }
  return result
}

export async function getEasMusicAlbumLikeStates(albumIds: readonly string[], userId?: string) {
  const ids = uniqueIds(albumIds)
  const result = new Map<string, EasMusicLikeState>()
  if (!ids.length) return result

  const [counts, userLikes] = await Promise.all([
    prisma.musicAlbumLike.groupBy({
      by: ['albumId'],
      where: { albumId: { in: ids } },
      _count: { _all: true },
    }),
    userId
      ? prisma.musicAlbumLike.findMany({ where: { albumId: { in: ids }, userId }, select: { albumId: true } })
      : Promise.resolve([] as Array<{ albumId: string }>),
  ])
  const likedIds = new Set(userLikes.map((like) => like.albumId))
  const countById = new Map(counts.map((row) => [row.albumId, row._count._all]))

  for (const id of ids) {
    result.set(id, { liked: likedIds.has(id), likeCount: countById.get(id) || 0 })
  }
  return result
}

export async function getEasMusicSongLikeState(songId: string, userId?: string) {
  return (await getEasMusicSongLikeStates([songId], userId)).get(songId) || emptyLikeState
}

export async function getEasMusicAlbumLikeState(albumId: string, userId?: string) {
  return (await getEasMusicAlbumLikeStates([albumId], userId)).get(albumId) || emptyLikeState
}

export async function writeEasMusicSongLike(input: { songId: string; userId: string; liked: boolean }) {
  return prisma.$transaction(async (tx) => {
    const song = await tx.musicSong.findFirst({
      where: { id: input.songId, MusicAlbum: { status: 'PUBLISHED' } },
      select: { id: true },
    })
    if (!song) return null

    if (input.liked) {
      // The composite unique index is the concurrency guard. skipDuplicates
      // makes repeated/concurrent POST requests idempotent without a
      // find-then-create race.
      await tx.musicSongLike.createMany({
        data: { songId: input.songId, userId: input.userId },
        skipDuplicates: true,
      })
    } else {
      await tx.musicSongLike.deleteMany({ where: { songId: input.songId, userId: input.userId } })
    }

    const likeCount = await tx.musicSongLike.count({ where: { songId: input.songId } })
    return { liked: input.liked, likeCount }
  })
}

export async function writeEasMusicAlbumLike(input: { albumId: string; userId: string; liked: boolean }) {
  return prisma.$transaction(async (tx) => {
    const album = await tx.musicAlbum.findFirst({
      where: { id: input.albumId, status: 'PUBLISHED' },
      select: { id: true },
    })
    if (!album) return null

    if (input.liked) {
      await tx.musicAlbumLike.createMany({
        data: { albumId: input.albumId, userId: input.userId },
        skipDuplicates: true,
      })
    } else {
      await tx.musicAlbumLike.deleteMany({ where: { albumId: input.albumId, userId: input.userId } })
    }

    const likeCount = await tx.musicAlbumLike.count({ where: { albumId: input.albumId } })
    return { liked: input.liked, likeCount }
  })
}
