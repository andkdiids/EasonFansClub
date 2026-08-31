import { NextResponse } from 'next/server'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { parseMentionSearchQuery, MENTION_SEARCH_RESULT_LIMIT } from '@/lib/mention-search'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, requireUser, sanitizeText } from '@/lib/security'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/users/mention-search',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited

  const parsed = parseMentionSearchQuery(sanitizeText(new URL(request.url).searchParams.get('q'), 80))
  if (parsed.mode === 'none') return NextResponse.json({ users: [] }, { headers: privateHeaders })

  const users = await prisma.user.findMany({
    where: parsed.mode === 'uid'
      ? { uid: parsed.uid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } }
      : {
          status: 'ACTIVE',
          isDeleted: false,
          Profile: { isNot: null },
          OR: [
            { nickname: { contains: parsed.query } },
            { Profile: { displayName: { contains: parsed.query } } },
          ],
        },
    orderBy: { uid: 'asc' },
    take: MENTION_SEARCH_RESULT_LIMIT,
    select: {
      id: true,
      uid: true,
      nickname: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      avatarUrl: true,
      Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
    },
  })

  return NextResponse.json({
    users: users.map((user) => ({
      id: user.id,
      uid: user.uid,
      displayName: getPublicUserDisplayName(user),
      avatarUrl: publicImageUrl(user.Profile?.avatarUrl || user.avatarUrl),
    })),
  }, { headers: privateHeaders })
}
