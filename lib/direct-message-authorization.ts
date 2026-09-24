import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveRelationship, type RelationshipDatabase, type RelationshipView } from '@/lib/relationship-resolver'

export type DirectMessageDatabase = Pick<PrismaClient, 'follow' | 'block'>

export type DirectMessageAuthorization =
  | { allowed: true; relationship: RelationshipView }
  | {
      allowed: false
      relationship: RelationshipView
      code: 'SELF_MESSAGE' | 'BLOCKED' | 'MUTUAL_FOLLOW_REQUIRED'
      message: string
    }

export class DirectMessageAuthorizationError extends Error {
  readonly code: 'SELF_MESSAGE' | 'BLOCKED' | 'MUTUAL_FOLLOW_REQUIRED'

  constructor(code: DirectMessageAuthorizationError['code'], message: string) {
    super(message)
    this.name = 'DirectMessageAuthorizationError'
    this.code = code
  }
}

/**
 * The single server-side authorization decision for user-created direct
 * messages.  Friendship is deliberately not consulted here; legacy rows are
 * only backfilled into Follow and remain available for rollback/audit.
 */
export async function assertCanDirectMessage(
  viewerId: string,
  targetId: string,
  db: RelationshipDatabase = prisma,
): Promise<DirectMessageAuthorization> {
  const relationship = await resolveRelationship(viewerId, targetId, db)
  if (relationship.state === 'MUTUAL' && relationship.canMessage) {
    return { allowed: true, relationship }
  }

  if (relationship.state === 'SELF') {
    return {
      allowed: false,
      relationship,
      code: 'SELF_MESSAGE',
      message: '不能给自己发送私信',
    }
  }

  if (relationship.state === 'BLOCKED') {
    return {
      allowed: false,
      relationship,
      code: 'BLOCKED',
      message: '当前无法发送私信',
    }
  }

  return {
    allowed: false,
    relationship,
    code: 'MUTUAL_FOLLOW_REQUIRED',
    message: '互相关注后才能发送私信',
  }
}
