import { topicV2ErrorResponse, topicV2Json } from '@/lib/topic-activity-v2-http'
import { TopicLotteryError } from '@/lib/topic-activity-v2-lottery-config'
import { TopicLotteryPiiError } from '@/lib/topic-activity-v2-lottery-private'

function controlledStatus(status: unknown, fallback: number) {
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback
}

/**
 * Lottery services have two error classes in addition to the shared V2 domain
 * error. Keep their stable codes/messages while still hiding all unexpected
 * errors behind the shared no-store generic response.
 */
export function topicLotteryErrorResponse(error: unknown) {
  if (error instanceof TopicLotteryError || error instanceof TopicLotteryPiiError) {
    return topicV2Json({ code: error.code, message: error.message }, controlledStatus(error.status, 500))
  }
  return topicV2ErrorResponse(error)
}
