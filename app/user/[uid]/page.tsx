import { notFound } from 'next/navigation'
import { ProfilePageSurface } from '@/components/ProfilePageSurface'
import { FriendRemarkEditor } from '@/components/FriendRemarkEditor'
import { getCurrentUser } from '@/lib/auth'
import { getGrowthSummarySafe } from '@/lib/growth'
import { profileImageUrl } from '@/lib/images'
import { loadProfileRecentMessages } from '@/lib/profile-page'
import { normalizeFriendPair } from '@/lib/friends'
import { prisma } from '@/lib/prisma'
import { parseUidParam } from '@/lib/uid'
import { withDbTimeout } from '@/lib/db-timeout'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ uid: string }> }

export default async function PublicUserPage({ params }: PageProps) {
  const { uid } = await params
  const numericUid = parseUidParam(uid)
  if (numericUid === null || numericUid <= 0) notFound()

  const viewer = await getCurrentUser()
  const user = await withDbTimeout('User.findFirst publicUser.profile', prisma.user.findFirst({
    where: {
      uid: numericUid,
      status: 'ACTIVE',
      isDeleted: false,
      Profile: { isNot: null },
    },
    select: {
      id: true,
      uid: true,
      nickname: true,
      experience: true,
      avatarUrl: true,
      backgroundUrl: true,
      bio: true,
      createdAt: true,
      Profile: true,
      _count: {
        select: {
          UserMusicConcert: {
            where: {
              isPublic: true,
              MusicConcert: { status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } },
            },
          },
        },
      },
    },
  }), 3500)

  if (!user || !user.Profile) notFound()

  const isSelf = viewer?.id === user.id
  let isFriend = false
  let isBlocked = false
  let pendingRequest: { senderId: string; receiverId: string } | null = null
  let initialRemark: string | null = null

  if (viewer && !isSelf) {
    try {
      const [userAId, userBId] = normalizeFriendPair(viewer.id, user.id)
      const [friendshipResult, pendingResult, blockResult] = await Promise.all([
        withDbTimeout('Friendship.findUnique publicUser.friendship', prisma.friendship.findUnique({
          where: { userAId_userBId: { userAId, userBId } },
          select: { id: true },
        }), 2500),
        withDbTimeout('FriendRequest.findFirst publicUser.pendingRequest', prisma.friendRequest.findFirst({
          where: {
            status: 'PENDING',
            OR: [
              { senderId: viewer.id, receiverId: user.id },
              { senderId: user.id, receiverId: viewer.id },
            ],
          },
          select: { senderId: true, receiverId: true },
        }), 2500),
        withDbTimeout('Block.findFirst publicUser.block', prisma.block.findFirst({
          where: {
            OR: [
              { blockerId: viewer.id, blockedId: user.id },
              { blockerId: user.id, blockedId: viewer.id },
            ],
          },
          select: { id: true },
        }), 2500),
      ])

      isFriend = Boolean(friendshipResult)
      pendingRequest = pendingResult
      isBlocked = Boolean(blockResult)

      if (isFriend && !isBlocked) {
        const remark = await withDbTimeout('FriendRemark.findUnique publicUser.remark', prisma.friendRemark.findUnique({
          where: { ownerId_friendId: { ownerId: viewer.id, friendId: user.id } },
          select: { remark: true },
        }), 2500)
        initialRemark = remark?.remark || null
      }
    } catch (error) {
      console.error('[public-user:ssr] relationship-query:failed', error)
      isFriend = false
      pendingRequest = null
      isBlocked = false
      initialRemark = null
    }
  }

  const name = user.Profile.displayName || user.nickname
  const baseDisplayName = name
  const displayName = baseDisplayName
  const avatar = profileImageUrl(user.Profile.avatarUrl || user.avatarUrl)
  const background = profileImageUrl(user.Profile.backgroundUrl || user.backgroundUrl)
  const bio = user.Profile.bio || user.bio || ''
  const [growth, recentMessages] = await Promise.all([
    getGrowthSummarySafe(user.experience),
    loadProfileRecentMessages(user.id, viewer?.id),
  ])
  const friendStatus: 'NONE' | 'PENDING' | 'FRIEND' | 'RECEIVED' = isFriend
    ? 'FRIEND'
    : pendingRequest?.senderId === viewer?.id
      ? 'PENDING'
      : pendingRequest
        ? 'RECEIVED'
        : 'NONE'
  const remarkEditor = viewer && isFriend && !isBlocked
    ? <FriendRemarkEditor targetUserId={user.id} initialRemark={initialRemark} baseDisplayName={baseDisplayName} />
    : null

  return (
    <ProfilePageSurface
      profile={{
        id: user.id,
        uid: user.uid,
        displayName,
        baseDisplayName,
        bio,
        avatarUrl: avatar,
        backgroundUrl: background,
        createdAt: user.createdAt,
        wallVisibility: user.Profile.wallVisibility || 'PUBLIC',
        publicLiveCount: user._count.UserMusicConcert,
      }}
      growth={growth}
      relationship={{
        isSelf,
        isFriend,
        isBlocked,
        hasViewer: Boolean(viewer),
        friendStatus,
        initialRemark,
      }}
      recentMessages={recentMessages}
      remarkEditor={remarkEditor}
    />
  )
}
