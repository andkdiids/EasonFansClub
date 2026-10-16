import type { PrismaClient } from '@prisma/client'
import { topicV2EntryGrantKey } from '@/lib/topic-activity-v2'

type Submission = {
  userId: string
  rewardEntryId: string | null
  rewardSnapshot: unknown
  rejectReason: string | null
}
type Evidence = {
  activityTitle: string
  snapshot: unknown
  status: 'APPROVED' | 'REJECTED'
  rejectReason: string | null
  grant: { status: string; points: number | null } | null
  eligible: boolean
}

export function topicReviewRejectionReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const reason = value.trim()
  return reason.length >= 2 && reason.length <= 200 ? reason : null
}

export function buildTopicReviewNotification(evidence: Evidence) {
  const raw = evidence.snapshot && typeof evidence.snapshot === 'object' && !Array.isArray(evidence.snapshot)
    ? evidence.snapshot as Record<string, unknown> : {}
  const entry = raw.entry && typeof raw.entry === 'object' && !Array.isArray(raw.entry) ? raw.entry as Record<string, unknown> : raw
  const platform = typeof entry.platformName === 'string' && entry.platformName.trim() ? entry.platformName.trim() : '活动'
  const task = typeof entry.title === 'string' && entry.title.trim() ? `「${entry.title.trim()}」任务` : '任务'
  const prefix = `你在「${evidence.activityTitle}」活动提交的${platform}${task}`
  if (evidence.status === 'REJECTED') return {
    title: `${platform}任务审核未通过`,
    content: `${prefix}未通过审核。原因：${evidence.rejectReason || '未提供原因，请联系活动管理员。'}`,
  }
  const paid = evidence.grant?.status === 'GRANTED' && typeof evidence.grant.points === 'number'
    && Number.isSafeInteger(evidence.grant.points) && evidence.grant.points >= 0
  return {
    title: `${platform}任务审核通过`,
    content: `${prefix}已审核通过。${paid ? `该任务奖励已发放：${evidence.grant!.points} 挂号费。` : '奖励尚未确认到账。'}${evidence.eligible ? '你已获得本活动 1 次抽奖资格。' : ''}`,
  }
}

// Only read committed evidence; never issue rewards or create eligibility here.
export async function readTopicReviewNotification(db: Pick<PrismaClient, 'activity' | 'topicActivityRewardGrant' | 'topicActivityLotteryEligibility'>,
  activityId: string, submission: Submission, status: Evidence['status']) {
  const [activity, grant, eligibility] = await Promise.all([
    db.activity.findUnique({ where: { id: activityId }, select: { title: true } }),
    status === 'APPROVED' && submission.rewardEntryId ? db.topicActivityRewardGrant.findUnique({
      where: { grantKey: topicV2EntryGrantKey(activityId, submission.rewardEntryId, submission.userId) },
      select: { status: true, points: true },
    }) : null,
    status === 'APPROVED' ? db.topicActivityLotteryEligibility.findUnique({
      where: { activityId_userId: { activityId, userId: submission.userId } }, select: { valid: true },
    }) : null,
  ])
  return buildTopicReviewNotification({ activityTitle: activity?.title || '话题活动', snapshot: submission.rewardSnapshot,
    status, rejectReason: submission.rejectReason, grant, eligible: eligibility?.valid === true })
}
