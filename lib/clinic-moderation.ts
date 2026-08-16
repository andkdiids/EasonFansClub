import { findMatchedBannedWords, getEnabledBannedWords, type ModerationWord } from '@/lib/content-moderation'

export type ClinicModerationResult = {
  blocked: boolean
  strictMatches: ModerationWord[]
  maskMatches: ModerationWord[]
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isLatinWord(value: string) {
  return /^[\p{ASCII}\p{Number}_-]+$/u.test(value)
}

function buildMaskRegExp(word: string) {
  const escaped = escapeRegExp(word)
  // ASCII profanity must not be replaced inside a normal word. Chinese
  // phrases do not have whitespace word boundaries, so the exact phrase is
  // matched while the shared matcher still decides which words are enabled.
  return isLatinWord(word)
    ? new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu')
    : new RegExp(escaped, 'giu')
}

/**
 * Clinic-only grading: HIGH words remain hard blocks, while NORMAL words are
 * accepted and masked for public display. Existing post/comment behaviour is
 * intentionally unchanged.
 */
export async function checkClinicModeration(text: string): Promise<ClinicModerationResult> {
  const words = await getEnabledBannedWords()
  return checkClinicModerationWithWords(text, words)
}

export function checkClinicModerationWithWords(text: string, words: ModerationWord[]): ClinicModerationResult {
  const matched = findMatchedBannedWords(text, words)
  const strictMatches = matched.filter((word) => word.priority === 'HIGH')
  const maskMatches = matched.filter((word) => word.priority !== 'HIGH')
  return { blocked: strictMatches.length > 0, strictMatches, maskMatches }
}

export async function maskClinicText(text: string) {
  return maskClinicTextWithWords(text, await getEnabledBannedWords())
}

export function maskClinicTextWithWords(text: string, words: ModerationWord[]) {
  const matches = findMatchedBannedWords(text, words)
    .filter((word) => word.priority !== 'HIGH')
    .sort((left, right) => right.word.length - left.word.length)

  return matches.reduce((value, word) => {
    if (!word.word) return value
    return value.replace(buildMaskRegExp(word.word), '哔——')
  }, text)
}

export function clinicModerationStorageValue(result: ClinicModerationResult) {
  const words = [...result.strictMatches, ...result.maskMatches].map((word) => word.word)
  return words.length ? JSON.stringify(Array.from(new Set(words)).slice(0, 20)) : null
}
