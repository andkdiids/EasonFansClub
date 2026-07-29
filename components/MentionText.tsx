import Link from 'next/link'
import { formatUid } from '@/lib/uid'

export type ReplyMentionView = {
  id: string
  startIndex: number
  endIndex: number
  user: {
    id: string
    uid: number
    name: string
  }
}

export function MentionText({ text, mentions }: Readonly<{ text: string; mentions?: ReplyMentionView[] }>) {
  const valid = (mentions || [])
    .filter((mention) =>
      mention.startIndex >= 0
      && mention.endIndex > mention.startIndex
      && mention.endIndex <= text.length
      && text[mention.startIndex] === '@',
    )
    .sort((a, b) => a.startIndex - b.startIndex)

  if (!valid.length) return text
  const parts: React.ReactNode[] = []
  let cursor = 0
  valid.forEach((mention) => {
    if (mention.startIndex < cursor) return
    parts.push(text.slice(cursor, mention.startIndex))
    parts.push(
      <Link key={mention.id} href={`/user/${formatUid(mention.user.uid)}`} className="font-semibold text-brand-700">
        @{mention.user.name}
      </Link>,
    )
    cursor = mention.endIndex
  })
  parts.push(text.slice(cursor))
  return parts
}
