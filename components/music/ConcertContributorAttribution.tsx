import Link from 'next/link'
import { formatUid } from '@/lib/uid'

export type ConcertContributor = { uid: number; username: string }
type AttributionType = 'SHOW' | 'SETLIST' | 'ENCORE'

const labels: Record<AttributionType, string> = {
  SHOW: '场次提供',
  SETLIST: '歌单提供',
  ENCORE: 'Encore 提供',
}

export function ConcertContributorAttribution({ type, contributor }: { type: AttributionType; contributor?: ConcertContributor | null }) {
  if (!contributor || !contributor.uid || !contributor.username) return null
  return <p className="mt-5 break-words text-xs font-bold text-slate-400/70">{labels[type]}：<Link href={`/user/${formatUid(contributor.uid)}`} className="text-slate-300/80 underline decoration-slate-500/50 underline-offset-2 hover:text-sky-200">{contributor.username}</Link> UID {contributor.uid}</p>
}
