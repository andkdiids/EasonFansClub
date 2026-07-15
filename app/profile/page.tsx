import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { ProfileCheckInCalendar, ProfileDeferredModules, ProfileRecentMessages } from '@/components/ProfileDeferredModules'
import { ProfileHeader, ProfileStatsGrid } from '@/components/ProfileSummary'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { withDbTimeout } from '@/lib/db-timeout'
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
  const layoutConfig = await getPublishedPageLayoutConfig('profile')
  const headerUser = { ...user, avatarUrl: avatar || user.avatarUrl || null, nickname: displayName }

  return (
    <>
      <SiteHeader user={headerUser} />
      <main className="mx-auto max-w-[1200px] space-y-4 px-4 py-5 sm:px-5 sm:py-6">
        <ProfileHeader
          displayName={displayName}
          uid={profile.uid}
          level={profile.level}
          createdAt={profile.createdAt}
          avatarUrl={avatar}
          backgroundUrl={background}
        />
        <PageLayoutRenderer
          pageKey="profile"
          config={layoutConfig}
          modules={{
            'profile.intro': (
              <section className="h-full overflow-hidden rounded-[28px] border border-sky-100 bg-white/88 shadow-sm">
                <div className="grid h-full gap-4 px-5 py-5 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div>
                    <h2 className="text-lg font-black text-slate-950">个人简介</h2>
                    <p className="mt-3 text-sm leading-7 text-slate-600">{bio || '这个成员还没有填写个人简介。'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 md:flex-col md:items-stretch">
                    <ProfileEditorDrawer
                      initialOpen={query?.edit === '1'}
                      initialProfile={{
                        nickname: displayName,
                        avatarUrl: avatar || '',
                        backgroundUrl: background || '',
                        bio,
                        email: profile.email || '',
                        phone: profile.phone || '',
                        emailVerifiedAt: profile.emailVerifiedAt ? profile.emailVerifiedAt.toISOString() : null,
                        phoneVerifiedAt: profile.phoneVerifiedAt ? profile.phoneVerifiedAt.toISOString() : null,
                      }}
                    />
                    <Link href={`/user/${formatUid(profile.uid)}`} className="rounded-xl border border-sky-100 bg-brand-950 px-4 py-2.5 text-center text-sm font-black text-white shadow-sm transition hover:bg-brand-800">
                      查看公开主页
                    </Link>
                  </div>
                </div>
              </section>
            ),
            'profile.stats': (
              <section className="h-full overflow-hidden rounded-[28px] border border-sky-100 bg-white/88 p-5 shadow-sm sm:p-6">
                <ProfileStatsGrid
                  items={[
                    ['等级', `Lv.${profile.level}`],
                    ['积分', profile.points],
                    ['经验', profile.exp],
                    ['连续挂号', `${profile.consecutiveDays} 天`],
                    ['累计挂号', `${profile._count.checkIns} 天`],
                  ]}
                />
              </section>
            ),
            'profile.calendar': <ProfileCheckInCalendar />,
            'profile.recentMessages': <ProfileRecentMessages />,
            'profile.main': (
              <section className="space-y-4">
                <section className="overflow-hidden rounded-[28px] border border-sky-100 bg-white/88 shadow-sm">
                  <div className="grid gap-4 px-5 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center sm:px-6">
                    <div>
                      <h2 className="text-lg font-black text-slate-950">个人简介</h2>
                      <p className="mt-3 text-sm leading-7 text-slate-600">{bio || '这个成员还没有填写个人简介。'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 md:flex-col md:items-stretch">
                      <ProfileEditorDrawer
                        initialOpen={query?.edit === '1'}
                        initialProfile={{
                          nickname: displayName,
                          avatarUrl: avatar || '',
                          backgroundUrl: background || '',
                          bio,
                          email: profile.email || '',
                          phone: profile.phone || '',
                          emailVerifiedAt: profile.emailVerifiedAt ? profile.emailVerifiedAt.toISOString() : null,
                          phoneVerifiedAt: profile.phoneVerifiedAt ? profile.phoneVerifiedAt.toISOString() : null,
                        }}
                      />
                      <Link href={`/user/${formatUid(profile.uid)}`} className="rounded-xl border border-sky-100 bg-brand-950 px-4 py-2.5 text-center text-sm font-black text-white shadow-sm transition hover:bg-brand-800">
                        查看公开主页
                      </Link>
                    </div>
                  </div>
                  <div className="px-5 pb-5 sm:px-6">
                    <ProfileStatsGrid
                      items={[
                        ['等级', `Lv.${profile.level}`],
                        ['积分', profile.points],
                        ['经验', profile.exp],
                        ['连续挂号', `${profile.consecutiveDays} 天`],
                        ['累计挂号', `${profile._count.checkIns} 天`],
                      ]}
                    />
                  </div>
                </section>
                <ProfileDeferredModules />
              </section>
            ),
          }}
        />
      </main>
    </>
  )
}
