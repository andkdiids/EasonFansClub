import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FriendRequestCancel, FriendRequestDecision } from '@/components/FriendRequestActions'
import { FriendActivityPanel } from '@/components/FriendActivityPanel'
import { SafeAvatar } from '@/components/SafeAvatar'
import { UserDisplayName } from '@/components/UserDisplayName'
import { getCurrentUser } from '@/lib/auth'
import { safeDb } from '@/lib/db-timeout'
import { formatDate } from '@/lib/format'
import { profileImageUrl } from '@/lib/images'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'

export const dynamic = 'force-dynamic'

type RequestTab = 'all' | 'received' | 'sent'
const REQUEST_LIMIT = 100

const friendRequestUserSelect = {
  id: true,
  uid: true,
  nickname: true,
  avatarUrl: true,
  usernameModerationStatus: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  Profile: {
    select: {
      displayName: true,
      displayNameModerationStatus: true,
      avatarUrl: true,
    },
  },
} as const

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
      where: { AND: [directionFilter, { status: 'PENDING' }] },
      select: {
        id: true,
        senderId: true,
        receiverId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        User_FriendRequest_senderIdToUser: { select: friendRequestUserSelect },
        User_FriendRequest_receiverIdToUser: { select: friendRequestUserSelect },
      },
      orderBy: { updatedAt: 'desc' },
      take: REQUEST_LIMIT,
    }),
    [],
  )
  const requestUserIds = requests.map((request) => request.receiverId === user.id ? request.senderId : request.receiverId)
  const equippedBadgeMap = await getEquippedBadgesForUsers(requestUserIds)

  return (
    <main className="site-page-main flat-page mx-auto max-w-6xl space-y-6 px-5 py-8">
      <section className="rounded-sm border border-sky-100 bg-white/85 p-7 shadow-sm">
        <p className="text-sm font-black uppercase tracking-[0.22em] text-brand-700">Friends</p>
        <h1 className="mt-3 text-4xl font-black text-brand-950">好友中心</h1>
        <p className="mt-3 text-sm font-bold text-slate-500">管理待处理的好友申请，浏览好友最近的挂号与发帖动态。</p>
      </section>

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[760px] grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-5">
      <section id="received-requests" className="scroll-mt-24 rounded-sm border border-sky-100 bg-white/85 p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">Requests</p>
            <h2 className="mt-1 text-2xl font-black text-brand-950">好友申请</h2>
          </div>
          <nav aria-label="好友申请分类" className="flex flex-wrap gap-2 rounded-sm bg-sky-50 p-1.5">
            <RequestTabLink current={requestType} value="all">全部申请</RequestTabLink>
            <RequestTabLink current={requestType} value="received">收到申请</RequestTabLink>
            <RequestTabLink current={requestType} value="sent">发出申请</RequestTabLink>
          </nav>
        </div>
        <div className="mt-5 space-y-3">
          {requests.length ? requests.map((request) => {
            const incoming = request.receiverId === user.id
            const requestUser = incoming ? request.User_FriendRequest_senderIdToUser : request.User_FriendRequest_receiverIdToUser
            return <RequestCard
              key={request.id}
              user={requestUser}
              createdAt={request.createdAt}
              updatedAt={request.updatedAt}
              direction={incoming ? 'received' : 'sent'}
              equippedBadge={equippedBadgeMap.get(requestUser.id) || null}
              action={incoming
                  ? <FriendRequestDecision requestId={request.id} />
                  : <FriendRequestCancel requestId={request.id} />}
            />
          }) : <Empty />}
        </div>
        {requests.length >= REQUEST_LIMIT ? <p className="mt-4 text-center text-xs font-bold text-slate-400">仅显示最近 {REQUEST_LIMIT} 条待处理申请</p> : null}
      </section>

      <FriendActivityPanel compact />
        </div>
      </div>
    </main>
  )
}

function RequestTabLink({ current, value, children }: { current: RequestTab; value: RequestTab; children: ReactNode }) {
  const active = current === value
  return <Link
    href={value === 'all' ? '/friends#received-requests' : `/friends?requestType=${value}#received-requests`}
    aria-current={active ? 'page' : undefined}
    className={`rounded-sm px-3 py-2 text-xs font-black transition ${active ? 'bg-brand-950 text-white shadow-sm' : 'text-brand-700 hover:bg-white'}`}
  >{children}</Link>
}

type FriendUser = {
  id: string
  uid: number
  nickname: string
  avatarUrl: string | null
  usernameModerationStatus?: string | null
  nicknameModerationStatus?: string | null
  nicknameViolationDisplay?: string | null
  Profile: { displayName: string | null; avatarUrl: string | null; displayNameModerationStatus?: string | null } | null
}

function RequestCard({
  user,
  createdAt,
  updatedAt,
  direction,
  equippedBadge,
  action,
}: {
  user: FriendUser
  createdAt: Date
  updatedAt: Date
  direction: 'received' | 'sent'
  equippedBadge?: import('@/lib/badge-types').EquippedBadgeView | null
  action?: ReactNode
}) {
  const name = getPublicUserDisplayName(user)
  const avatar = profileImageUrl(user.Profile?.avatarUrl || user.avatarUrl)
  return (
    <article className="rounded-sm border border-sky-100 bg-sky-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/user/${formatUid(user.uid)}`} className="flex min-w-0 items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 font-black text-white">
            <SafeAvatar src={avatar} name={name} uid={user.uid} className="h-full w-full" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-black text-brand-950"><UserDisplayName name={name} uid={user.uid} badge={equippedBadge} compact /></span>
            <span className="block text-xs font-bold text-slate-500">UID {formatUid(user.uid)}</span>
          </span>
        </Link>
        <span className="shrink-0 bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-700">等待处理</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-500">
        <span>{direction === 'received' ? '收到申请 · 等待你的确认' : '发出申请 · 等待对方确认'}</span>
        <time>更新于 {formatDate(updatedAt || createdAt)}</time>
      </div>
      {action}
    </article>
  )
}

function Empty() {
  return <p className="bg-sky-50 p-5 text-sm font-bold text-slate-500">暂无待处理的好友申请</p>
}
