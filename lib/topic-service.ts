import type { Prisma } from '@prisma/client'
import { buildPublicPostWhere } from '@/lib/post-moderation'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'

export const TOPIC_PAGE_SIZE = 20
export const TRENDING_TOPIC_LIMIT = 5
const TRENDING_WINDOW_MS = 24 * 60 * 60 * 1000

const publicTopicPostWhere = (topicId: string, now: Date): Prisma.PostWhereInput => ({
  ...buildPublicPostWhere(now),
  PostTopic: { some: { topicId } },
  User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
})

export const topicPublicSelect = {
  id: true,
  name: true,
  normalizedName: true,
  description: true,
  coverImage: true,
  isOfficial: true,
  activityId: true,
  startAt: true,
  endAt: true,
  createdAt: true,
  updatedAt: true,
  Activity: { select: { id: true, title: true, status: true } },
} satisfies Prisma.TopicSelect

export async function findTopics(search: string, now = new Date()) {
  const keyword = search.trim()
  const topics = await prisma.topic.findMany({
    where: keyword
      ? { OR: [{ name: { contains: keyword } }, { normalizedName: { contains: keyword.toLocaleLowerCase('en-US') } }] }
      : {},
    orderBy: [{ isOfficial: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
    take: 20,
    select: topicPublicSelect,
  })
  const counts = await Promise.all(topics.map(async (topic) => {
    const [postCount, participantCount] = await Promise.all([
      prisma.post.count({ where: publicTopicPostWhere(topic.id, now) }),
      prisma.post.findMany({ where: publicTopicPostWhere(topic.id, now), distinct: ['authorId'], select: { authorId: true }, take: 5_000 }),
    ])
    return { ...topic, coverImage: publicImageUrl(topic.coverImage), postCount, participantCount: participantCount.length }
  }))
  return counts
}

export async function getTopicById(topicId: string, now = new Date()) {
  const topic = await prisma.topic.findUnique({ where: { id: topicId }, select: topicPublicSelect })
  if (!topic) return null
  const [postCount, participantRows] = await Promise.all([
    prisma.post.count({ where: publicTopicPostWhere(topicId, now) }),
    prisma.post.findMany({ where: publicTopicPostWhere(topicId, now), distinct: ['authorId'], select: { authorId: true }, take: 10_000 }),
  ])
  return { ...topic, coverImage: publicImageUrl(topic.coverImage), postCount, participantCount: participantRows.length }
}

export async function getTopicPosts(topicId: string, sort: 'latest' | 'hot' = 'latest', page = 1, now = new Date()) {
  const where = publicTopicPostWhere(topicId, now)
  const total = await prisma.post.count({ where })
  const totalPages = Math.max(1, Math.ceil(total / TOPIC_PAGE_SIZE))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const posts = await prisma.post.findMany({
    where,
    orderBy: sort === 'hot'
      ? [{ likeCount: 'desc' }, { replyCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (safePage - 1) * TOPIC_PAGE_SIZE,
    take: TOPIC_PAGE_SIZE,
    select: {
      id: true,
      title: true,
      content: true,
      richContent: true,
      summary: true,
      createdAt: true,
      expiresAt: true,
      likeCount: true,
      replyCount: true,
      moderationStatus: true,
      User: { select: { id: true, uid: true, nickname: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, avatarUrl: true, Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } } } },
      PostTopic: { select: { Topic: { select: { id: true, name: true } } } },
    },
  })
  return { posts, page: safePage, pageSize: TOPIC_PAGE_SIZE, total, totalPages }
}

type TrendingAccumulator = {
  topic: { id: string; name: string; isOfficial: boolean; coverImage: string | null }
  authors: Map<string, number>
  posts: number
  replies: number
  likes: number
  score: number
}

export async function getTrendingTopics(now = new Date(), limit = TRENDING_TOPIC_LIMIT) {
  const since = new Date(now.getTime() - TRENDING_WINDOW_MS)
  const rows = await prisma.postTopic.findMany({
    where: { Post: { ...buildPublicPostWhere(now), createdAt: { gte: since }, User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } } } },
    orderBy: { createdAt: 'desc' },
    take: 5_000,
    select: {
      Topic: { select: { id: true, name: true, isOfficial: true, coverImage: true } },
      Post: { select: { authorId: true, likeCount: true, replyCount: true, createdAt: true } },
    },
  })
  const byTopic = new Map<string, TrendingAccumulator>()
  for (const row of rows) {
    const current = byTopic.get(row.Topic.id) || {
      topic: { ...row.Topic, coverImage: publicImageUrl(row.Topic.coverImage) },
      authors: new Map<string, number>(),
      posts: 0,
      replies: 0,
      likes: 0,
      score: 0,
    }
    current.posts += 1
    current.replies += row.Post.replyCount
    current.likes += row.Post.likeCount
    const authorPosts = current.authors.get(row.Post.authorId) || 0
    current.authors.set(row.Post.authorId, authorPosts + 1)
    // Count at most the first three posts from one author. Subsequent posts
    // still remain visible and can contribute their normal interaction weight,
    // but cannot keep lifting the topic through post volume alone.
    const cappedPostContribution = authorPosts < 3 ? 1 : 0
    const ageHours = Math.max(0, (now.getTime() - row.Post.createdAt.getTime()) / 3_600_000)
    const decay = 1 / (1 + ageHours / 12)
    current.score += decay * (cappedPostContribution * 1 + row.Post.replyCount * 0.8 + row.Post.likeCount * 0.25)
    byTopic.set(row.Topic.id, current)
  }
  return [...byTopic.values()]
    .map((item) => ({
      ...item.topic,
      participantCount: item.authors.size,
      postCount: item.posts,
      score: item.score,
    }))
    .sort((a, b) => b.score - a.score || b.participantCount - a.participantCount || a.id.localeCompare(b.id))
    .slice(0, limit)
}
