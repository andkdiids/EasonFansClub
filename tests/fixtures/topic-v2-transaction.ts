/* eslint-disable @typescript-eslint/no-explicit-any */
// Deterministic double only: real MySQL locking/FK/rollback is a separate gate.
import { prisma } from '@/lib/prisma'
import { createDefaultTopicActivityV2Program, type TopicRewardEntryConfig } from '@/lib/topic-activity-v2-config'
export const instant = new Date('2026-10-13T04:00:00Z')
export function rewardEntry(id: string, platformKey = id, points = 96): TopicRewardEntryConfig {
  return { id, platformKey, platformName: platformKey, title: id, instructions: '分享后提交截图', materialRequirement: '截图', minImages: 0, maxImages: 0, points, enabled: true, sortOrder: 0, startsAt: null, endsAt: null, allowResubmit: true }
}
export function fixture(entries = [rewardEntry('weibo')]) {
  const program = createDefaultTopicActivityV2Program()
  program.enabled = true; program.platformRewards.enabled = true; program.platformRewards.allowStacking = true; program.entries = entries
  program.poll = { ...program.poll, enabled: true, id: 'poll-one', title: '投票', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], maxChoices: 1 }
  program.test = { ...program.test, enabled: true, id: 'test-one', title: '知识测试', mode: 'KNOWLEDGE', allowRetake: true,
    questions: [{ id: 'q1', prompt: '题目', points: 2, options: [{ id: 'yes', label: '正确' }, { id: 'no', label: '错误' }], correctOptionId: 'yes' }],
    results: [{ id: 'low', title: '继续练习', description: '0分', scoreMin: 0, scoreMax: 1 }, { id: 'high', title: '完成', description: '2分', scoreMin: 2, scoreMax: 2 }] }
  const activity: any = { id: 'activity-one', type: 'TOPIC_ACTIVITY', title: '本地测试活动', status: 'PUBLISHED', startsAt: new Date('2026-10-01T00:00:00Z'), endsAt: new Date('2026-10-31T00:00:00Z'),
    participationMode: 'COMMENT', formSchema: null, allowImageAttachments: true, activityPostId: 'post-one', topicProgram: program, ActivityPost: { authorId: 'admin-one' } }
  const state: any = { submissions: [], grants: [], participations: [], reviews: [], audits: [], logs: [], votes: [], attempts: [],
    entries: entries.map((entry) => ({ id: entry.id, activityId: activity.id, platformKey: entry.platformKey, config: structuredClone(entry), enabled: true })), assets: [], forms: [], points: 100, floor: 0 }
  const queries: string[] = []
  function matches(row: any, where: any = {}): boolean {
    return Object.entries(where).every(([key, value]: [string, any]) => {
      if (['activityId_userId', 'activityId_pollId_userId', 'activityId_userId_requestKey'].includes(key)) return matches(row, value)
      if (key === 'Comment') return Boolean(row.Comment) && matches(row.Comment, value.is || value)
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('not' in value) return row[key] !== value.not
        if ('in' in value) return value.in.includes(row[key])
        return matches(row[key] || {}, value)
      }
      return (row[key] ?? null) === value
    })
  }
  const table = (name: string, defaults: any = {}) => ({
    findMany: async ({ where = {}, take, orderBy }: any = {}) => {
      let rows = state[name].filter((row: any) => matches(row, where))
      if (orderBy) rows = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))
      return rows.slice(0, take ?? rows.length)
    },
    findFirst: async ({ where = {} }: any = {}) => state[name].find((row: any) => matches(row, where)) || null,
    findUnique: async ({ where }: any) => state[name].find((row: any) => matches(row, where)) || null,
    count: async ({ where = {} }: any = {}) => state[name].filter((row: any) => matches(row, where)).length,
    create: async ({ data }: any) => { const row = { ...structuredClone(defaults), id: name + '-' + state[name].length, ...structuredClone(data) }; state[name].push(row); return row },
    update: async ({ where, data }: any) => { const row = state[name].find((row: any) => matches(row, where)); if (!row) throw new Error('fixture row missing ' + name); Object.assign(row, structuredClone(data)); return row },
    updateMany: async ({ where, data }: any) => { const rows = state[name].filter((row: any) => matches(row, where)); rows.forEach((row: any) => Object.assign(row, data)); return { count: rows.length } },
    upsert: async ({ where, create, update }: any) => {
      const row = state[name].find((row: any) => matches(row, where))
      if (row) { Object.assign(row, structuredClone(update)); return row }
      const made = { ...structuredClone(defaults), id: name + '-' + state[name].length, ...structuredClone(create) }; state[name].push(made); return made
    },
  })
  const tx: any = {
    $queryRawUnsafe: async (sql: string) => { queries.push(sql); return [{ id: activity.id }] },
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => { const text = sql.join('?'); queries.push(text); return text.includes('FROM `User`') ? [{ id: 'user-one', points: state.points }] : state.logs.filter((log: any) => log.businessKey === values[0]) },
    activity: { findUnique: async () => activity, findFirst: async () => activity, update: async ({ data }: any) => Object.assign(activity, data) },
    user: { findUnique: async () => ({ id: 'user-one', status: 'ACTIVE', isDeleted: false, Profile: { id: 'profile-one' }, points: state.points }),
      findFirst: async () => ({ id: 'user-one', nickname: '测试用户' }), update: async ({ data }: any) => { state.points += data.points.increment; return { points: state.points } } },
    post: { findFirst: async () => ({ id: 'post-one', authorId: 'admin-one' }), update: async ({ data }: any) => { if (data.lastCommentFloor) state.floor++; return { lastCommentFloor: state.floor } } },
    reply: { create: async ({ data }: any) => ({ id: 'reply-' + state.submissions.length, ...data }) },
    topicActivitySubmission: table('submissions', { status: 'PENDING', commentDeletedAt: null }),
    topicActivityParticipation: table('participations'), topicActivityRewardGrant: table('grants', { status: 'PENDING' }),
    topicActivityRewardEntry: table('entries'), topicActivityImageAsset: table('assets'), topicActivityFormSubmission: table('forms'),
    topicActivityReviewLog: table('reviews'), adminActionLog: table('audits'), pointLog: table('logs'),
    topicActivityPollVote: table('votes'), topicActivityTestAttempt: table('attempts'), badge: { findUnique: async () => ({ isEnabled: true, isActive: true }) },
  }
  function submission(id: string, entry = entries[0]) {
    const row = { id, activityId: activity.id, userId: 'user-one', commentId: 'comment-' + id, rewardEntryId: entry.id, rewardSnapshot: structuredClone(entry), submittedAt: instant,
      status: 'PENDING', commentDeletedAt: null, Comment: { postId: 'post-one', parentId: null, isDeleted: false } }
    state.submissions.push(row); return row
  }
  async function run<T>(work: () => Promise<T>): Promise<T> {
    const restores: Array<() => void> = []
    function replace(target: object, key: string, value: unknown) { const prior = Reflect.get(target, key); Reflect.set(target, key, value); restores.push(() => Reflect.set(target, key, prior)) }
    let queue = Promise.resolve()
    replace(prisma, '$transaction', (callback: (client: unknown) => Promise<unknown>, options: any) => {
      if (options?.isolationLevel !== 'Serializable') throw new Error('Missing serializable boundary')
      const request = queue.then(async () => {
        const before = structuredClone(state), oldActivity = structuredClone(activity)
        try { return await callback(tx) } catch (error) { Object.assign(state, before); Object.assign(program, oldActivity.topicProgram); Object.assign(activity, oldActivity, { topicProgram: program }); throw error }
      })
      queue = request.then(() => undefined, () => undefined); return request
    })
    for (const key of ['activity', 'topicActivitySubmission', 'topicActivityRewardGrant', 'topicActivityRewardEntry', 'topicActivityPollVote', 'topicActivityTestAttempt']) {
      for (const [method, implementation] of Object.entries(tx[key])) replace(Reflect.get(prisma, key), method, implementation)
    }
    try { return await work() } finally { restores.reverse().forEach((restore) => restore()) }
  }
  return { activity, program, state, tx, queries, run, submission }
}
