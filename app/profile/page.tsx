import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ProfileDeferredModules } from '@/components/ProfileDeferredModules'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { formatDate } from '@/lib/format'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'
import { ProfileSettingsForm } from './ProfileSettingsForm'

export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const profile = await prisma.user.findFirst({
    where: { id: user.id, isDeleted: false, status: 'ACTIVE', profile: { isNot: null } },
    select: {
      uid: true,
      nickname: true,
      avatarUrl: true,
      backgroundUrl: true,
      bio: true,
      email: true,
      phone: true,
      level: true,
      exp: true,
      points: true,
      consecutiveDays: true,
      createdAt: true,
      profile: true,
      _count: { select: { checkIns: true } },
    },
  })

  if (!profile || !profile.profile) redirect('/login')

  const displayName = profile.profile.displayName || profile.nickname
  const avatar = publicImageUrl(profile.profile.avatarUrl || profile.avatarUrl)
  const background = publicImageUrl(profile.profile.backgroundUrl || profile.backgroundUrl)
  const bio = profile.profile.bio || profile.bio || ''
  const initial = displayName.slice(0, 1).toUpperCase()

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl space-y-6 px-5 py-8">
        <section className="overflow-hidden rounded-[28px] border border-sky-100 bg-white/88 shadow-sm">
          <div
            className="bg-gradient-to-r from-sky-100 via-white to-cyan-50 px-8 py-10"
            style={background ? { backgroundImage: `url(${background})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
          >
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div className="flex items-center gap-5">
                {avatar ? (
                  <img src={avatar} alt={displayName} className="h-24 w-24 rounded-full border-4 border-white object-cover shadow-lg" />
                ) : (
                  <div className="grid h-24 w-24 place-items-center rounded-full border-4 border-white bg-brand-950 text-4xl font-black text-white shadow-lg">
                    {initial}
                  </div>
                )}
                <div>
                  <p className="text-sm font-black uppercase tracking-[0.22em] text-sky-700">Eason Chan Fans Club</p>
                  <h1 className="mt-2 text-4xl font-black text-slate-950">{displayName}</h1>
                  <p className="mt-2 text-sm font-bold text-slate-500">
                    UID {formatUid(profile.uid)} · Lv.{profile.level} · {formatDate(profile.createdAt)} 加入
                  </p>
                </div>
              </div>
              <Link href={`/user/${formatUid(profile.uid)}`} className="rounded-xl bg-brand-950 px-5 py-3 text-center text-sm font-black text-white">
                查看我的主页
              </Link>
            </div>
          </div>

          <div className="grid gap-6 px-8 py-8 md:grid-cols-[1fr_1.1fr]">
            <div>
              <h2 className="text-xl font-black text-slate-950">个人简介</h2>
              <p className="mt-4 leading-8 text-slate-600">{bio || '这个成员还没有填写个人简介。'}</p>
              <div className="mt-5 space-y-2 text-sm font-bold text-slate-500">
                <p>邮箱：{profile.email || '未绑定邮箱'}</p>
                <p>手机号：{profile.phone || '未绑定手机号'}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                ['等级', `Lv.${profile.level}`],
                ['积分', profile.points],
                ['经验', profile.exp],
                ['连续挂号', `${profile.consecutiveDays} 天`],
                ['累计挂号', `${profile._count.checkIns} 天`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-sky-100 bg-sky-50/70 p-4">
                  <p className="text-xs font-black text-slate-500">{label}</p>
                  <p className="mt-2 text-2xl font-black text-brand-950">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <ProfileSettingsForm
            initialProfile={{
              nickname: displayName,
              avatarUrl: avatar || '',
              backgroundUrl: background || '',
              bio,
            }}
          />
          <ProfileDeferredModules />
        </section>
      </main>
    </>
  )
}
