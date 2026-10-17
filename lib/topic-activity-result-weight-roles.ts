import type { TopicActivityV2TestOption, TopicActivityV2TestQuestion, TopicActivityV2TestResult } from '@/lib/topic-activity-v2-config'

export const TOPIC_ACTIVITY_RESULT_ROLES = [
  { key: 'PRIMARY', label: '主要结果', points: 4 },
  { key: 'SECONDARY', label: '次要结果', points: 2 },
  { key: 'WEAK', label: '弱关联结果', points: 1 },
] as const

export type TopicActivityResultRole = typeof TOPIC_ACTIVITY_RESULT_ROLES[number]['key']

export function topicActivityRolePoints(role: TopicActivityResultRole) {
  return TOPIC_ACTIVITY_RESULT_ROLES.find((item) => item.key === role)!.points
}

export function topicActivityRoleAssignments(weights: Record<string, number> | undefined) {
  return Object.fromEntries(TOPIC_ACTIVITY_RESULT_ROLES.map((role) => [
    role.key,
    Object.entries(weights || {}).find(([, points]) => points === role.points)?.[0] || '',
  ])) as Record<TopicActivityResultRole, string>
}

export function setTopicActivityResultRole(
  weights: Record<string, number> | undefined,
  role: TopicActivityResultRole,
  resultId: string,
) {
  const points = topicActivityRolePoints(role)
  const next = Object.fromEntries(Object.entries(weights || {}).filter(([id, value]) => id !== resultId && value !== points && value > 0))
  if (resultId) next[resultId] = points
  return next
}

/** One-time explicit conversion for an administrator switching an existing test to role scoring. */
export function migrateTopicActivityWeightsToRoles(
  weights: Record<string, number> | undefined,
  results: readonly TopicActivityV2TestResult[],
) {
  const ranked = results
    .map((result, index) => ({ id: result.id, value: weights?.[result.id] || 0, index }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value || left.index - right.index)
    .slice(0, TOPIC_ACTIVITY_RESULT_ROLES.length)
  if (!ranked.length && results[0]) ranked.push({ id: results[0].id, value: 0, index: 0 })
  return Object.fromEntries(ranked.map((item, index) => [item.id, TOPIC_ACTIVITY_RESULT_ROLES[index].points]))
}

export function topicActivityResultReferenceCount(questions: readonly TopicActivityV2TestQuestion[], resultId: string) {
  return questions.reduce((count, question) => count + question.options.filter((option) => (option.weights?.[resultId] || 0) > 0).length, 0)
}

export function topicActivityRoleSummary(option: Pick<TopicActivityV2TestOption, 'weights'>, results: readonly TopicActivityV2TestResult[]) {
  return TOPIC_ACTIVITY_RESULT_ROLES.flatMap((role) => {
    const resultId = Object.entries(option.weights || {}).find(([, points]) => points === role.points)?.[0]
    if (!resultId) return []
    const result = results.find((item) => item.id === resultId)
    return result ? [`${result.title || '未命名结果'} +${role.points}`] : []
  })
}
