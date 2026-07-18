import { hashPassword, verifyPassword } from '@/lib/password'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export const securityQuestionCount = 1
export const securityQuestionNotificationKey = 'complete-security-questions'

export type SecurityQuestionRecoveryReason = 'AVAILABLE' | 'GLOBAL_DISABLED' | 'USER_DISABLED' | 'QUESTIONS_INCOMPLETE'

export function getSecurityQuestionRecoveryAvailability(input: {
  globalEnabled: boolean
  userEnabled: boolean
  questionCount: number
}): { available: boolean; reason: SecurityQuestionRecoveryReason } {
  if (!input.globalEnabled) return { available: false, reason: 'GLOBAL_DISABLED' }
  if (input.questionCount !== securityQuestionCount) return { available: false, reason: 'QUESTIONS_INCOMPLETE' }
  if (!input.userEnabled) return { available: false, reason: 'USER_DISABLED' }
  return { available: true, reason: 'AVAILABLE' }
}

export type SecurityQuestionInput = {
  question: string
  answer: string
  sortOrder: number
}

export function normalizeSecurityAnswer(value: unknown) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ')
    : ''
}

export function normalizeSecurityQuestion(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
}

export function parseSecurityQuestions(value: unknown): SecurityQuestionInput[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, securityQuestionCount).map((item, index) => {
    const row = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
    return {
      question: normalizeSecurityQuestion(row.question),
      answer: normalizeSecurityAnswer(row.answer),
      sortOrder: index + 1,
    }
  })
}

export function validateSecurityQuestions(questions: SecurityQuestionInput[]) {
  if (questions.length !== securityQuestionCount) return '必须完整设置 1 个密保问题'
  if (questions.some((item) => !item.question || !item.answer)) return '密保问题和答案不能为空'
  if (questions.some((item) => item.question.length > 120 || item.answer.length > 200)) return '密保问题或答案过长'
  return null
}

export async function hashSecurityQuestions(questions: SecurityQuestionInput[]) {
  return Promise.all(questions.map(async (item) => ({
    question: item.question,
    answerHash: await hashPassword(item.answer),
    sortOrder: item.sortOrder,
  })))
}

export async function verifySecurityAnswers(
  stored: { sortOrder: number; answerHash: string }[],
  answers: unknown,
) {
  const parsed = Array.isArray(answers)
    ? answers.map((value) => normalizeSecurityAnswer(
        typeof value === 'object' && value !== null ? (value as Record<string, unknown>).answer : value,
      ))
    : []
  if (parsed.length !== securityQuestionCount || parsed.some((answer) => !answer)) return false
  const ordered = [...stored].sort((a, b) => a.sortOrder - b.sortOrder).slice(0, securityQuestionCount)
  if (ordered.length !== securityQuestionCount) return false
  const results = await Promise.all(ordered.map((item, index) => verifyPassword(parsed[index], item.answerHash)))
  return results.every((result) => result.valid)
}

export async function ensureSecurityQuestionNotification(userId: string) {
  const settings = await getAccountSecuritySettings()
  if (!settings.notifyLegacyUsersToSetSecurityQuestions) return
  const count = await prisma.userSecurityQuestion.count({ where: { userId } })
  if (count >= securityQuestionCount) return
  await prisma.notification.upsert({
    where: { recipientId_key: { recipientId: userId, key: securityQuestionNotificationKey } },
    update: {},
    create: {
      recipientId: userId,
      key: securityQuestionNotificationKey,
      type: 'SYSTEM',
      title: '请设置账号密保问题',
      content: '设置一个仅你知道答案的密保问题，可用于安全地找回账号。',
      link: '/settings/security-questions',
    },
  })
}

const settingDefinitions = {
  requireSecurityQuestionsForNewUsers: { key: 'security.requireQuestionsForNewUsers', defaultValue: true, label: '新用户必须设置密保问题' },
  notifyLegacyUsersToSetSecurityQuestions: { key: 'security.notifyLegacyUsers', defaultValue: true, label: '通知历史用户设置密保问题' },
  enableSecurityQuestionRecovery: { key: 'security.enableQuestionRecovery', defaultValue: true, label: '启用密保问题找回' },
  enableEmailPasswordReset: { key: 'security.enableEmailPasswordReset', defaultValue: false, label: '启用邮箱验证码重置密码' },
} as const

export type AccountSecuritySettings = {
  [Key in keyof typeof settingDefinitions]: boolean
}

export async function getAccountSecuritySettings(): Promise<AccountSecuritySettings> {
  const rows = await prisma.siteSetting.findMany({
    where: { key: { in: Object.values(settingDefinitions).map((item) => item.key) } },
    select: { key: true, value: true },
  })
  const values = new Map(rows.map((row) => [row.key, row.value]))
  return Object.fromEntries(Object.entries(settingDefinitions).map(([name, definition]) => [
    name,
    values.has(definition.key) ? values.get(definition.key) === 'true' : definition.defaultValue,
  ])) as AccountSecuritySettings
}

export async function setAccountSecuritySettings(
  settings: AccountSecuritySettings,
  database: Pick<Prisma.TransactionClient, 'siteSetting'> = prisma,
) {
  await Promise.all(Object.entries(settingDefinitions).map(([name, definition]) => database.siteSetting.upsert({
    where: { key: definition.key },
    update: { value: String(settings[name as keyof AccountSecuritySettings]), valueType: 'BOOLEAN', group: 'security', label: definition.label },
    create: { key: definition.key, value: String(settings[name as keyof AccountSecuritySettings]), valueType: 'BOOLEAN', group: 'security', label: definition.label },
  })))
}

export function parseAccountSecuritySettings(value: unknown): AccountSecuritySettings | null {
  if (typeof value !== 'object' || value === null) return null
  const input = value as Record<string, unknown>
  const keys = Object.keys(settingDefinitions) as (keyof AccountSecuritySettings)[]
  if (keys.some((key) => typeof input[key] !== 'boolean')) return null
  return Object.fromEntries(keys.map((key) => [key, input[key]])) as AccountSecuritySettings
}
