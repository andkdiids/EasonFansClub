import type { BannedWordPriority } from '@prisma/client'

import { isAdminUser } from '@/lib/admin-permissions'
import type { SessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { VIOLATION_USER_TEXT } from '@/lib/public-user-name'

export const CONTENT_CONTAINS_BANNED_WORD = 'CONTENT_CONTAINS_BANNED_WORD' as const
export const USERNAME_CONTAINS_BANNED_WORD = 'USERNAME_CONTAINS_BANNED_WORD' as const
export const BANNED_WORD_MESSAGE = '内容包含违禁词，请修改后再提交。'
export const USERNAME_BANNED_WORD_MESSAGE = '用户名包含违禁词，请修改。'
export const NICKNAME_BANNED_WORD_MESSAGE = '昵称包含违禁词，请修改。'
export const VIOLATION_CONTENT_TEXT = '违规内容'
/**
 * Re-exported for backward compatibility. `lib/content-moderation` is
 * server-only (it owns Prisma queries), so client-safe code must import
 * VIOLATION_USER_TEXT from '@/lib/public-user-name' directly.
 */
export { VIOLATION_USER_TEXT }

export const DEFAULT_HIGH_PRIORITY_BANNED_WORDS = [
  '神经研究所',
  '研究所',
  'yjs',
  '神经所',
] as const

export type ModerationWord = {
  id: string
  word: string
  normalizedWord: string
  enabled: boolean
  priority: BannedWordPriority | 'HIGH' | 'NORMAL'
}

export type BannedWordCheck = {
  blocked: boolean
  matchedWords: string[]
  matchedWordIds: string[]
  highestPriority: 'HIGH' | 'NORMAL' | null
}

export type PostForbiddenWordField = 'title' | 'content'

export type PostForbiddenWordMatch = {
  field: PostForbiddenWordField
  word: string
}

export type PostForbiddenWordCheck = {
  blocked: boolean
  matches: PostForbiddenWordMatch[]
  hasMore: boolean
}

type ForbiddenWordUser = Pick<SessionUser, 'role'>

const cacheTtlMs = Number(process.env.BANNED_WORD_CACHE_TTL_MS || 10_000)
let wordCache: { expiresAt: number; words: ModerationWord[] } | null = null
let wordCachePromise: Promise<ModerationWord[]> | null = null

/**
 * Normalize only the deliberately safe bypass characters. This is not fuzzy
 * matching: punctuation and arbitrary characters remain significant.
 */
export function normalizeModerationText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\s\u200B\u200C\u200D\uFEFF]+/gu, '')
    .toLocaleLowerCase('zh-CN')
}

export function normalizeBannedWord(value: unknown) {
  return normalizeModerationText(value)
}

function sortWords(words: ModerationWord[]) {
  return [...words].sort((left, right) => {
    const priority = Number(right.priority === 'HIGH') - Number(left.priority === 'HIGH')
    return priority || right.normalizedWord.length - left.normalizedWord.length || left.word.localeCompare(right.word, 'zh-CN')
  })
}

function mergeWords(rows: ModerationWord[]) {
  const byNormalizedWord = new Map<string, ModerationWord>()
  for (const row of rows) {
    const normalizedWord = normalizeBannedWord(row.normalizedWord || row.word)
    if (!normalizedWord) continue
    const current = byNormalizedWord.get(normalizedWord)
    if (!current || (row.priority === 'HIGH' && current.priority !== 'HIGH')) {
      byNormalizedWord.set(normalizedWord, { ...row, normalizedWord })
    }
  }
  return sortWords([...byNormalizedWord.values()])
}

async function loadWordsFromDatabase(): Promise<ModerationWord[]> {
  const [bannedRows, legacyRows] = await Promise.all([
    // Load disabled rows as tombstones too. They must override a legacy
    // SensitiveWord with the same normalized value after an administrator
    // disables the new entry.
    prisma.bannedWord.findMany({
      select: { id: true, word: true, normalizedWord: true, enabled: true, priority: true },
    }),
    prisma.sensitiveWord.findMany({
      where: { isActive: true },
      select: { id: true, word: true, isActive: true },
    }),
  ])

  return mergeWords([
    ...bannedRows,
    ...legacyRows.map((row) => ({
      id: `legacy:${row.id}`,
      word: row.word,
      normalizedWord: normalizeBannedWord(row.word),
      enabled: row.isActive,
      priority: 'NORMAL' as const,
    })),
  ])
}

export async function getEnabledBannedWords() {
  const now = Date.now()
  if (wordCache && wordCache.expiresAt > now) return wordCache.words
  if (wordCachePromise) return wordCachePromise

  wordCachePromise = loadWordsFromDatabase()
    .catch((error) => {
      // Keep the P0 defaults active during a transient database outage. Once
      // the database is reachable again, its enabled/disabled state wins.
      console.error('[content-moderation:load-words]', error)
      return DEFAULT_HIGH_PRIORITY_BANNED_WORDS.map((word, index) => ({
        id: `fallback:${index}`,
        word,
        normalizedWord: normalizeBannedWord(word),
        enabled: true,
        priority: 'HIGH' as const,
      }))
    })
    .then((words) => {
      wordCache = { expiresAt: Date.now() + cacheTtlMs, words }
      return words
    })
    .finally(() => {
      wordCachePromise = null
    })

  return wordCachePromise
}

export function invalidateBannedWordCache() {
  wordCache = null
  wordCachePromise = null
}

/** Pure matcher, useful for tests and for batch scans that already loaded words. */
export function findMatchedBannedWords(text: string | null | undefined, words: ModerationWord[]) {
  const normalizedText = normalizeModerationText(text)
  if (!normalizedText) return []
  return sortWords(words.filter((word) => word.enabled && word.normalizedWord && normalizedText.includes(word.normalizedWord)))
}

/**
 * The post APIs must use the authenticated server-side user for this decision.
 * Request-body flags are intentionally not accepted here.
 */
export function shouldBypassForbiddenWords(currentUser: ForbiddenWordUser | null | undefined) {
  return isAdminUser(currentUser)
}

function preferLongestMatches(words: ModerationWord[]) {
  const longestFirst = [...words].sort((left, right) => {
    return right.normalizedWord.length - left.normalizedWord.length || Number(right.priority === 'HIGH') - Number(left.priority === 'HIGH')
  })
  const selected: ModerationWord[] = []
  for (const word of longestFirst) {
    // If a longer matched word contains this one, showing the shorter word is
    // redundant (for example 「研究所」 inside 「神经研究所」).
    if (selected.some((existing) => existing.normalizedWord.includes(word.normalizedWord))) continue
    selected.push(word)
  }
  return selected
}

/** Pure post matcher for tests and for callers that already loaded the words. */
export function findPostForbiddenWordMatches(
  fields: { title?: string | null; content?: string | null },
  words: ModerationWord[],
) {
  const matches: PostForbiddenWordMatch[] = []
  for (const field of ['title', 'content'] as const) {
    const fieldMatches = preferLongestMatches(findMatchedBannedWords(fields[field], words))
    for (const word of fieldMatches) matches.push({ field, word: word.word })
  }
  return matches
}

function groupPostForbiddenWordMatches(matches: PostForbiddenWordMatch[]) {
  const groups = new Map<PostForbiddenWordField, string[]>()
  for (const match of matches) {
    const words = groups.get(match.field) || []
    if (!words.includes(match.word)) words.push(match.word)
    groups.set(match.field, words)
  }
  return groups
}

function formatPostForbiddenWordPart(field: PostForbiddenWordField, words: string[]) {
  const label = field === 'title' ? '标题' : '正文'
  const quotedWords = words.map((word) => `「${word}」`).join('、')
  return `${label}包含违禁词${words.length > 1 ? `：${quotedWords}` : quotedWords}`
}

export function formatPostForbiddenWordMessage(matches: PostForbiddenWordMatch[], hasMore = false) {
  if (!matches.length) return BANNED_WORD_MESSAGE
  const parts = [...groupPostForbiddenWordMatches(matches).entries()].map(([field, words]) => formatPostForbiddenWordPart(field, words))
  return `${parts.join('；')}${hasMore ? '等' : ''}，请修改后重新提交。`
}

export function formatPostForbiddenWordFieldErrors(matches: PostForbiddenWordMatch[]) {
  const errors: Partial<Record<PostForbiddenWordField, string>> = {}
  for (const [field, words] of groupPostForbiddenWordMatches(matches)) {
    errors[field] = `${formatPostForbiddenWordPart(field, words)}，请修改后重新提交。`
  }
  return errors
}

/** Shared title/body validation for both POST /api/posts and PATCH /api/posts/[postId]. */
export async function checkPostForbiddenWords(
  fields: { title?: string | null; content?: string | null },
  currentUser: ForbiddenWordUser | null | undefined,
): Promise<PostForbiddenWordCheck> {
  if (shouldBypassForbiddenWords(currentUser)) {
    return { blocked: false, matches: [], hasMore: false }
  }

  const allMatches = findPostForbiddenWordMatches(fields, await getEnabledBannedWords())
  const matches = allMatches.slice(0, 5)
  return {
    blocked: allMatches.length > 0,
    matches,
    hasMore: allMatches.length > matches.length,
  }
}

export async function checkBannedWords(text: string | null | undefined): Promise<BannedWordCheck> {
  const matched = findMatchedBannedWords(text, await getEnabledBannedWords())
  return {
    blocked: matched.length > 0,
    matchedWords: matched.map((word) => word.word),
    matchedWordIds: matched.map((word) => word.id),
    highestPriority: matched[0]?.priority === 'HIGH' ? 'HIGH' : matched.length ? 'NORMAL' : null,
  }
}

export async function containsBannedWord(text: string | null | undefined) {
  return (await checkBannedWords(text)).blocked
}

export function moderationMatchStorageValue(result: Pick<BannedWordCheck, 'matchedWords'>) {
  return result.matchedWords.length ? JSON.stringify(result.matchedWords) : null
}

export function publicModerationText(text: string | null | undefined, status: string | null | undefined) {
  return status === 'VIOLATION' ? VIOLATION_CONTENT_TEXT : (text || '')
}

export function publicModerationUserName(
  name: string | null | undefined,
  statuses: Array<string | null | undefined> = [],
) {
  return statuses.includes('VIOLATION') ? VIOLATION_USER_TEXT : (name || VIOLATION_USER_TEXT)
}

export function isModerationViolation(status: string | null | undefined) {
  return status === 'VIOLATION'
}
