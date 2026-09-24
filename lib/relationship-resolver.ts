import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const RELATIONSHIP_STATES = [
  'SELF',
  'NONE',
  'FOLLOWING',
  'FOLLOWED_BY',
  'MUTUAL',
  'BLOCKED',
] as const

export type RelationshipState = typeof RELATIONSHIP_STATES[number]

export type RelationshipView = {
  state: RelationshipState
  viewerFollowsTarget: boolean
  targetFollowsViewer: boolean
  blocked: boolean
  canMessage: boolean
}

export type RelationshipSignals = {
  viewerFollowsTarget: boolean
  targetFollowsViewer: boolean
  blocked: boolean
}

/**
 * The resolver can run against the normal Prisma client or a transaction
 * client.  Keeping the database dependency this narrow lets authorization be
 * re-checked in the same transaction that creates a conversation/message.
 */
export type RelationshipDatabase = Pick<PrismaClient, 'follow' | 'block'>

const selfRelationship = (): RelationshipView => ({
  state: 'SELF',
  viewerFollowsTarget: false,
  targetFollowsViewer: false,
  blocked: false,
  canMessage: false,
})

export function relationshipStateFromSignals(signals: RelationshipSignals): RelationshipState {
  // Keep this order explicit: it is the product-wide precedence contract.
  if (signals.blocked) return 'BLOCKED'
  if (signals.viewerFollowsTarget && signals.targetFollowsViewer) return 'MUTUAL'
  if (signals.viewerFollowsTarget) return 'FOLLOWING'
  if (signals.targetFollowsViewer) return 'FOLLOWED_BY'
  return 'NONE'
}

export function relationshipViewFromSignals(signals: RelationshipSignals, isSelf = false): RelationshipView {
  if (isSelf) return selfRelationship()
  const state = relationshipStateFromSignals(signals)
  return {
    state,
    viewerFollowsTarget: signals.viewerFollowsTarget,
    targetFollowsViewer: signals.targetFollowsViewer,
    blocked: signals.blocked,
    canMessage: state === 'MUTUAL' && !signals.blocked,
  }
}

/**
 * Resolve a batch of target users with two bounded relation queries. Callers
 * serving a list should use this function so relationship data never becomes
 * one database round-trip per row.
 */
export async function resolveRelationships(
  viewerId: string,
  targetIds: Iterable<string>,
  db: RelationshipDatabase = prisma,
) {
  const ids = [...new Set([...targetIds].filter(Boolean))]
  const result = new Map<string, RelationshipView>()
  for (const targetId of ids) {
    result.set(targetId, targetId === viewerId ? selfRelationship() : {
      state: 'NONE',
      viewerFollowsTarget: false,
      targetFollowsViewer: false,
      blocked: false,
      canMessage: false,
    })
  }

  const otherIds = ids.filter((targetId) => targetId !== viewerId)
  if (!otherIds.length) return result

  const [follows, blocks] = await Promise.all([
    db.follow.findMany({
      where: {
        OR: [
          { followerId: viewerId, followingId: { in: otherIds } },
          { followerId: { in: otherIds }, followingId: viewerId },
        ],
      },
      select: { followerId: true, followingId: true },
    }),
    db.block.findMany({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: { in: otherIds } },
          { blockerId: { in: otherIds }, blockedId: viewerId },
        ],
      },
      select: { blockerId: true, blockedId: true },
    }),
  ])

  const signals = new Map<string, RelationshipSignals>(otherIds.map((targetId) => [targetId, {
    viewerFollowsTarget: false,
    targetFollowsViewer: false,
    blocked: false,
  }]))
  for (const follow of follows) {
    const targetId = follow.followerId === viewerId ? follow.followingId : follow.followerId
    const current = signals.get(targetId)
    if (!current) continue
    if (follow.followerId === viewerId) current.viewerFollowsTarget = true
    if (follow.followingId === viewerId) current.targetFollowsViewer = true
  }
  for (const block of blocks) {
    const targetId = block.blockerId === viewerId ? block.blockedId : block.blockerId
    const current = signals.get(targetId)
    if (current) current.blocked = true
  }
  for (const [targetId, current] of signals) result.set(targetId, relationshipViewFromSignals(current))
  return result
}

export async function resolveRelationship(
  viewerId: string,
  targetId: string,
  db: RelationshipDatabase = prisma,
): Promise<RelationshipView> {
  return (await resolveRelationships(viewerId, [targetId], db)).get(targetId) || selfRelationship()
}
