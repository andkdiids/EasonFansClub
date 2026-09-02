import { Prisma } from '@prisma/client'
import {
  collectActivityReferenceIds,
  collectMaterialReferenceIds,
  collectPostReferenceIds,
  collectUserMentionIds,
  enrichRichTextReferenceMetadata,
  extractPlainText,
  normalizeRichTextReferenceSnapshots,
  validateRichPostContent,
  type RichTextActivityReferenceMetadata,
  type RichTextContent,
  type RichTextMaterialReferenceMetadata,
  type RichTextPostReferenceMetadata,
  type RichTextUserMentionMetadata,
} from '@/lib/rich-text'
import { activityStatusLabel, getActivityDisplayStatus, type ActivityDisplayStatus } from '@/lib/activity'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { getMaterialExchangeState, type MaterialExchangeState } from '@/lib/material-redemption-domain'
import { getMaterialExchangeStateLabel, materialScheduleFromRow } from '@/lib/material-redemptions'
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

export type ActivityReferenceTarget = {
  id: string
  title: string
  coverUrl: string | null
  bannerUrl: string | null
  startsAt: string | null
  endsAt: string | null
  locationName: string | null
  displayStatus: ActivityDisplayStatus
  statusLabel: string
}

export type MaterialReferenceTarget = {
  id: string
  title: string
  coverImageUrl: string | null
  cost: number
  stockRemaining: number
  state: MaterialExchangeState
  stateLabel: string
  linkedActivity: { id: string; title: string } | null
}

const publicReferenceUserWhere = { status: 'ACTIVE' as const, isDeleted: false, Profile: { isNot: null } }

const activityReferenceSelect = {
  id: true,
  title: true,
  coverUrl: true,
  bannerUrl: true,
  locationName: true,
  startsAt: true,
  endsAt: true,
  status: true,
} satisfies Prisma.ActivitySelect

type ActivityReferenceRow = Prisma.ActivityGetPayload<{ select: typeof activityReferenceSelect }>

const materialReferenceSelect = {
  id: true,
  title: true,
  coverImageUrl: true,
  cost: true,
  stockRemaining: true,
  exchangeStartAt: true,
  exchangeEndAt: true,
  redeemEndAt: true,
  redemptionRule: true,
  linkedActivityId: true,
  status: true,
  linkedActivity: { select: { id: true, title: true, startsAt: true, endsAt: true } },
} satisfies Prisma.MaterialRedemptionSelect

type MaterialReferenceRow = Prisma.MaterialRedemptionGetPayload<{ select: typeof materialReferenceSelect }>

export const REFERENCE_SEARCH_RESULT_LIMIT = 15

function activityReferenceTarget(row: ActivityReferenceRow, now = new Date()): ActivityReferenceTarget {
  const displayStatus = getActivityDisplayStatus(row, now)
  return {
    id: row.id,
    title: row.title,
    coverUrl: publicImageUrl(row.coverUrl),
    bannerUrl: publicImageUrl(row.bannerUrl),
    startsAt: row.startsAt?.toISOString() || null,
    endsAt: row.endsAt?.toISOString() || null,
    locationName: row.locationName,
    displayStatus,
    statusLabel: activityStatusLabel(displayStatus),
  }
}

function materialReferenceTarget(row: MaterialReferenceRow, now = new Date()): MaterialReferenceTarget {
  const state = getMaterialExchangeState(row.status, materialScheduleFromRow(row), now)
  return {
    id: row.id,
    title: row.title,
    coverImageUrl: publicImageUrl(row.coverImageUrl),
    cost: row.cost,
    stockRemaining: row.stockRemaining,
    state,
    stateLabel: getMaterialExchangeStateLabel(state),
    linkedActivity: row.linkedActivity ? { id: row.linkedActivity.id, title: row.linkedActivity.title } : null,
  }
}

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

/** Public activities are intentionally limited to rows that a normal visitor can open. */
export function findPublicActivityReferences(activityIds: string[]) {
  return prisma.activity.findMany({
    where: { id: { in: activityIds }, status: { in: ['PUBLISHED', 'CANCELLED'] } },
    select: activityReferenceSelect,
  }).then((rows) => rows.map((row) => activityReferenceTarget(row)))
}

/** Public material references use MaterialRedemption definitions, never orders. */
export function findPublicMaterialReferences(materialIds: string[]) {
  return prisma.materialRedemption.findMany({
    where: { id: { in: materialIds }, status: { in: ['PUBLISHED', 'PAUSED', 'ENDED'] } },
    select: materialReferenceSelect,
  }).then((rows) => rows.map((row) => materialReferenceTarget(row)))
}

export function searchPublicActivityReferences(query: string) {
  return prisma.activity.findMany({
    where: {
      status: { in: ['PUBLISHED', 'CANCELLED'] },
      title: { contains: query },
    },
    orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    take: REFERENCE_SEARCH_RESULT_LIMIT,
    select: activityReferenceSelect,
  }).then((rows) => rows.map((row) => activityReferenceTarget(row)))
}

export function searchPublicMaterialReferences(query: string) {
  return prisma.materialRedemption.findMany({
    where: {
      status: { in: ['PUBLISHED', 'PAUSED', 'ENDED'] },
      OR: [
        { title: { contains: query } },
        { linkedActivity: { title: { contains: query } } },
      ],
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: REFERENCE_SEARCH_RESULT_LIMIT,
    select: materialReferenceSelect,
  }).then((rows) => rows.map((row) => materialReferenceTarget(row)))
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

export class InvalidActivityReferenceError extends Error {
  readonly code = 'INVALID_ACTIVITY_REFERENCE'

  constructor(readonly activityIds: string[]) {
    super('帖子包含不存在或当前不可引用的活动')
    this.name = 'InvalidActivityReferenceError'
  }
}

export class InvalidMaterialReferenceError extends Error {
  readonly code = 'INVALID_MATERIAL_REFERENCE'

  constructor(readonly materialIds: string[]) {
    super('帖子包含不存在或当前不可引用的物料')
    this.name = 'InvalidMaterialReferenceError'
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

function publicActivityMetadata(activity: ActivityReferenceTarget): RichTextActivityReferenceMetadata {
  return {
    title: activity.title,
    coverUrl: activity.coverUrl,
    bannerUrl: activity.bannerUrl,
    startsAt: activity.startsAt,
    endsAt: activity.endsAt,
    locationName: activity.locationName,
    displayStatus: activity.displayStatus,
    statusLabel: activity.statusLabel,
    available: true,
  }
}

function publicMaterialMetadata(material: MaterialReferenceTarget): RichTextMaterialReferenceMetadata {
  return {
    title: material.title,
    coverImageUrl: material.coverImageUrl,
    cost: material.cost,
    stockRemaining: material.stockRemaining,
    state: material.state,
    stateLabel: material.stateLabel,
    linkedActivityId: material.linkedActivity?.id || null,
    linkedActivityTitle: material.linkedActivity?.title || null,
    available: true,
  }
}

/**
 * Validate reference identities against server-owned rows and overwrite all
 * client-provided snapshots with the current public values.
 */
export async function validateAndNormalizeRichTextReferences(
  richContent: RichTextContent,
  findPosts: (postIds: string[]) => Promise<PostReferenceTarget[]> = findPublicPostReferences,
  findUsers: (userIds: string[]) => Promise<UserMentionTarget[]> = findPublicUserMentions,
  findActivities: (activityIds: string[]) => Promise<ActivityReferenceTarget[]> = findPublicActivityReferences,
  findMaterials: (materialIds: string[]) => Promise<MaterialReferenceTarget[]> = findPublicMaterialReferences,
) {
  const postIds = collectPostReferenceIds(richContent)
  const userIds = collectUserMentionIds(richContent)
  const activityIds = collectActivityReferenceIds(richContent)
  const materialIds = collectMaterialReferenceIds(richContent)
  if (postIds.length > 50) throw new InvalidPostReferenceError(postIds.slice(50))
  if (userIds.length > 50) throw new InvalidUserMentionError(userIds.slice(50))
  if (activityIds.length > 50) throw new InvalidActivityReferenceError(activityIds.slice(50))
  if (materialIds.length > 50) throw new InvalidMaterialReferenceError(materialIds.slice(50))

  const [posts, users, activities, materials] = await Promise.all([
    postIds.length ? findPosts(postIds) : Promise.resolve([] as PostReferenceTarget[]),
    userIds.length ? findUsers(userIds) : Promise.resolve([] as UserMentionTarget[]),
    activityIds.length ? findActivities(activityIds) : Promise.resolve([] as ActivityReferenceTarget[]),
    materialIds.length ? findMaterials(materialIds) : Promise.resolve([] as MaterialReferenceTarget[]),
  ])
  const postsById = new Map(posts.map((post) => [post.id, post]))
  const usersById = new Map(users.map((user) => [user.id, user]))
  const activitiesById = new Map(activities.map((activity) => [activity.id, activity]))
  const materialsById = new Map(materials.map((material) => [material.id, material]))
  const missingPostIds = postIds.filter((postId) => !postsById.has(postId))
  const missingUserIds = userIds.filter((userId) => !usersById.has(userId))
  const missingActivityIds = activityIds.filter((activityId) => !activitiesById.has(activityId))
  const missingMaterialIds = materialIds.filter((materialId) => !materialsById.has(materialId))
  if (missingPostIds.length) throw new InvalidPostReferenceError(missingPostIds)
  if (missingUserIds.length) throw new InvalidUserMentionError(missingUserIds)
  if (missingActivityIds.length) throw new InvalidActivityReferenceError(missingActivityIds)
  if (missingMaterialIds.length) throw new InvalidMaterialReferenceError(missingMaterialIds)

  const postMetadata = new Map(postIds.map((postId) => [postId, publicPostMetadata(postsById.get(postId)!)]))
  const userMetadata = new Map(userIds.map((userId) => [userId, publicUserMetadata(usersById.get(userId)!)]))
  const activityMetadata = new Map(activityIds.map((activityId) => [activityId, publicActivityMetadata(activitiesById.get(activityId)!)]))
  const materialMetadata = new Map(materialIds.map((materialId) => [materialId, publicMaterialMetadata(materialsById.get(materialId)!)]))
  const normalizedContent = normalizeRichTextReferenceSnapshots(richContent, postMetadata, userMetadata, activityMetadata, materialMetadata)
  const validation = validateRichPostContent(normalizedContent)
  if (!validation.valid) {
    if (postIds.length) throw new InvalidPostReferenceError(postIds)
    if (userIds.length) throw new InvalidUserMentionError(userIds)
    if (activityIds.length) throw new InvalidActivityReferenceError(activityIds)
    throw new InvalidMaterialReferenceError(materialIds)
  }

  return {
    richContent: validation.value,
    plainText: validation.plainText,
    postIds,
    userIds,
    activityIds,
    materialIds,
  }
}

/**
 * Hydrate snapshots for public rendering. Missing targets are represented as
 * safe fallback labels instead of being dereferenced by the renderer.
 */
export async function hydrateRichTextReferences(
  richContent: RichTextContent,
  findPosts: (postIds: string[]) => Promise<PostReferenceTarget[]> = findPublicPostReferences,
  findUsers: (userIds: string[]) => Promise<UserMentionTarget[]> = findPublicUserMentions,
  findActivities: (activityIds: string[]) => Promise<ActivityReferenceTarget[]> = findPublicActivityReferences,
  findMaterials: (materialIds: string[]) => Promise<MaterialReferenceTarget[]> = findPublicMaterialReferences,
) {
  const postIds = collectPostReferenceIds(richContent)
  const userIds = collectUserMentionIds(richContent)
  const activityIds = collectActivityReferenceIds(richContent)
  const materialIds = collectMaterialReferenceIds(richContent)
  if (!postIds.length && !userIds.length && !activityIds.length && !materialIds.length) return richContent

  const results = await Promise.allSettled([
    postIds.length ? findPosts(postIds) : Promise.resolve([] as PostReferenceTarget[]),
    userIds.length ? findUsers(userIds) : Promise.resolve([] as UserMentionTarget[]),
    activityIds.length ? findActivities(activityIds) : Promise.resolve([] as ActivityReferenceTarget[]),
    materialIds.length ? findMaterials(materialIds) : Promise.resolve([] as MaterialReferenceTarget[]),
  ])
  const posts = results[0].status === 'fulfilled' ? results[0].value : []
  const users = results[1].status === 'fulfilled' ? results[1].value : []
  const activities = results[2].status === 'fulfilled' ? results[2].value : []
  const materials = results[3].status === 'fulfilled' ? results[3].value : []
  const postsById = new Map(posts.map((post) => [post.id, post]))
  const usersById = new Map(users.map((user) => [user.id, user]))
  const activitiesById = new Map(activities.map((activity) => [activity.id, activity]))
  const materialsById = new Map(materials.map((material) => [material.id, material]))
  const postMetadata = new Map<string, RichTextPostReferenceMetadata>(postIds.map((postId) => [postId, postsById.has(postId)
    ? publicPostMetadata(postsById.get(postId)!)
    : { title: '该引用帖子已不可用', authorName: '', available: false }]))
  const userMetadata = new Map<string, RichTextUserMentionMetadata>(userIds.map((userId) => [userId, usersById.has(userId)
    ? publicUserMetadata(usersById.get(userId)!)
    : { displayName: '用户已不可用', available: false }]))
  const activityMetadata = new Map<string, RichTextActivityReferenceMetadata>(activityIds.map((activityId) => [activityId, activitiesById.has(activityId)
    ? publicActivityMetadata(activitiesById.get(activityId)!)
    : { title: '该引用活动已不可用', available: false }]))
  const materialMetadata = new Map<string, RichTextMaterialReferenceMetadata>(materialIds.map((materialId) => [materialId, materialsById.has(materialId)
    ? publicMaterialMetadata(materialsById.get(materialId)!)
    : { title: '该引用物料已不可用', available: false }]))

  return enrichRichTextReferenceMetadata(richContent, postMetadata, userMetadata, activityMetadata, materialMetadata)
}

export function richTextReferencePlainText(value: RichTextContent) {
  return extractPlainText(value)
}
