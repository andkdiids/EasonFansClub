import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AddFriendButton } from '@/components/FriendRequestActions'
import { PublicUserModules } from '@/components/PublicUserModules'
import { SiteHeader } from '@/components/SiteHeader'
import { getSessionUserFromCookie } from '@/lib/auth'
import { withDbTimeout } from '@/lib/db-timeout'
import { formatDate } from '@/lib/format'
import { normalizeFriendPair } from '@/lib/friends'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { formatUid, parseUidParam } from '@/lib/uid'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ uid: string }> }

export default async function PublicUserPage({ params }: PageProps) {
  const { uid } = await params
  console.log('[public-user:ssr] start', uid)
  const numericUid = parseUidParam(uid)
  if (numericUid === null) notFound()
  if (numericUid <= 0) notFound()

  const viewer = await getSessionUserFromCookie()
  console.log('[public-user:ssr] viewer', viewer ? 'session' : 'anonymous')
  console.log('[public-user:ssr] user-query:start')
  let user
  try {
    user = await withDbTimeout('User.findFirst publicUser.profile', prisma.user.findFirst({
      where: {
        uid: numericUid,
        status: 'ACTIVE',
        isDeleted: false,
        profile: { isNot: null },
      },
      select: {
        id: true,
        uid: true,
        nickname: true,
        avatarUrl: true,
        backgroundUrl: true,
        bio: true,
        email: true,
        phone: true,
        level: true,
        createdAt: true,
        profile: true,
        _count: {
          select: {
            posts: true,
            replies: true,
            checkIns: true,
            friendshipsA: true,
            friendshipsB: true,
          },
        },
      },
    }), 3500)
  } catch (error) {
    console.error('[public-user:ssr] prisma query failed', {
      model: 'User',
      query: 'findFirst',
      feature: 'publicUser.profile',
      uid: numericUid,
      where: ['uid=params.uid', 'status=ACTIVE', 'isDeleted=false', 'profile is not null'],
      includeCounts: ['posts', 'replies', 'checkIns', 'friendshipsA', 'friendshipsB'],
    }, error)
    throw error
  }
  console.log('[public-user:ssr] user-query:done')

  if (!user || !user.profile) notFound()

  const isSelf = viewer?.id === user.id
  let friendship = null
  let pendingRequest: { senderId: string; receiverId: string } | null = null

  if (viewer && !isSelf) {
    try {
      console.log('[public-user:ssr] relationship-query:start')
      const [userAId, userBId] = normalizeFriendPair(viewer.id, user.id)
      friendship = await withDbTimeout('Friendship.findUnique publicUser.friendship', prisma.friendship.findUnique({
        where: { userAId_userBId: { userAId, userBId } },
        select: { id: true },
      }), 2500)
      pendingRequest = await withDbTimeout('FriendRequest.findFirst publicUser.pendingRequest', prisma.friendRequest.findFirst({
        where: {
          status: 'PENDING',
          OR: [
            { senderId: viewer.id, receiverId: user.id },
            { senderId: user.id, receiverId: viewer.id },
          ],
        },
        select: { senderId: true, receiverId: true },
      }), 2500)
      console.log('[public-user:ssr] relationship-query:done')
    } catch (error) {
      console.error('[public-user:ssr] relationship-query:failed', {
        queries: [
          { model: 'Friendship', query: 'findUnique', feature: 'publicUser.friendship' },
          { model: 'FriendRequest', query: 'findFirst', feature: 'publicUser.pendingRequest' },
        ],
      }, error)
      friendship = null
      pendingRequest = null
    }
  }

  const avatar = publicImageUrl(user.profile.avatarUrl || user.avatarUrl)
  const background = publicImageUrl(user.profile.backgroundUrl || user.backgroundUrl)
  const name = user.profile.displayName || user.nickname
  const bio = user.profile.bio || user.bio || '这个成员还没有填写个人简介。'
  const friendCount = user._count.friendshipsA + user._count.friendshipsB
  const friendStatus = friendship ? 'FRIEND' : pendingRequest?.senderId === viewer?.id ? 'PENDING' : pendingRequest ? 'RECEIVED' : 'NONE'

  return (
    <>
      <SiteHeader user={viewer} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-5">
        <section className="overflow-hidden rounded-[28px] border border-sky-100 bg-white/88 shadow-sm">
          <div
            className="h-52 bg-gradient-to-r from-sky-100 via-white to-cyan-50"
            style={background ? { backgroundImage: `url(${background})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
          />
          <div className="-mt-12 flex flex-col gap-5 px-6 pb-7 md:flex-row md:items-end md:justify-between">
            <div className="flex items-end gap-5">
              <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-full border-4 border-white bg-brand-950 text-4xl font-black text-white shadow-lg">
                {avatar ? <img src={avatar} alt={name} className="h-full w-full object-cover" /> : name.slice(0, 1)}
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-[0.18em] text-sky-700">Eason Chan Fans Club</p>
                <h1 className="mt-2 text-4xl font-black text-brand-950">{name}</h1>
                <p className="mt-2 text-sm font-bold text-slate-500">
                  UID {formatUid(user.uid)} · Lv.{user.level} · {formatDate(user.createdAt)} 加入
                </p>
              </div>
            </div>
            {isSelf ? (
              <Link href="/profile" className="rounded-xl bg-brand-950 px-5 py-3 text-sm font-black text-white">
                编辑个人资料
              </Link>
            ) : viewer ? (
              <AddFriendButton uid={user.uid} initialStatus={friendStatus} />
            ) : (
              <Link href="/login" className="rounded-xl bg-brand-700 px-5 py-3 text-sm font-black text-white">
                登录后加好友
              </Link>
            )}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="rounded-2xl border border-sky-100 bg-white/82 p-5 shadow-sm">
              <h2 className="font-black text-brand-950">个人档案</h2>
              <div className="mt-4 space-y-3 text-sm font-bold text-slate-600">
                <p>邮箱：{user.email || '未绑定邮箱'}</p>
                <p>手机号：{user.phone || '未绑定手机号'}</p>
                <p>简介：{bio}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                ['帖子', user._count.posts],
                ['回复', user._count.replies],
                ['挂号', user._count.checkIns],
                ['好友', friendCount],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 text-center">
                  <p className="text-2xl font-black text-brand-950">{value}</p>
                  <p className="mt-1 text-xs font-black text-slate-500">{label}</p>
                </div>
              ))}
            </div>
          </aside>

          <PublicUserModules uid={formatUid(user.uid)} isSelf={isSelf} />
        </section>
      </main>
    </>
  )
}
