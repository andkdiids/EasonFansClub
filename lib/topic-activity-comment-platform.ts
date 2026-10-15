import type { Prisma } from '@prisma/client'
import { readTopicActivityV2Program } from '@/lib/topic-activity-v2-config'

export type TopicActivityPlatformTab = { platformKey: string; platformName: string }

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
