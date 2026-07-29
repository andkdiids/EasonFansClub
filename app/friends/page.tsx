import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FriendRequestCancel, FriendRequestDecision } from '@/components/FriendRequestActions'
import { FriendActivityPanel } from '@/components/FriendActivityPanel'
import { SafeAvatar } from '@/components/SafeAvatar'
import { getCurrentUser } from '@/lib/auth'
import { safeDb } from '@/lib/db-timeout'
import { formatDate } from '@/lib/format'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'

export const dynamic = 'force-dynamic'

type RequestTab = 'all' | 'received' | 'sent'
const REQUEST_LIMIT = 100

export default async function FriendsPage({ searchParams }: { searchParams: Promise<{ requestType?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const requestType: RequestTab = params.requestType === 'received' || params.requestType === 'sent' ? params.requestType : 'all'
  const activeUserFilter = { uid: { gt: 0 }, status: 'ACTIVE' as const, isDeleted: false, Profile: { isNot: null } }
  const directionFilter = requestType === 'received'
    ? { receiverId: user.id, User_FriendRequest_senderIdToUser: activeUserFilter }
    : requestType === 'sent'
      ? { senderId: user.id, User_FriendRequest_receiverIdToUser: activeUserFilter }
      : {
        OR: [
          { receiverId: user.id, User_FriendRequest_senderIdToUser: activeUserFilter },
          { senderId: user.id, User_FriendRequest_receiverIdToUser: activeUserFilter },
        ],
      }
  const requests = await safeDb(
    'friends.requests',
    prisma.friendRequest.findMany({
      where: directionFilter,
      include: {
        User_FriendRequest_senderIdToUser: { include: { Profile: true } },
        User_FriendRequest_receiverIdToUser: { include: { Profile: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: REQUEST_LIMIT,
    }),
    [],
  )

  return (
    <main className="site-page-main flat-page mx-auto max-w-5xl space-y-6 px-5 py-8">
      <section className="rounded-[28px] border border-sky-100 bg-white/85 p-7 shadow-sm">
        <p className="text-sm font-black uppercase tracking-[0.22em] text-brand-700">Friends</p>
        <h1 className="mt-3 text-4xl font-black text-brand-950">我的好友</h1>
      </section>

      <section id="received-requests" className="scroll-mt-24 rounded-[24px] border border-sky-100 bg-white/85 p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">Requests</p>
            <h2 className="mt-1 text-2xl font-black text-brand-950">好友申请</h2>
          </div>
          <nav aria-label="好友申请分类" className="flex flex-wrap gap-2 rounded-2xl bg-sky-50 p-1.5">
            <RequestTabLink current={requestType} value="all">全部申请</RequestTabLink>
            <RequestTabLink current={requestType} value="received">收到申请</RequestTabLink>
            <RequestTabLink current={requestType} value="sent">发出申请</RequestTabLink>
          </nav>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {requests.length ? requests.map((request) => {
            const incoming = request.receiverId === user.id
            const requestUser = incoming ? request.User_FriendRequest_senderIdToUser : request.User_FriendRequest_receiverIdToUser
            return <RequestCard
              key={request.id}
              user={requestUser}
              createdAt={request.createdAt}
              updatedAt={request.updatedAt}
              status={request.status}
              direction={incoming ? 'received' : 'sent'}
              action={request.status === 'PENDING'
                ? incoming
                  ? <FriendRequestDecision requestId={request.id} />
                  : <FriendRequestCancel requestId={request.id} />
                : null}
            />
          }) : <Empty />}
        </div>
        {requests.length >= REQUEST_LIMIT ? <p className="mt-4 text-center text-xs font-bold text-slate-400">仅显示最近 {REQUEST_LIMIT} 条申请记录</p> : null}
      </section>

      <FriendActivityPanel />
    </main>
  )
}

function RequestTabLink({ current, value, children }: { current: RequestTab; value: RequestTab; children: ReactNode }) {
  const active = current === value
  return <Link
    href={value === 'all' ? '/friends#received-requests' : `/friends?requestType=${value}#received-requests`}
    aria-current={active ? 'page' : undefined}
    className={`rounded-xl px-3 py-2 text-xs font-black transition ${active ? 'bg-brand-950 text-white shadow-sm' : 'text-brand-700 hover:bg-white'}`}
  >{children}</Link>
}

type FriendUser = {
  id: string
  uid: number
  nickname: string
  avatarUrl: string | null
  bio: string | null
  status: string
  isDeleted: boolean
  Profile: { displayName: string; avatarUrl: string | null; bio: string | null } | null
}

function RequestCard({
  user,
  createdAt,
  updatedAt,
  status,
  direction,
  action,
}: {
  user: FriendUser
  createdAt: Date
  updatedAt: Date
  status: string
  direction: 'received' | 'sent'
  action?: ReactNode
}) {
  const name = user.Profile?.displayName || user.nickname
  const avatar = publicImageUrl(user.Profile?.avatarUrl || user.avatarUrl)
  return (
    <article className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/user/${formatUid(user.uid)}`} className="flex min-w-0 items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 font-black text-white">
            <SafeAvatar src={avatar} name={name} className="h-full w-full" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-black text-brand-950">{name}</span>
            <span className="block text-xs font-bold text-slate-500">UID {formatUid(user.uid)}</span>
          </span>
        </Link>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${statusClass(status)}`}>{statusText(status)}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-500">
        <span>{direction === 'received' ? '收到的申请' : status === 'PENDING' ? '等待对方确认' : '发出的申请'}</span>
        <time>{status === 'PENDING' ? `申请时间 ${formatDate(createdAt)}` : `更新时间 ${formatDate(updatedAt)}`}</time>
      </div>
      {action}
    </article>
  )
}

function statusText(status: string) {
  if (status === 'PENDING') return '等待验证'
  if (status === 'ACCEPTED') return '已通过'
  if (status === 'REJECTED') return '已拒绝'
  if (status === 'CANCELLED') return '已取消'
  return status
}

function statusClass(status: string) {
  if (status === 'ACCEPTED') return 'bg-emerald-100 text-emerald-700'
  if (status === 'REJECTED' || status === 'CANCELLED') return 'bg-slate-200 text-slate-600'
  return 'bg-amber-100 text-amber-700'
}

function Empty() {
  return <p className="rounded-2xl bg-sky-50 p-5 text-sm font-bold text-slate-500 md:col-span-2">暂无好友申请</p>
}
