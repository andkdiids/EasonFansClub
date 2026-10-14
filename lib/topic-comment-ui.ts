export type TopicCommentGateMode = 'AFTER_FORM_SUBMIT' | 'AFTER_ADMIN_REPLY'
export type TopicCommentLimit = 'MULTIPLE' | 'SINGLE'

export type TopicCommentBlockReason =
  | 'FORM_REQUIRED_BEFORE_COMMENT'
  | 'ADMIN_REPLY_REQUIRED'
  | 'COMMENT_LIMIT_REACHED'
  | 'ACTIVITY_NOT_STARTED'
  | 'ACTIVITY_ENDED'
  | 'ACTIVITY_CANCELLED'
  | null

export type TopicCommentPolicy = {
  requiresForm: boolean
  gateMode: TopicCommentGateMode
  commentLimit: TopicCommentLimit
}

export type TopicCommentEligibility = TopicCommentPolicy & {
  hasFormSubmission: boolean
  hasAdminReply: boolean
  canComment: boolean
  blockReason: TopicCommentBlockReason
  hasUsedSingleComment: boolean
}

export type TopicCommentEligibilityPayload = {
  policy: TopicCommentPolicy
  eligibility: TopicCommentEligibility
}

const GATE_MODES = new Set<TopicCommentGateMode>(['AFTER_FORM_SUBMIT', 'AFTER_ADMIN_REPLY'])
const COMMENT_LIMITS = new Set<TopicCommentLimit>(['MULTIPLE', 'SINGLE'])
const BLOCK_REASONS = new Set<Exclude<TopicCommentBlockReason, null>>([
  'FORM_REQUIRED_BEFORE_COMMENT',
  'ADMIN_REPLY_REQUIRED',
  'COMMENT_LIMIT_REACHED',
  'ACTIVITY_NOT_STARTED',
  'ACTIVITY_ENDED',
  'ACTIVITY_CANCELLED',
])

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/**
 * The replies endpoint owns this DTO. Keep parsing here so the comments UI
 * fails closed when a stale/malformed response cannot prove eligibility.
 */
export function parseTopicCommentEligibility(value: unknown): TopicCommentEligibilityPayload | null {
  const root = record(value)
  const activity = record(root?.topicActivity)
  const rawPolicy = record(activity?.commentPolicy)
  const rawEligibility = record(activity?.currentUserEligibility)
  if (!rawPolicy || !rawEligibility) return null

  const requiresForm = booleanValue(rawEligibility.requiresForm)
  const gateMode = rawPolicy.gateMode
  const commentLimit = rawPolicy.commentLimit
  const hasFormSubmission = booleanValue(rawEligibility.hasFormSubmission)
  const hasAdminReply = booleanValue(rawEligibility.hasAdminReply)
  const canComment = booleanValue(rawEligibility.canComment)
  const hasUsedSingleComment = booleanValue(rawEligibility.hasUsedSingleComment)
  const rawBlockReason = rawEligibility.blockReason
  const blockReason = rawBlockReason === null ? null : rawBlockReason

  if (
    requiresForm === null
    || typeof gateMode !== 'string' || !GATE_MODES.has(gateMode as TopicCommentGateMode)
    || typeof commentLimit !== 'string' || !COMMENT_LIMITS.has(commentLimit as TopicCommentLimit)
    || hasFormSubmission === null
    || hasAdminReply === null
    || canComment === null
    || hasUsedSingleComment === null
    || (blockReason !== null && (typeof blockReason !== 'string' || !BLOCK_REASONS.has(blockReason as Exclude<TopicCommentBlockReason, null>)))
  ) return null

  const policy: TopicCommentPolicy = {
    requiresForm,
    gateMode: gateMode as TopicCommentGateMode,
    commentLimit: commentLimit as TopicCommentLimit,
  }
  const eligibility: TopicCommentEligibility = {
    ...policy,
    hasFormSubmission,
    hasAdminReply,
    canComment,
    blockReason: blockReason as TopicCommentBlockReason,
    hasUsedSingleComment,
  }
  return { policy, eligibility }
}

export function topicCommentBlockMessage(reason: TopicCommentBlockReason): string {
  switch (reason) {
    case 'FORM_REQUIRED_BEFORE_COMMENT': return '请先填写活动表单后再发表评论。'
    case 'ADMIN_REPLY_REQUIRED': return '表单已提交，等待管理员回复后即可发表评论。'
    case 'COMMENT_LIMIT_REACHED': return '你已使用本活动的参与评论机会。'
    case 'ACTIVITY_NOT_STARTED': return '活动尚未开始，不能发表评论。'
    case 'ACTIVITY_ENDED': return '活动已结束，不能再发表评论。'
    case 'ACTIVITY_CANCELLED': return '活动已取消，不能再发表评论。'
    default: return '当前暂时不能发表评论。'
  }
}
