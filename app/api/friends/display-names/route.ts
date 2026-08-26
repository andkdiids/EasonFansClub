import { NextResponse } from 'next/server'
import { getFriendDisplayName, getPublicUserDisplayName, loadFriendRemarkMap } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, requireUser } from '@/lib/security'
import { activeUserWhere } from '@/lib/friends'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/friends/display-names',
    ip: { limit: 240, windowSeconds: 60 },
    user: { limit: 120, windowSeconds: 60 },
  })
  if (limited) return limited

  const ids = [...new Set((new URL(request.url).searchParams.get('ids') || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean))].slice(0, 50)
  if (!ids.length) return NextResponse.json({ friends: [] }, { headers: privateHeaders })

  // This endpoint returns only private friend-context overrides.  The room
  // protocol continues to carry public nicknames; the duel client applies
  // these results locally for the current viewer.
  const remarkMap = await loadFriendRemarkMap(guard.user.id, ids)
  if (!remarkMap.size) return NextResponse.json({ friends: [] }, { headers: privateHeaders })

  const users = await prisma.user.findMany({
    where: { ...activeUserWhere, id: { in: [...remarkMap.keys()] } },
    select: {
      id: true,
      nickname: true,
      usernameModerationStatus: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      avatarUrl: true,
      Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
    },
  })

  return NextResponse.json({
    friends: users.map((user) => {
      const nickname = getPublicUserDisplayName(user)
      const friendRemark = remarkMap.get(user.id) || null
      return {
        id: user.id,
        nickname,
        friendRemark,
        displayName: getFriendDisplayName({ nickname, friendRemark, isFriendContext: true }),
        avatarUrl: publicImageUrl(user.Profile?.avatarUrl || user.avatarUrl),
      }
    }),
  }, { headers: privateHeaders })
}
