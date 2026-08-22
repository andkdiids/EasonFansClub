import { Prisma, RatingTargetType } from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { isSupabaseStorageUrl, publicImageUrl } from '@/lib/images'
import { publicImageVariantUrl, type ImageVariant } from '@/lib/image-variants'
import { prisma } from '@/lib/prisma'
import {
  formatAverageScore,
  normalizeRatingLanguage,
  ratingLanguageLabel,
  type RatingLanguage,
  type RatingReviewSort,
  type RatingTarget,
} from '@/lib/rating-types'

export type RatingStatsView = {
  ratingCount: number
  ratingScoreTotal: number
  averageScore: number
  reviewCount: number
}

export type RatingListItem = RatingStatsView & {
  id: string
  target: RatingTarget
  title: string
  artist?: string | null
  albumId?: string | null
  albumName?: string | null
  releaseYear: number
  language: string | null
  languageKey: Exclude<RatingLanguage, 'ALL'>
  languageLabel: string
  coverUrl: string | null
  fallbackCoverUrl: string | null
}

export type RatingReviewView = {
  id: string
  content: string
  likeCount: number
  createdAt: string
  score: number
  liked: boolean
  isOwn: boolean
  user: {
    id: string
    uid: number
    name: string
    avatarUrl: string | null
    level: number
  }
}

export type OwnRatingView = {
  id: string
  score: number
  createdAt: string
}

export type OwnReviewView = {
  id: string
  content: string
  likeCount: number
  createdAt: string
}

export type SongRatingDetail = {
  target: 'song'
  song: {
    id: string
    title: string
    artist: string
    releaseYear: number
    language: string | null
    languageKey: Exclude<RatingLanguage, 'ALL'>
    languageLabel: string
    coverUrl: string | null
    fallbackCoverUrl: string | null
    album: {
      id: string
      name: string
      releaseYear: number
      language: string | null
      coverUrl: string | null
    }
  }
  stats: RatingStatsView
  myRating: OwnRatingView | null
  myReview: OwnReviewView | null
  reviews: RatingReviewView[]
}

export type AlbumRatingDetail = {
  target: 'album'
  album: {
    id: string
    name: string
    artist: string
    releaseYear: number
    language: string | null
    languageKey: Exclude<RatingLanguage, 'ALL'>
    languageLabel: string
    coverUrl: string | null
    songs: Array<RatingListItem & { trackNumber: number }>
  }
  stats: RatingStatsView
  myRating: OwnRatingView | null
  myReview: OwnReviewView | null
  reviews: RatingReviewView[]
}

export type RatingRankingResult = {
  items: RatingListItem[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasMore: boolean
}

export type AdminRatingReview = {
  id: string
  content: string
  likeCount: number
  createdAt: string
  deletedAt: string | null
  score: number
  target: RatingTarget
  targetId: string
  targetTitle: string
  user: { id: string; uid: number; name: string }
}

export type AdminRatingOverview = {
  reviews: AdminRatingReview[]
  stats: RatingStatsView
}

export class RatingServiceError extends Error {
  constructor(
    public readonly code: 'TARGET_NOT_FOUND' | 'INVALID_SCORE' | 'ALREADY_RATED' | 'RATING_REQUIRED' | 'ALREADY_REVIEWED' | 'REVIEW_NOT_FOUND' | 'FORBIDDEN' | 'LIKE_TARGET_NOT_FOUND',
    message: string,
    public readonly status = 400,
  ) {
    super(message)
    this.name = 'RatingServiceError'
  }
}

type RawSongRankingRow = {
  id: string
  title: string
  artist: string | null
  releaseYear: number
  language: string | null
  coverUrl: string | null
  albumId: string
  albumName: string
  albumCoverUrl: string | null
  albumLanguage: string | null
  ratingCount: number | bigint | string
  ratingScoreTotal: number | bigint | string
  averageScore: number | string | null
  reviewCount: number | bigint | string
}

type RawAlbumRankingRow = {
  id: string
  name: string
  artist: string
  releaseYear: number
  language: string | null
  coverUrl: string | null
  ratingCount: number | bigint | string
  ratingScoreTotal: number | bigint | string
  averageScore: number | string | null
  reviewCount: number | bigint | string
}

function integerValue(value: number | bigint | string | null | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

function decimalValue(value: number | string | null | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function statsView(value?: Partial<RatingStatsView> | null): RatingStatsView {
  return {
    ratingCount: integerValue(value?.ratingCount),
    ratingScoreTotal: integerValue(value?.ratingScoreTotal),
    averageScore: decimalValue(value?.averageScore),
    reviewCount: integerValue(value?.reviewCount),
  }
}

function targetEnum(target: RatingTarget) {
  return target === 'song' ? RatingTargetType.SONG : RatingTargetType.ALBUM
}

function targetRelationWhere(target: RatingTarget, id: string): Prisma.RatingWhereInput {
  return target === 'song' ? { targetType: RatingTargetType.SONG, songId: id } : { targetType: RatingTargetType.ALBUM, albumId: id }
}

function statsUniqueWhere(target: RatingTarget, id: string): Prisma.RatingStatsWhereUniqueInput {
  return target === 'song' ? { songId: id } : { albumId: id }
}

function statsTargetData(target: RatingTarget, id: string) {
  return target === 'song'
    ? { targetType: RatingTargetType.SONG, songId: id }
    : { targetType: RatingTargetType.ALBUM, albumId: id }
}

function publicTargetLanguage(songLanguage: string | null | undefined, albumLanguage: string | null | undefined) {
  const language = songLanguage?.trim() || albumLanguage?.trim() || null
  return {
    language,
    languageKey: normalizeRatingLanguage(language),
    languageLabel: ratingLanguageLabel(language),
  }
}

function normalizedRatingCover(value: string | null | undefined, variant: ImageVariant) {
  const publicUrl = publicImageUrl(value)
  if (!publicUrl || isSupabaseStorageUrl(publicUrl)) return null
  return publicImageVariantUrl(publicUrl, variant)
}

export function resolveRatingCoverSources(primary: string | null | undefined, fallback: string | null | undefined, variant: ImageVariant) {
  const primaryUrl = normalizedRatingCover(primary, variant)
  const fallbackUrl = normalizedRatingCover(fallback, variant)
  return {
    coverUrl: primaryUrl || fallbackUrl,
    fallbackCoverUrl: primaryUrl && fallbackUrl !== primaryUrl ? fallbackUrl : null,
  }
}

function languageExpression(kind: 'song' | 'album') {
  return kind === 'song'
    ? Prisma.sql`LOWER(COALESCE(NULLIF(s.language, ''), NULLIF(a.language, ''), ''))`
    : Prisma.sql`LOWER(COALESCE(a.language, ''))`
}

function cantoneseCondition(expression: Prisma.Sql) {
  return Prisma.sql`(
    ${expression} LIKE ${'%cantonese%'}
    OR ${expression} LIKE ${'%粵語%'}
    OR ${expression} LIKE ${'%粤语%'}
    OR ${expression} LIKE ${'%廣東話%'}
    OR ${expression} LIKE ${'%广东话%'}
    OR ${expression} LIKE ${'%zh-hk%'}
    OR ${expression} LIKE ${'%zh_hk%'}
    OR ${expression} LIKE ${'%zh-mo%'}
    OR ${expression} LIKE ${'%yue%'}
    OR ${expression} LIKE ${'%hong kong%'}
  )`
}

function mandarinCondition(expression: Prisma.Sql) {
  return Prisma.sql`(
    ${expression} LIKE ${'%mandarin%'}
    OR ${expression} LIKE ${'%普通話%'}
    OR ${expression} LIKE ${'%普通话%'}
    OR ${expression} LIKE ${'%國語%'}
    OR ${expression} LIKE ${'%国语%'}
    OR ${expression} LIKE ${'%華語%'}
    OR ${expression} LIKE ${'%华语%'}
    OR ${expression} LIKE ${'%zh-cn%'}
    OR ${expression} LIKE ${'%zh_cn%'}
    OR ${expression} LIKE ${'%zh-sg%'}
    OR ${expression} LIKE ${'%zh-my%'}
    OR ${expression} LIKE ${'%putonghua%'}
  )`
}

function languageFilter(language: RatingLanguage, kind: 'song' | 'album') {
  if (language === 'ALL') return null
  const expression = languageExpression(kind)
  const cantonese = cantoneseCondition(expression)
  const mandarin = mandarinCondition(expression)
  if (language === 'CANTONESE') return cantonese
  if (language === 'MANDARIN') return mandarin
  return Prisma.sql`NOT ${cantonese} AND NOT ${mandarin}`
}

function searchFilter(query: string, kind: RatingTarget) {
  const value = query.trim()
  if (!value) return null
  const pattern = `%${value}%`
  return kind === 'song'
    ? Prisma.sql`(s.title LIKE ${pattern} OR a.name LIKE ${pattern})`
    : Prisma.sql`a.name LIKE ${pattern}`
}

function mapSongRankingRow(row: RawSongRankingRow): RatingListItem {
  const language = publicTargetLanguage(row.language, row.albumLanguage)
  const cover = resolveRatingCoverSources(row.coverUrl, row.albumCoverUrl, 'thumb-sm')
  return {
    id: row.id,
    target: 'song',
    title: row.title,
    artist: row.artist,
    albumId: row.albumId,
    albumName: row.albumName,
    releaseYear: integerValue(row.releaseYear),
    ...language,
    ...cover,
    ratingCount: integerValue(row.ratingCount),
    ratingScoreTotal: integerValue(row.ratingScoreTotal),
    averageScore: decimalValue(row.averageScore),
    reviewCount: integerValue(row.reviewCount),
  }
}

function mapAlbumRankingRow(row: RawAlbumRankingRow): RatingListItem {
  const language = publicTargetLanguage(row.language, null)
  const cover = resolveRatingCoverSources(row.coverUrl, null, 'thumb-sm')
  return {
    id: row.id,
    target: 'album',
    title: row.name,
    artist: row.artist,
    releaseYear: integerValue(row.releaseYear),
    ...language,
    ...cover,
    ratingCount: integerValue(row.ratingCount),
    ratingScoreTotal: integerValue(row.ratingScoreTotal),
    averageScore: decimalValue(row.averageScore),
    reviewCount: integerValue(row.reviewCount),
  }
}

export async function getRatingRanking({
  target,
  language = 'ALL',
  query = '',
  page = 1,
  pageSize = 30,
}: {
  target: RatingTarget
  language?: RatingLanguage
  query?: string
  page?: number
  pageSize?: number
}): Promise<RatingRankingResult> {
  const safePageSize = Math.min(Math.max(Math.floor(pageSize) || 30, 1), 50)
  const requestedPage = Number.isFinite(page) ? Math.max(Math.floor(page) || 1, 1) : 1
  const filters = [
    Prisma.sql`a.status = ${'PUBLISHED'}`,
    languageFilter(language, target),
    searchFilter(query, target),
  ].filter((item): item is Prisma.Sql => Boolean(item))
  const where = Prisma.join(filters, ' AND ')

  if (target === 'song') {
    const loadRows = (skip: number) => prisma.$queryRaw<RawSongRankingRow[]>(Prisma.sql`
      SELECT
        s.id,
        s.title,
        s.artist,
        s.releaseYear,
        s.language,
        s.coverUrl,
        s.albumId,
        a.name AS albumName,
        a.coverUrl AS albumCoverUrl,
        a.language AS albumLanguage,
        COALESCE(rs.ratingCount, 0) AS ratingCount,
        COALESCE(rs.ratingScoreTotal, 0) AS ratingScoreTotal,
        COALESCE(rs.averageScore, 0) AS averageScore,
        COALESCE(rs.reviewCount, 0) AS reviewCount
      FROM MusicSong AS s
      INNER JOIN MusicAlbum AS a ON a.id = s.albumId
      LEFT JOIN RatingStats AS rs ON rs.songId = s.id
      WHERE ${where}
      ORDER BY COALESCE(rs.averageScore, 0) DESC, COALESCE(rs.ratingCount, 0) DESC, s.id ASC
      LIMIT ${safePageSize} OFFSET ${skip}
    `)
    const skip = (requestedPage - 1) * safePageSize
    const [rows, countRows] = await Promise.all([
      loadRows(skip),
      prisma.$queryRaw<Array<{ count: number | bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS count
        FROM MusicSong AS s
        INNER JOIN MusicAlbum AS a ON a.id = s.albumId
        WHERE ${where}
      `),
    ])
    const total = integerValue(countRows[0]?.count)
    const totalPages = Math.max(1, Math.ceil(total / safePageSize))
    const safePage = Math.min(requestedPage, totalPages)
    const resolvedRows = safePage === requestedPage ? rows : await loadRows((safePage - 1) * safePageSize)
    return { items: resolvedRows.map(mapSongRankingRow), page: safePage, pageSize: safePageSize, total, totalPages, hasMore: safePage < totalPages }
  }

  const loadRows = (skip: number) => prisma.$queryRaw<RawAlbumRankingRow[]>(Prisma.sql`
    SELECT
      a.id,
      a.name,
      a.artist,
      a.releaseYear,
      a.language,
      a.coverUrl,
      COALESCE(rs.ratingCount, 0) AS ratingCount,
      COALESCE(rs.ratingScoreTotal, 0) AS ratingScoreTotal,
      COALESCE(rs.averageScore, 0) AS averageScore,
      COALESCE(rs.reviewCount, 0) AS reviewCount
    FROM MusicAlbum AS a
    LEFT JOIN RatingStats AS rs ON rs.albumId = a.id
    WHERE ${where}
    ORDER BY COALESCE(rs.averageScore, 0) DESC, COALESCE(rs.ratingCount, 0) DESC, a.id ASC
    LIMIT ${safePageSize} OFFSET ${skip}
  `)
  const skip = (requestedPage - 1) * safePageSize
  const [rows, countRows] = await Promise.all([
    loadRows(skip),
    prisma.$queryRaw<Array<{ count: number | bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS count
      FROM MusicAlbum AS a
      WHERE ${where}
    `),
  ])
  const total = integerValue(countRows[0]?.count)
  const totalPages = Math.max(1, Math.ceil(total / safePageSize))
  const safePage = Math.min(requestedPage, totalPages)
  const resolvedRows = safePage === requestedPage ? rows : await loadRows((safePage - 1) * safePageSize)
  return { items: resolvedRows.map(mapAlbumRankingRow), page: safePage, pageSize: safePageSize, total, totalPages, hasMore: safePage < totalPages }
}

function mapStats(stats: { ratingCount: number; ratingScoreTotal: number; averageScore: number; reviewCount: number } | null | undefined) {
  return statsView(stats)
}

const userSelect = {
  id: true,
  uid: true,
  nickname: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  avatarUrl: true,
  level: true,
  Profile: { select: { avatarUrl: true, displayName: true, displayNameModerationStatus: true } },
} as const

async function getReviewsForTarget(target: RatingTarget, id: string, viewerId: string | null, sort: RatingReviewSort) {
  const rows = await prisma.ratingReview.findMany({
    where: {
      deletedAt: null,
      Rating: targetRelationWhere(target, id),
      User: { status: 'ACTIVE', isDeleted: false },
    },
    orderBy: sort === 'latest' ? [{ createdAt: 'desc' }, { id: 'asc' }] : [{ likeCount: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    take: 50,
    select: {
      id: true,
      userId: true,
      content: true,
      likeCount: true,
      createdAt: true,
      User: { select: userSelect },
      Rating: { select: { score: true } },
      RatingReviewLike: { where: { userId: viewerId || '__guest__' }, select: { id: true } },
    },
  })

  return rows.map((row): RatingReviewView => ({
    id: row.id,
    content: row.content,
    likeCount: row.likeCount,
    createdAt: row.createdAt.toISOString(),
    score: row.Rating.score,
    liked: row.RatingReviewLike.length > 0,
    isOwn: Boolean(viewerId && row.userId === viewerId),
    user: {
      id: row.User.id,
      uid: row.User.uid,
      name: getPublicUserDisplayName(row.User),
      avatarUrl: publicImageUrl(row.User.Profile?.avatarUrl || row.User.avatarUrl),
      level: row.User.level,
    },
  }))
}

async function getOwnReview(ratingId: string, userId: string | null): Promise<OwnReviewView | null> {
  if (!userId) return null
  const review = await prisma.ratingReview.findFirst({
    where: { ratingId, userId, deletedAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: { id: true, content: true, likeCount: true, createdAt: true },
  })
  return review ? { ...review, createdAt: review.createdAt.toISOString() } : null
}

async function getOwnRating(target: RatingTarget, id: string, userId: string | null): Promise<OwnRatingView | null> {
  if (!userId) return null
  const rating = await prisma.rating.findFirst({
    where: { userId, ...targetRelationWhere(target, id) },
    select: { id: true, score: true, createdAt: true },
  })
  return rating ? { ...rating, createdAt: rating.createdAt.toISOString() } : null
}

export async function getSongRatingDetail(id: string, viewerId: string | null, sort: RatingReviewSort): Promise<SongRatingDetail | null> {
  const song = await prisma.musicSong.findFirst({
    where: { id, MusicAlbum: { status: 'PUBLISHED' } },
    select: {
      id: true,
      title: true,
      artist: true,
      releaseYear: true,
      language: true,
      coverUrl: true,
      MusicAlbum: { select: { id: true, name: true, releaseYear: true, language: true, coverUrl: true } },
    },
  })
  if (!song) return null

  const [stats, myRating, reviews] = await Promise.all([
    prisma.ratingStats.findUnique({ where: { songId: id }, select: { ratingCount: true, ratingScoreTotal: true, averageScore: true, reviewCount: true } }),
    getOwnRating('song', id, viewerId),
    getReviewsForTarget('song', id, viewerId, sort),
  ])
  const myReview = myRating ? await getOwnReview(myRating.id, viewerId) : null
  const language = publicTargetLanguage(song.language, song.MusicAlbum.language)
  const cover = resolveRatingCoverSources(song.coverUrl, song.MusicAlbum.coverUrl, 'large')
  return {
    target: 'song',
    song: {
      id: song.id,
      title: song.title,
      artist: song.artist,
      releaseYear: song.releaseYear,
      ...language,
      ...cover,
      album: {
        id: song.MusicAlbum.id,
        name: song.MusicAlbum.name,
        releaseYear: song.MusicAlbum.releaseYear,
        language: song.MusicAlbum.language,
        coverUrl: resolveRatingCoverSources(song.MusicAlbum.coverUrl, null, 'thumb-md').coverUrl,
      },
    },
    stats: mapStats(stats),
    myRating,
    myReview,
    reviews,
  }
}

export async function getAlbumRatingDetail(id: string, viewerId: string | null, sort: RatingReviewSort): Promise<AlbumRatingDetail | null> {
  const album = await prisma.musicAlbum.findFirst({
    where: { id, status: 'PUBLISHED' },
    select: {
      id: true,
      name: true,
      artist: true,
      releaseYear: true,
      language: true,
      coverUrl: true,
      MusicSong: {
        orderBy: [{ trackNumber: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          title: true,
          artist: true,
          releaseYear: true,
          language: true,
          coverUrl: true,
          albumId: true,
          trackNumber: true,
          RatingStats: { select: { ratingCount: true, ratingScoreTotal: true, averageScore: true, reviewCount: true } },
        },
      },
    },
  })
  if (!album) return null

  const [stats, myRating, reviews] = await Promise.all([
    prisma.ratingStats.findUnique({ where: { albumId: id }, select: { ratingCount: true, ratingScoreTotal: true, averageScore: true, reviewCount: true } }),
    getOwnRating('album', id, viewerId),
    getReviewsForTarget('album', id, viewerId, sort),
  ])
  const myReview = myRating ? await getOwnReview(myRating.id, viewerId) : null
  const albumLanguage = publicTargetLanguage(album.language, null)
  return {
    target: 'album',
    album: {
      id: album.id,
      name: album.name,
      artist: album.artist,
      releaseYear: album.releaseYear,
      ...albumLanguage,
      coverUrl: resolveRatingCoverSources(album.coverUrl, null, 'large').coverUrl,
      songs: album.MusicSong.map((song) => ({
        ...resolveRatingCoverSources(song.coverUrl, album.coverUrl, 'thumb-sm'),
        id: song.id,
        target: 'song' as const,
        title: song.title,
        artist: song.artist,
        albumId: song.albumId,
        albumName: album.name,
        releaseYear: song.releaseYear,
        ...publicTargetLanguage(song.language, album.language),
        ...statsView(song.RatingStats),
        trackNumber: song.trackNumber,
      })),
    },
    stats: mapStats(stats),
    myRating,
    myReview,
    reviews,
  }
}

async function ensureStatsRow(tx: Prisma.TransactionClient, target: RatingTarget, id: string) {
  const where = statsUniqueWhere(target, id)
  const current = await tx.ratingStats.findUnique({ where })
  if (current) return current

  const aggregate = await tx.rating.aggregate({
    where: targetRelationWhere(target, id),
    _count: { _all: true },
    _sum: { score: true },
  })
  const reviewCount = await tx.ratingReview.count({ where: { deletedAt: null, Rating: targetRelationWhere(target, id) } })
  const count = integerValue(aggregate._count._all)
  const total = integerValue(aggregate._sum.score)
  try {
    return await tx.ratingStats.create({
      data: {
        ...statsTargetData(target, id),
        ratingCount: count,
        ratingScoreTotal: total,
        averageScore: count ? total / count : 0,
        reviewCount,
      },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return tx.ratingStats.findUniqueOrThrow({ where })
    }
    throw error
  }
}

async function applyStatsDelta(tx: Prisma.TransactionClient, target: RatingTarget, id: string, delta: { ratingCount?: number; ratingScoreTotal?: number; reviewCount?: number }) {
  const stats = await ensureStatsRow(tx, target, id)
  const updated = await tx.ratingStats.update({
    where: { id: stats.id },
    data: {
      ...(delta.ratingCount ? { ratingCount: { increment: delta.ratingCount } } : {}),
      ...(delta.ratingScoreTotal ? { ratingScoreTotal: { increment: delta.ratingScoreTotal } } : {}),
      ...(delta.reviewCount !== undefined && delta.reviewCount !== 0 ? { reviewCount: { increment: delta.reviewCount } } : {}),
    },
    select: { id: true, ratingCount: true, ratingScoreTotal: true },
  })
  return tx.ratingStats.update({
    where: { id: updated.id },
    data: { averageScore: updated.ratingCount > 0 ? updated.ratingScoreTotal / updated.ratingCount : 0 },
  })
}

function ratingDuplicateMessage(target: RatingTarget) {
  return target === 'song' ? '你已经评价过这首歌曲' : '你已经评价过这张专辑'
}

export async function createRatingWithOptionalReview({
  target,
  targetId,
  userId,
  score,
  content,
}: {
  target: RatingTarget
  targetId: string
  userId: string
  score: number
  content?: string | null
}) {
  if (!Number.isInteger(score) || score < 1 || score > 10) throw new RatingServiceError('INVALID_SCORE', '评分必须是 1 到 10 的整数', 400)

  try {
    return await prisma.$transaction(async (tx) => {
      const targetExists = target === 'song'
        ? await tx.musicSong.findFirst({ where: { id: targetId, MusicAlbum: { status: 'PUBLISHED' } }, select: { id: true } })
        : await tx.musicAlbum.findFirst({ where: { id: targetId, status: 'PUBLISHED' }, select: { id: true } })
      if (!targetExists) throw new RatingServiceError('TARGET_NOT_FOUND', '评分对象不存在或暂未公开', 404)

      const existing = await tx.rating.findFirst({ where: { userId, ...targetRelationWhere(target, targetId) }, select: { id: true } })
      if (existing) throw new RatingServiceError('ALREADY_RATED', ratingDuplicateMessage(target), 409)

      // Create the zeroed stats row before the new Rating exists.  This keeps
      // ensureStatsRow from counting the just-created rating and then adding
      // it a second time below.
      await ensureStatsRow(tx, target, targetId)
      const rating = await tx.rating.create({
        data: {
          userId,
          targetType: targetEnum(target),
          songId: target === 'song' ? targetId : null,
          albumId: target === 'album' ? targetId : null,
          score,
        },
        select: { id: true, score: true, createdAt: true },
      })
      const reviewContent = content?.trim() || ''
      let review: { id: string; content: string; createdAt: Date } | null = null
      if (reviewContent) {
        review = await tx.ratingReview.create({
          data: {
            ratingId: rating.id,
            userId,
            content: reviewContent,
            activeKey: `rating:${target}:${targetId}:${userId}`,
          },
          select: { id: true, content: true, createdAt: true },
        })
      }
      const stats = await applyStatsDelta(tx, target, targetId, { ratingCount: 1, ratingScoreTotal: score, reviewCount: review ? 1 : 0 })
      return { rating, review, stats: statsView(stats) }
    })
  } catch (error) {
    if (error instanceof RatingServiceError) throw error
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new RatingServiceError('ALREADY_RATED', ratingDuplicateMessage(target), 409)
    }
    throw error
  }
}

export async function createRatingReview({ target, targetId, userId, content }: { target: RatingTarget; targetId: string; userId: string; content: string }) {
  const value = content.trim()
  if (!value) throw new RatingServiceError('RATING_REQUIRED', '评价内容不能为空', 400)
  try {
    return await prisma.$transaction(async (tx) => {
      const targetExists = target === 'song'
        ? await tx.musicSong.findFirst({ where: { id: targetId, MusicAlbum: { status: 'PUBLISHED' } }, select: { id: true } })
        : await tx.musicAlbum.findFirst({ where: { id: targetId, status: 'PUBLISHED' }, select: { id: true } })
      if (!targetExists) throw new RatingServiceError('TARGET_NOT_FOUND', '评价对象不存在或暂未公开', 404)

      const rating = await tx.rating.findFirst({ where: { userId, ...targetRelationWhere(target, targetId) }, select: { id: true } })
      if (!rating) throw new RatingServiceError('RATING_REQUIRED', '请先完成评分，再发表评价', 400)
      const active = await tx.ratingReview.findFirst({ where: { ratingId: rating.id, deletedAt: null }, select: { id: true } })
      if (active) throw new RatingServiceError('ALREADY_REVIEWED', '你已经发表过评价，请先删除原评价', 409)

      await ensureStatsRow(tx, target, targetId)
      const review = await tx.ratingReview.create({
        data: { ratingId: rating.id, userId, content: value, activeKey: `rating:${target}:${targetId}:${userId}` },
        select: { id: true, content: true, createdAt: true },
      })
      const stats = await applyStatsDelta(tx, target, targetId, { reviewCount: 1 })
      return { review, stats: statsView(stats) }
    })
  } catch (error) {
    if (error instanceof RatingServiceError) throw error
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new RatingServiceError('ALREADY_REVIEWED', '你已经发表过评价，请先删除原评价', 409)
    }
    throw error
  }
}

export async function deleteRatingReview({ reviewId, userId, canModerate }: { reviewId: string; userId: string; canModerate: boolean }) {
  return prisma.$transaction(async (tx) => {
    const review = await tx.ratingReview.findFirst({
      where: { id: reviewId, deletedAt: null },
      select: { id: true, userId: true, ratingId: true, Rating: { select: { targetType: true, songId: true, albumId: true } } },
    })
    if (!review) throw new RatingServiceError('REVIEW_NOT_FOUND', '评价不存在或已经删除', 404)
    if (!canModerate && review.userId !== userId) throw new RatingServiceError('FORBIDDEN', '只能删除自己的评价', 403)

    const target: RatingTarget = review.Rating.targetType === RatingTargetType.SONG ? 'song' : 'album'
    const targetId = target === 'song' ? review.Rating.songId : review.Rating.albumId
    if (!targetId) throw new RatingServiceError('TARGET_NOT_FOUND', '评价对象不存在', 404)
    await ensureStatsRow(tx, target, targetId)
    await tx.ratingReview.update({ where: { id: review.id }, data: { deletedAt: new Date(), activeKey: null } })
    await applyStatsDelta(tx, target, targetId, { reviewCount: -1 })
    return { id: review.id, target, targetId }
  })
}

export async function toggleRatingReviewLike({ reviewId, userId }: { reviewId: string; userId: string }) {
  try {
    return await prisma.$transaction(async (tx) => {
      const review = await tx.ratingReview.findFirst({ where: { id: reviewId, deletedAt: null }, select: { id: true } })
      if (!review) throw new RatingServiceError('LIKE_TARGET_NOT_FOUND', '评价不存在或已经删除', 404)
      const existing = await tx.ratingReviewLike.findUnique({ where: { reviewId_userId: { reviewId, userId } }, select: { id: true } })
      let liked = false
      if (existing) await tx.ratingReviewLike.delete({ where: { id: existing.id } })
      else {
        await tx.ratingReviewLike.create({ data: { reviewId, userId } })
        liked = true
      }
      const likeCount = await tx.ratingReviewLike.count({ where: { reviewId } })
      await tx.ratingReview.update({ where: { id: reviewId }, data: { likeCount } })
      return { liked, likeCount }
    })
  } catch (error) {
    if (error instanceof RatingServiceError) throw error
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const [existing, likeCount] = await Promise.all([
        prisma.ratingReviewLike.findUnique({ where: { reviewId_userId: { reviewId, userId } }, select: { id: true } }),
        prisma.ratingReviewLike.count({ where: { reviewId } }),
      ])
      return { liked: Boolean(existing), likeCount }
    }
    throw error
  }
}

export async function getMyRatings({ userId, target, page = 1, pageSize = 30 }: { userId: string; target?: RatingTarget; page?: number; pageSize?: number }) {
  const take = Math.min(Math.max(Math.floor(pageSize) || 30, 1), 50)
  const safePage = Math.max(Math.floor(page) || 1, 1)
  const where: Prisma.RatingWhereInput = { userId, ...(target ? { targetType: targetEnum(target) } : {}) }
  const [rows, total] = await Promise.all([
    prisma.rating.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (safePage - 1) * take,
      take,
      select: {
        id: true,
        score: true,
        createdAt: true,
        MusicSong: { select: { id: true, title: true, coverUrl: true, releaseYear: true, language: true, MusicAlbum: { select: { id: true, name: true, coverUrl: true, releaseYear: true, language: true } } } },
        MusicAlbum: { select: { id: true, name: true, coverUrl: true, releaseYear: true, language: true } },
        RatingReview: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, content: true } },
      },
    }),
    prisma.rating.count({ where }),
  ])
  return {
    items: rows.map((row) => {
      const song = row.MusicSong
      const album = row.MusicAlbum || song?.MusicAlbum
      return {
        ...resolveRatingCoverSources(song?.coverUrl, song?.MusicAlbum.coverUrl || album?.coverUrl, 'thumb-sm'),
        id: row.id,
        targetId: song?.id || album?.id || '',
        target: song ? 'song' as const : 'album' as const,
        title: song?.title || album?.name || '未知作品',
        albumName: song?.MusicAlbum.name || null,
        releaseYear: song?.releaseYear || album?.releaseYear || 0,
        languageLabel: ratingLanguageLabel(song?.language || album?.language),
        score: row.score,
        createdAt: row.createdAt.toISOString(),
        review: row.RatingReview[0] || null,
      }
    }),
    page: safePage,
    pageSize: take,
    total,
    hasMore: (safePage - 1) * take + rows.length < total,
  }
}

export async function getAdminRatingOverview(): Promise<AdminRatingOverview> {
  const [reviews, stats] = await Promise.all([
    prisma.ratingReview.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 300,
      select: {
        id: true,
        content: true,
        likeCount: true,
        createdAt: true,
        deletedAt: true,
        User: { select: { id: true, uid: true, nickname: true, nicknameModerationStatus: true, Profile: { select: { displayName: true, displayNameModerationStatus: true } } } },
        Rating: { select: { score: true, targetType: true, songId: true, albumId: true, MusicSong: { select: { id: true, title: true } }, MusicAlbum: { select: { id: true, name: true } } } },
      },
    }),
    prisma.ratingStats.findMany({ select: { ratingCount: true, ratingScoreTotal: true, averageScore: true, reviewCount: true } }),
  ])
  const mapped: AdminRatingReview[] = reviews.map((review) => {
    const target: RatingTarget = review.Rating.targetType === RatingTargetType.SONG ? 'song' : 'album'
    const targetId = target === 'song' ? review.Rating.songId : review.Rating.albumId
    return {
      id: review.id,
      content: review.content,
      likeCount: review.likeCount,
      createdAt: review.createdAt.toISOString(),
      deletedAt: review.deletedAt?.toISOString() || null,
      score: review.Rating.score,
      target,
      targetId: targetId || '',
      targetTitle: target === 'song' ? review.Rating.MusicSong?.title || '已下架歌曲' : review.Rating.MusicAlbum?.name || '已下架专辑',
      user: { id: review.User.id, uid: review.User.uid, name: getPublicUserDisplayName(review.User) },
    }
  })
  const summary = stats.reduce((result, item) => ({
    ratingCount: result.ratingCount + item.ratingCount,
    ratingScoreTotal: result.ratingScoreTotal + item.ratingScoreTotal,
    averageScore: 0,
    reviewCount: result.reviewCount + item.reviewCount,
  }), { ratingCount: 0, ratingScoreTotal: 0, averageScore: 0, reviewCount: 0 })
  summary.averageScore = summary.ratingCount ? summary.ratingScoreTotal / summary.ratingCount : 0
  return { reviews: mapped, stats: summary }
}

export function ratingSummaryLabel(stats: RatingStatsView) {
  return `${formatAverageScore(stats.averageScore)} · ${stats.ratingCount.toLocaleString('zh-CN')} 人评分`
}
