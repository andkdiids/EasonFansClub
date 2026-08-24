import type { ReactNode } from 'react'
import { resolveGrowthLevelName } from '@/lib/growth-display'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { UserDisplayName } from '@/components/UserDisplayName'
import type { EquippedBadgeView } from '@/lib/badge-types'

type ProfileHeaderProps = {
  displayName: string
  uid: number
  level: number
  levelName?: string
  experience?: number
  nextRequiredExp?: number | null
  progressPercent?: number
  createdAt: Date
  avatarUrl?: string | null
  backgroundUrl?: string | null
  equippedBadge?: EquippedBadgeView | null
  badgeInteraction?: 'interactive' | 'static'
  showGrowth?: boolean
}

type ProfileStatsGridProps = {
  items: Array<[string, ReactNode]>
  compact?: boolean
}

const oneDayMs = 24 * 60 * 60 * 1000



function formatUid(uid: number) {
  return String(uid).padStart(5, '0')
}

export function formatAdmissionInfo(createdAt: Date) {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(createdAt)

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  )

  const date = `${values.year}/${values.month}/${values.day}`

  const todayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const today = todayFormatter.format(new Date())
const admission = todayFormatter.format(createdAt)

const startToday = new Date(`${today}T00:00:00+08:00`)
const startAdmission = new Date(`${admission}T00:00:00+08:00`)

  const days = Math.max(
    1,
    Math.floor(
      (startToday.getTime() - startAdmission.getTime()) / oneDayMs
    ) + 1
  )

  return {
    date,
    days,
  }
}

export function ProfileHeader({
  displayName,
  uid,
  level,
  levelName,
  experience = 0,
  nextRequiredExp,
  progressPercent = 0,
  createdAt,
  avatarUrl,
  backgroundUrl,
  equippedBadge = null,
  badgeInteraction = 'interactive',
  showGrowth = true,
}: ProfileHeaderProps) {
  const initial = formatUid(uid).slice(0, 1)
  const admissionInfo = formatAdmissionInfo(createdAt)
  const growthLevelName = resolveGrowthLevelName(level, levelName)
  const publicAvatarUrl = publicImageVariantUrl(avatarUrl, 'avatar-md')
  const publicBackgroundUrl = publicImageVariantUrl(backgroundUrl, 'large')

  return (
    <section className="profile-hero overflow-hidden rounded-sm border border-sky-100 bg-white/88">
  <div
  className="profile-hero-background relative isolate flex h-[210px] w-full items-end justify-start overflow-hidden bg-slate-900 px-4 pb-3 sm:block sm:aspect-[9/2] sm:h-auto sm:items-stretch sm:justify-start sm:px-0 sm:pb-0"
  style={{
    backgroundImage: publicBackgroundUrl ? `url(${publicBackgroundUrl})` : undefined,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  }}
>
        {!publicBackgroundUrl ? <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_22%,rgba(14,165,233,0.35),transparent_32%),linear-gradient(135deg,#0f172a,#075985_48%,#164e63)]" /> : null}
        <div className="profile-hero-identity relative w-fit min-w-[190px] max-w-[min(320px,calc(100%_-_2rem))] p-0 text-left text-white sm:absolute sm:bottom-5 sm:left-5 sm:max-w-[380px]">
          <div className="flex min-w-0 flex-row items-center gap-2 sm:gap-3">
            {publicAvatarUrl ? (
              <img src={publicAvatarUrl} alt={displayName} className="h-[60px] w-[60px] shrink-0 rounded-full border-2 border-white/85 object-cover shadow-lg shadow-slate-950/25" />
            ) : (
              <div className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-full border-2 border-white/85 bg-brand-950 text-xl font-black text-white shadow-lg shadow-slate-950/25">
                {initial}
              </div>
            )}
            <div className="min-w-0 max-w-[250px] flex-1">
              <h1 className="truncate text-[24px] font-black leading-none text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.38)] sm:text-[26px]"><UserDisplayName name={displayName} uid={uid} badge={equippedBadge} showBadgeName badgeInteraction={badgeInteraction} /></h1>
            </div>
          </div>
          <div className="profile-identity-badges mt-2.5 flex flex-wrap items-center justify-start gap-1.5 text-xs font-bold leading-none text-white/90">
            <span className="profile-identity-badge profile-identity-uid">UID {formatUid(uid)}</span>
            <span className="profile-identity-badge">{growthLevelName}</span>
          </div>
          <p className="mt-2 text-[11px] font-bold text-white/82">
            {admissionInfo.date} 加入E院 <span aria-hidden>·</span> 已入院 {admissionInfo.days} 天
          </p>
          {showGrowth ? <div className="mt-2.5 w-40 max-w-full sm:w-56">
            <div className="flex min-w-0 items-center justify-between gap-2 text-[10px] font-black text-white/85 sm:text-[11px]">
              <span className="shrink-0">成长经验</span>
              <span className="min-w-0 truncate text-right">{experience} / {nextRequiredExp ?? experience} XP</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/18">
              <div className="h-full rounded-full bg-sky-200" style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }} />
            </div>
          </div> : null}
        </div>
      </div>
    </section>
  )
}

export function ProfileStatsGrid({ items, compact = false }: ProfileStatsGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className={`rounded-sm border border-sky-100 bg-sky-50/70 text-center ${compact ? 'p-3' : 'p-4'}`}>
          <p className={`${compact ? 'text-lg' : 'text-xl sm:text-2xl'} font-black text-brand-950`}>{value}</p>
          <p className="mt-1 text-[11px] font-black text-slate-500 sm:text-xs">{label}</p>
        </div>
      ))}
    </div>
  )
}
