import { parseActivityDateInput } from '@/lib/activity'

export type TopicRewardReleaseTimingInput = {
  rewardGrantMode?: string | null
  rewardGrantAt?: Date | string | null
}

/**
 * Resolve the legacy Activity reward release gate used by all Topic V2
 * grant rows. Unknown or malformed schedules fail closed so a bad value can
 * never turn a pending reward into an immediate grant.
 */
export function topicRewardReleaseDue(input: TopicRewardReleaseTimingInput, now: Date): boolean {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return false
  if (input.rewardGrantMode === 'IMMEDIATE') return true
  if (input.rewardGrantMode !== 'SCHEDULED' || input.rewardGrantAt == null) return false
  const releaseAt = parseActivityDateInput(input.rewardGrantAt)
  return Boolean(releaseAt && releaseAt.getTime() <= now.getTime())
}
