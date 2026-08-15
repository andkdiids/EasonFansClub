import { getMood } from '@/lib/daily'
import { isAllowedSystemEmoji } from '@/lib/system-emoji'

export const CUSTOM_MOOD_TYPE = 'CUSTOM' as const
export const PRESET_MOOD_TYPE = 'PRESET' as const
export const CUSTOM_MOOD_MAX_GRAPHEMES = 7
export const CUSTOM_MOOD_BANNED_WORD_MESSAGE = '心情内容包含不适合展示的内容，请修改后再试。'
export const CUSTOM_MOOD_INVALID_MESSAGE = '请选择 Emoji，并填写 1～7 个字的心情文字。'

export type CheckInMoodRecord = {
  mood?: string | null
  moodType?: string | null
  moodEmoji?: string | null
  moodText?: string | null
}

export type CustomMoodInput = {
  emoji: unknown
  text: unknown
}

export type CustomMoodValidation =
  | { ok: true; emoji: string; text: string }
  | { ok: false; reason: 'emoji' | 'empty' | 'too-long' }

type GraphemeSegmenter = {
  segment(value: string): Iterable<{ segment: string }>
}

function getGraphemeSegmenter(): GraphemeSegmenter | null {
  try {
    const Segmenter = (Intl as typeof Intl & {
      Segmenter?: new (locales?: string | string[], options?: { granularity: 'grapheme' }) => GraphemeSegmenter
    }).Segmenter
    return Segmenter ? new Segmenter('zh-CN', { granularity: 'grapheme' }) : null
  } catch {
    return null
  }
}

/** Count user-perceived characters instead of UTF-16 code units. */
export function countGraphemes(value: string) {
  const segmenter = getGraphemeSegmenter()
  return segmenter ? Array.from(segmenter.segment(value)).length : Array.from(value).length
}

export function truncateGraphemes(value: string, max = CUSTOM_MOOD_MAX_GRAPHEMES) {
  const segmenter = getGraphemeSegmenter()
  if (!segmenter) return Array.from(value).slice(0, max).join('')
  return Array.from(segmenter.segment(value)).slice(0, max).map((part) => part.segment).join('')
}

export function normalizeCustomMoodText(value: string) {
  return value.normalize('NFKC').trim()
}

export function validateCustomMoodInput(input: CustomMoodInput): CustomMoodValidation {
  if (!isAllowedSystemEmoji(input.emoji)) return { ok: false, reason: 'emoji' }
  if (typeof input.text !== 'string') return { ok: false, reason: 'empty' }

  const text = normalizeCustomMoodText(input.text)
  if (!text || countGraphemes(text) === 0) return { ok: false, reason: 'empty' }
  if (countGraphemes(text) > CUSTOM_MOOD_MAX_GRAPHEMES) return { ok: false, reason: 'too-long' }
  return { ok: true, emoji: input.emoji, text }
}

export type MoodDisplay = {
  icon: string
  label: string
  formatted: string
  isCustom: boolean
}

export function getMoodDisplay(value: CheckInMoodRecord | string | null | undefined): MoodDisplay {
  const record: CheckInMoodRecord = typeof value === 'string' || value == null ? { mood: value } : value
  const hasCustomSnapshot = Boolean(record.moodEmoji && record.moodText)
    && (record.moodType === CUSTOM_MOOD_TYPE || !record.mood)

  if (hasCustomSnapshot) {
    const icon = record.moodEmoji || ''
    const label = record.moodText || ''
    return { icon, label, formatted: [icon, label].filter(Boolean).join(' '), isCustom: true }
  }

  const preset = getMood(record.mood || '')
  if (preset) return { icon: preset.icon, label: preset.label, formatted: `${preset.icon} ${preset.label}`, isCustom: false }

  const label = record.moodText || record.mood || ''
  const icon = record.moodEmoji || ''
  return { icon, label, formatted: [icon, label].filter(Boolean).join(' '), isCustom: Boolean(record.moodType === CUSTOM_MOOD_TYPE) }
}
