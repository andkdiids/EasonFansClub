export const TOPIC_ACTIVITY_COMMENT_GATE_MODES = ['AFTER_FORM_SUBMIT', 'AFTER_ADMIN_REPLY'] as const
export type TopicActivityCommentGateMode = (typeof TOPIC_ACTIVITY_COMMENT_GATE_MODES)[number]

export const TOPIC_ACTIVITY_COMMENT_LIMITS = ['MULTIPLE', 'SINGLE'] as const
export type TopicActivityCommentLimit = (typeof TOPIC_ACTIVITY_COMMENT_LIMITS)[number]

export type TopicActivityCommentPolicy = Readonly<{
  gateMode: TopicActivityCommentGateMode
  commentLimit: TopicActivityCommentLimit
}>

export const DEFAULT_TOPIC_ACTIVITY_COMMENT_POLICY: TopicActivityCommentPolicy = {
  gateMode: 'AFTER_FORM_SUBMIT',
  commentLimit: 'MULTIPLE',
}

export const TOPIC_ACTIVITY_COMMENT_BLOCK_REASONS = [
  'FORM_REQUIRED_BEFORE_COMMENT',
  'ADMIN_REPLY_REQUIRED',
  'COMMENT_LIMIT_REACHED',
  'ACTIVITY_ENDED',
  'ACTIVITY_CANCELLED',
  'ACTIVITY_NOT_STARTED',
] as const
export type TopicActivityCommentBlockReason = (typeof TOPIC_ACTIVITY_COMMENT_BLOCK_REASONS)[number]

export type TopicActivityCommentEligibility = {
  requiresForm: boolean
  gateMode: TopicActivityCommentGateMode
  commentLimit: TopicActivityCommentLimit
  hasFormSubmission: boolean
  hasAdminReply: boolean
  canComment: boolean
  blockReason: TopicActivityCommentBlockReason | null
  hasUsedSingleComment: boolean
}

type Normalized<T> = { valid: true; value: T } | { valid: false; message: string }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/**
 * Normalize the optional form-level policy. Keeping this optional in the
 * stored schema lets V5 activities retain their exact JSON while all server
 * decisions still resolve to the V6 defaults.
 */
export function normalizeTopicActivityCommentPolicy(value: unknown): Normalized<TopicActivityCommentPolicy> {
  const input = record(value)
  if (!input) return { valid: false, message: '评论策略格式不正确' }
  const gateMode = input.gateMode === undefined ? DEFAULT_TOPIC_ACTIVITY_COMMENT_POLICY.gateMode : input.gateMode
  const commentLimit = input.commentLimit === undefined ? DEFAULT_TOPIC_ACTIVITY_COMMENT_POLICY.commentLimit : input.commentLimit
  if (!TOPIC_ACTIVITY_COMMENT_GATE_MODES.includes(gateMode as TopicActivityCommentGateMode)) return { valid: false, message: '表单后评论开放策略不正确' }
  if (!TOPIC_ACTIVITY_COMMENT_LIMITS.includes(commentLimit as TopicActivityCommentLimit)) return { valid: false, message: '活动评论次数策略不正确' }
  return { valid: true, value: { gateMode: gateMode as TopicActivityCommentGateMode, commentLimit: commentLimit as TopicActivityCommentLimit } }
}

/** Resolve an old/missing policy without changing the old stored snapshot. */
export function resolveTopicActivityCommentPolicy(value: unknown): TopicActivityCommentPolicy {
  const root = record(value)
  const input = root && Object.prototype.hasOwnProperty.call(root, 'commentPolicy')
    ? root.commentPolicy
    : root && (Object.prototype.hasOwnProperty.call(root, 'gateMode') || Object.prototype.hasOwnProperty.call(root, 'commentLimit'))
      ? root
      : undefined
  const normalized = input === undefined ? null : normalizeTopicActivityCommentPolicy(input)
  return normalized?.valid ? normalized.value : DEFAULT_TOPIC_ACTIVITY_COMMENT_POLICY
}

export type TopicActivityAdminReplyUnlock = Readonly<{
  unlocked: true
  unlockedAt: string
  replyId: string
  senderUserId: string
}>

/** The unlock is an immutable audit marker, not a current reply count. */
export function hasTopicActivityAdminReplyUnlock(snapshot: unknown): boolean {
  const value = record(snapshot)?.adminReplyUnlock
  if (value === true) return true
  const marker = record(value)
  return Boolean(marker && (marker.unlocked === true || typeof marker.unlockedAt === 'string'))
}

export function withTopicActivityAdminReplyUnlock(snapshot: unknown, unlock: TopicActivityAdminReplyUnlock): Record<string, unknown> {
  const current = record(snapshot) || {}
  if (hasTopicActivityAdminReplyUnlock(current)) return current
  return { ...current, adminReplyUnlock: unlock }
}

export function resolveTopicActivityCommentEligibility(input: {
  requiresForm: boolean
  policy?: TopicActivityCommentPolicy | null
  hasFormSubmission: boolean
  hasAdminReply: boolean
  hasUsedSingleComment: boolean
  lifecycle?: 'ACTIVE' | 'ENDED' | 'CANCELLED' | 'NOT_STARTED'
}): TopicActivityCommentEligibility {
  const policy = input.policy || DEFAULT_TOPIC_ACTIVITY_COMMENT_POLICY
  let blockReason: TopicActivityCommentBlockReason | null = null
  if (input.lifecycle === 'CANCELLED') blockReason = 'ACTIVITY_CANCELLED'
  else if (input.lifecycle === 'ENDED') blockReason = 'ACTIVITY_ENDED'
  else if (input.lifecycle === 'NOT_STARTED') blockReason = 'ACTIVITY_NOT_STARTED'
  else if (input.requiresForm && !input.hasFormSubmission) blockReason = 'FORM_REQUIRED_BEFORE_COMMENT'
  else if (input.requiresForm && policy.gateMode === 'AFTER_ADMIN_REPLY' && !input.hasAdminReply) blockReason = 'ADMIN_REPLY_REQUIRED'
  else if (policy.commentLimit === 'SINGLE' && input.hasUsedSingleComment) blockReason = 'COMMENT_LIMIT_REACHED'

  return {
    requiresForm: input.requiresForm,
    gateMode: policy.gateMode,
    commentLimit: policy.commentLimit,
    hasFormSubmission: input.hasFormSubmission,
    hasAdminReply: input.hasAdminReply,
    canComment: blockReason === null,
    blockReason,
    hasUsedSingleComment: input.hasUsedSingleComment,
  }
}
