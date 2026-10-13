import { secureShuffle } from '@/lib/activity-lottery'
import { TopicLotteryError } from '@/lib/topic-activity-v2-lottery-config'

/** Server-only: crypto.randomInt uses rejection sampling, not biased modulo. */
export function sampleTopicLotteryUsers(users: readonly string[], count: number, rng?: (maximum: number) => number) {
  if (new Set(users).size !== users.length || users.length > 50_000 || !Number.isInteger(count) || count < 0) throw new TopicLotteryError('LOTTERY_CANDIDATES_INVALID', '候选名单无效')
  return secureShuffle(users, rng).slice(0, Math.min(count, users.length))
}
