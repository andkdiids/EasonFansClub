import Link from 'next/link'
import type { ReactNode } from 'react'
import { FriendProfileActions } from '@/components/FriendProfileActions'
import { ProfileHeader } from '@/components/ProfileSummary'
import { ProfileWall } from '@/components/ProfileWall'
import { PublicUserModules } from '@/components/PublicUserModules'
import type { GrowthSummary } from '@/lib/growth'
import { formatUid } from '@/lib/uid'
import type { ProfileRecentMessage, ProfileRecordPagination, ProfileWallVisibility } from '@/lib/profile-page'
import { formatUserLocation, type UserLocation } from '@/lib/user-location'
import type { BadgeCollectionView, EquippedBadgeView } from '@/lib/badge-types'
import { BadgeMiniShowcase } from '@/components/BadgeMiniShowcase'

type FriendStatus = 'NONE' | 'PENDING' | 'FRIEND' | 'RECEIVED'

export type ProfilePageSurfaceProfile = {
  id: string
  uid: number
  displayName: string
  baseDisplayName: string
  bio: string
  location: UserLocation | null
  ipRegion: string | null
  avatarUrl: string | null
  backgroundUrl: string | null
  createdAt: Date
  wallVisibility: ProfileWallVisibility
  publicLiveCount: number
  equippedBadge: EquippedBadgeView | null
  badgeSummary?: BadgeCollectionView | null
}

export type ProfilePageSurfaceRelationship = {
  isSelf: boolean
  isFriend: boolean
  isBlocked: boolean
  isFollowed: boolean
  hasViewer: boolean
  friendStatus: FriendStatus
  initialRemark: string | null
}

function actionLinkClass(variant: 'primary' | 'secondary' = 'secondary') {
  return variant === 'primary'
    ? 'inline-flex min-h-11 items-center justify-center rounded-xl border border-brand-900 bg-brand-950 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-brand-800'
    : 'inline-flex min-h-11 items-center justify-center rounded-xl border border-sky-100 bg-white px-4 py-2.5 text-sm font-black text-brand-800 shadow-sm transition hover:bg-sky-50'
}

function ClosedWall({ visibility }: { visibility: ProfileWallVisibility }) {
  const message = visibility === 'FRIENDS' ? '该成员的留言墙仅对好友展示。' : '该成员暂未开放留言墙展示。'

  return (
    <section className="rounded-[24px] border border-sky-100 bg-white/85 p-4 shadow-sm sm:p-5">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">留言墙</p>
      <h2 className="mt-1 text-xl font-black text-brand-950">留言墙暂不可见</h2>
      <p className="mt-3 break-words text-sm font-bold leading-6 text-slate-500">{message}</p>
    </section>
  )
}

export function ProfilePageSurface({
  profile,
  growth,
  relationship,
  recentMessages,
  recentMessagesPagination,
  remarkEditor,
}: {
  profile: ProfilePageSurfaceProfile
  growth: GrowthSummary
  relationship: ProfilePageSurfaceRelationship
  recentMessages: ProfileRecentMessage[]
  recentMessagesPagination?: ProfileRecordPagination
  remarkEditor?: ReactNode
}) {
  const { isSelf, isFriend, isBlocked, hasViewer, friendStatus } = relationship
  const wallHref = '#profile-wall'
  const canViewWall = isSelf || profile.wallVisibility === 'PUBLIC' || (profile.wallVisibility === 'FRIENDS' && isFriend && !isBlocked)

  return (
    <main className="site-page-main flat-page mx-auto max-w-7xl space-y-4 px-4 py-5 sm:space-y-5 sm:px-5 sm:py-6">
      <ProfileHeader
        displayName={profile.displayName}
        uid={profile.uid}
        level={growth.level}
        levelName={growth.levelName}
        experience={growth.experience}
        nextRequiredExp={growth.nextRequiredExp}
        progressPercent={growth.progressPercent}
        createdAt={profile.createdAt}
        avatarUrl={profile.avatarUrl}
        backgroundUrl={profile.backgroundUrl}
        equippedBadge={profile.equippedBadge}
        badgeInteraction={isSelf ? 'static' : 'interactive'}
        showGrowth
      />

      <section className="min-w-0 rounded-2xl border border-sky-100 bg-white/88 p-4 shadow-sm sm:p-5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="profile-archive-title whitespace-nowrap text-base font-black text-brand-950 sm:text-lg md:text-xl">个人档案</h2>
          {!isSelf && hasViewer && isFriend && !isBlocked && remarkEditor ? <div className="shrink-0">{remarkEditor}</div> : null}
        </div>
        <dl className="mt-4 grid gap-2 border-t border-sky-100 pt-4 text-sm sm:grid-cols-2">
          <div className="flex min-w-0 items-baseline gap-3">
            <dt className="shrink-0 font-black text-slate-500">地区</dt>
            <dd className="min-w-0 truncate font-bold text-brand-950">{formatUserLocation(profile.location) || '未设置'}</dd>
          </div>
          <div className="flex min-w-0 items-baseline gap-3">
            <dt className="shrink-0 font-black text-slate-500">IP属地</dt>
            <dd className="min-w-0 truncate font-bold text-brand-950">{profile.ipRegion || '未有记录'}</dd>
          </div>
        </dl>
        <p className="mt-3 min-w-0 whitespace-pre-wrap break-words text-sm font-bold leading-7 text-slate-600 sm:text-base">
          {profile.bio || '这个成员还没有填写个人简介。'}
        </p>
      </section>

      <BadgeMiniShowcase uid={profile.uid} summary={profile.badgeSummary || null} equippedBadge={profile.equippedBadge} isSelf={isSelf} />

      <div className="profile-actions-scroll min-w-0" aria-label={isSelf ? '个人操作' : '好友操作'}>
        <div className="flex w-max min-w-full flex-nowrap items-center gap-2 py-0.5">
          {isSelf ? (
            <>
              <Link href="/profile?edit=1" scroll={false} className={actionLinkClass('primary')}>编辑资料</Link>
              <Link href={`/user/${formatUid(profile.uid)}`} className={actionLinkClass()}>查看公开主页</Link>
              <Link href={wallHref} className={actionLinkClass()}>去留言</Link>
              <Link href="/music/live/me" className={actionLinkClass()}>我的现场</Link>
              <Link href="/profile/stickers" className={actionLinkClass()}>我的表情包</Link>
            </>
          ) : (
            <FriendProfileActions
              targetUserId={profile.id}
              targetUid={profile.uid}
              publicLiveCount={profile.publicLiveCount}
              hasViewer={hasViewer}
              initialIsFriend={isFriend}
              initialIsBlocked={isBlocked}
              initialIsFollowed={relationship.isFollowed}
              friendStatus={friendStatus}
            />
          )}
        </div>
      </div>

      <section className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.48fr)] lg:gap-5">
        <div id="profile-wall" className="min-w-0 scroll-mt-24">
          {canViewWall ? <ProfileWall receiverUid={profile.uid} isOwner={isSelf} /> : <ClosedWall visibility={profile.wallVisibility} />}
        </div>
        <div className="min-w-0">
          <PublicUserModules uid={formatUid(profile.uid)} isSelf={isSelf} recentMessages={recentMessages} recentMessagesPagination={recentMessagesPagination} />
        </div>
      </section>
    </main>
  )
}
