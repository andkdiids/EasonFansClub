import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { ProfilePageSurface } from '@/components/ProfilePageSurface'
import { getCurrentUser } from '@/lib/auth'
import { ensureBirthdayBadge } from '@/lib/birthday'
import { getGrowthSummarySafe } from '@/lib/growth'
import { profileImageUrl } from '@/lib/images'
import { loadProfileRecentMessagesPage } from '@/lib/profile-page'
import { prisma } from '@/lib/prisma'
import { getUsernameChangeAvailability } from '@/lib/username-change'
import { getDefaultAvatarOptions } from '@/lib/default-avatars'
import { locationFromProfile } from '@/lib/user-location'
import { updateUserIpRegion } from '@/lib/ip-region'
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
  const resolvedIpRegion = await updateUserIpRegion(
    user.id,
    new Request('http://profile.internal/current', { headers: new Headers(requestHeaders) }),
  )

  const profile = await prisma.user.findFirst({
    where: { id: user.id, isDeleted: false, status: 'ACTIVE', Profile: { isNot: null } },
    select: {
      id: true,
      uid: true,
      username: true,
      usernameChangedAt: true,
      nickname: true,
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
      experience: true,
      createdAt: true,
      Profile: true,
    },
  })

  if (!profile || !profile.Profile) redirect('/login')

  await ensureBirthdayBadge(user.id).catch((error) => {
    console.error('[profile.ensureBirthdayBadge]', error)
  })

  const displayName = profile.Profile.displayName || profile.nickname
  const avatar = profileImageUrl(profile.Profile.avatarUrl || profile.avatarUrl)
  const background = profileImageUrl(profile.Profile.backgroundUrl || profile.backgroundUrl)
  const bio = profile.Profile.bio || profile.bio || ''
  const usernameChange = getUsernameChangeAvailability(profile.usernameChangedAt)
  const [growth, recentMessagesPage, defaultAvatarOptions] = await Promise.all([
    getGrowthSummarySafe(profile.experience),
    loadProfileRecentMessagesPage(profile.id, user.id),
    getDefaultAvatarOptions(),
  ])

  const profileEditorInitialProfile = {
    username: profile.username,
    usernameChange: {
      lastChangedAt: usernameChange.lastChangedAt ? usernameChange.lastChangedAt.toISOString() : null,
      nextAllowedAt: usernameChange.nextAllowedAt ? usernameChange.nextAllowedAt.toISOString() : null,
      canChange: usernameChange.canChange,
    },
    nickname: displayName,
    avatarUrl: avatar || '',
    defaultAvatarOptions,
    backgroundUrl: background || '',
    bio,
    location: locationFromProfile(profile.Profile),
    email: profile.email || '',
    phone: profile.phone || '',
    emailVerifiedAt: profile.emailVerifiedAt ? profile.emailVerifiedAt.toISOString() : null,
    phoneVerifiedAt: profile.phoneVerifiedAt ? profile.phoneVerifiedAt.toISOString() : null,
    birthMonth: profile.birthMonth,
    birthDay: profile.birthDay,
    birthdaySetAt: profile.birthdaySetAt ? profile.birthdaySetAt.toISOString() : null,
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
          ipRegion: resolvedIpRegion || profile.ipRegion,
          avatarUrl: avatar,
          backgroundUrl: background,
          createdAt: profile.createdAt,
          wallVisibility: profile.Profile.wallVisibility || 'PUBLIC',
          publicLiveCount: 0,
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
