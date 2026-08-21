import Link from 'next/link'
import { SafeAvatar } from '@/components/SafeAvatar'
import { UiIcon } from '@/components/UiIcon'
import { UserDisplayName } from '@/components/UserDisplayName'
import type { ClinicPublicIdentity } from '@/lib/clinic-service'

export function ClinicIdentityBadge({ identity, compact = false }: Readonly<{ identity: ClinicPublicIdentity; compact?: boolean }>) {
  if (identity.type === 'anonymous') {
    return (
      <span className={`clinic-identity-badge ${compact ? 'is-compact' : ''}`}>
        <span className="clinic-anonymous-avatar" aria-hidden="true"><UiIcon name="stethoscope" /></span>
        <span className="clinic-identity-name">{identity.displayName}</span>
      </span>
    )
  }

  const badge = (
    <span className={`clinic-identity-badge ${compact ? 'is-compact' : ''}`}>
      <span className="clinic-public-avatar"><SafeAvatar src={identity.avatarUrl} name={identity.displayName} uid={identity.uid} /></span>
      <span className="clinic-identity-name"><UserDisplayName name={identity.displayName} uid={identity.uid} badge={identity.equippedBadge} compact /></span>
    </span>
  )
  return identity.canOpenProfile ? <Link href={identity.profileUrl} className="clinic-identity-link">{badge}</Link> : badge
}
