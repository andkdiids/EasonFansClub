import { redirect } from 'next/navigation'
import { ProfilePageSurface } from '@/components/ProfilePageSurface'
import { getCurrentUser } from '@/lib/auth'
import { ensureBirthdayBadge } from '@/lib/birthday'
import { getGrowthSummarySafe } from '@/lib/growth'
import { profileImageUrl } from '@/lib/images'
import { loadProfileRecentMessages } from '@/lib/profile-page'
import { prisma } from '@/lib/prisma'
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

  const profile = await prisma.user.findFirst({
    where: { id: user.id, isDeleted: false, status: 'ACTIVE', Profile: { isNot: null } },
    select: {
      id: true,
      uid: true,
      nickname: true,
      avatarUrl: true,
      backgroundUrl: true,
      bio: true,
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
  const [growth, recentMessages] = await Promise.all([
    getGrowthSummarySafe(profile.experience),
    loadProfileRecentMessages(profile.id, user.id),
  ])

  const profileEditorInitialProfile = {
    nickname: displayName,
    avatarUrl: avatar || '',
    backgroundUrl: background || '',
    bio,
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
          hasViewer: true,
          friendStatus: 'NONE',
          initialRemark: null,
        }}
        recentMessages={recentMessages}
      />
    </>
  )
}
