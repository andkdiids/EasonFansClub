import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/security'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const keyword = sanitizeText(searchParams.get('q'), 60)
  const numericUid = /^\d+$/.test(keyword) ? Number(keyword) : null

  if (!keyword) {
    const hotKeywords = await prisma.searchKeyword.findMany({
      orderBy: [{ count: 'desc' }, { lastUsedAt: 'desc' }],
      take: 10,
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

  const user = await getCurrentUser()
  await prisma.searchKeyword.upsert({
    where: { keyword },
    update: { count: { increment: 1 }, lastUsedAt: new Date() },
    create: { keyword },
  })

  if (user) {
    await prisma.searchHistory.create({ data: { userId: user.id, keyword } })
  }

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
          { username: { contains: keyword } },
          { Profile: { displayName: { contains: keyword } } },
        ],
      },
      select: {
        id: true, uid: true, nickname: true, avatarUrl: true, experience: true, createdAt: true, lastActiveAt: true,
        Profile: { select: { displayName: true, avatarUrl: true, bio: true } },
        _count: { select: { Post: { where: { isDeleted: false, status: 'PUBLISHED', moderationStatus: 'APPROVED' } } } },
        Post: { where: { isDeleted: false, status: 'PUBLISHED', moderationStatus: 'APPROVED' }, orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, title: true, createdAt: true } },
      },
      take: 10,
    }),
    prisma.post.findMany({
      where: {
        isDeleted: false,
        status: 'PUBLISHED',
        moderationStatus: 'APPROVED',
        OR: [
          { title: { contains: keyword } },
          { content: { contains: keyword } },
        ],
      },
      include: {
        User: { select: { id: true, nickname: true, level: true, Profile: { select: { displayName: true } } } },
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
        ],
      },
      take: 10,
    }),
    prisma.tag.findMany({
      where: { name: { contains: keyword } },
      orderBy: { usageCount: 'desc' },
      take: 10,
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

  const remarkMap = await loadFriendRemarkMap(user?.id, [
    ...users.map((item) => item.id),
    ...posts.map((item) => item.User.id),
  ])

  return NextResponse.json({
    users: users.map(({ Profile, Post, _count, ...item }) => ({
      ...item,
      profile: Profile ? {
        ...Profile,
        displayName: resolveFriendDisplayName({
          viewerId: user?.id,
          targetUserId: item.id,
          fallbackName: getPublicUserDisplayName({ ...item, Profile }),
          remarkMap,
        }),
      } : Profile,
      posts: Post,
      _count: { posts: _count.Post },
    })),
    posts: posts.map(({ User, Board, ...post }) => ({
      ...post,
      author: {
        ...User,
        Profile: User.Profile ? {
          ...User.Profile,
          displayName: resolveFriendDisplayName({
            viewerId: user?.id,
            targetUserId: User.id,
            fallbackName: getPublicUserDisplayName(User),
            remarkMap,
          }),
        } : User.Profile,
      },
      board: Board,
    })),
    boards,
    tags,
    albums,
    songs: songs.map(({ MusicAlbum, ...song }) => ({
      ...song,
      coverUrl: song.coverUrl || MusicAlbum.coverUrl,
      album: MusicAlbum,
      hasPreview: Boolean(song.previewUrl),
      previewUrl: undefined,
    })),
  }, { headers: user ? { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } : { Vary: 'Cookie' } })
}
