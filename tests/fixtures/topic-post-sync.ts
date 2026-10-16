import type { Prisma } from '@prisma/client'

/** Local transaction surface for the real activity-to-post adapter, never a DB connection. */
export function topicPostSyncFixture(type = 'TOPIC_ACTIVITY', existingBody?: string) {
  const activity = {
    id: 'local-topic', title: '本地话题活动', description: '管理员填写的真正活动说明', type,
    status: 'PUBLISHED', startsAt: new Date('2026-10-01T00:00:00Z'), endsAt: new Date('2026-10-31T00:00:00Z'),
    participationRule: '上传活动相关截图', rewardGrantMode: 'IMMEDIATE' as const, rewardGrantAt: null,
    rewardPoints: 13, rewardBadgeIds: ['local-badge'], pinToPlaza: true,
    activityPostId: existingBody === undefined ? null as string | null : 'local-post', createdById: 'local-admin',
  }
  const post: { content?: string; richContent?: unknown; title?: string } = existingBody === undefined ? {} : { content: existingBody }
  const writes: Array<{ action: string; data: Record<string, unknown> }> = []
  const tx = {
    activity: { findUnique: async () => activity, update: async ({ data }: { data: { activityPostId: string } }) => Object.assign(activity, data) },
    badge: { findMany: async () => [{ name: '本地勋章' }] },
    board: { findUnique: async () => ({ id: 'local-board' }) },
    post: {
      create: async ({ data }: { data: Record<string, unknown> }) => { writes.push({ action: 'create', data }); Object.assign(post, data); return { id: 'local-post' } },
      update: async ({ data }: { data: Record<string, unknown> }) => { writes.push({ action: 'update', data }); Object.assign(post, data); return { id: 'local-post' } },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { writes.push({ action: 'updateMany', data }); return { count: 1 } },
    },
  }
  return { activity, post, writes, tx: tx as unknown as Prisma.TransactionClient }
}
