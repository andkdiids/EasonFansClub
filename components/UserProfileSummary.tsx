'use client'

import Link from 'next/link'
import { UserAvatar, getUserDisplayName } from '@/components/UserAvatar'
import { UserDisplayName } from '@/components/UserDisplayName'
import type { SessionShellUser } from '@/lib/auth'
import { formatUid } from '@/lib/uid'
import { resolveGrowthLevelName } from '@/lib/growth-display'

export type AppShellGrowth = {
  level: number
  levelName: string
  experience: number
  nextRequiredExp: number | null
  progressPercent: number
}

export function UserProfileSummary({ user, growth, onActivate }: Readonly<{ user: SessionShellUser; growth: AppShellGrowth; onActivate?: () => void }>) {
  const name = getUserDisplayName(user)
  const targetExperience = growth.nextRequiredExp ?? growth.experience
  const format = new Intl.NumberFormat('zh-CN')

  const summary = <>
      <span className="sidebar-avatar"><UserAvatar user={user} /></span>
      <span>
  <strong><UserDisplayName name={name} uid={user.uid} badge={user.equippedBadge} compact /></strong>
  <small>{resolveGrowthLevelName(growth.level, growth.levelName)}</small>
</span>
    </>

  return <>
    {onActivate
      ? <button type="button" className="sidebar-user-row" onClick={onActivate} aria-haspopup="menu">{summary}</button>
      : <Link href={`/user/${formatUid(user.uid)}`} className="sidebar-user-row">{summary}</Link>}
    <div className="sidebar-growth" aria-label="成长经验">
      <div className="sidebar-progress" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, growth.progressPercent))}%` }} /></div>
      <small>{format.format(growth.experience)} / {format.format(targetExperience)} EXP</small>
    </div>
  </>
}
