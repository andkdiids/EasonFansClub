import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { ProfilePageSurface } from '@/components/ProfilePageSurface'
import { getCurrentUser } from '@/lib/auth'
import { ensureBirthdayBadge } from '@/lib/birthday'
import { getGrowthSummarySafe } from '@/lib/growth'
import { profileImageUrl } from '@/lib/images'
import { loadProfileRecentMessagesPage } from '@/lib/profile-page'
import { prisma } from '@/lib/prisma'
import { getDefaultAvatarOptions } from '@/lib/default-avatars'
import { locationFromProfile } from '@/lib/user-location'
import { resolveIpLocation, updateUserIpRegion } from '@/lib/ip-region'
import { getBadgeProfileSummary, getEquippedBadgeForUser } from '@/lib/badge-service'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { ProfileEditorDrawer } from './ProfileEditorDrawer'

export const dynamic = 'force-dynamic'

export const metadata = { title: '个人主页' }

type ProfilePageProps = {
  searchParams?: Promise<{ edit?: string }>
}

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const query = await searchParams
  const requestHeaders = await headers()
  const request = new Request('http://profile.internal/current', { headers: new Headers(requestHeaders) })
  const ipLocation = await resolveIpLocation(request)
  const resolvedIpRegion = await updateUserIpRegion(user.id, ipLocation)

  const profile = await prisma.user.findFirst({
    where: { id: user.id, isDeleted: false, status: 'ACTIVE', Profile: { isNot: null } },
    select: {
      id: true,
      uid: true,
      nickname: true,
      usernameModerationStatus: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      bioModerationStatus: true,
      avatarUrl: true,
      backgroundUrl: true,
      bio: true,
      ipRegion: true,
      email: true,
      phone: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      birthMonth: true,
      birthDay: true,
      birthdaySetAt: true,
      birthdayPublic: true,
      showBadgeActivity: true,
      experience: true,
      createdAt: true,
      Profile: true,
    },
  })

  if (!profile || !profile.Profile) redirect('/login')

  await ensureBirthdayBadge(user.id).catch((error) => {
    console.error('[profile.ensureBirthdayBadge]', error)
  })

  const displayName = getPublicUserDisplayName(profile)
  const avatar = profileImageUrl(profile.Profile.avatarUrl || profile.avatarUrl)
  const background = profileImageUrl(profile.Profile.backgroundUrl || profile.backgroundUrl)
  const bio = profile.Profile.bio || profile.bio || ''
  const [growth, recentMessagesPage, defaultAvatarOptions, equippedBadge, badgeSummary] = await Promise.all([
    getGrowthSummarySafe(profile.experience),
    loadProfileRecentMessagesPage(profile.id, user.id),
    getDefaultAvatarOptions(),
    getEquippedBadgeForUser(profile.id),
    getBadgeProfileSummary(profile.id, user.id),
  ])

  const profileEditorInitialProfile = {
    nickname: profile.nickname,
    nicknameViolation: profile.nicknameModerationStatus === 'VIOLATION' || profile.Profile.displayNameModerationStatus === 'VIOLATION',
    avatarUrl: avatar || '',
    defaultAvatarOptions,
    backgroundUrl: background || '',
    bio,
    bioViolation: profile.bioModerationStatus === 'VIOLATION' || profile.Profile.bioModerationStatus === 'VIOLATION',
    location: locationFromProfile(profile.Profile),
    email: profile.email || '',
    phone: profile.phone || '',
    emailVerifiedAt: profile.emailVerifiedAt ? profile.emailVerifiedAt.toISOString() : null,
    phoneVerifiedAt: profile.phoneVerifiedAt ? profile.phoneVerifiedAt.toISOString() : null,
    birthMonth: profile.birthMonth,
    birthDay: profile.birthDay,
    birthdaySetAt: profile.birthdaySetAt ? profile.birthdaySetAt.toISOString() : null,
    birthdayPublic: profile.birthdayPublic,
    showBadgeActivity: profile.showBadgeActivity,
    wallVisibility: profile.Profile.wallVisibility || 'PUBLIC',
  }

  return (
    <>
      <ProfileEditorDrawer initialOpen={query?.edit === '1'} initialProfile={profileEditorInitialProfile} hideTrigger />
      <ProfilePageSurface
        profile={{
          id: profile.id,
          uid: profile.uid,
          displayName,
          baseDisplayName: displayName,
          bio,
          location: locationFromProfile(profile.Profile),
          ipRegion: resolvedIpRegion,
          avatarUrl: avatar,
          backgroundUrl: background,
          createdAt: profile.createdAt,
          wallVisibility: profile.Profile.wallVisibility || 'PUBLIC',
          publicLiveCount: 0,
          equippedBadge,
          badgeSummary,
        }}
        growth={growth}
        relationship={{
          isSelf: true,
          isFriend: false,
          isBlocked: false,
          isFollowed: false,
          hasViewer: true,
          friendStatus: 'NONE',
          initialRemark: null,
        }}
        recentMessages={recentMessagesPage.messages}
        recentMessagesPagination={recentMessagesPage.pagination}
      />
    </>
  )
}
