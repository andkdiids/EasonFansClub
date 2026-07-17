import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AddFriendButton, FriendRequestDecision } from '@/components/FriendRequestActions'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { safeDb } from '@/lib/db-timeout'
import { formatDate } from '@/lib/format'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'

export const dynamic = 'force-dynamic'

const FRIEND_LIST_LIMIT = 50
const FRIEND_REQUEST_LIMIT = 50

export default async function FriendsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const q = (params.q || '').trim()
  const numericUid = Number(q)

  const activeUserFilter = { uid: { gt: 0 }, status: 'ACTIVE' as const, isDeleted: false, profile: { isNot: null } }
  const friendships = await safeDb(
    'friends.friendships',
    prisma.friendship.findMany({
      where: { OR: [{ userAId: user.id }, { userBId: user.id }] },
      include: {
        userA: { include: { profile: true } },
        userB: { include: { profile: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: FRIEND_LIST_LIMIT,
    }),
    [],
  )
  const received = await safeDb(
    'friends.received',
    prisma.friendRequest.findMany({
      where: { receiverId: user.id, status: 'PENDING', sender: activeUserFilter },
      include: { sender: { include: { profile: true } } },
      orderBy: { createdAt: 'desc' },
      take: FRIEND_REQUEST_LIMIT,
    }),
    [],
  )
  const sent = await safeDb(
    'friends.sent',
    prisma.friendRequest.findMany({
      where: { senderId: user.id, status: 'PENDING', receiver: activeUserFilter },
      include: { receiver: { include: { profile: true } } },
      orderBy: { createdAt: 'desc' },
      take: FRIEND_REQUEST_LIMIT,
    }),
    [],
  )
  const searchUsers = await safeDb(
    'friends.search',
    q
      ? prisma.user.findMany({
          where: {
            id: { not: user.id },
            ...activeUserFilter,
            OR: [
              { nickname: { contains: q, mode: 'insensitive' } },
              { profile: { displayName: { contains: q, mode: 'insensitive' } } },
              { phone: q },
              { email: { contains: q, mode: 'insensitive' } },
              ...(Number.isInteger(numericUid) ? [{ uid: numericUid }] : []),
            ],
          },
          include: { profile: true },
          take: 20,
        })
      : Promise.resolve([]),
    [],
  )

  const friends = friendships
    .map((item) => (item.userAId === user.id ? item.userB : item.userA))
    .filter((item) => item.status === 'ACTIVE' && !item.isDeleted && item.profile)

  const friendIds = new Set(friends.map((item) => item.id))
  const sentPendingReceiverIds = new Set(sent.filter((item) => item.status === 'PENDING').map((item) => item.receiverId))
  const receivedPendingSenderIds = new Set(received.map((item) => item.senderId))

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-6xl space-y-6 px-5 py-8">
        <section className="rounded-[28px] border border-sky-100 bg-white/85 p-7 shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.22em] text-brand-700">Friends</p>
          <h1 className="mt-3 text-4xl font-black text-brand-950">我的好友</h1>
          <form action="/friends" className="mt-5 flex gap-3">
            <input
              name="q"
              defaultValue={q}
              placeholder="搜索 UID、昵称、手机号或邮箱"
              className="min-w-0 flex-1 rounded-xl border border-sky-100 px-4 py-3 font-bold outline-none"
            />
            <button className="rounded-xl bg-brand-700 px-5 py-3 font-black text-white">搜索</button>
          </form>
        </section>

        {q ? (
          <section className="rounded-2xl border border-sky-100 bg-white/80 p-5 shadow-sm">
            <h2 className="text-2xl font-black text-brand-950">搜索用户</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {searchUsers.length ? (
                searchUsers.map((item) => {
                  const status = friendIds.has(item.id)
                    ? 'FRIEND'
                    : sentPendingReceiverIds.has(item.id)
                      ? 'PENDING'
                      : receivedPendingSenderIds.has(item.id)
                        ? 'RECEIVED'
                        : 'NONE'
                  return <UserCard key={item.id} user={item} action={<AddFriendButton uid={item.uid} initialStatus={status} />} />
                })
              ) : (
                <Empty />
              )}
            </div>
          </section>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-3">
          <Panel id="friend-list" title="好友列表">
            {friends.length ? friends.map((item) => <UserCard key={item.id} user={item} status="已是好友" />) : <Empty />}
          </Panel>
          <Panel id="received-requests" title="收到的申请">
            {received.length ? (
              received.map((item) => (
                <RequestCard key={item.id} user={item.sender} createdAt={item.createdAt} status="等待处理">
                  <FriendRequestDecision requestId={item.id} />
                </RequestCard>
              ))
            ) : (
              <Empty />
            )}
          </Panel>
          <Panel id="sent-requests" title="发出的申请">
            {sent.length ? (
              sent.map((item) => <RequestCard key={item.id} user={item.receiver} createdAt={item.createdAt} status={statusText(item.status)} />)
            ) : (
              <Empty />
            )}
          </Panel>
        </section>
      </main>
    </>
  )
}

function statusText(status: string) {
  if (status === 'PENDING') return '等待通过'
  if (status === 'ACCEPTED') return '已通过'
  if (status === 'REJECTED') return '已拒绝'
  if (status === 'CANCELLED') return '已取消'
  return status
}

function Panel({ id, title, children }: Readonly<{ id: string; title: string; children: ReactNode }>) {
  return (
    <div id={id} className="scroll-mt-24 rounded-2xl border border-sky-100 bg-white/80 p-5 shadow-sm">
      <h2 className="text-2xl font-black text-brand-950">{title}</h2>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  )
}

type FriendUser = {
  id: string
  uid: number
  nickname: string
  avatarUrl: string | null
  bio: string | null
  status: string
  isDeleted: boolean
  profile: { displayName: string; avatarUrl: string | null; bio: string | null } | null
}

function UserCard({ user, status, action }: { user: FriendUser; status?: string; action?: ReactNode }) {
  const name = user.profile?.displayName || user.nickname
  const avatar = publicImageUrl(user.profile?.avatarUrl || user.avatarUrl)
  return (
    <div className="rounded-2xl bg-sky-50 p-4 transition hover:bg-sky-100">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/user/${formatUid(user.uid)}`} className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-white">
            {avatar ? <img src={avatar} alt={name} className="h-full w-full object-cover" /> : name.slice(0, 1)}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-black text-brand-950">{name}</span>
            <span className="block text-xs font-bold text-slate-500">UID {formatUid(user.uid)} {status ? `· ${status}` : ''}</span>
          </span>
        </Link>
        {action}
      </div>
      <p className="mt-3 text-sm font-bold text-slate-500">{user.profile?.bio || user.bio || '还没有简介。'}</p>
    </div>
  )
}

function RequestCard({ user, createdAt, status, children }: { user: FriendUser; createdAt: Date; status: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-sky-50 p-4">
      <UserCard user={user} status={status} />
      <p className="mt-2 text-xs font-bold text-slate-500">申请时间 {formatDate(createdAt)}</p>
      {children}
    </div>
  )
}

function Empty() {
  return <p className="rounded-2xl bg-sky-50 p-5 text-sm font-bold text-slate-500">暂无数据</p>
}
