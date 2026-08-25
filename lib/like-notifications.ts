import { Prisma, type PrismaClient } from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { prisma } from '@/lib/prisma'
import { normalizeStoredInternalPath } from '@/lib/url-safety'
import { logNotificationError } from '@/lib/notification-errors'
import { safeNotificationTransaction } from '@/lib/notification-transaction'

export type LikeNotificationTargetKind = 'post' | 'reply'

export type LikeNotificationTarget = {
  kind: LikeNotificationTargetKind
  id: string
  link: string
}

const LIKE_NOTIFICATION_KEY_PREFIX = 'like:'

export function getLikeNotificationKey(kind: LikeNotificationTargetKind, id: string) {
  return `${LIKE_NOTIFICATION_KEY_PREFIX}${kind}:${id}`
}

export function getLikeNotificationLabel(kind: LikeNotificationTargetKind) {
  return kind === 'reply' ? '评论' : '帖子'
}

export function formatLikeNotificationText(actorName: string | null | undefined, count: number, kind: LikeNotificationTargetKind) {
  const label = getLikeNotificationLabel(kind)
  if (count <= 1) return `${actorName || '有人'} 赞了我的${label}`
  return `${actorName ? `${actorName} ` : ''}等共计${count}人赞了我的${label}`
}

function targetFromKey(key: string | null | undefined, link: string | null | undefined): LikeNotificationTarget | null {
  if (!key?.startsWith(LIKE_NOTIFICATION_KEY_PREFIX) || !link) return null
  const match = key.match(/^like:(post|reply):(.+)$/)
  if (!match) return null
  const normalizedLink = normalizeStoredInternalPath(link)
  if (!normalizedLink) return null
  return { kind: match[1] as LikeNotificationTargetKind, id: match[2], link: normalizedLink }
}

export function parseLikeNotificationTarget(input: {
  type?: string | null
  key?: string | null
  link?: string | null
}): LikeNotificationTarget | null {
  if (input.type && input.type !== 'LIKE') return null

  const keyedTarget = targetFromKey(input.key, input.link)
  if (keyedTarget) return keyedTarget
  const normalizedLink = normalizeStoredInternalPath(input.link)
  if (!normalizedLink) return null

  try {
    const url = new URL(normalizedLink, 'https://local.invalid')
    const post = url.pathname.match(/^\/posts\/([^/]+)$/)
    if (!post) return null
    const focus = url.searchParams.get('focus')
    return focus
      ? { kind: 'reply', id: focus, link: normalizedLink }
      : { kind: 'post', id: post[1], link: normalizedLink }
  } catch {
    return null
  }
}

type LikeNotificationRow = {
  id: string
  isRead: boolean
  readAt: Date | null
  actorId: string | null
  createdAt: Date
}

type LikeSnapshot = {
  count: number
  latest: { userId: string; actorName: string; createdAt: Date } | null
}

export type LikeNotificationSyncInput = {
  recipientId: string
  actorId?: string | null
  actorName?: string | null
  target: LikeNotificationTarget
}

async function loadLikeSnapshot(tx: PrismaClient, target: LikeNotificationTarget): Promise<LikeSnapshot> {
  if (target.kind === 'post') {
    const count = await tx.like.count({ where: { postId: target.id } })
    const latest = await tx.like.findFirst({
      where: { postId: target.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { userId: true, createdAt: true, User: { select: { nickname: true, nicknameModerationStatus: true, nicknameViolationDisplay: true } } },
    })
    return {
      count,
      latest: latest ? { userId: latest.userId, actorName: getPublicUserDisplayName(latest.User), createdAt: latest.createdAt } : null,
    }
  }

  const count = await tx.replyLike.count({ where: { replyId: target.id } })
  const latest = await tx.replyLike.findFirst({
    where: { replyId: target.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { userId: true, createdAt: true, User: { select: { nickname: true, nicknameModerationStatus: true, nicknameViolationDisplay: true } } },
  })
  return {
    count,
    latest: latest ? { userId: latest.userId, actorName: getPublicUserDisplayName(latest.User), createdAt: latest.createdAt } : null,
  }
}

function readState(rows: LikeNotificationRow[]) {
  const read = rows.length > 0 && rows.every((row) => row.isRead)
  return {
    isRead: read,
    readAt: read ? rows.find((row) => row.readAt)?.readAt || null : null,
  }
}

/**
 * Keep one personal notification for one post/reply target. The source Like
 * table remains authoritative for the current count; Notification only stores
 * the latest actor, read state, and a stable aggregate key.
 */
async function syncLikeNotificationWithSnapshot(
  tx: Prisma.TransactionClient,
  input: LikeNotificationSyncInput,
  snapshot: LikeSnapshot,
) {
  const key = getLikeNotificationKey(input.target.kind, input.target.id)
  const [aggregate, legacy] = await Promise.all([
    tx.notification.findUnique({
      where: { recipientId_key: { recipientId: input.recipientId, key } },
      select: { id: true, isRead: true, readAt: true, actorId: true, createdAt: true },
    }),
    tx.notification.findMany({
      where: { recipientId: input.recipientId, type: 'LIKE', key: null, link: input.target.link },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, isRead: true, readAt: true, actorId: true, createdAt: true },
    }),
  ])

  const existingRows: LikeNotificationRow[] = [
    ...(aggregate ? [aggregate] : []),
    ...legacy,
  ]

  if (snapshot.count === 0) {
    if (existingRows.length) {
      await tx.notification.deleteMany({ where: { id: { in: existingRows.map((row) => row.id) } } })
    }
    return null
  }

  // Infer the event from the committed source rows instead of requiring every
  // caller to pass a second action argument. A newly-created like is the
  // current latest actor; reconciliation and unlike operations either have no
  // actor or leave another actor as the latest row.
  const isNewLike = Boolean(input.actorId && snapshot.latest?.userId === input.actorId)

  // A cleared notification must not be recreated by a read-time reconciliation
  // or by an unlike that leaves other likes behind.
  if (!isNewLike && existingRows.length === 0) return null

  const preservedReadState = readState(existingRows)
  const actorId = snapshot.latest?.userId || input.actorId || aggregate?.actorId || legacy[0]?.actorId || null
  const actorName = snapshot.latest?.actorName || input.actorName || null
  const data = {
    recipientId: input.recipientId,
    actorId,
    type: 'LIKE' as const,
    title: formatLikeNotificationText(actorName, snapshot.count, input.target.kind),
    content: null,
    link: input.target.link,
    key,
    createdAt: snapshot.latest?.createdAt || aggregate?.createdAt || legacy[0]?.createdAt || new Date(),
    ...(isNewLike ? { isRead: false, readAt: null } : preservedReadState),
  }

  const notification = await tx.notification.upsert({
    where: { recipientId_key: { recipientId: input.recipientId, key } },
    update: data,
    create: data,
    select: { id: true, isRead: true, readAt: true },
  })

  const legacyIds = legacy.map((row) => row.id)
  if (legacyIds.length) await tx.notification.deleteMany({ where: { id: { in: legacyIds } } })
  return notification
}

/**
 * Public post-commit entry point. Like/ReplyLike source rows are never loaded
 * through a caller-owned business transaction.
 */
export async function syncLikeNotification(input: LikeNotificationSyncInput) {
  return syncLikeNotificationSafely(input)
}

/**
 * Post-commit notification path. The Like/ReplyLike statistics are loaded
 * before the notification-only transaction, so reconciliation never keeps one
 * interactive transaction open while it counts source rows.
 */
export async function syncLikeNotificationSafely(
  input: LikeNotificationSyncInput,
) {
  const startedAt = Date.now()
  try {
    const snapshot = await loadLikeSnapshot(prisma, input.target)
    return await safeNotificationTransaction(
      (tx) => syncLikeNotificationWithSnapshot(tx, input, snapshot),
      {
        operation: 'like-notification-sync',
        userId: input.recipientId,
        notificationType: 'LIKE',
      },
    )
  } catch (error) {
    logNotificationError('like-notification-sync', {
      durationMs: Date.now() - startedAt,
      userId: input.recipientId,
      notificationType: 'LIKE',
    }, error)
    return null
  }
}

/** Consolidate old one-like-one-notification rows without recreating cleared rows. */
export async function reconcileLikeNotifications(userId: string) {
  const legacy = await prisma.notification.findMany({
    where: {
      recipientId: userId,
      type: 'LIKE',
      link: { startsWith: '/posts/' },
      OR: [
        { key: null },
        { key: { startsWith: LIKE_NOTIFICATION_KEY_PREFIX } },
      ],
    },
    select: { type: true, key: true, link: true },
  })
  const targets = new Map<string, LikeNotificationTarget>()
  for (const row of legacy) {
    const target = parseLikeNotificationTarget(row)
    if (target) targets.set(`${target.kind}:${target.id}`, target)
  }
  if (!targets.size) return 0

  // Each target gets its own short notification-only transaction. Source Like
  // counts are read before that transaction, and a single slow/invalid target
  // is isolated from the rest of the maintenance pass.
  let reconciled = 0
  for (const target of targets.values()) {
    const result = await syncLikeNotificationSafely({ recipientId: userId, target })
    if (result) reconciled += 1
  }
  return reconciled
}

export async function loadLikeNotificationStats(targets: LikeNotificationTarget[]) {
  const uniqueTargets = Array.from(new Map(targets.map((target) => [`${target.kind}:${target.id}`, target])).values())
  const postIds = uniqueTargets.filter((target) => target.kind === 'post').map((target) => target.id)
  const replyIds = uniqueTargets.filter((target) => target.kind === 'reply').map((target) => target.id)
  const [postCounts, replyCounts] = await Promise.all([
    postIds.length ? prisma.like.groupBy({ by: ['postId'], where: { postId: { in: postIds } }, _count: { _all: true } }) : [],
    replyIds.length ? prisma.replyLike.groupBy({ by: ['replyId'], where: { replyId: { in: replyIds } }, _count: { _all: true } }) : [],
  ])
  const counts = new Map<string, number>()
  for (const row of postCounts) counts.set(`post:${row.postId}`, row._count._all)
  for (const row of replyCounts) counts.set(`reply:${row.replyId}`, row._count._all)
  return counts
}
