import type { TopicActivityV2Program, TopicRewardEntryConfig } from '@/lib/topic-activity-v2-config'

export type TopicActivityV2ActivityStatus = 'UPCOMING' | 'ONGOING' | 'ENDED' | 'CANCELLED'

export type TopicActivityV2AvailabilityDecision = {
  canSubmit: boolean
  code: string | null
}

export type TopicActivityV2Availability = {
  activityStatus: TopicActivityV2ActivityStatus
  entries: Record<string, TopicActivityV2AvailabilityDecision>
  poll: TopicActivityV2AvailabilityDecision
  test: TopicActivityV2AvailabilityDecision
  fixedReward: TopicActivityV2AvailabilityDecision
}

type ActivityInput = {
  status: string
  startsAt: Date | string | null
  endsAt: Date | string | null
  allowImageAttachments: boolean
}

type SubmissionProgress = {
  rewardEntryId?: string | null
  status?: string | null
}

type GrantProgress = {
  rewardEntryId?: string | null
  rewardSnapshot?: unknown
  origin?: string | null
  kind?: string | null
  status?: string | null
}

type PollProgress = {
  pollId?: string | null
}

type TestProgress = {
  testId?: string | null
  configVersion?: number | null
}

export type TopicActivityV2AvailabilityInput = {
  activity: ActivityInput
  program: TopicActivityV2Program | null
  authenticated: boolean
  submissions?: readonly SubmissionProgress[]
  grants?: readonly GrantProgress[]
  pollVotes?: readonly PollProgress[]
  testAttempts?: readonly TestProgress[]
  now?: Date
}

const allowedSubmissionStatuses = new Set(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'])

function decision(code: string | null): TopicActivityV2AvailabilityDecision {
  return code ? { canSubmit: false, code } : { canSubmit: true, code: null }
}

function at(value: Date | string | null | undefined) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function inWindow(startsAt: Date | string | null | undefined, endsAt: Date | string | null | undefined, now: Date) {
  const current = now.getTime()
  const start = at(startsAt)
  const end = at(endsAt)
  return (start === null || current >= start) && (end === null || current <= end)
}

function activityStatus(activity: ActivityInput, now: Date): TopicActivityV2ActivityStatus {
  if (activity.status === 'CANCELLED') return 'CANCELLED'
  const current = now.getTime()
  const start = at(activity.startsAt)
  const end = at(activity.endsAt)
  if (start !== null && current < start) return 'UPCOMING'
  if (end !== null && current > end) return 'ENDED'
  if (activity.status !== 'PUBLISHED') return 'ENDED'
  return 'ONGOING'
}

function activityGate(activity: ActivityInput, status: TopicActivityV2ActivityStatus): string | null {
  if (activity.status !== 'PUBLISHED' && status !== 'CANCELLED') return 'ACTIVITY_CLOSED'
  if (status === 'CANCELLED') return 'ACTIVITY_CANCELLED'
  if (status === 'UPCOMING') return 'ACTIVITY_NOT_STARTED'
  if (status === 'ENDED') return 'ACTIVITY_ENDED'
  return null
}

function snapshotPlatformKey(value: unknown, entriesById: ReadonlyMap<string, TopicRewardEntryConfig>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const nested = source.entry && typeof source.entry === 'object' && !Array.isArray(source.entry)
    ? source.entry as Record<string, unknown>
    : source
  if (typeof nested.platformKey === 'string' && nested.platformKey) return nested.platformKey
  return typeof source.rewardEntryId === 'string' ? entriesById.get(source.rewardEntryId)?.platformKey || null : null
}

function entryAvailability(
  entry: TopicRewardEntryConfig,
  input: TopicActivityV2AvailabilityInput,
  gate: string | null,
  entriesById: ReadonlyMap<string, TopicRewardEntryConfig>,
) {
  if (!input.authenticated) return decision('UNAUTHENTICATED')
  if (!input.program?.enabled) return decision('TOPIC_V2_DISABLED')
  if (gate) return decision(gate)
  if (!input.program.platformRewards.enabled) return decision('TOPIC_V2_PLATFORM_DISABLED')
  if (!entry.enabled) return decision('TOPIC_V2_ENTRY_NOT_FOUND')
  if (!inWindow(entry.startsAt, entry.endsAt, input.now || new Date())) return decision('TOPIC_V2_WINDOW_CLOSED')
  if (entry.maxImages > 0 && !input.activity.allowImageAttachments) return decision('TOPIC_V2_IMAGES_DISABLED')

  const submissions = (input.submissions || []).filter((row) => row.rewardEntryId === entry.id)
  const knownStatuses = submissions.map((row) => row.status || '').filter((value) => allowedSubmissionStatuses.has(value))
  const unknownSubmission = submissions.some((row) => !row.status || !allowedSubmissionStatuses.has(row.status))
  if (unknownSubmission || knownStatuses.some((value) => value === 'PENDING') || (knownStatuses.length > 0 && !entry.allowResubmit)) {
    return decision('TOPIC_V2_RESUBMISSION_NOT_ALLOWED')
  }

  // Match the review service's authoritative limit check. A previously granted
  // entry is already counted but may still be resubmitted when the config allows
  // it; a new entry must fit both the entry and platform limits before review.
  const activeGrants = (input.grants || []).filter((row) => row.status !== 'CANCELLED' && Boolean(row.rewardEntryId))
  const entryGranted = activeGrants.some((row) => row.rewardEntryId === entry.id)
  if (!entryGranted && input.program.platformRewards.maxEntries !== null) {
    const entries = new Set(activeGrants.map((row) => row.rewardEntryId).filter((value): value is string => Boolean(value)))
    if (entries.size >= input.program.platformRewards.maxEntries) return decision('TOPIC_V2_MAX_ENTRIES_REACHED')
  }
  const platformLimit = input.program.platformRewards.allowStacking ? input.program.platformRewards.maxPlatforms : 1
  if (!entryGranted && platformLimit !== null) {
    const platforms = new Set(activeGrants.map((row) => snapshotPlatformKey(row.rewardSnapshot, entriesById)).filter((value): value is string => Boolean(value)))
    if (!platforms.has(entry.platformKey) && platforms.size >= platformLimit) return decision('TOPIC_V2_MAX_PLATFORMS_REACHED')
  }
  return decision(null)
}

function interactiveGate(input: TopicActivityV2AvailabilityInput, gate: string | null) {
  if (!input.authenticated) return 'UNAUTHENTICATED'
  if (!input.program?.enabled) return 'TOPIC_V2_DISABLED'
  return gate
}

export function getTopicActivityV2Availability(input: TopicActivityV2AvailabilityInput): TopicActivityV2Availability {
  const now = input.now || new Date()
  const status = activityStatus(input.activity, now)
  const gate = activityGate(input.activity, status)
  const program = input.program
  const entriesById = new Map((program?.entries || []).map((entry) => [entry.id, entry]))
  const entries = Object.fromEntries((program?.entries || []).map((entry) => [
    entry.id,
    entryAvailability(entry, { ...input, now }, gate, entriesById),
  ]))

  const interactiveBase = interactiveGate({ ...input, now }, gate)
  const poll = !program?.poll.enabled
    ? decision('POLL_DISABLED')
    : interactiveBase
      ? decision(interactiveBase)
      : !inWindow(program.poll.startsAt, program.poll.endsAt, now)
        ? decision('POLL_CLOSED')
        : input.pollVotes?.some((vote) => vote.pollId === program.poll.id) && !program.poll.allowChange
          ? decision('POLL_ALREADY_SUBMITTED')
          : decision(null)

  const test = !program?.test.enabled
    ? decision('TEST_DISABLED')
    : interactiveBase
      ? decision(interactiveBase)
      : !program.test.allowRetake && input.testAttempts?.some((attempt) => attempt.testId === program.test.id)
        ? decision('TEST_RETAKE_NOT_ALLOWED')
        : decision(null)

  let fixedReward: TopicActivityV2AvailabilityDecision
  if (!program?.fixedReward.enabled) fixedReward = decision('TOPIC_V2_FIXED_REWARD_DISABLED')
  else {
    // Fixed claims use their own configured window. The claim service only
    // requires a published activity here; an activity whose public date has
    // ended can still accept a valid fixed claim until this window closes.
    const fixedGate = !input.authenticated
      ? 'UNAUTHENTICATED'
      : !program.enabled
        ? 'TOPIC_V2_DISABLED'
        : input.activity.status !== 'PUBLISHED' ? 'ACTIVITY_CLOSED' : null
    if (fixedGate) fixedReward = decision(fixedGate)
    else {
      const fixedStart = program.fixedReward.startsAt || input.activity.startsAt
      const fixedEnd = program.fixedReward.endsAt || input.activity.endsAt
      const grants = (input.grants || []).filter((row) => row.origin === 'FIXED' || (!row.origin && row.rewardEntryId == null && row.kind === 'POINTS'))
      const currentGrant = grants.find((row) => row.status !== 'CANCELLED')
      if (currentGrant?.status === 'GRANTED') fixedReward = decision('TOPIC_V2_FIXED_REWARD_ALREADY_GRANTED')
      else if (currentGrant) fixedReward = decision('TOPIC_V2_FIXED_REWARD_PENDING')
      else if (grants.some((row) => row.status === 'CANCELLED')) fixedReward = decision('TOPIC_V2_FIXED_REWARD_REJECTED')
      else if (!inWindow(fixedStart, fixedEnd, now)) fixedReward = decision('TOPIC_V2_WINDOW_CLOSED')
      else {
        const condition = program.fixedReward.condition
        const hasEvidence = condition === 'ADMIN_REVIEW'
          || (condition === 'APPROVED_COMMENT' && input.submissions?.some((row) => row.status === 'APPROVED'))
          || (condition === 'POLL' && program.poll.enabled && input.pollVotes?.some((vote) => vote.pollId === program.poll.id))
          || (condition === 'TEST' && program.test.enabled && input.testAttempts?.some((attempt) => attempt.testId === program.test.id && attempt.configVersion === program.test.version))
        fixedReward = hasEvidence ? decision(null) : decision('TOPIC_V2_FIXED_REWARD_NOT_ELIGIBLE')
      }
    }
  }

  return { activityStatus: status, entries, poll, test, fixedReward }
}
