import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AddFriendButton } from '@/components/FriendRequestActions'
import { PostList } from '@/components/PostList'
import { SiteHeader } from '@/components/SiteHeader'
import { categoryText, rarityText, syncUserAchievements } from '@/lib/achievements'
import { getCurrentUser } from '@/lib/auth'
import { formatDate } from '@/lib/format'
import { normalizeFriendPair } from '@/lib/friends'
import { prisma } from '@/lib/prisma'
import { formatUid, parseUidParam } from '@/lib/uid'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ uid: string }> }

export default async function PublicUserPage({ params }: PageProps) {
  const { uid } = await params
  const numericUid = parseUidParam(uid)
  if (numericUid === null) notFound()

  const viewer = await getCurrentUser()
  const user = await prisma.user.findFirst({
    where: {
      uid: numericUid,
      status: 'ACTIVE',
      isDeleted: false,
      profile: { isNot: null },
    },
    include: {
      profile: true,
      posts: {
        where: { isDeleted: false, status: 'PUBLISHED' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          author: { select: { uid: true, nickname: true, avatarUrl: true, level: true, profile: true } },
          board: { select: { name: true, slug: true } },
        },
      },
      replies: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { post: { select: { id: true, title: true } } },
      },
      badges: {
        where: { isHidden: false },
        orderBy: { grantedAt: 'desc' },
        take: 12,
        include: { badge: true },
      },
      albumCollections: {
        where: { owned: true, album: { isVisible: true, type: 'ALBUM' } },
        take: 12,
        include: { album: true },
      },
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
  })

  if (!user || !user.profile) notFound()

  const isSelf = viewer?.id === user.id
  const [favoritePosts, favoriteMessages, friendship, pendingRequest, achievements] = await Promise.all([
    isSelf
      ? prisma.postFavorite.findMany({
          where: {
            userId: user.id,
            post: {
              isDeleted: false,
              status: 'PUBLISHED',
              author: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            post: {
              include: {
                author: { select: { uid: true, nickname: true, avatarUrl: true, profile: true } },
                board: { select: { name: true, slug: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    isSelf
      ? prisma.dailyMessageFavorite.findMany({
          where: {
            userId: user.id,
            message: {
              isDeleted: false,
              user: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            message: {
              include: {
                user: { select: { uid: true, nickname: true, avatarUrl: true, profile: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    viewer && !isSelf
      ? prisma.friendship.findUnique({
          where: {
            userAId_userBId: {
              userAId: normalizeFriendPair(viewer.id, user.id)[0],
              userBId: normalizeFriendPair(viewer.id, user.id)[1],
            },
          },
        })
      : Promise.resolve(null),
    viewer && !isSelf
      ? prisma.friendRequest.findFirst({
          where: {
            status: 'PENDING',
            OR: [
              { senderId: viewer.id, receiverId: user.id },
              { senderId: user.id, receiverId: viewer.id },
            ],
          },
          select: { senderId: true, receiverId: true },
        })
      : Promise.resolve(null),
    isSelf
      ? syncUserAchievements(user.id)
      : prisma.userAchievement.findMany({
          where: { userId: user.id, unlocked: true, achievement: { isVisible: true } },
          include: { achievement: true },
          orderBy: [{ unlockedAt: 'desc' }, { createdAt: 'desc' }],
          take: 12,
        }),
  ])

  const avatar = user.profile.avatarUrl || user.avatarUrl
  const background = user.profile.backgroundUrl || user.backgroundUrl
  const name = user.profile.displayName || user.nickname
  const bio = user.profile.bio || user.bio || '这个成员还没有填写个人简介。'
  const friendCount = user._count.friendshipsA + user._count.friendshipsB
  const friendStatus = friendship ? 'FRIEND' : pendingRequest?.senderId === viewer?.id ? 'PENDING' : pendingRequest ? 'RECEIVED' : 'NONE'
  const unlockedAchievements = achievements.filter((item) => item.unlocked).slice(0, 12)

  return (
    <>
      <SiteHeader />
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

          <section className="space-y-6">
            <div className="rounded-2xl border border-sky-100 bg-white/82 p-5 shadow-sm">
              <h2 className="text-2xl font-black text-brand-950">我的成就</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {unlockedAchievements.map((item) => (
                  <div key={item.id} className="rounded-2xl bg-sky-50/80 p-4">
                    <p className="text-3xl">{item.achievement.icon || '🏆'}</p>
                    <h3 className="mt-2 font-black text-brand-950">{item.achievement.title}</h3>
                    <p className="mt-1 text-xs font-bold text-slate-500">
                      {categoryText[item.achievement.category]} · {rarityText[item.achievement.rarity]}
                    </p>
                  </div>
                ))}
                {!unlockedAchievements.length ? <p className="rounded-xl bg-sky-50 p-4 text-sm font-bold text-slate-500">还没有点亮成就。</p> : null}
              </div>
            </div>

            <div className="rounded-2xl border border-sky-100 bg-white/82 p-5 shadow-sm">
              <h2 className="text-2xl font-black text-brand-950">我的勋章</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {user.badges.map((item) => (
                  <div key={item.id} className="rounded-2xl bg-sky-50/80 p-4">
                    <p className="font-black text-brand-950">{item.badge.iconUrl ? '🏅' : '🏅'} {item.badge.name}</p>
                    <p className="mt-2 text-xs font-bold text-slate-500">{item.badge.description || '暂无介绍'}</p>
                  </div>
                ))}
                {!user.badges.length ? <p className="rounded-xl bg-sky-50 p-4 text-sm font-bold text-slate-500">还没有获得勋章。</p> : null}
              </div>
            </div>

            <div>
              <h2 className="mb-4 text-2xl font-black text-brand-950">发帖记录</h2>
              <PostList posts={user.posts} />
            </div>

            {isSelf ? (
              <div className="rounded-2xl border border-sky-100 bg-white/82 p-5 shadow-sm">
                <h2 className="text-2xl font-black text-brand-950">我的收藏</h2>
                <div className="mt-4 grid gap-3">
                  {favoritePosts.map((item) => {
                    const author = item.post.author
                    const authorName = author.profile?.displayName || author.nickname
                    return (
                      <Link key={item.id} href={`/posts/${item.post.id}`} className="rounded-2xl bg-sky-50 p-4 transition hover:bg-sky-100">
                        <p className="text-xs font-black text-brand-700">帖子 · 收藏于 {formatDate(item.createdAt)}</p>
                        <h3 className="mt-2 text-lg font-black text-brand-950">{item.post.title}</h3>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{item.post.content}</p>
                        <p className="mt-2 text-xs font-bold text-slate-500">作者 {authorName} · UID {formatUid(author.uid)}</p>
                      </Link>
                    )
                  })}
                  {favoriteMessages.map((item) => {
                    const author = item.message.user
                    const authorName = author.profile?.displayName || author.nickname
                    return (
                      <Link key={item.id} href={`/checkin?date=${item.message.date.toISOString().slice(0, 10)}`} className="rounded-2xl bg-sky-50 p-4 transition hover:bg-sky-100">
                        <p className="text-xs font-black text-brand-700">E友留言 · 收藏于 {formatDate(item.createdAt)}</p>
                        <p className="mt-2 line-clamp-3 text-sm leading-7 text-slate-700">{item.message.content}</p>
                        <p className="mt-2 text-xs font-bold text-slate-500">作者 {authorName} · UID {formatUid(author.uid)}</p>
                      </Link>
                    )
                  })}
                  {!favoritePosts.length && !favoriteMessages.length ? (
                    <p className="rounded-xl bg-sky-50 p-4 text-sm font-bold text-slate-500">还没有收藏内容。</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-sky-100 bg-white/82 p-5 shadow-sm">
              <h2 className="text-2xl font-black text-brand-950">我的专辑</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {user.albumCollections.map((item) => (
                  <Link key={item.id} href={`/culture/${item.album.slug}`} className="rounded-2xl bg-sky-50/80 p-4">
                    <p className="font-black text-brand-950">{item.album.title}</p>
                    <p className="mt-2 text-xs font-bold text-slate-500">{item.note || '已加入收藏馆'}</p>
                  </Link>
                ))}
                {!user.albumCollections.length ? <p className="rounded-xl bg-sky-50 p-4 text-sm font-bold text-slate-500">还没有标记专辑收藏。</p> : null}
              </div>
            </div>

            <div className="rounded-2xl border border-sky-100 bg-white/82 p-5 shadow-sm">
              <h2 className="text-2xl font-black text-brand-950">回复记录</h2>
              <div className="mt-4 space-y-3">
                {user.replies.length ? (
                  user.replies.map((reply) => (
                    <Link key={reply.id} href={`/posts/${reply.post.id}`} className="block rounded-xl bg-sky-50 p-4 transition hover:bg-sky-100">
                      <p className="font-black text-slate-700">{reply.post.title}</p>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{reply.content}</p>
                    </Link>
                  ))
                ) : (
                  <p className="rounded-xl bg-sky-50 p-4 text-sm font-bold text-slate-500">还没有回复记录。</p>
                )}
              </div>
            </div>
          </section>
        </section>
      </main>
    </>
  )
}
