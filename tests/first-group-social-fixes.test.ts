import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { validateLoginAccountValue } from '../lib/login-account'

const root = process.cwd()
const readSource = (path: string) => readFileSync(`${root}/${path}`, 'utf8')

test('username validation accepts Chinese, English letters, numbers and underscores', () => {
  for (const value of ['陈奕迅', 'Eason', 'Eason2026', '陈奕迅123', 'Eason_123']) {
    assert.equal(validateLoginAccountValue(value).error, null, value)
  }
})

test('username validation rejects whitespace, punctuation and ordinary symbols', () => {
  for (const value of ['陈 奕迅', 'Eason Chan', ' Eason', 'Eason ', 'Eason-', 'Eason.', 'Eason@', 'Eason!', 'Eason#1', 'Eason\u3000Chan', 'Eason\tChan', 'Eason\nChan', '😀Eason']) {
    assert.equal(validateLoginAccountValue(value).error, '用户名只能包含中文、英文、数字和下划线，不能包含空格或特殊字符')
  }
})

test('check-in, profile wall, friend count and content upload keep the first-group contracts', () => {
  const checkInRoute = readSource('app/api/checkin/route.ts')
  const checkInButton = readSource('components/CheckInButton.tsx')
  const wallRoute = readSource('app/api/profile-wall/route.ts')
  const friendRoute = readSource('app/api/friends/list/route.ts')
  const uploadRoute = readSource('app/api/uploads/content-image/route.ts')

  assert.match(checkInRoute, /type:\s*'CHECKIN'/)
  assert.match(checkInRoute, /dailyMessageId\s*\?\s*await\s+getCheckInMessage/)
  assert.match(checkInButton, /dailyMessageId/)
  assert.match(checkInButton, /cache:\s*'no-store'/)
  assert.match(wallRoute, /parentId:\s*parentMessage\?\.id\s*\|\|\s*null/)
  assert.match(wallRoute, /wallMessage/)
  assert.match(friendRoute, /prisma\.friendship\.count/)
  assert.match(uploadRoute, /isMultipartFile/)
  assert.doesNotMatch(uploadRoute, /file\s+instanceof\s+File/)
})
