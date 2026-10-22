import type { Prisma } from '@prisma/client'
import { readTopicActivityV2Program } from '@/lib/topic-activity-v2-config'
import { topicReviewFilter, type TopicReviewStatus } from '@/lib/topic-review-filter'

export type TopicActivityPlatformTab = { platformKey: string; platformName: string }

/** A V2 submission is reviewable only when it is attached to a configured platform reward entry. */
export function isReviewableTopicActivitySubmission(input: {
  isV2Activity: boolean
  rewardEntryId?: string | null
}) {
  return !input.isV2Activity || Boolean(input.rewardEntryId)
}

export function canShowTopicActivityCommentReviewActions(input: {
  canReview: boolean
  isV2Activity: boolean
  status: string
  rewardEntryId?: string | null
}) {
  return input.canReview
    && input.status === 'PENDING'
    && isReviewableTopicActivitySubmission(input)
}

export function topicActivityPlatformTabs(topicProgram: unknown): TopicActivityPlatformTab[] {
  const program = readTopicActivityV2Program(topicProgram)
  if (!program?.enabled || !program.platformRewards.enabled) return []
  const tabs = new Map<string, string>()
  for (const entry of program.entries) {
    const platformKey = entry.platformKey.trim()
    const platformName = entry.platformName.trim()
    if (entry.enabled && platformKey && platformName && !tabs.has(platformKey)) tabs.set(platformKey, platformName)
  }
  return [...tabs].map(([platformKey, platformName]) => ({ platformKey, platformName }))
}

export function topicActivityPlatformReplyWhere(
  activityId: string | null | undefined,
  platformKey: string | null | undefined,
  discussionOnly = false,
): Prisma.ReplyWhereInput {
  if (!activityId) return {}
  if (discussionOnly) {
    return {
      OR: [
        { TopicActivitySubmission: { is: null } },
        { TopicActivitySubmission: { is: { activityId, rewardEntryId: null } } },
      ],
    }
  }
  if (!platformKey) return {}
  return {
    TopicActivitySubmission: {
      is: { activityId, RewardEntry: { is: { platformKey } } },
    },
  }
}

/**
 * Compose the independent status and comment-tab predicates without object
 * spread overwriting their shared TopicActivitySubmission relation key.
 */
export function topicActivityReviewReplyWhere(
  activityId: string | null | undefined,
  status: TopicReviewStatus | null | undefined,
  platformKey: string | null | undefined,
  discussionOnly = false,
): Prisma.ReplyWhereInput {
  const conditions = [
    topicReviewFilter(activityId, status),
    topicActivityPlatformReplyWhere(activityId, platformKey, discussionOnly),
  ].filter((condition) => Object.keys(condition).length > 0)

  if (conditions.length === 1) return conditions[0]!
  return conditions.length > 1 ? { AND: conditions } : {}
}

/** Scope status-group counts to the currently selected comment tab. */
export function topicActivityReviewSubmissionScopeWhere(
  platformKey: string | null | undefined,
  discussionOnly = false,
): Prisma.TopicActivitySubmissionWhereInput {
  if (discussionOnly) return { rewardEntryId: null }
  if (!platformKey) return {}
  return { RewardEntry: { is: { platformKey } } }
}
