import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  CUSTOM_MOOD_MAX_GRAPHEMES,
  countGraphemes,
  getMoodDisplay,
  normalizeCustomMoodText,
  truncateGraphemes,
  validateCustomMoodInput,
} from '../lib/checkin-mood'
import { SYSTEM_EMOJIS, isAllowedSystemEmoji } from '../lib/system-emoji'

const read = (path: string) => readFileSync(path, 'utf8')
const checkinRoute = read('app/api/checkin/route.ts')
const checkinButton = read('components/CheckInButton.tsx')
const moodHelper = read('lib/checkin-mood.ts')
const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20260815170000_add_custom_checkin_mood/migration.sql')
const emoji = SYSTEM_EMOJIS[0]

test('custom mood accepts an allowed Emoji with one visible character', () => {
  const result = validateCustomMoodInput({ emoji, text: '好' })
  assert.deepEqual(result, { ok: true, emoji, text: '好' })
  assert.equal(isAllowedSystemEmoji(emoji), true)
})

test('custom mood accepts exactly seven grapheme characters', () => {
  const result = validateCustomMoodInput({ emoji, text: '今天真的开心呀' })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(countGraphemes(result.text), CUSTOM_MOOD_MAX_GRAPHEMES)
})

test('custom mood rejects more than seven grapheme characters', () => {
  assert.deepEqual(validateCustomMoodInput({ emoji, text: '今天真的特别开心呀' }), { ok: false, reason: 'too-long' })
  assert.equal(truncateGraphemes('今天真的特别开心呀', CUSTOM_MOOD_MAX_GRAPHEMES), '今天真的特别开')
})

test('custom mood rejects empty and whitespace-only text', () => {
  assert.deepEqual(validateCustomMoodInput({ emoji, text: '' }), { ok: false, reason: 'empty' })
  assert.deepEqual(validateCustomMoodInput({ emoji, text: '   \t  ' }), { ok: false, reason: 'empty' })
  assert.equal(normalizeCustomMoodText('  今天开心  '), '今天开心')
})

test('custom mood requires an Emoji from the existing system catalog', () => {
  assert.deepEqual(validateCustomMoodInput({ emoji: '', text: '开心' }), { ok: false, reason: 'emoji' })
  assert.deepEqual(validateCustomMoodInput({ emoji: '🛸', text: '开心' }), { ok: false, reason: 'emoji' })
  assert.deepEqual(validateCustomMoodInput({ emoji: 'https://example.com/a.png', text: '开心' }), { ok: false, reason: 'emoji' })
})

test('grapheme counting treats composed and joined Emoji as one character', () => {
  assert.equal(countGraphemes('❤️'), 1)
  assert.equal(countGraphemes('👨‍👩‍👧‍👦'), 1)
  assert.equal(countGraphemes('á'), 1)
})

test('custom mood remains plain text and does not render HTML directly', () => {
  const result = validateCustomMoodInput({ emoji, text: '<b>好呀' })
  assert.equal(result.ok, true)
  assert.doesNotMatch(checkinButton, /dangerouslySetInnerHTML/)
  assert.doesNotMatch(moodHelper, /dangerouslySetInnerHTML/)
})

test('server validates custom mood fields and dynamic moderation', () => {
  assert.match(checkinRoute, /validateCustomMoodInput\(/)
  assert.match(checkinRoute, /checkBannedWords\(validatedCustomMood\.text\)/)
  assert.match(checkinRoute, /CUSTOM_MOOD_BANNED_WORD_MESSAGE/)
  assert.match(checkinRoute, /moodType: mood \? PRESET_MOOD_TYPE : customMood \? CUSTOM_MOOD_TYPE : null/)
  assert.doesNotMatch(checkinRoute, /body\?\.(?:safe|approved|moderationPassed)/)
  assert.doesNotMatch(checkinRoute, /PENDING/)
})

test('custom mood is stored as a snapshot on CheckIn and related daily records', () => {
  for (const model of ['CheckIn', 'DailyMessage', 'FriendActivity']) {
    const modelBlock = new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`)
    const match = schema.match(modelBlock)
    assert.ok(match, `missing ${model} model`)
    assert.match(match[0], /moodType\s+String\?/)
    assert.match(match[0], /moodEmoji\s+String\?/)
    assert.match(match[0], /moodText\s+String\?/)
  }
  assert.match(migration, /ALTER TABLE `CheckIn`[\s\S]*ADD COLUMN `moodType`/)
  assert.match(migration, /ALTER TABLE `DailyMessage`[\s\S]*ADD COLUMN `moodEmoji`/)
  assert.match(migration, /ALTER TABLE `FriendActivity`[\s\S]*ADD COLUMN `moodText`/)
  assert.doesNotMatch(migration, /moodEmoji.*\|.*moodText/)
})

test('old and new mood records share a display formatter with Emoji plus text', () => {
  const custom = getMoodDisplay({ moodType: 'CUSTOM', moodEmoji: emoji, moodText: '今天开心' })
  assert.equal(custom.formatted, `${emoji} 今天开心`)
  assert.equal(custom.isCustom, true)
  assert.equal(getMoodDisplay({ mood: 'HAPPY' }).isCustom, false)
  assert.ok(getMoodDisplay({ mood: 'HAPPY' }).formatted)
})

test('the existing check-in flow keeps rewards and invalidates relevant caches', () => {
  assert.match(checkinRoute, /awardRegistrationFee/)
  assert.match(checkinRoute, /getRandomCheckInPoints/)
  assert.match(checkinRoute, /invalidateCheckInMessagesCache\(\)/)
  assert.match(checkinRoute, /invalidateHomeDataCache\(\)/)
  assert.match(checkinButton, /moodKey:/)
  assert.match(checkinButton, /moodEmoji:/)
  assert.match(checkinButton, /moodText:/)
})

test('the client uses grapheme truncation, a live counter, and the existing EmojiPicker', () => {
  assert.match(checkinButton, /truncateGraphemes\(event\.target\.value, CUSTOM_MOOD_MAX_GRAPHEMES\)/)
  assert.match(checkinButton, /countGraphemes\(customMoodText\).*CUSTOM_MOOD_MAX_GRAPHEMES/)
  assert.match(checkinButton, /onSelectEmoji=\{\(emoji\) =>/)
  assert.match(checkinButton, /自定义/)
})

test('related APIs and surfaces carry the custom mood snapshot fields', () => {
  for (const path of [
    'app/api/checkin/history/route.ts',
    'app/api/checkin/history/[dateKey]/route.ts',
    'app/api/profile/checkins/route.ts',
    'app/api/friends/activity/route.ts',
    'app/api/daily-messages/route.ts',
    'app/api/profile/messages/route.ts',
    'lib/home-data.ts',
    'lib/profile-page.ts',
  ]) {
    const source = read(path)
    assert.match(source, /moodType/)
    assert.match(source, /moodEmoji/)
    assert.match(source, /moodText/)
  }
})
