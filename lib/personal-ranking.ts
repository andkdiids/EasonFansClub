import { PersonalRankingType, Prisma, RatingTargetType } from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { ratingLanguageLabel, type RatingReviewSort, type RatingTarget } from '@/lib/rating-types'
import { publicRatingReviewVisibilityWhere, ratingPublicUserSelect, resolveRatingCoverSources } from '@/lib/rating-service'

export const PERSONAL_RANKING_LIMITS = {
  SONG: 27,
  ALBUM: 10,
} as const

export type PersonalRankingKind = keyof typeof PERSONAL_RANKING_LIMITS

export function parsePersonalRankingType(value: unknown): PersonalRankingKind {
  return String(value || '').toUpperCase() === 'ALBUM' ? 'ALBUM' : 'SONG'
}

export class PersonalRankingError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'LIMIT_REACHED' | 'DUPLICATE' | 'INVALID_TARGET' | 'INVALID_ORDER' | 'STALE_REVISION',
    message: string,
    public readonly status = 400,
  ) {
    super(message)
    this.name = 'PersonalRankingError'
  }
}

export function assertPersonalRankingHasCapacity(type: PersonalRankingKind, currentCount: number) {
  if (currentCount < PERSONAL_RANKING_LIMITS[type]) return
  throw new PersonalRankingError('LIMIT_REACHED', type === 'SONG' ? '个人单曲榜最多收录 27 首歌曲' : '个人专辑榜最多收录 10 张专辑', 409)
}

export function isCompletePersonalRankingOrder(existingIds: string[], itemIds: string[]) {
  const expected = new Set(existingIds)
  return itemIds.length === expected.size && new Set(itemIds).size === itemIds.length && itemIds.every((id) => expected.has(id))
}

type RankingItemRow = {
  id: string
  songId: string | null
  albumId: string | null
  position: number
  note: string | null
  MusicSong: null | {
    id: string
    title: string
    artist: string
    releaseYear: number
    language: string | null
    coverUrl: string | null
    MusicAlbum: { id: string; name: string; coverUrl: string | null; language: string }
  }
  MusicAlbum: null | {
    id: string
    name: string
    artist: string
    releaseYear: number
    language: string
    coverUrl: string | null
  }
}

export type PersonalRankingItemView = {
  id: string
  targetId: string
  position: number
  note: string | null
  title: string
  artist: string
  albumName: string | null
  releaseYear: number
  languageLabel: string
  coverUrl: string | null
  fallbackCoverUrl: string | null
  publicCommentCount: number
}

export type PersonalRankingView = {
  id: string | null
  type: PersonalRankingKind
  revision: number
  limit: number
  items: PersonalRankingItemView[]
}

const itemInclude = {
  MusicSong: {
    select: {
      id: true,
      title: true,
      artist: true,
      releaseYear: true,
      language: true,
      coverUrl: true,
      MusicAlbum: { select: { id: true, name: true, coverUrl: true, language: true } },
    },
  },
  MusicAlbum: { select: { id: true, name: true, artist: true, releaseYear: true, language: true, coverUrl: true } },
} as const

function integerValue(value: number | bigint | string | null | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

async function getPublicCommentCounts(type: PersonalRankingKind, targetIds: string[]) {
  if (!targetIds.length) return new Map<string, number>()
  const rows = type === 'SONG'
      ? await prisma.$queryRaw<Array<{ targetId: string; commentCount: number | bigint }>>(Prisma.sql`
        SELECT r.songId AS targetId, COUNT(rr.id) AS commentCount
        FROM RatingReview rr
        INNER JOIN Rating r ON r.id = rr.ratingId
        INNER JOIN MusicSong s ON s.id = r.songId
        INNER JOIN MusicAlbum a ON a.id = s.albumId
        INNER JOIN User u ON u.id = rr.userId
        WHERE r.targetType = ${'SONG'} AND r.songId IN (${Prisma.join(targetIds)})
          AND a.status = ${'PUBLISHED'}
          AND rr.deletedAt IS NULL AND TRIM(rr.content) <> ''
          AND u.status = ${'ACTIVE'} AND u.isDeleted = FALSE
        GROUP BY r.songId
      `)
      : await prisma.$queryRaw<Array<{ targetId: string; commentCount: number | bigint }>>(Prisma.sql`
        SELECT r.albumId AS targetId, COUNT(rr.id) AS commentCount
        FROM RatingReview rr
        INNER JOIN Rating r ON r.id = rr.ratingId
        INNER JOIN MusicAlbum a ON a.id = r.albumId
        INNER JOIN User u ON u.id = rr.userId
        WHERE r.targetType = ${'ALBUM'} AND r.albumId IN (${Prisma.join(targetIds)})
          AND a.status = ${'PUBLISHED'}
          AND rr.deletedAt IS NULL AND TRIM(rr.content) <> ''
          AND u.status = ${'ACTIVE'} AND u.isDeleted = FALSE
        GROUP BY r.albumId
      `)
  return new Map(rows.map((row) => [row.targetId, integerValue(row.commentCount)]))
}

function mapRankingItem(row: RankingItemRow, counts: Map<string, number>): PersonalRankingItemView {
  if (row.MusicSong) {
    const song = row.MusicSong
    const cover = resolveRatingCoverSources(song.coverUrl, song.MusicAlbum.coverUrl, 'thumb-sm')
    return {
      id: row.id,
      targetId: song.id,
      position: row.position,
      note: row.note,
      title: song.title,
      artist: song.artist,
      albumName: song.MusicAlbum.name,
      releaseYear: song.releaseYear,
      languageLabel: ratingLanguageLabel(song.language || song.MusicAlbum.language),
      ...cover,
      publicCommentCount: counts.get(song.id) || 0,
    }
  }
  if (!row.MusicAlbum) throw new PersonalRankingError('INVALID_TARGET', '榜单作品关系无效', 500)
  const album = row.MusicAlbum
  const cover = resolveRatingCoverSources(album.coverUrl, null, 'thumb-sm')
  return {
    id: row.id,
    targetId: album.id,
    position: row.position,
    note: row.note,
    title: album.name,
    artist: album.artist,
    albumName: null,
    releaseYear: album.releaseYear,
    languageLabel: ratingLanguageLabel(album.language),
    ...cover,
    publicCommentCount: counts.get(album.id) || 0,
  }
}

export async function getPersonalRanking(userId: string, type: PersonalRankingKind): Promise<PersonalRankingView> {
  const ranking = await prisma.personalRanking.findUnique({
    where: { userId_type: { userId, type: type as PersonalRankingType } },
    select: {
      id: true,
      revision: true,
      items: { orderBy: [{ position: 'asc' }, { id: 'asc' }], include: itemInclude },
    },
  })
  if (!ranking) return { id: null, type, revision: 0, limit: PERSONAL_RANKING_LIMITS[type], items: [] }
  const rows = ranking.items as RankingItemRow[]
  const targetIds = rows.map((row) => (type === 'SONG' ? row.songId : row.albumId)).filter((id): id is string => Boolean(id))
  const counts = await getPublicCommentCounts(type, targetIds)
  return {
    id: ranking.id,
    type,
    revision: ranking.revision,
    limit: PERSONAL_RANKING_LIMITS[type],
    items: rows.map((row) => mapRankingItem(row, counts)),
  }
}

async function lockRanking(tx: Prisma.TransactionClient, rankingId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM PersonalRanking WHERE id = ${rankingId} FOR UPDATE`)
}

async function ensurePublishedTarget(tx: Prisma.TransactionClient, type: PersonalRankingKind, targetId: string) {
  if (type === 'SONG') {
    const song = await tx.musicSong.findFirst({ where: { id: targetId, MusicAlbum: { status: 'PUBLISHED' } }, select: { id: true } })
    if (!song) throw new PersonalRankingError('NOT_FOUND', '歌曲不存在或暂未公开', 404)
    return
  }
  const album = await tx.musicAlbum.findFirst({ where: { id: targetId, status: 'PUBLISHED' }, select: { id: true } })
  if (!album) throw new PersonalRankingError('NOT_FOUND', '专辑不存在或暂未公开', 404)
}

export async function addPersonalRankingItem(userId: string, type: PersonalRankingKind, targetId: string) {
  // The first two requests for a user's type can race before the unique
  // PersonalRanking row exists. Retry the whole transaction on that unique
  // key race (and a transaction conflict), then let the locked row serialize
  // the count/limit check and insert. A duplicate target is re-evaluated on
  // the retry and therefore still returns the normal DUPLICATE error.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const ranking = await tx.personalRanking.upsert({
          where: { userId_type: { userId, type: type as PersonalRankingType } },
          create: { userId, type: type as PersonalRankingType },
          update: {},
          select: { id: true },
        })
        await lockRanking(tx, ranking.id)
        await ensurePublishedTarget(tx, type, targetId)
        const count = await tx.personalRankingItem.count({ where: { rankingId: ranking.id } })
        assertPersonalRankingHasCapacity(type, count)
        const existing = await tx.personalRankingItem.findFirst({
          where: { rankingId: ranking.id, ...(type === 'SONG' ? { songId: targetId } : { albumId: targetId }) },
          select: { id: true },
        })
        if (existing) throw new PersonalRankingError('DUPLICATE', type === 'SONG' ? '这首歌曲已经加入榜单' : '这张专辑已经加入榜单', 409)
        await tx.personalRankingItem.create({
          data: {
            rankingId: ranking.id,
            position: count + 1,
            ...(type === 'SONG' ? { songId: targetId, albumId: null } : { albumId: targetId, songId: null }),
          },
        })
        await tx.personalRanking.update({ where: { id: ranking.id }, data: { revision: { increment: 1 } } })
      })
      break
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')
      if (!retryable || attempt === 2) throw error
    }
  }
  return getPersonalRanking(userId, type)
}

async function ownedItem(tx: Prisma.TransactionClient, itemId: string, userId: string) {
  const item = await tx.personalRankingItem.findUnique({
    where: { id: itemId },
    select: { id: true, rankingId: true, ranking: { select: { userId: true, type: true } } },
  })
  if (!item) throw new PersonalRankingError('NOT_FOUND', '榜单作品不存在', 404)
  if (item.ranking.userId !== userId) throw new PersonalRankingError('FORBIDDEN', '不能修改其他用户的榜单', 403)
  return item
}

export async function updatePersonalRankingNote(userId: string, itemId: string, note: string | null) {
  const type = await prisma.$transaction(async (tx) => {
    const item = await ownedItem(tx, itemId, userId)
    await lockRanking(tx, item.rankingId)
    await tx.personalRankingItem.update({ where: { id: item.id }, data: { note } })
    await tx.personalRanking.update({ where: { id: item.rankingId }, data: { revision: { increment: 1 } } })
    return item.ranking.type as PersonalRankingKind
  })
  return getPersonalRanking(userId, type)
}

export async function removePersonalRankingItem(userId: string, itemId: string) {
  const type = await prisma.$transaction(async (tx) => {
    const item = await ownedItem(tx, itemId, userId)
    await lockRanking(tx, item.rankingId)
    await tx.personalRankingItem.delete({ where: { id: item.id } })
    const remaining = await tx.personalRankingItem.findMany({ where: { rankingId: item.rankingId }, orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { id: true } })
    for (let index = 0; index < remaining.length; index += 1) {
      await tx.personalRankingItem.update({ where: { id: remaining[index].id }, data: { position: index + 1 } })
    }
    await tx.personalRanking.update({ where: { id: item.rankingId }, data: { revision: { increment: 1 } } })
    return item.ranking.type as PersonalRankingKind
  })
  return getPersonalRanking(userId, type)
}

export async function reorderPersonalRanking(userId: string, type: PersonalRankingKind, itemIds: string[], revision: number) {
  await prisma.$transaction(async (tx) => {
    const ranking = await tx.personalRanking.findUnique({ where: { userId_type: { userId, type: type as PersonalRankingType } }, select: { id: true } })
    if (!ranking) throw new PersonalRankingError('NOT_FOUND', '个人榜单不存在', 404)
    await lockRanking(tx, ranking.id)
    const current = await tx.personalRanking.findUnique({ where: { id: ranking.id }, select: { revision: true } })
    if (!current || current.revision !== revision) throw new PersonalRankingError('STALE_REVISION', '榜单已在其他操作中更新，请使用最新顺序重试', 409)
    const existing = await tx.personalRankingItem.findMany({ where: { rankingId: ranking.id }, select: { id: true } })
    if (!isCompletePersonalRankingOrder(existing.map((item) => item.id), itemIds)) {
      throw new PersonalRankingError('INVALID_ORDER', '排序项目必须完整且全部属于当前榜单', 400)
    }
    for (let index = 0; index < itemIds.length; index += 1) {
      await tx.personalRankingItem.update({ where: { id: itemIds[index] }, data: { position: index + 1 } })
    }
    await tx.personalRanking.update({ where: { id: ranking.id }, data: { revision: { increment: 1 } } })
  })
  return getPersonalRanking(userId, type)
}

export async function searchPersonalRankingOptions(userId: string, type: PersonalRankingKind, query: string, page = 1, pageSize = 20) {
  const take = Math.min(Math.max(Math.floor(pageSize) || 20, 1), 30)
  const safePage = Math.max(Math.floor(page) || 1, 1)
  const ranking = await prisma.personalRanking.findUnique({ where: { userId_type: { userId, type: type as PersonalRankingType } }, select: { items: { select: { songId: true, albumId: true } } } })
  const added = new Set((ranking?.items || []).map((item) => type === 'SONG' ? item.songId : item.albumId).filter(Boolean))
  if (type === 'SONG') {
    const where: Prisma.MusicSongWhereInput = {
      MusicAlbum: { status: 'PUBLISHED' },
      ...(query ? { OR: [{ title: { contains: query } }, { MusicAlbum: { name: { contains: query }, status: 'PUBLISHED' } }] } : {}),
    }
    const [rows, total] = await Promise.all([
      prisma.musicSong.findMany({ where, orderBy: [{ releaseYear: 'desc' }, { title: 'asc' }], skip: (safePage - 1) * take, take, select: { id: true, title: true, releaseYear: true, language: true, coverUrl: true, MusicAlbum: { select: { name: true, coverUrl: true, language: true } } } }),
      prisma.musicSong.count({ where }),
    ])
    return { items: rows.map((song) => ({ id: song.id, title: song.title, albumName: song.MusicAlbum.name, releaseYear: song.releaseYear, languageLabel: ratingLanguageLabel(song.language || song.MusicAlbum.language), ...resolveRatingCoverSources(song.coverUrl, song.MusicAlbum.coverUrl, 'thumb-sm'), added: added.has(song.id) })), page: safePage, total, hasMore: safePage * take < total }
  }
  const where: Prisma.MusicAlbumWhereInput = { status: 'PUBLISHED', ...(query ? { name: { contains: query } } : {}) }
  const [rows, total] = await Promise.all([
    prisma.musicAlbum.findMany({ where, orderBy: [{ releaseYear: 'desc' }, { name: 'asc' }], skip: (safePage - 1) * take, take, select: { id: true, name: true, releaseYear: true, language: true, coverUrl: true } }),
    prisma.musicAlbum.count({ where }),
  ])
  return { items: rows.map((album) => ({ id: album.id, title: album.name, albumName: null, releaseYear: album.releaseYear, languageLabel: ratingLanguageLabel(album.language), ...resolveRatingCoverSources(album.coverUrl, null, 'thumb-sm'), added: added.has(album.id) })), page: safePage, total, hasMore: safePage * take < total }
}

export type PublicCommentView = {
  id: string
  content: string
  createdAt: string
  author: { id: string; uid: number; name: string; avatarUrl: string | null; level: number }
}

export async function getPersonalRankingPublicComments(target: RatingTarget, targetId: string, sort: RatingReviewSort, page = 1, pageSize = 20) {
  const take = Math.min(Math.max(Math.floor(pageSize) || 20, 1), 30)
  const safePage = Math.max(Math.floor(page) || 1, 1)
  const targetExists = target === 'song'
    ? await prisma.musicSong.findFirst({ where: { id: targetId, MusicAlbum: { status: 'PUBLISHED' } }, select: { id: true } })
    : await prisma.musicAlbum.findFirst({ where: { id: targetId, status: 'PUBLISHED' }, select: { id: true } })
  if (!targetExists) throw new PersonalRankingError('NOT_FOUND', target === 'song' ? '歌曲不存在或暂未公开' : '专辑不存在或暂未公开', 404)
  const targetType = target === 'song' ? RatingTargetType.SONG : RatingTargetType.ALBUM
  const targetColumn = target === 'song' ? Prisma.sql`r.songId` : Prisma.sql`r.albumId`
  const targetJoin = target === 'song'
    ? Prisma.sql`INNER JOIN MusicSong s ON s.id = r.songId INNER JOIN MusicAlbum a ON a.id = s.albumId`
    : Prisma.sql`INNER JOIN MusicAlbum a ON a.id = r.albumId`
  const order = sort === 'latest' ? Prisma.sql`rr.createdAt DESC, rr.id ASC` : Prisma.sql`rr.likeCount DESC, rr.createdAt DESC, rr.id ASC`
  const [idRows, countRows] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT rr.id
      FROM RatingReview rr
      INNER JOIN Rating r ON r.id = rr.ratingId
      ${targetJoin}
      INNER JOIN User u ON u.id = rr.userId
      WHERE r.targetType = ${targetType} AND ${targetColumn} = ${targetId}
        AND a.status = ${'PUBLISHED'}
        AND rr.deletedAt IS NULL AND TRIM(rr.content) <> ''
        AND u.status = ${'ACTIVE'} AND u.isDeleted = FALSE
      ORDER BY ${order}
      LIMIT ${take} OFFSET ${(safePage - 1) * take}
    `),
    prisma.$queryRaw<Array<{ count: number | bigint }>>(Prisma.sql`
      SELECT COUNT(rr.id) AS count
      FROM RatingReview rr
      INNER JOIN Rating r ON r.id = rr.ratingId
      ${targetJoin}
      INNER JOIN User u ON u.id = rr.userId
      WHERE r.targetType = ${targetType} AND ${targetColumn} = ${targetId}
        AND a.status = ${'PUBLISHED'}
        AND rr.deletedAt IS NULL AND TRIM(rr.content) <> ''
        AND u.status = ${'ACTIVE'} AND u.isDeleted = FALSE
    `),
  ])
  const ids = idRows.map((row) => row.id)
  const reviews = ids.length ? await prisma.ratingReview.findMany({ where: { id: { in: ids }, ...publicRatingReviewVisibilityWhere() }, select: { id: true, content: true, createdAt: true, User: { select: ratingPublicUserSelect } } }) : []
  const byId = new Map(reviews.map((review) => [review.id, review]))
  const items = ids.flatMap((id): PublicCommentView[] => {
    const review = byId.get(id)
    if (!review) return []
    return [{ id: review.id, content: review.content, createdAt: review.createdAt.toISOString(), author: { id: review.User.id, uid: review.User.uid, name: getPublicUserDisplayName(review.User), avatarUrl: publicImageUrl(review.User.Profile?.avatarUrl || review.User.avatarUrl), level: review.User.level } }]
  })
  const total = integerValue(countRows[0]?.count)
  return { items, page: safePage, pageSize: take, total, hasMore: safePage * take < total }
}
