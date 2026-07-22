import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { ProfileCheckInCalendar, ProfileRecentMessages } from '@/components/ProfileDeferredModules'
import { ProfileHeader, ProfileStatsGrid } from '@/components/ProfileSummary'
import { PublicUserModules } from '@/components/PublicUserModules'
import { getCurrentUser } from '@/lib/auth'
import { calculateCheckinStreaks } from '@/lib/checkin'
import { withDbTimeout } from '@/lib/db-timeout'
import { getGrowthSummary } from '@/lib/growth'
import { publicImageUrl } from '@/lib/images'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'
import { ProfileEditorDrawer } from './ProfileEditorDrawer'

export const dynamic = 'force-dynamic'

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
        where: { id: user.id, isDeleted: false, status: 'ACTIVE', profile: { isNot: null } },
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
          level: true,
          exp: true,
          experience: true,
          points: true,
          consecutiveDays: true,
          createdAt: true,
          profile: true,
          _count: { select: { checkIns: true } },
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
      includeCounts: ['checkIns'],
    }, error)
    throw error
  }

  if (!profile || !profile.profile) redirect('/login')

  const displayName = profile.profile.displayName || profile.nickname
  const avatar = publicImageUrl(profile.profile.avatarUrl || profile.avatarUrl)
  const background = publicImageUrl(profile.profile.backgroundUrl || profile.backgroundUrl)
  const bio = profile.profile.bio || profile.bio || ''
  const [layoutConfig, growth, checkInHistory] = await Promise.all([
    getPublishedPageLayoutConfig('profile'),
    getGrowthSummary(profile.experience || profile.exp || 0),
    prisma.checkIn.findMany({ where: { userId: user.id }, select: { checkinDateKey: true } }),
  ])
  const streaks = calculateCheckinStreaks(checkInHistory.map((item) => item.checkinDateKey))
  const profileEditorInitialProfile = {
    nickname: displayName,
    avatarUrl: avatar || '',
    backgroundUrl: background || '',
    bio,
    email: profile.email || '',
    phone: profile.phone || '',
    emailVerifiedAt: profile.emailVerifiedAt ? profile.emailVerifiedAt.toISOString() : null,
    phoneVerifiedAt: profile.phoneVerifiedAt ? profile.phoneVerifiedAt.toISOString() : null,
    wallVisibility: profile.profile.wallVisibility || 'PUBLIC',
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
    </div>
  )

  return (
    <>
      <ProfileEditorDrawer initialOpen={query?.edit === '1'} initialProfile={profileEditorInitialProfile} hideTrigger />
      <main className="site-page-main flat-page mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-5 sm:py-6">
        <ProfileHeader
          displayName={displayName}
          uid={profile.uid}
          level={profile.level}
          levelName={growth.levelName}
          experience={growth.experience}
          nextRequiredExp={growth.nextRequiredExp}
          progressPercent={growth.progressPercent}
          createdAt={profile.createdAt}
          avatarUrl={avatar}
          backgroundUrl={background}
        />
        <PageLayoutRenderer
          pageKey="profile"
          config={layoutConfig}
          modules={{
            'profile.calendar': <ProfileCheckInCalendar />,
            'profile.recentMessages': <ProfileRecentMessages />,
            'profile.posts': <PublicUserModules uid={formatUid(profile.uid)} isSelf />,
            'profile.main': (
              <section className="overflow-hidden rounded-[24px] border border-sky-100 bg-white/88 shadow-sm">
                  <div className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center sm:px-5">
                    <div>
                      <h2 className="text-lg font-black text-slate-950">个人简介</h2>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{bio || '这个成员还没有填写个人简介。'}</p>
                    </div>
                    {renderProfileActions()}
                  </div>
                  <div className="px-4 pb-4 sm:px-5">
                    <ProfileStatsGrid
                      compact
                      items={[
                        ['等级', `Lv.${profile.level}`],
                        ['积分', profile.points],
                        ['经验', `${growth.experience} XP`],
                        ['连续挂号', `${streaks.currentStreak} 天`],
                        ['累计挂号', `${streaks.totalDays} 天`],
                      ]}
                    />
                  </div>
              </section>
            ),
          }}
        />
      </main>
    </>
  )
}
