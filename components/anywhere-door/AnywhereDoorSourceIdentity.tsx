import { SafeAvatar } from '@/components/SafeAvatar'

export function AnywhereDoorSourceIdentity({ username, avatarUrl }: Readonly<{
  username: string
  avatarUrl?: string | null
}>) {
  const label = `@${username}`

  return (
    <div className="anywhere-door-source-identity" data-anywhere-door-source-identity>
      <span className="anywhere-door-source-avatar" data-anywhere-door-source-avatar>
        <SafeAvatar src={avatarUrl} name={label} className="h-full w-full" textClassName="text-[11px]" />
      </span>
      <span className="anywhere-door-source-name">{label}</span>
    </div>
  )
}
