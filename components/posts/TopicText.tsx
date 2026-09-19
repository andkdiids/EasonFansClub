import Link from 'next/link'
import * as React from 'react'
import type { ReactNode } from 'react'
import { extractTopicNamesFromText, normalizeTopicKey } from '@/lib/post-topics'

export type TopicLink = { id: string; name: string }

export function TopicText({ text, topics = [], className = '' }: Readonly<{ text: string; topics?: readonly TopicLink[]; className?: string }>) {
  const topicByKey = new Map(topics.map((topic) => [normalizeTopicKey(topic.name), topic]))
  const names = extractTopicNamesFromText(text)
  if (!names.length || !topicByKey.size) return className ? <span className={className}>{text}</span> : text

  const pattern = /(^|[^\p{L}\p{N}_/])#([\p{Script=Han}A-Za-z0-9_]+)/gu
  const children: ReactNode[] = []
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    const tokenStart = start + match[1].length
    const token = match[0].slice(match[1].length)
    const topic = topicByKey.get(normalizeTopicKey(token.slice(1)))
    if (!topic) continue
    if (start > cursor) children.push(text.slice(cursor, start))
    if (match[1]) children.push(match[1])
    children.push(
      <Link key={`${topic.id}:${tokenStart}`} href={`/topics/${encodeURIComponent(topic.id)}`} onClick={(event) => event.stopPropagation()} className="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-950">
        {token}
      </Link>,
    )
    cursor = start + match[0].length
  }
  if (!children.length) return className ? <span className={className}>{text}</span> : text
  if (cursor < text.length) children.push(text.slice(cursor))
  return className ? <span className={className}>{children}</span> : <>{children}</>
}
