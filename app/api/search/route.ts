import { NextResponse } from 'next/server'
import { DAILY_CHAT_BOARD_SLUG, DAILY_CHAT_DISPLAY_NAME, DAILY_CHAT_LEGACY_NAME, normalizeForumBoards, withForumBoardDisplayName } from '@/lib/boards'
import { toPublicMediaUrl } from '@/lib/media-url'
import { getCurrentUser } from '@/lib/auth'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, sanitizeText } from '@/lib/security'
import { publicModerationText } from '@/lib/content-moderation'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import { summarizePlainText } from '@/lib/share-metadata'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const keyword = sanitizeText(searchParams.get('q'), 60)
  const numericUid = /^\d+$/.test(keyword) ? Number(keyword) : null
  const user = await getCurrentUser()

  const limited = await enforceApiRateLimit(request, user?.id, {
    endpoint: '/api/search',
    ip: { limit: 60, windowSeconds: 60 },
    user: { limit: 30, windowSeconds: 60 },
  }, '搜索请求过于频繁，请稍后再试')
  if (limited) return limited

  if (!keyword) {
    const hotKeywords = await prisma.searchKeyword.findMany({
      orderBy: [{ count: 'desc' }, { lastUsedAt: 'desc' }],
      take: 10,
      select: { keyword: true, count: true },
    })
    return NextResponse.json({
      users: [],
      posts: [],
      boards: [],
      tags: [],
      albums: [],
      songs: [],
      hotKeywords,
    })
  }

  if (keyword.length < 2) {
    return NextResponse.json(
      { ok: false, code: 'SEARCH_KEYWORD_TOO_SHORT', message: '搜索关键词至少需要 2 个字符' },
      { status: 400 },
    )
  }

  await prisma.searchKeyword.upsert({
    where: { keyword },
    update: { count: { increment: 1 }, lastUsedAt: new Date() },
    create: { keyword },
  })

  if (user) {
    await prisma.searchHistory.create({ data: { userId: user.id, keyword } })
  }

  const matchesDailyChatAlias = keyword.includes(DAILY_CHAT_DISPLAY_NAME)
    || keyword.includes(DAILY_CHAT_LEGACY_NAME)
    || DAILY_CHAT_LEGACY_NAME.includes(keyword)

  const [users, posts, boards, tags, albums, songs] = await Promise.all([
    prisma.user.findMany({
      where: {
        uid: { gt: 0 },
        isDeleted: false,
        status: 'ACTIVE',
        Profile: { isNot: null },
        OR: [
          ...(Number.isSafeInteger(numericUid) && Number(numericUid) > 0 ? [{ uid: Number(numericUid) }] : []),
          { nickname: { contains: keyword } },
          { Profile: { displayName: { contains: keyword } } },
        ],
      },
      select: {
        id: true, uid: true, nickname: true, usernameModerationStatus: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, avatarUrl: true,
        Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true, bio: true, bioModerationStatus: true } },
        _count: { select: { Post: { where: { isDeleted: false, status: 'PUBLISHED', moderationStatus: { in: ['APPROVED', 'VIOLATION'] } } } } },
        Post: { where: { isDeleted: false, status: 'PUBLISHED', moderationStatus: { in: ['APPROVED', 'VIOLATION'] } }, orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, title: true, moderationStatus: true, createdAt: true } },
      },
      take: 10,
    }),
    prisma.post.findMany({
      where: {
        isDeleted: false,
        status: 'PUBLISHED',
        moderationStatus: { in: ['APPROVED', 'VIOLATION'] },
        OR: [
          { title: { contains: keyword } },
          { content: { contains: keyword } },
        ],
      },
      select: {
        id: true,
        title: true,
        content: true,
        ipRegion: true,
        viewCount: true,
        likeCount: true,
        replyCount: true,
        isPinned: true,
        isFeatured: true,
        createdAt: true,
        updatedAt: true,
        contentType: true,
        favoriteCount: true,
        isLocked: true,
        isRecommended: true,
        publishedAt: true,
        shareCount: true,
        moderationStatus: true,
        summary: true,
        User: { select: { id: true, uid: true, nickname: true, usernameModerationStatus: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, avatarUrl: true, Profile: { select: { displayName: true, avatarUrl: true } } } },
        Board: { select: { name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.board.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: keyword } },
          { description: { contains: keyword } },
          ...(matchesDailyChatAlias ? [{ slug: DAILY_CHAT_BOARD_SLUG }] : []),
        ],
      },
      take: 10,
      select: { name: true, slug: true, description: true, postCount: true, coverUrl: true, followerCount: true, isHot: true, isRecommended: true },
    }),
    prisma.tag.findMany({
      where: { name: { contains: keyword } },
      orderBy: { usageCount: 'desc' },
      take: 10,
      select: { name: true, slug: true, usageCount: true },
    }),
    prisma.musicAlbum.findMany({
      where: {
        status: 'PUBLISHED',
        OR: [
          { name: { contains: keyword } },
          { artist: { contains: keyword } },
        ],
      },
      select: {
        id: true,
        name: true,
        artist: true,
        releaseYear: true,
        coverUrl: true,
      },
      orderBy: [{ displayOrder: 'asc' }, { releaseYear: 'desc' }],
      take: 10,
    }),
    prisma.musicSong.findMany({
      where: {
        MusicAlbum: { status: 'PUBLISHED' },
        OR: [
          { title: { contains: keyword } },
          { artist: { contains: keyword } },
          { lyrics: { contains: keyword } },
          { lyricist: { contains: keyword } },
          { composer: { contains: keyword } },
          { MusicAlbum: { name: { contains: keyword } } },
        ],
      },
      select: {
        id: true,
        title: true,
        artist: true,
        coverUrl: true,
        previewUrl: true,
        MusicAlbum: {
          select: { id: true, name: true, coverUrl: true },
        },
      },
      take: 16,
    }),
  ])

  const equippedBadgeMap = await getEquippedBadgesForUsers([
    ...users.map((item) => item.id),
    ...posts.map((item) => item.User.id),
  ])

  return NextResponse.json({
    users: users.map(({ Profile, Post, _count, ...item }) => ({
      uid: item.uid,
      nickname: getPublicUserDisplayName({ ...item, Profile }),
      equippedBadge: equippedBadgeMap.get(item.id) || null,
      avatarUrl: toPublicMediaUrl(item.avatarUrl),
      profile: Profile ? {
        displayName: getPublicUserDisplayName({ ...item, Profile }),
        avatarUrl: toPublicMediaUrl(Profile.avatarUrl),
        bio: publicModerationText(Profile.bio, Profile.bioModerationStatus),
      } : Profile,
      posts: Post.map((post) => ({ ...post, title: publicModerationText(post.title, post.moderationStatus) })),
      _count: { posts: _count.Post },
    })),
    posts: posts.map(({ User, Board, ...post }) => ({
      id: post.id,
      title: publicModerationText(post.title, post.moderationStatus),
      content: summarizePlainText(post.summary || post.content),
      ipRegion: post.ipRegion,
      viewCount: post.viewCount,
      likeCount: post.likeCount,
      replyCount: post.replyCount,
      isPinned: post.isPinned,
      isFeatured: post.isFeatured,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      contentType: post.contentType,
      favoriteCount: post.favoriteCount,
      isLocked: post.isLocked,
      isRecommended: post.isRecommended,
      publishedAt: post.publishedAt,
      shareCount: post.shareCount,
      summary: summarizePlainText(post.summary || post.content),
      author: {
        uid: User.uid,
        nickname: getPublicUserDisplayName(User),
        equippedBadge: equippedBadgeMap.get(User.id) || null,
        avatarUrl: toPublicMediaUrl(User.avatarUrl),
        Profile: User.Profile ? {
          displayName: getPublicUserDisplayName(User),
          avatarUrl: toPublicMediaUrl(User.Profile.avatarUrl),
        } : User.Profile,
      },
      board: withForumBoardDisplayName(Board),
    })),
    boards: normalizeForumBoards(boards),
    tags,
    albums: albums.map((album) => ({ ...album, coverUrl: toPublicMediaUrl(album.coverUrl) })),
    songs: songs.map(({ MusicAlbum, ...song }) => {
      const publicPreviewUrl = toPublicMediaUrl(song.previewUrl)
      return {
        ...song,
        coverUrl: toPublicMediaUrl(song.coverUrl || MusicAlbum.coverUrl),
        album: { ...MusicAlbum, coverUrl: toPublicMediaUrl(MusicAlbum.coverUrl) },
        hasPreview: Boolean(publicPreviewUrl),
        previewUrl: undefined,
      }
    }),
  }, { headers: user ? { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } : { Vary: 'Cookie' } })
}
