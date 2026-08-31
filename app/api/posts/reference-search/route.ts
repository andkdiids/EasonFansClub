import { NextResponse } from 'next/server'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicModerationText } from '@/lib/content-moderation'
import { prisma } from '@/lib/prisma'
import { publicPostWhere } from '@/lib/post-moderation'
import { enforceApiRateLimit, requireUser, sanitizeText } from '@/lib/security'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/posts/reference-search',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited

  const query = sanitizeText(new URL(request.url).searchParams.get('q'), 100).trim()
  if (!query) return NextResponse.json({ posts: [] }, { headers: privateHeaders })

  const numericUid = /^\d+$/u.test(query) ? Number(query) : null
  const posts = await prisma.post.findMany({
    where: {
      ...publicPostWhere,
      User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
      Board: { isActive: true },
      OR: [
        { title: { contains: query } },
        { User: { nickname: { contains: query } } },
        { User: { Profile: { displayName: { contains: query } } } },
        ...(numericUid !== null && Number.isSafeInteger(numericUid) ? [{ User: { uid: numericUid } }] : []),
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 15,
    select: {
      id: true,
      title: true,
      moderationStatus: true,
      createdAt: true,
      User: {
        select: {
          uid: true,
          nickname: true,
          nicknameModerationStatus: true,
          nicknameViolationDisplay: true,
          Profile: { select: { displayName: true, displayNameModerationStatus: true } },
        },
      },
      Board: { select: { name: true } },
    },
  })

  return NextResponse.json({
    posts: posts.map((post) => ({
      id: post.id,
      title: publicModerationText(post.title, post.moderationStatus),
      authorName: getPublicUserDisplayName(post.User),
      authorUid: post.User.uid,
      boardName: post.Board.name,
      createdAt: post.createdAt.toISOString(),
    })),
  }, { headers: privateHeaders })
}
