import {
  collectPostReferenceIds,
  collectUserMentionIds,
  enrichRichTextReferenceMetadata,
  extractPlainText,
  validateRichPostContent,
  type RichTextContent,
  type RichTextPostReferenceMetadata,
  type RichTextUserMentionMetadata,
} from '@/lib/rich-text'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicPostWhere } from '@/lib/post-moderation'
import { prisma } from '@/lib/prisma'

export type PostReferenceTarget = {
  id: string
  title: string
  User: {
    uid: number
    nickname: string
    nicknameModerationStatus?: string | null
    nicknameViolationDisplay?: string | null
    username?: string | null
    usernameModerationStatus?: string | null
    Profile?: {
      displayName?: string | null
      displayNameModerationStatus?: string | null
    } | null
  }
}

export type UserMentionTarget = {
  id: string
  uid: number
  nickname: string
  nicknameModerationStatus?: string | null
  nicknameViolationDisplay?: string | null
  username?: string | null
  usernameModerationStatus?: string | null
  Profile?: {
    displayName?: string | null
    displayNameModerationStatus?: string | null
  } | null
}

const publicReferenceUserWhere = { status: 'ACTIVE' as const, isDeleted: false, Profile: { isNot: null } }

/** Server-owned lookup used by both persistence and public hydration. */
export function findPublicPostReferences(postIds: string[]) {
  return prisma.post.findMany({
    where: {
      id: { in: postIds },
      ...publicPostWhere,
      User: publicReferenceUserWhere,
      Board: { isActive: true },
    },
    select: {
      id: true,
      title: true,
      User: {
        select: {
          uid: true,
          nickname: true,
          nicknameModerationStatus: true,
          nicknameViolationDisplay: true,
          Profile: { select: { displayName: true, displayNameModerationStatus: true } },
        },
      },
    },
  })
}

/** Server-owned lookup for public users; no client-side user enumeration. */
export function findPublicUserMentions(userIds: string[]) {
  return prisma.user.findMany({
    where: { id: { in: userIds }, ...publicReferenceUserWhere },
    select: {
      id: true,
      uid: true,
      nickname: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      Profile: { select: { displayName: true, displayNameModerationStatus: true } },
    },
  })
}

export class InvalidPostReferenceError extends Error {
  readonly code = 'INVALID_POST_REFERENCE'

  constructor(readonly postIds: string[]) {
    super('帖子包含不存在或当前不可引用的站内帖子')
    this.name = 'InvalidPostReferenceError'
  }
}

export class InvalidUserMentionError extends Error {
  readonly code = 'INVALID_USER_MENTION'

  constructor(readonly userIds: string[]) {
    super('帖子包含不存在或当前不可用的用户 @ 引用')
    this.name = 'InvalidUserMentionError'
  }
}

function publicPostMetadata(post: PostReferenceTarget): RichTextPostReferenceMetadata {
  return {
    title: post.title,
    authorName: getPublicUserDisplayName(post.User),
    authorUid: post.User.uid,
    available: true,
  }
}

function publicUserMetadata(user: UserMentionTarget): RichTextUserMentionMetadata {
  return {
    displayName: getPublicUserDisplayName(user),
    uid: user.uid,
    available: true,
  }
}

/**
 * Validate reference identities against server-owned rows and overwrite all
 * client-provided snapshots with the current public values.
 */
export async function validateAndNormalizeRichTextReferences(
  richContent: RichTextContent,
  findPosts: (postIds: string[]) => Promise<PostReferenceTarget[]>,
  findUsers: (userIds: string[]) => Promise<UserMentionTarget[]>,
) {
  const postIds = collectPostReferenceIds(richContent)
  const userIds = collectUserMentionIds(richContent)
  if (postIds.length > 50) throw new InvalidPostReferenceError(postIds.slice(50))
  if (userIds.length > 50) throw new InvalidUserMentionError(userIds.slice(50))

  const [posts, users] = await Promise.all([
    postIds.length ? findPosts(postIds) : Promise.resolve([] as PostReferenceTarget[]),
    userIds.length ? findUsers(userIds) : Promise.resolve([] as UserMentionTarget[]),
  ])
  const postsById = new Map(posts.map((post) => [post.id, post]))
  const usersById = new Map(users.map((user) => [user.id, user]))
  const missingPostIds = postIds.filter((postId) => !postsById.has(postId))
  const missingUserIds = userIds.filter((userId) => !usersById.has(userId))
  if (missingPostIds.length) throw new InvalidPostReferenceError(missingPostIds)
  if (missingUserIds.length) throw new InvalidUserMentionError(missingUserIds)

  const postMetadata = new Map(postIds.map((postId) => [postId, publicPostMetadata(postsById.get(postId)!)]))
  const userMetadata = new Map(userIds.map((userId) => [userId, publicUserMetadata(usersById.get(userId)!)]))
  const enriched = enrichRichTextReferenceMetadata(richContent, postMetadata, userMetadata)
  const validation = validateRichPostContent(enriched)
  if (!validation.valid) {
    if (postIds.length) throw new InvalidPostReferenceError(postIds)
    throw new InvalidUserMentionError(userIds)
  }

  return {
    richContent: validation.value,
    plainText: validation.plainText,
    postIds,
    userIds,
  }
}

/**
 * Hydrate snapshots for public rendering. Missing targets are represented as
 * safe fallback labels instead of being dereferenced by the renderer.
 */
export async function hydrateRichTextReferences(
  richContent: RichTextContent,
  findPosts: (postIds: string[]) => Promise<PostReferenceTarget[]>,
  findUsers: (userIds: string[]) => Promise<UserMentionTarget[]>,
) {
  const postIds = collectPostReferenceIds(richContent)
  const userIds = collectUserMentionIds(richContent)
  if (!postIds.length && !userIds.length) return richContent

  const [posts, users] = await Promise.all([
    postIds.length ? findPosts(postIds) : Promise.resolve([] as PostReferenceTarget[]),
    userIds.length ? findUsers(userIds) : Promise.resolve([] as UserMentionTarget[]),
  ])
  const postsById = new Map(posts.map((post) => [post.id, post]))
  const usersById = new Map(users.map((user) => [user.id, user]))
  const postMetadata = new Map<string, RichTextPostReferenceMetadata>(postIds.map((postId) => [postId, postsById.has(postId)
    ? publicPostMetadata(postsById.get(postId)!)
    : { title: '该引用帖子已不可用', authorName: '', available: false }]))
  const userMetadata = new Map<string, RichTextUserMentionMetadata>(userIds.map((userId) => [userId, usersById.has(userId)
    ? publicUserMetadata(usersById.get(userId)!)
    : { displayName: '用户已不可用', available: false }]))

  return enrichRichTextReferenceMetadata(richContent, postMetadata, userMetadata)
}

export function richTextReferencePlainText(value: RichTextContent) {
  return extractPlainText(value)
}
