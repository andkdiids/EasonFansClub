import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AddFriendButton } from '@/components/FriendRequestActions'
import { BackButton } from '@/components/BackButton'
import { ProfileHeader, ProfileStatsGrid } from '@/components/ProfileSummary'
import { PublicUserModules } from '@/components/PublicUserModules'
import { getCurrentUser } from '@/lib/auth'
import { withDbTimeout } from '@/lib/db-timeout'
import { normalizeFriendPair } from '@/lib/friends'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { formatUid, parseUidParam } from '@/lib/uid'
import { getGrowthSummary } from '@/lib/growth'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ uid: string }> }

export default async function PublicUserPage({ params }: PageProps) {
  const { uid } = await params
  const numericUid = parseUidParam(uid)
  if (numericUid === null) notFound()
  if (numericUid <= 0) notFound()

  const viewer = await getCurrentUser()
  if (viewer?.uid === numericUid) redirect('/profile')
  let user
  try {
    user = await withDbTimeout('User.findFirst publicUser.profile', prisma.user.findFirst({
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
            Post: true,
            Reply: true,
            Friendship_Friendship_userAIdToUser: true,
            Friendship_Friendship_userBIdToUser: true,
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
  } catch (error) {
    console.error('[public-user:ssr] prisma query failed', {
      model: 'User',
      query: 'findFirst',
      feature: 'publicUser.profile',
      uid: numericUid,
      where: ['uid=params.uid', 'status=ACTIVE', 'isDeleted=false', 'profile is not null'],
      includeCounts: ['posts', 'replies', 'friendshipsA', 'friendshipsB'],
    }, error)
    throw error
  }
  if (!user || !user.Profile) notFound()

  const isSelf = false
  let friendship = null
  let pendingRequest: { senderId: string; receiverId: string } | null = null

  if (viewer && !isSelf) {
    try {
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

  const avatar = publicImageUrl(user.Profile.avatarUrl || user.avatarUrl)
  const background = publicImageUrl(user.Profile.backgroundUrl || user.backgroundUrl)
  const name = user.Profile.displayName || user.nickname
  const bio = user.Profile.bio || user.bio || '这个成员还没有填写个人简介。'
  const friendCount = user._count.Friendship_Friendship_userAIdToUser + user._count.Friendship_Friendship_userBIdToUser
  const growth = await getGrowthSummary(user.experience)
  const friendStatus = friendship ? 'FRIEND' : pendingRequest?.senderId === viewer?.id ? 'PENDING' : pendingRequest ? 'RECEIVED' : 'NONE'

  return (
    <>
      <main className="site-page-main flat-page mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-5 sm:py-7">
        <BackButton />
        <ProfileHeader
          displayName={name}
          uid={user.uid}
          level={growth.level}
          levelName={growth.levelName}
          showGrowth={true}
          createdAt={user.createdAt}
          avatarUrl={avatar}
          backgroundUrl={background}
        />

        <section className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="rounded-2xl border border-sky-100 bg-white/82 p-5 shadow-sm">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div>
                  <h2 className="font-black text-brand-950">个人档案</h2>
                  <div className="mt-4 space-y-3 text-sm font-bold text-slate-600">
                    <p>简介：{bio}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 md:flex-col md:items-stretch">
                  {viewer ? <Link href={`/user/${formatUid(user.uid)}/wall`} className="rounded-xl border border-sky-100 bg-brand-700 px-4 py-2.5 text-center text-sm font-black text-white shadow-sm transition hover:bg-brand-800">去留言</Link> : null}
                  {user._count.UserMusicConcert > 0 ? <Link href={`/user/${formatUid(user.uid)}/live`} className="rounded-xl border border-sky-100 bg-brand-950 px-4 py-2.5 text-center text-sm font-black text-white shadow-sm transition hover:bg-brand-800">查看TA公开的现场记录</Link> : null}
                  {isSelf ? (
                    <Link href="/profile?edit=1" className="rounded-xl border border-sky-100 bg-brand-950 px-4 py-2.5 text-center text-sm font-black text-white shadow-sm transition hover:bg-brand-800">
                      编辑个人资料
                    </Link>
                  ) : viewer && !friendship ? (
                    <AddFriendButton uid={user.uid} initialStatus={friendStatus} />
                  ) : !viewer ? (
                    <Link href="/login" className="rounded-xl border border-sky-100 bg-brand-950 px-4 py-2.5 text-center text-sm font-black text-white shadow-sm transition hover:bg-brand-800">
                      登录后加好友
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
            <ProfileStatsGrid
              compact
              items={[
                ['帖子', user._count.Post],
                ['回复', user._count.Reply],
                ['好友', friendCount],
              ]}
            />
          </aside>

          <PublicUserModules uid={formatUid(user.uid)} isSelf={isSelf} />
        </section>
      </main>
    </>
  )
}
