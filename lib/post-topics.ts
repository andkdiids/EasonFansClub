import type { Prisma } from '@prisma/client'
import type { RichTextBlockNode, RichTextContent, RichTextInlineNode } from '@/lib/rich-text'

export const MAX_POST_TOPICS = 5
export const MAX_TOPIC_NAME_LENGTH = 80

const topicNamePattern = /^[\p{Script=Han}A-Za-z0-9_]{1,80}$/u
const hashtagPattern = /(^|[^\p{L}\p{N}_/])#([\p{Script=Han}A-Za-z0-9_]+)/gu

export class PostTopicInputError extends Error {
  constructor(readonly reason: 'TOO_MANY' | 'INVALID_NAME') {
    super(reason)
    this.name = 'PostTopicInputError'
  }
}

export function normalizeTopicName(value: unknown) {
  if (typeof value !== 'string') return null
  const name = value.trim().replace(/^#+/u, '').normalize('NFKC')
  if (!name || name.length > MAX_TOPIC_NAME_LENGTH || !topicNamePattern.test(name)) return null
  return name
}

export function normalizeTopicKey(name: string) {
  return name.toLocaleLowerCase('en-US')
}

export function extractTopicNamesFromText(value: string) {
  const names: string[] = []
  hashtagPattern.lastIndex = 0
  for (const match of value.matchAll(hashtagPattern)) {
    const name = normalizeTopicName(match[2])
    if (name) names.push(name)
  }
  return names
}

function collectInlineText(content: RichTextInlineNode[] | undefined) {
  return (content || []).flatMap((node) => {
    if (node.type !== 'text') return []
    const marks = node.marks || []
    if (marks.some((mark) => mark.type === 'code' || mark.type === 'link')) return []
    return [node.text]
  }).join('')
}

function collectBlockText(block: RichTextBlockNode): string {
  if (block.type === 'codeBlock') return ''
  if (block.type === 'paragraph' || block.type === 'heading') return collectInlineText(block.content)
  if (block.type === 'listItem' || block.type === 'blockquote') return (block.content || []).map(collectBlockText).join('\n')
  if (block.type === 'bulletList' || block.type === 'orderedList') return (block.content || []).map(collectBlockText).join('\n')
  return ''
}

export function extractTopicNamesFromRichContent(value: RichTextContent) {
  return value.content.flatMap((block) => extractTopicNamesFromText(collectBlockText(block)))
}

function uniqueTopicNames(values: readonly string[]) {
  const seen = new Set<string>()
  const names: string[] = []
  for (const value of values) {
    const name = normalizeTopicName(value)
    if (!name) throw new PostTopicInputError('INVALID_NAME')
    const key = normalizeTopicKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  if (names.length > MAX_POST_TOPICS) throw new PostTopicInputError('TOO_MANY')
  return names
}

export function collectPostTopicNames({
  content,
  richContent,
  topicNames,
}: Readonly<{
  content: string
  richContent?: RichTextContent | null
  topicNames?: unknown
}>) {
  const inlineNames = richContent ? extractTopicNamesFromRichContent(richContent) : extractTopicNamesFromText(content)
  const manualNames = topicNames === undefined
    ? []
    : Array.isArray(topicNames)
      ? topicNames.map((value) => {
          const normalized = normalizeTopicName(value)
          if (!normalized) throw new PostTopicInputError('INVALID_NAME')
          return normalized
        })
      : (() => { throw new PostTopicInputError('INVALID_NAME') })()
  return uniqueTopicNames([...inlineNames, ...manualNames])
}

export async function syncPostTopics(
  tx: Prisma.TransactionClient,
  postId: string,
  topicNames: readonly string[],
  createdById: string,
) {
  const topics = []
  for (const name of uniqueTopicNames(topicNames)) {
    const normalizedName = normalizeTopicKey(name)
    const topic = await tx.topic.upsert({
      where: { normalizedName },
      update: {},
      create: { name, normalizedName, createdById },
      select: { id: true },
    })
    topics.push(topic)
  }
  await tx.postTopic.deleteMany({ where: { postId } })
  if (topics.length) {
    await tx.postTopic.createMany({
      data: topics.map((topic) => ({ postId, topicId: topic.id })),
      skipDuplicates: true,
    })
  }
}
