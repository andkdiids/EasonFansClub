import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { ProfileRecentMessages } from '@/components/ProfileDeferredModules'
import { ProfileHeader } from '@/components/ProfileSummary'
import { PublicUserModules } from '@/components/PublicUserModules'
import { getCurrentUser } from '@/lib/auth'
import { ensureBirthdayBadge } from '@/lib/birthday'
import { withDbTimeout } from '@/lib/db-timeout'
import { profileImageUrl } from '@/lib/images'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'
import { ProfileEditorDrawer } from './ProfileEditorDrawer'
import ProfileAchievementPreview from '@/components/achievements/ProfileAchievementPreview'
import { getGrowthSummarySafe } from '@/lib/growth'

export const dynamic = 'force-dynamic'

export const metadata = { title: '个人病历' }

type ProfilePageProps = {
  searchParams?: Promise<{ edit?: string }>
}

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const query = await searchParams

  let profile
  try {
    profile = await withDbTimeout(
      'User.findFirst profile.user',
      prisma.user.findFirst({
        where: { id: user.id, isDeleted: false, status: 'ACTIVE', Profile: { isNot: null } },
        select: {
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
      }),
      3000,
    )
  } catch (error) {
    console.error('[profile] prisma query failed', {
      model: 'User',
      query: 'findFirst',
      feature: 'profile.user',
      where: ['id=sessionUser.id', 'isDeleted=false', 'status=ACTIVE', 'profile is not null'],
    }, error)
    throw error
  }

  if (!profile || !profile.Profile) redirect('/login')

  // 访问本人资料时，若今天为生日则自动授予「生日纪念」徽章（幂等，失败不影响页面）。
  await ensureBirthdayBadge(user.id).catch((error) => {
    console.error('[profile.ensureBirthdayBadge]', error)
  })

  const displayName = profile.Profile.displayName || profile.nickname
  const avatar = profileImageUrl(profile.Profile.avatarUrl || profile.avatarUrl)
  
  const background = profileImageUrl(profile.Profile.backgroundUrl || profile.backgroundUrl)
  const bio = profile.Profile.bio || profile.bio || ''
  const growth = await getGrowthSummarySafe(profile.experience)
  const layoutConfig = await getPublishedPageLayoutConfig('profile')
  const achievements = await prisma.userAchievement.findMany({
  where: {
    userId: user.id,
    Achievement: {
      isVisible: true,
    },
  },
  include: {
    Achievement: true,
  },
  orderBy: [
    { unlockedAt: 'desc' },
    { createdAt: 'desc' },
  ],
  take: 200,
})
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
  const renderProfileActions = () => (
    <div className="flex flex-wrap items-center gap-3 md:justify-end">
      <Link href="/profile?edit=1" scroll={false} className="inline-flex h-11 items-center justify-center rounded-xl border border-brand-900 bg-brand-950 px-5 text-sm font-black text-white shadow-sm transition hover:bg-brand-800">
        编辑资料
      </Link>
      <Link href={`/user/${formatUid(profile.uid)}`} className="inline-flex h-11 items-center justify-center rounded-xl border border-sky-100 bg-white px-5 text-sm font-black text-brand-800 shadow-sm transition hover:bg-sky-50">
        查看公开主页
      </Link>
      <Link href={`/user/${formatUid(profile.uid)}/wall`} className="inline-flex h-11 items-center justify-center rounded-xl border border-sky-100 bg-white px-5 text-sm font-black text-brand-800 shadow-sm transition hover:bg-sky-50">
        去留言
      </Link>
      <Link href="/music/live/me" className="inline-flex h-11 items-center justify-center rounded-xl border border-brand-900 bg-brand-950 px-5 text-sm font-black text-white shadow-sm transition hover:bg-brand-800">
        我的现场
      </Link>
      <Link href="/profile/stickers" className="inline-flex h-11 items-center justify-center rounded-xl border border-sky-100 bg-white px-5 text-sm font-black text-brand-800 shadow-sm transition hover:bg-sky-50">
        我的表情包
      </Link>
    </div>
  )

  return (
    <>
      <ProfileEditorDrawer initialOpen={query?.edit === '1'} initialProfile={profileEditorInitialProfile} hideTrigger />
      <main className="site-page-main flat-page mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-5 sm:py-6">
        <header className="rounded-sm border border-sky-100 bg-white/88 px-4 py-5 sm:px-5">
          <h1 className="text-2xl font-black text-brand-950">个人病历</h1>
          <p className="mt-1 text-sm font-bold text-slate-500">记录你在 E院的成长轨迹</p>
        </header>
        <ProfileHeader
          displayName={displayName}
          uid={profile.uid}
          level={growth.level}
          levelName={growth.levelName}
          createdAt={profile.createdAt}
          avatarUrl={avatar}
          backgroundUrl={background}
          showGrowth={false}
        />
        <PageLayoutRenderer
          pageKey="profile"
          config={layoutConfig}
          modules={{
           'profile.achievements': (
  <ProfileAchievementPreview records={achievements.map(({ Achievement, ...record }) => ({ ...record, achievement: Achievement }))} />
),
            'profile.recentMessages': (
  <section className="rounded-sm border border-sky-100 bg-white/88">
    <ProfileRecentMessages />
  </section>
),

'profile.posts': (
  <section className="rounded-sm border border-sky-100 bg-white/88">
    <PublicUserModules uid={formatUid(profile.uid)} isSelf />
  </section>
),
            'profile.main': (
              <section className="overflow-hidden rounded-[24px] border border-sky-100 bg-white/88 shadow-sm">
                  <div className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center sm:px-5">
                    <div>
                      <h2 className="text-lg font-black text-slate-950">个人简介</h2>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{bio || '这个成员还没有填写个人简介。'}</p>
                    </div>
                    {renderProfileActions()}
                  </div>
              </section>
            ),
          }}
        />
      </main>
    </>
  )
}
