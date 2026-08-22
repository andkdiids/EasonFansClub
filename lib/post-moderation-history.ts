import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const postModerationHistorySelect = {
  id: true,
  postId: true,
  actorName: true,
  actorUid: true,
  action: true,
  status: true,
  titleSnapshot: true,
  rejectionReason: true,
  createdAt: true,
} as const

export type PostModerationHistoryRow = Prisma.PostModerationHistoryGetPayload<{
  select: typeof postModerationHistorySelect
}>

type PrismaErrorShape = {
  name?: unknown
  code?: unknown
  message?: unknown
  stack?: unknown
  meta?: { code?: unknown; message?: unknown } | unknown
}

function redactSensitiveText(value: string) {
  return value
    .replace(/\b(?:mysql|mariadb|postgres(?:ql)?|prisma(?:\+postgres)?):\/\/[^\s'\"]+/gi, (match) => `${match.slice(0, match.indexOf('://') + 3)}[redacted]`)
    .replace(/\b(password|passwd|secret|token|cookie|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
}

export function describePostModerationHistoryError(error: unknown) {
  const value = error as PrismaErrorShape
  const meta = value?.meta as { code?: unknown; message?: unknown } | undefined
  const message = typeof value?.message === 'string' ? value.message : String(error)
  const stack = typeof value?.stack === 'string' ? value.stack : undefined
  return {
    name: typeof value?.name === 'string' ? value.name : undefined,
    code: typeof value?.code === 'string' ? value.code : undefined,
    metaCode: typeof meta?.code === 'string' || typeof meta?.code === 'number' ? meta.code : undefined,
    message: redactSensitiveText(message),
    stack: stack ? redactSensitiveText(stack) : undefined,
  }
}

/**
 * The history model was added before its production migration was created.
 * Keep the moderation queue usable while that table is absent, but only
 * classify an error as optional when Prisma identifies this exact table.
 */
export function isMissingPostModerationHistoryTableError(error: unknown) {
  const details = describePostModerationHistoryError(error)
  const text = [details.code, details.metaCode, details.message].filter(Boolean).join(' ').toLowerCase()
  return text.includes('postmoderationhistory') && (
    text.includes('p2021')
    || text.includes('p2010')
    || text.includes('1146')
    || text.includes('does not exist')
    || text.includes('not exist')
  )
}

export async function loadPostModerationHistoryByPostIds(
  postIds: readonly string[],
  context: string,
) {
  const ids = Array.from(new Set(postIds.filter(Boolean)))
  const result = new Map<string, PostModerationHistoryRow[]>()
  if (!ids.length) return result

  try {
    const rows = await prisma.postModerationHistory.findMany({
      where: { postId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      select: postModerationHistorySelect,
    })
    for (const row of rows) {
      if (!row.postId) continue
      const current = result.get(row.postId) || []
      current.push(row)
      result.set(row.postId, current)
    }
  } catch (error) {
    console.error(`[${context}.history]`, {
      postCount: ids.length,
      optionalTableMissing: isMissingPostModerationHistoryTableError(error),
      error: describePostModerationHistoryError(error),
    })
  }

  return result
}
