import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { publicTopicActivityV2Program, type TopicActivityV2Test } from '@/lib/topic-activity-v2-config'
import { grantTopicActivityV2MedalForEventInTransaction, lockTopicV2Activity, requireTopicV2Active, requireTopicV2Program, TopicActivityV2Error, withTopicV2Transaction } from '@/lib/topic-activity-v2'

function fail(code: string, message: string, status = 409): never { throw new TopicActivityV2Error(code, message, status) }
function json(value: unknown) { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue }
function data(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function equalChoices(left: unknown, right: string[]) { return Array.isArray(left) && left.length === right.length && [...left].sort().every((item, index) => item === [...right].sort()[index]) }

export function calculateTopicV2Test(test: TopicActivityV2Test, input: unknown) {
  const answers = data(input)
  if (Object.keys(answers).length !== test.questions.length) fail('TEST_ANSWERS_INVALID', '请完成全部题目', 400)
  const selections = test.questions.map((question) => {
    const option = question.options.find((item) => item.id === answers[question.id])
    if (!option) fail('TEST_OPTION_INVALID', '存在不属于本题的选项', 400)
    return { question, option }
  })
  let score: number | null = null
  const totals = Object.fromEntries(test.results.map((result) => [result.id, 0]))
  const maxScore = test.questions.reduce((sum, question) => sum + question.points, 0)
  if (test.mode === 'KNOWLEDGE') score = selections.reduce((sum, { question, option }) => sum + (question.correctOptionId === option.id ? question.points : 0), 0)
  else for (const { option } of selections) for (const [id, weight] of Object.entries(option.weights || {})) totals[id] += weight
  const result = test.mode === 'KNOWLEDGE'
    ? test.results.find((item) => score! >= item.scoreMin! && score! <= item.scoreMax!)
    : test.results.reduce((best, item) => totals[item.id] > totals[best.id] ? item : best, test.results[0])
  if (!result) fail('TEST_RESULT_UNAVAILABLE', '测试结果配置不完整')
  return { answers: Object.fromEntries(selections.map(({ question, option }) => [question.id, option.id])), result, score, maxScore: test.mode === 'KNOWLEDGE' ? maxScore : null }
}

async function publicActivity(activityId: string) {
  const activity = await prisma.activity.findFirst({ where: { id: activityId, type: 'TOPIC_ACTIVITY', status: { in: ['PUBLISHED', 'CANCELLED'] } } })
  if (!activity) fail('ACTIVITY_NOT_FOUND', '活动不存在', 404)
  return { activity, program: requireTopicV2Program(activity) }
}
export async function getTopicV2Poll(activityId: string, userId?: string, now = new Date()) {
  const { activity, program } = await publicActivity(activityId)
  if (!program.poll.enabled) fail('POLL_DISABLED', '投票未开放')
  const poll = program.poll
  const votes = await prisma.topicActivityPollVote.findMany({ where: { activityId, pollId: poll.id }, select: { userId: true, choices: true } })
  const end = poll.endsAt ? new Date(poll.endsAt) : activity.endsAt
  const closed = activity.status === 'CANCELLED' || Boolean(end && now > end)
  const show = (poll.showLiveResults && activity.status === 'PUBLISHED') || (closed && poll.publishAfterClose)
  return { poll, myChoices: userId ? votes.find((vote) => vote.userId === userId)?.choices || [] : [],
    results: show ? { participantCount: votes.length, percentageBasis: 'PARTICIPANTS', options: poll.options.map((option) => {
      const count = votes.filter((vote) => Array.isArray(vote.choices) && vote.choices.includes(option.id)).length
      return { id: option.id, label: option.label, count, percentage: votes.length ? Math.round(count / votes.length * 1000) / 10 : 0 }
    }) } : null }
}
export async function castTopicV2Vote(input: { activityId: string; userId: string; choices: unknown; now?: Date }) {
  const now = input.now || new Date()
  return withTopicV2Transaction(async (tx) => {
    const activity = await lockTopicV2Activity(tx, input.activityId)
    requireTopicV2Active(activity, now)
    const program = requireTopicV2Program(activity)
    const poll = program.poll
    if (!poll.enabled) fail('POLL_DISABLED', '投票未开放')
    if ((poll.startsAt && now < new Date(poll.startsAt)) || (poll.endsAt && now > new Date(poll.endsAt))) fail('POLL_CLOSED', '当前不在投票时间内')
    if (!Array.isArray(input.choices) || !input.choices.length || input.choices.some((choice) => typeof choice !== 'string') || new Set(input.choices).size !== input.choices.length) fail('POLL_CHOICES_INVALID', '请选择有效选项', 400)
    const choices = input.choices as string[]
    if (choices.length > (poll.mode === 'SINGLE' ? 1 : poll.maxChoices) || choices.some((id) => !poll.options.some((option) => option.id === id))) fail('POLL_CHOICES_INVALID', '投票选项或数量不符合规则', 400)
    const user = await tx.user.findFirst({ where: { id: input.userId, status: 'ACTIVE', isDeleted: false }, select: { id: true } })
    if (!user) fail('USER_UNAVAILABLE', '账号不可参与活动', 403)
    const key = { activityId_pollId_userId: { activityId: activity.id, pollId: poll.id, userId: input.userId } }
    const previous = await tx.topicActivityPollVote.findUnique({ where: key })
    if (previous && equalChoices(previous.choices, choices)) return { vote: previous, changed: false }
    if (previous && !poll.allowChange) fail('POLL_ALREADY_SUBMITTED', '本投票不允许修改选择')
    const vote = await tx.topicActivityPollVote.upsert({ where: key,
      create: { activityId: activity.id, pollId: poll.id, userId: input.userId, configVersion: poll.version, choices: json(choices), createdAt: now },
      update: { choices: json(choices), configVersion: poll.version, updatedAt: now },
    })
    await grantTopicActivityV2MedalForEventInTransaction(tx, activity, { userId: input.userId, event: 'POLL', effectiveAt: vote.createdAt, now })
    return { vote, changed: true }
  })
}
export async function getTopicV2Test(activityId: string) {
  const { activity, program } = await publicActivity(activityId)
  if (!program.test.enabled) fail('TEST_DISABLED', '测试未开放')
  return { activity: { id: activity.id, title: activity.title }, test: publicTopicActivityV2Program(program).test }
}
export async function submitTopicV2Test(input: { activityId: string; userId: string; answers: unknown; requestKey: string; now?: Date }) {
  if (!/^[A-Za-z0-9_-]{8,64}$/u.test(input.requestKey)) fail('TEST_REQUEST_KEY_INVALID', '测试提交编号无效', 400)
  const now = input.now || new Date()
  return withTopicV2Transaction(async (tx) => {
    const activity = await lockTopicV2Activity(tx, input.activityId)
    const program = requireTopicV2Program(activity)
    const test = program.test
    if (!test.enabled) fail('TEST_DISABLED', '测试未开放')
    const previous = await tx.topicActivityTestAttempt.findUnique({ where: { activityId_userId_requestKey: { activityId: activity.id, userId: input.userId, requestKey: input.requestKey } } })
    if (previous) {
      const old = data(previous.answers), submitted = data(input.answers)
      if (Object.keys(old).length !== Object.keys(submitted).length || Object.keys(old).some((id) => old[id] !== submitted[id])) fail('TEST_REQUEST_KEY_CONFLICT', '提交编号已用于其他答案')
      return { attempt: { id: previous.id, resultId: previous.resultId, resultSnapshot: previous.resultSnapshot, completedAt: previous.completedAt }, changed: false }
    }
    requireTopicV2Active(activity, now)
    const user = await tx.user.findFirst({ where: { id: input.userId, status: 'ACTIVE', isDeleted: false }, select: { nickname: true } })
    if (!user) fail('USER_UNAVAILABLE', '账号不可参与活动', 403)
    if (!test.allowRetake && await tx.topicActivityTestAttempt.count({ where: { activityId: activity.id, testId: test.id, userId: input.userId } })) fail('TEST_RETAKE_NOT_ALLOWED', '本测试仅允许完成一次')
    const computed = calculateTopicV2Test(test, input.answers)
    const snapshot = { resultId: computed.result.id, title: computed.result.title, description: computed.result.description,
      imageUrl: computed.result.imageUrl || null, score: computed.score, maxScore: computed.maxScore, mode: test.mode,
      activityTitle: activity.title, testTitle: test.title, testId: test.id, version: test.version, poster: test.poster,
      nickname: test.poster.showNickname ? user.nickname : null }
    const attempt = await tx.topicActivityTestAttempt.create({ data: { activityId: activity.id, userId: input.userId, testId: test.id, configVersion: test.version,
      requestKey: input.requestKey, answers: json(computed.answers), resultId: computed.result.id, resultSnapshot: json(snapshot), completedAt: now },
      select: { id: true, resultId: true, resultSnapshot: true, completedAt: true } })
    await grantTopicActivityV2MedalForEventInTransaction(tx, activity, { userId: input.userId, event: 'TEST', effectiveAt: now, now })
    return { attempt, changed: true }
  })
}
export async function getTopicV2Attempts(activityId: string, userId: string) {
  return prisma.topicActivityTestAttempt.findMany({ where: { activityId, userId }, orderBy: [{ completedAt: 'desc' }, { id: 'desc' }], take: 100,
    select: { id: true, activityId: true, testId: true, configVersion: true, resultId: true, resultSnapshot: true, completedAt: true } })
}
export async function getTopicV2Attempt(activityId: string, attemptId: string, userId: string) {
  const attempt = await prisma.topicActivityTestAttempt.findFirst({ where: { id: attemptId, activityId, userId },
    select: { id: true, activityId: true, testId: true, configVersion: true, resultId: true, resultSnapshot: true, completedAt: true } })
  if (!attempt) fail('TEST_RESULT_NOT_FOUND', '测试结果不存在', 404)
  return attempt
}

/** Poster-only enrichment for pre-V4 attempts. Never mutate or replace historical test/results. */
export async function getTopicV2PosterSnapshot(activityId: string, attemptId: string, userId: string): Promise<Record<string, unknown>> {
  const attempt = await prisma.topicActivityTestAttempt.findFirst({ where: { id: attemptId, activityId, userId },
    select: { resultSnapshot: true, Activity: { select: { startsAt: true, endsAt: true } },
      User: { select: { avatarUrl: true, Profile: { select: { avatarUrl: true } } } } } })
  if (!attempt) fail('TEST_RESULT_NOT_FOUND', '测试结果不存在', 404)
  const snapshot = data(attempt.resultSnapshot)
  // Missing properties alone fall back; explicit nulls in new snapshots stay frozen.
  return { ...snapshot,
    activityStartsAt: Object.hasOwn(snapshot, 'activityStartsAt') ? snapshot.activityStartsAt : attempt.Activity.startsAt?.toISOString() || null,
    activityEndsAt: Object.hasOwn(snapshot, 'activityEndsAt') ? snapshot.activityEndsAt : attempt.Activity.endsAt?.toISOString() || null,
    avatarUrl: Object.hasOwn(snapshot, 'avatarUrl') ? snapshot.avatarUrl : attempt.User.Profile?.avatarUrl || attempt.User.avatarUrl || null }
}
