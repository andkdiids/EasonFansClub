import { SafeAvatar } from '@/components/SafeAvatar'
import type { DailyPrescriptionUser } from '@/lib/daily-prescription-types'
import { formatUid } from '@/lib/uid'

export function PrescriptionUserBadge({ user }: Readonly<{ user: DailyPrescriptionUser }>) {
  return (
    <div className="prescription-user-badge" aria-label={`用户 ${user.nickname}，UID: ${formatUid(user.uid)}`}>
      <span className="prescription-user-avatar">
        <SafeAvatar src={user.avatarUrl} name={user.nickname} uid={user.uid} variant="avatar-sm" className="h-full w-full" textClassName="text-[10px]" />
      </span>
      <span className="prescription-user-copy">
        <strong className="prescription-user-name" title={user.nickname}>{user.nickname}</strong>
        <small>UID: {formatUid(user.uid)}</small>
      </span>
    </div>
  )
}
