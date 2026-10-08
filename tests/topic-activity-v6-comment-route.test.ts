import assert from 'node:assert/strict'
import Module from 'node:module'
import { before, test } from 'node:test'
import {
  resolveTopicActivityCommentEligibility,
  resolveTopicActivityCommentPolicy,
  type TopicActivityCommentEligibility,
} from '@/lib/topic-activity-comment-policy'

type ActivityStatus = 'PUBLISHED' | 'DRAFT' | 'CANCELLED'
type ParticipationMode = 'COMMENT' | 'FORM' | 'BOTH'
type UserRole = 'USER' | 'ADMIN' | 'SUPER_ADMIN'

type FixtureForm = {
  id: string
  activityId: string
  userId: string
  formSchemaSnapshot: Record<string, unknown>
  replies: Array<{ id: string; content: string | null; imageIds: string[] }>
}

type FixtureSubmission = {
  id: string
  activityId: string
  userId: string
  commentId: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'
  commentDeletedAt: Date | null
}

type FixtureActivity = {
  id: string
  title: string
  type: 'TOPIC_ACTIVITY'
  status: ActivityStatus
  activityPostId: string
  startsAt: Date | null
  endsAt: Date | null
  participationMode: ParticipationMode
  formSchema: Record<string, unknown>
  allowImageAttachments: boolean
}

type FixtureReply = {
  id: string
  postId: string
  authorId: string
  parentId: string | null
  content: string
  moderationStatus: 'PENDING'
  stickerId: string | null
  isPinned: boolean
  likeCount: number
  floorNumber: number | null
  isDeleted?: boolean
  createdAt: Date
  updatedAt: Date
}

type FixtureState = {
  activity: FixtureActivity
  post: { id: string; authorId: string; isDeleted: boolean; isLocked: boolean }
  currentUser: { id: string; uid: number; nickname: string; role: UserRole }
  forms: FixtureForm[]
  submissions: FixtureSubmission[]
  replies: FixtureReply[]
  adminAssets: Array<{ id: string; activityId: string; uploadedByUserId: string; storageKey: string; mimeType: string; width: number; height: number; size: number; replyId: string | null }>
  nextReplyId: number
  nextFloor: number
  sideEffects: { communityRewards: number; tasks: number; friends: number; notifications: number }
  formSubmission: FixtureForm
}

const now = () => new Date('2026-10-08T04:00:00.000Z')
const participant = (role: UserRole = 'USER') => ({ id: 'participant-1', uid: 1001, nickname: '参与者', role })

let state: FixtureState
let repliesRoute: typeof import('../app/api/posts/[postId]/replies/route')
let adminRepliesRoute: typeof import('../app/api/admin/topic-activity-form-submissions/[submissionId]/replies/route')

function resetFixture(input: Partial<{
  gateMode: 'AFTER_FORM_SUBMIT' | 'AFTER_ADMIN_REPLY'
  commentLimit: 'MULTIPLE' | 'SINGLE'
  mode: ParticipationMode
  status: ActivityStatus
  startsAt: Date | null
  endsAt: Date | null
  role: UserRole
}> = {}) {
  const form: FixtureForm = {
    id: 'form-1',
    activityId: 'activity-1',
    userId: 'participant-1',
    formSchemaSnapshot: { version: 1, fields: [] },
    replies: [],
  }
  state = {
    activity: {
      id: 'activity-1',
      title: '话题活动 fixture',
      type: 'TOPIC_ACTIVITY',
      status: input.status || 'PUBLISHED',
      activityPostId: 'post-1',
      startsAt: input.startsAt === undefined ? new Date(now().getTime() - 86_400_000) : input.startsAt,
      endsAt: input.endsAt === undefined ? new Date(now().getTime() + 86_400_000) : input.endsAt,
      participationMode: input.mode || 'BOTH',
      allowImageAttachments: true,
      formSchema: {
        version: 1,
        fields: [{ id: 'name', label: '姓名', type: 'TEXT' }],
        commentPolicy: {
          gateMode: input.gateMode || 'AFTER_FORM_SUBMIT',
          commentLimit: input.commentLimit || 'MULTIPLE',
        },
      },
    },
    post: { id: 'post-1', authorId: 'post-owner', isDeleted: false, isLocked: false },
    currentUser: participant(input.role),
    forms: [],
    submissions: [],
    replies: [],
    adminAssets: [],
    nextReplyId: 1,
    nextFloor: 1,
    sideEffects: { communityRewards: 0, tasks: 0, friends: 0, notifications: 0 },
    formSubmission: form,
  }
}

function formSnapshotWithUnlock() {
  return state.forms.some((form) => form.formSchemaSnapshot.adminReplyUnlock)
}

function addForm(options: { replied?: boolean; imageReply?: boolean } = {}) {
  const form = structuredClone(state.formSubmission)
  form.formSchemaSnapshot = { version: 1, fields: [] }
  form.replies = options.replied || options.imageReply
    ? [{ id: 'admin-reply-1', content: options.replied ? '收到' : null, imageIds: options.imageReply ? ['asset-1'] : [] }]
    : []
  state.forms = [form]
  state.formSubmission = form
}

function addSubmission(input: Partial<FixtureSubmission> = {}) {
  state.submissions.push({
    id: input.id || `submission-${state.submissions.length + 1}`,
    activityId: input.activityId || state.activity.id,
    userId: input.userId || state.currentUser.id,
    commentId: input.commentId === undefined ? `comment-history-${state.submissions.length + 1}` : input.commentId,
    status: input.status || 'PENDING',
    commentDeletedAt: input.commentDeletedAt === undefined ? null : input.commentDeletedAt,
  })
}

function makeRequest(body: Record<string, unknown>, postId = 'post-1') {
  return new Request(`https://ecfc.invalid/api/posts/${postId}/replies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeAdminReplyRequest(body: Record<string, unknown>, submissionId = 'form-1') {
  return new Request(`https://ecfc.invalid/api/admin/topic-activity-form-submissions/${submissionId}/replies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://ecfc.invalid' },
    body: JSON.stringify(body),
  })
}

function postContext(postId = 'post-1') {
  return { params: Promise.resolve({ postId }) }
}

function adminReplyContext(submissionId = 'form-1') {
  return { params: Promise.resolve({ submissionId }) }
}

function createdReply(id: string, postId: string, authorId: string, content: string, parentId: string | null, floorNumber: number | null) {
  const createdAt = now()
  return {
    id,
    postId,
    authorId,
    parentId,
    content,
    moderationStatus: 'PENDING' as const,
    stickerId: null,
    isPinned: false,
    likeCount: 0,
    floorNumber,
    createdAt,
    updatedAt: createdAt,
    User: {
      id: authorId,
      uid: state.currentUser.uid,
      nickname: state.currentUser.nickname,
      usernameModerationStatus: 'APPROVED',
      nicknameModerationStatus: 'APPROVED',
      nicknameViolationDisplay: null,
      level: 1,
      avatarUrl: null,
      Profile: { displayName: state.currentUser.nickname, displayNameModerationStatus: 'APPROVED', avatarUrl: null },
    },
    sticker: null,
  }
}

function eligibilityFor(activity: FixtureActivity, userId: string): TopicActivityCommentEligibility {
  const policy = resolveTopicActivityCommentPolicy(activity.formSchema)
  const requiresForm = activity.participationMode === 'FORM' || activity.participationMode === 'BOTH'
  const userForms = state.forms.filter((form) => form.activityId === activity.id && form.userId === userId)
  const hasAdminReply = userForms.some((form) => Boolean(form.formSchemaSnapshot.adminReplyUnlock) || form.replies.some((reply) => Boolean(reply.content?.trim()) || reply.imageIds.length > 0))
  const hasUsedSingleComment = policy.commentLimit === 'SINGLE' && state.submissions.some((submission) => submission.activityId === activity.id && submission.userId === userId)
  const lifecycle = activity.status === 'CANCELLED'
    ? 'CANCELLED' as const
    : activity.status !== 'PUBLISHED' || (activity.startsAt && activity.startsAt > now())
      ? 'NOT_STARTED' as const
      : activity.endsAt && activity.endsAt < now()
        ? 'ENDED' as const
        : 'ACTIVE' as const
  return resolveTopicActivityCommentEligibility({ requiresForm, policy, hasFormSubmission: userForms.length > 0, hasAdminReply, hasUsedSingleComment, lifecycle })
}

const txStub = {
  $queryRaw: async () => [],
  activity: {
    findUnique: async () => state.activity,
  },
  post: {
    findFirst: async () => state.post.isDeleted || state.post.isLocked ? null : { id: state.post.id, authorId: state.post.authorId },
    update: async () => ({ id: state.post.id }),
  },
  user: {
    findFirstOrThrow: async () => ({ id: state.currentUser.id }),
  },
  reply: {
    findFirst: async (args: { where: Record<string, unknown> }) => {
      const where = args.where
      if (typeof where.id === 'string') return state.replies.find((reply) => reply.id === where.id && reply.isDeleted !== true) || null
      if (typeof where.content === 'string') return state.replies.find((reply) => reply.postId === where.postId && reply.authorId === where.authorId && reply.parentId === where.parentId && reply.content === where.content) || null
      return null
    },
    create: async (args: { data: { postId: string; authorId: string; content: string; parentId: string | null; floorNumber: number | null } }) => {
      const id = `reply-${state.nextReplyId++}`
      const reply = createdReply(id, args.data.postId, args.data.authorId, args.data.content, args.data.parentId, args.data.floorNumber)
      state.replies.push({ ...reply, createdAt: reply.createdAt, updatedAt: reply.updatedAt })
      return reply
    },
  },
  replyMention: { createMany: async () => ({ count: 0 }) },
  friendActivity: { create: async () => { state.sideEffects.friends += 1 } },
  topicActivityFormSubmission: {
    findMany: async () => state.forms,
    findUnique: async () => state.formSubmission,
    update: async (args: { data: { formSchemaSnapshot: Record<string, unknown> } }) => {
      state.formSubmission.formSchemaSnapshot = args.data.formSchemaSnapshot
      const current = state.forms.find((form) => form.id === state.formSubmission.id)
      if (current) current.formSchemaSnapshot = args.data.formSchemaSnapshot
      return state.formSubmission
    },
  },
  topicActivitySubmission: {
    findFirst: async () => state.submissions[0] || null,
  },
  topicActivityImageAsset: {
    findMany: async (args: { where: { id: { in: string[] } } }) => state.adminAssets.filter((asset) => args.where.id.in.includes(asset.id) && !asset.replyId),
    updateMany: async (args: { where: { id: { in: string[] } }; data: { replyId: string } }) => {
      let count = 0
      for (const asset of state.adminAssets) if (args.where.id.in.includes(asset.id) && !asset.replyId) { asset.replyId = args.data.replyId; count += 1 }
      return { count }
    },
  },
  topicActivitySubmissionReply: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = state.formSubmission.replies.find((reply) => reply.id === where.id)
      return row ? { ...row, submissionId: state.formSubmission.id, senderUserId: 'admin-1', ImageAssets: state.adminAssets.filter((asset) => asset.replyId === row.id).map((asset) => ({ id: asset.id })) } : null
    },
    create: async (args: { data: { id?: string; submissionId: string; senderUserId: string; content: string | null } }) => {
      const id = args.data.id || `admin-reply-${state.formSubmission.replies.length + 1}`
      state.formSubmission.replies.push({ id, content: args.data.content, imageIds: [] })
      const current = state.forms.find((form) => form.id === args.data.submissionId)
      if (current && current !== state.formSubmission) current.replies = state.formSubmission.replies
      return { id }
    },
  },
}

let transactionTail = Promise.resolve()
function matchingReplies(where: Record<string, unknown>) {
  assert.equal(where.OR, undefined, 'own author must not bypass administrative status filtering')
  const status = (where.TopicActivitySubmission as { is?: { status?: string } } | undefined)?.is?.status
  return state.replies.filter((reply) => reply.postId === where.postId && !reply.isDeleted
    && (where.parentId === null ? reply.parentId === null : true)
    && (typeof where.isPinned === 'boolean' ? reply.isPinned === where.isPinned : true)
    && (!status || state.submissions.some((submission) => submission.commentId === reply.id && submission.status === status)))
}
const prismaStub = {
  activity: {
    findFirst: async () => state.activity,
  },
  post: {
    findFirst: async () => state.post.isDeleted || state.post.isLocked || state.activity.status === 'CANCELLED' ? null : { id: state.post.id, authorId: state.post.authorId },
    updateMany: async () => ({ count: 0 }),
  },
  friendship: { findMany: async () => [] },
  block: { findMany: async () => [] },
  reply: {
    findFirst: async (args: { where: Record<string, unknown> }) => txStub.reply.findFirst(args),
    count: async ({ where }: { where: Record<string, unknown> }) => matchingReplies(where).length,
    findMany: async ({ where, skip = 0, take }: { where: Record<string, unknown>; skip?: number; take?: number }) => {
      if (typeof where.parentId === 'object' && where.parentId !== null) return []
      return matchingReplies(where).slice(skip, take === undefined ? undefined : skip + take)
    },
    updateMany: async () => ({ count: 1 }),
  },
  replyLike: { findMany: async () => [] },
  topicActivitySubmission: {
    findFirst: async () => state.submissions[0] || null,
    findMany: async ({ where }: { where: { commentId: { in: string[] } } }) => state.submissions.filter((submission) => submission.commentId && where.commentId.in.includes(submission.commentId)),
    groupBy: async ({ by }: { by: string[] }) => {
      const grouped = new Map<string, number>()
      for (const submission of state.submissions) {
        if (!state.replies.some((reply) => reply.id === submission.commentId && !reply.isDeleted && !reply.parentId)) continue
        if (by[0] === 'userId' && submission.status !== 'APPROVED') continue
        const key = by[0] === 'status' ? submission.status : submission.userId
        grouped.set(key, (grouped.get(key) || 0) + 1)
      }
      return [...grouped].map(([key, count]) => ({ [by[0]]: key, _count: { _all: count } }))
    },
  },
  topicActivityFormSubmission: {
    findMany: async () => state.forms.map((form) => ({ ...form, Replies: form.replies.map((reply) => ({ ...reply, ImageAssets: reply.imageIds.map((id) => ({ id })) })) })),
    groupBy: async () => [],
    findUnique: async () => ({ id: state.formSubmission.id, activityId: state.formSubmission.activityId, userId: state.formSubmission.userId, Activity: { title: state.activity.title }, formSchemaSnapshot: state.formSubmission.formSchemaSnapshot, ImageAssets: [], Replies: state.formSubmission.replies.map((reply) => ({ id: reply.id, content: reply.content, Sender: { id: 'admin-1', nickname: '管理员' }, ImageAssets: reply.imageIds.map((id) => ({ id })) })) }),
  },
  $transaction: async <T>(operation: (tx: typeof txStub) => Promise<T>) => {
    const previous = transactionTail
    let release!: () => void
    transactionTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await operation(txStub) } finally { release() }
  },
}

const topicActivityStub = {
  isTopicActivityFormRequired: (activity: FixtureActivity) => activity.participationMode === 'FORM' || activity.participationMode === 'BOTH',
  topicActivityCommentGateErrorCode: (reason: TopicActivityCommentEligibility['blockReason']) => reason === 'COMMENT_LIMIT_REACHED' ? 'TOPIC_ACTIVITY_COMMENT_LIMIT_REACHED' : reason,
  resolveTopicActivityCommentEligibilityInTransaction: async (_tx: typeof txStub, input: { activity: FixtureActivity; userId: string; now: Date }) => eligibilityFor(input.activity, input.userId),
  createTopicSubmissionForCommentInTransaction: async (_tx: typeof txStub, input: { postId: string; commentId: string; userId: string; now: Date }) => {
    if (state.activity.status !== 'PUBLISHED' || (state.activity.startsAt && state.activity.startsAt > input.now) || (state.activity.endsAt && state.activity.endsAt < input.now)) return null
    const submission: FixtureSubmission = { id: `submission-${state.submissions.length + 1}`, activityId: state.activity.id, userId: input.userId, commentId: input.commentId, status: 'PENDING', commentDeletedAt: null }
    state.submissions.push(submission)
    return { id: submission.id, activityId: submission.activityId, status: submission.status }
  },
}

const securityStub = {
  requireRequestUser: async () => ({ user: state.currentUser }),
  requireRequestAdmin: async () => ({ user: { id: 'admin-1', role: 'ADMIN' as const } }),
  rejectInvalidRequestOrigin: () => null,
  enforceApiRateLimit: async () => null,
  isAdminRole: (role: UserRole) => role === 'ADMIN' || role === 'SUPER_ADMIN',
  resolveRequestAuth: async () => ({ user: state.currentUser, response: null }),
  sanitizeText: (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '',
}

const originalLoad = (Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown })._load

before(async () => {
  resetFixture()
  ;(Module as unknown as { _load: typeof originalLoad })._load = function (request, parent, isMain) {
    if (request === '@/lib/prisma') return { prisma: prismaStub }
    if (request === '@/lib/security') return securityStub
    if (request === '@/lib/topic-activity') return topicActivityStub
    if (request === '@/lib/admin-permissions') return { hasAdminPermission: async () => state.currentUser.role !== 'USER' }
    if (request === '@/lib/friend-remarks') return { getPublicUserDisplayName: (user: { nickname: string }) => user.nickname }
    if (request === '@/lib/community-rewards') return { awardCommunityCommentRewards: async () => { state.sideEffects.communityRewards += 1; return { commenterRewardPoints: 0 } } }
    if (request === '@/lib/content-images') return { publicContentImageMarkers: (value: string) => value, appendContentImages: (value: string) => value, parseContentImageUrls: (value: unknown) => Array.isArray(value) ? value : [] }
    if (request === '@/lib/images') return { publicImageUrl: (value: string | null) => value }
    if (request === '@/lib/post-replies') return { parsePostReplyDirection: () => 'asc', parsePostReplySort: () => 'floor', getPostReplyOrderBy: () => [], getPostReplyOffset: () => 0, getPostReplyTotalPages: (value: number) => Math.max(1, value), POST_REPLY_PAGE_SIZE: 20 }
    if (request === '@/lib/post-moderation') return { buildPublicPostWhere: () => ({ isDeleted: false, status: 'PUBLISHED', moderationStatus: { in: ['APPROVED', 'VIOLATION'] } }) }
    if (request === '@/lib/realtime') return { emitRealtimeMany: () => undefined }
    if (request === '@/lib/content-moderation') return { publicModerationText: (value: string) => value, BANNED_WORD_MESSAGE: 'blocked', CONTENT_CONTAINS_BANNED_WORD: 'CONTENT_CONTAINS_BANNED_WORD', checkBannedWords: async () => ({ blocked: false }) }
    if (request === '@/lib/sticker-center') return { isStickerVisible: async () => true, recordStickerUsage: async () => undefined }
    if (request === '@/lib/ip-region') return { resolveIpLocation: async () => null, updateUserIpRegion: async () => null }
    if (request === '@/lib/notification-transaction') return { safeNotificationWrite: async (operation: () => Promise<unknown>) => { state.sideEffects.notifications += 1; return operation() } }
    if (request === '@/lib/notification-write') return { createManyNotifications: async () => ({ count: 1 }) }
    if (request === '@/lib/post-comment-floor') return { allocatePostCommentFloor: async () => state.nextFloor++ }
    if (request === '@/lib/growth-tasks/service') return { completeTask: async () => undefined, resolveAndGrantWeeklyMilestonesInTransaction: async () => { state.sideEffects.tasks += 1; return { rewards: [], balance: 0 } } }
    if (request === '@/lib/checkin') return { getShanghaiDateKey: () => '2026-10-08' }
    if (request === '@/lib/topic-activity-form-view') return { serializeTopicActivityFormSubmission: async (row: { Replies: Array<{ id: string; content: string | null }> }) => ({ replies: row.Replies.map((reply) => ({ id: reply.id, content: reply.content, images: [] })) }) }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    repliesRoute = await import('../app/api/posts/[postId]/replies/route')
    adminRepliesRoute = await import('../app/api/admin/topic-activity-form-submissions/[submissionId]/replies/route')
  } finally {
    ;(Module as unknown as { _load: typeof originalLoad })._load = originalLoad
  }
})

async function post(body: Record<string, unknown>) {
  return repliesRoute.POST(makeRequest(body), postContext())
}

async function postJson(body: Record<string, unknown>) {
  const response = await post(body)
  return { response, body: await response.json() as Record<string, unknown> }
}

test('V6.1.1 real GET strictly filters admin own approved/rejected roots and exposes private live counts', async () => {
  resetFixture({ role: 'ADMIN', mode: 'COMMENT' })
  for (const [index, status] of (['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const).entries()) {
    const reply = createdReply(`review-${index}`, state.post.id, state.currentUser.id, '参与内容', null, index + 1)
    state.replies.push(reply)
    addSubmission({ commentId: reply.id, status })
  }
  state.replies.push(createdReply('legacy-ordinary-root', state.post.id, state.currentUser.id, '历史普通评论', null, 5))
  for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN']) {
    const response = await repliesRoute.GET(new Request(`https://ecfc.invalid/api/posts/post-1/replies?topicStatus=${status}`), postContext())
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.replies.map((reply: { topicActivitySubmission: { status: string } }) => reply.topicActivitySubmission.status), [status])
    assert.deepEqual(body.topicActivity.reviewCounts, { PENDING: 1, APPROVED: 1, REJECTED: 1, WITHDRAWN: 1, ALL: 5 })
    assert.equal(body.total, 1)
    assert.match(response.headers.get('cache-control') || '', /private, no-store/)
  }
  assert.deepEqual(state.sideEffects, { communityRewards: 0, tasks: 0, friends: 0, notifications: 0 })
  state.currentUser = participant('USER')
  const response = await repliesRoute.GET(new Request('https://ecfc.invalid/api/posts/post-1/replies?topicStatus=PENDING'), postContext())
  const body = await response.json()
  assert.equal(body.replies.length, 5, 'ordinary viewers cannot activate private admin filtering')
  assert.equal(body.topicActivity.reviewCounts, undefined, 'private counts are admin-only')
})

test('direct POST gate matrix enforces form, admin reply, activity lifecycle, and admin participant rules', async () => {
  resetFixture({ gateMode: 'AFTER_FORM_SUBMIT', mode: 'BOTH' })
  let result = await postJson({ content: '没有表单' })
  assert.equal(result.response.status, 409)
  assert.equal(result.body.code, 'FORM_REQUIRED_BEFORE_COMMENT')
  assert.equal(state.replies.length, 0)
  assert.equal(state.submissions.length, 0)
  assert.deepEqual(state.sideEffects, { communityRewards: 0, tasks: 0, friends: 0, notifications: 0 })

  addForm()
  result = await postJson({ content: '已提交表单' })
  assert.equal(result.response.status, 201)

  resetFixture({ gateMode: 'AFTER_FORM_SUBMIT', mode: 'FORM' })
  result = await postJson({ content: 'FORM 模式先填表' })
  assert.equal(result.response.status, 409)
  assert.equal(result.body.code, 'FORM_REQUIRED_BEFORE_COMMENT')
  addForm()
  result = await postJson({ content: 'FORM 模式已填表' })
  assert.equal(result.response.status, 201)

  resetFixture({ gateMode: 'AFTER_ADMIN_REPLY', mode: 'BOTH' })
  addForm()
  result = await postJson({ content: '等待回复' })
  assert.equal(result.response.status, 409)
  assert.equal(result.body.code, 'ADMIN_REPLY_REQUIRED')
  addForm({ replied: true })
  result = await postJson({ content: '管理员已回复' })
  assert.equal(result.response.status, 201)

  resetFixture({ gateMode: 'AFTER_FORM_SUBMIT', mode: 'BOTH', role: 'ADMIN' })
  result = await postJson({ content: '管理员也必须填表' })
  assert.equal(result.response.status, 409)
  assert.equal(result.body.code, 'FORM_REQUIRED_BEFORE_COMMENT')

  resetFixture({ gateMode: 'AFTER_ADMIN_REPLY', mode: 'BOTH', status: 'PUBLISHED', endsAt: new Date(now().getTime() - 1) })
  addForm({ replied: true })
  result = await postJson({ content: '结束后不可参与' })
  assert.equal(result.response.status, 409)
  assert.equal(result.body.code, 'ACTIVITY_ENDED')

  resetFixture({ mode: 'COMMENT', startsAt: new Date(now().getTime() + 86_400_000) })
  result = await postJson({ content: '尚未开始不可参与' })
  assert.equal(result.response.status, 409)
  assert.equal(result.body.code, 'ACTIVITY_NOT_STARTED')

  resetFixture({ mode: 'COMMENT', status: 'CANCELLED' })
  result = await postJson({ content: '取消后不可参与' })
  assert.equal(result.response.status, 409)
  assert.equal(result.body.code, 'ACTIVITY_CANCELLED')
})

test('direct POST keeps nested replies ordinary and does not gate COMMENT activities with legacy form fields', async () => {
  resetFixture({ mode: 'COMMENT', gateMode: 'AFTER_ADMIN_REPLY' })
  let result = await postJson({ content: 'COMMENT 模式无需表单' })
  assert.equal(result.response.status, 201)
  assert.equal(state.submissions.length, 1)

  resetFixture({ mode: 'BOTH', gateMode: 'AFTER_FORM_SUBMIT' })
  state.replies.push({ ...createdReply('root-1', state.post.id, 'post-owner', '历史根评论', null, 1), createdAt: now(), updatedAt: now() })
  result = await postJson({ content: '楼中楼回复', parentId: 'root-1' })
  assert.equal(result.response.status, 201)
  assert.equal(state.replies.at(-1)?.parentId, 'root-1')
  assert.equal(state.submissions.length, 0)
})

test('direct SINGLE POST uses lifetime submission history and remains concurrency-safe', async () => {
  resetFixture({ mode: 'COMMENT', commentLimit: 'SINGLE' })
  const first = await postJson({ content: '第一次参与' })
  assert.equal(first.response.status, 201)
  const second = await postJson({ content: '第二次参与' })
  assert.equal(second.response.status, 409)
  assert.equal(second.body.code, 'TOPIC_ACTIVITY_COMMENT_LIMIT_REACHED')

  for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const) {
    resetFixture({ mode: 'COMMENT', commentLimit: 'SINGLE' })
    addSubmission({ status, commentDeletedAt: new Date(), commentId: null })
    const result = await postJson({ content: `历史 ${status}` })
    assert.equal(result.response.status, 409, status)
    assert.equal(result.body.code, 'TOPIC_ACTIVITY_COMMENT_LIMIT_REACHED', status)
    assert.equal(state.replies.length, 0, status)
  }

  resetFixture({ mode: 'COMMENT', commentLimit: 'SINGLE' })
  const concurrent = await Promise.all([postJson({ content: '并发 A' }), postJson({ content: '并发 B' })])
  assert.deepEqual(concurrent.map((item) => item.response.status).sort(), [201, 409])
  assert.equal(state.replies.length, 1)
  assert.equal(state.submissions.length, 1)
})

test('V6.1.1 comment attachments obey the locked Activity flag on roots and replies; form IMAGE remains unrelated', async () => {
  resetFixture({ mode: 'COMMENT' })
  state.activity.allowImageAttachments = false
  state.activity.formSchema.fields = [{ id: 'photo', label: '凭证', type: 'IMAGE', maxImages: 1 }]
  let result = await postJson({ content: '图片凭证', imageUrls: ['fixture-image'] })
  assert.equal(result.response.status, 403)
  assert.equal(result.body.code, 'TOPIC_COMMENT_ATTACHMENTS_DISABLED')
  assert.equal(state.replies.length, 0)
  state.replies.push({ ...createdReply('root-1', 'post-1', 'post-owner', '历史根评论', null, 1), createdAt: now(), updatedAt: now() })
  result = await postJson({ content: '图片回复', parentId: 'root-1', imageUrls: ['fixture-image'] })
  assert.equal(result.response.status, 403)
  result = await postJson({ content: '[[content-image:https://fixture.invalid/image.png]]' })
  assert.equal(result.response.status, 403, 'raw content marker cannot bypass attachment permission')
  result = await postJson({ content: '正常文字评论' })
  assert.equal(result.response.status, 201)
  state.activity.allowImageAttachments = true
  result = await postJson({ content: '', imageUrls: ['fixture-image'] })
  assert.equal(result.response.status, 201, 'existing image-only rule is preserved')
})

test('V6.1.1 server rejects one grapheme and whitespace but preserves sticker-only validity', async () => {
  resetFixture({ mode: 'COMMENT' })
  for (const content of ['字', '  \n\t ', '👨‍👩‍👧‍👦']) {
    const result = await postJson({ content })
    assert.equal(result.response.status, 400)
    assert.match(String(result.body.message), /至少需要 2 个字符/)
  }
  assert.equal(state.submissions.length, 0)
  assert.equal((await postJson({ content: '', stickerId: 'sticker-fixture' })).response.status, 201)
})

test('direct admin text/image replies persist durable unlock and deletion does not re-lock', async () => {
  resetFixture({ mode: 'BOTH', gateMode: 'AFTER_ADMIN_REPLY' })
  addForm()
  let response = await adminRepliesRoute.POST(makeAdminReplyRequest({ content: '文字回复' }), adminReplyContext())
  assert.equal(response.status, 201)
  assert.equal(formSnapshotWithUnlock(), true)
  state.formSubmission.replies = []
  state.forms[0]!.replies = []
  let result = await postJson({ content: '文字回复后参与' })
  assert.equal(result.response.status, 201)

  resetFixture({ mode: 'BOTH', gateMode: 'AFTER_ADMIN_REPLY' })
  addForm()
  state.adminAssets.push({ id: 'asset-1', activityId: state.activity.id, uploadedByUserId: 'admin-1', storageKey: 'private/a.png', mimeType: 'image/png', width: 100, height: 100, size: 100, replyId: null })
  response = await adminRepliesRoute.POST(makeAdminReplyRequest({ assetIds: ['asset-1'] }), adminReplyContext())
  assert.equal(response.status, 201)
  assert.equal(formSnapshotWithUnlock(), true)
  state.formSubmission.replies = []
  state.forms[0]!.replies = []
  result = await postJson({ content: '图片回复后参与' })
  assert.equal(result.response.status, 201)
})

test('V6.1 admin reply retry and concurrent replay reuse the same reply, including already-linked images', async () => {
  resetFixture({ gateMode: 'AFTER_ADMIN_REPLY' })
  addForm()
  state.adminAssets.push({ id: 'asset-1', activityId: state.activity.id, uploadedByUserId: 'admin-1', storageKey: 'private/a.png', mimeType: 'image/png', width: 100, height: 100, size: 100, replyId: null })
  const body = { content: '收到资料', assetIds: ['asset-1'], requestId: 'fixture-request-1' }
  const responses = await Promise.all(Array.from({ length: 8 }, () => adminRepliesRoute.POST(makeAdminReplyRequest(body), adminReplyContext())))
  assert.deepEqual(responses.map((response) => response.status), Array(8).fill(201))
  assert.equal(state.formSubmission.replies.length, 1)
  assert.equal(state.adminAssets[0].replyId, state.formSubmission.replies[0].id)
  assert.match(state.formSubmission.replies[0].id, /^tr_[a-f0-9]{64}$/)
  assert.equal(state.formSubmission.formSchemaSnapshot.adminReplyRequests, undefined)
  assert.equal(formSnapshotWithUnlock(), true)
  const replies = await Promise.all(responses.map((response) => response.json()))
  assert.equal(new Set(replies.map((value) => value.reply.id)).size, 1)
  assert.equal((await adminRepliesRoute.POST(makeAdminReplyRequest({ ...body, content: '不同内容' }), adminReplyContext())).status, 409)
  assert.equal(state.formSubmission.replies.length, 1)
  assert.equal((await adminRepliesRoute.POST(makeAdminReplyRequest({ content: '第二次独立说明', requestId: 'fixture-request-2' }), adminReplyContext())).status, 201)
  assert.equal(state.formSubmission.replies.length, 2)
  assert.deepEqual(state.sideEffects.communityRewards, 0)
})
