import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBadgeDefinition } from '@/lib/badge-admin'
import { BADGE_NICKNAME_SHINE_FALLBACK, getBadgeNicknameShineColor, isBadgeNicknameShineEnabled } from '@/lib/badge-types'

test('nickname shine derives enabled state without changing the base color', () => {
  assert.equal(isBadgeNicknameShineEnabled({ nicknameEffect: 'NONE' }), false)
  assert.equal(isBadgeNicknameShineEnabled({ nicknameEffect: 'GOLD' }), true)
  assert.equal(getBadgeNicknameShineColor({ nicknameColor: '#D4AF37' }), '#d4af37')
  assert.equal(getBadgeNicknameShineColor({ nicknameColor: null }), BADGE_NICKNAME_SHINE_FALLBACK)
})

test('admin badge parsing stores one shine color and ignores legacy gradient endpoints', () => {
  const parsed = parseBadgeDefinition({
    name: '闪光测试勋章',
    nicknameEffect: 'GRADIENT',
    nicknameColor: '#d4af37',
    nicknameGradientStart: '#111111',
    nicknameGradientEnd: '#eeeeee',
  })
  assert.equal(parsed.error, undefined)
  assert.equal(parsed.data?.nicknameEffect, 'COLOR')
  assert.equal(parsed.data?.nicknameColor, '#d4af37')
  assert.equal(parsed.data?.nicknameGradientStart, undefined)
  assert.equal(parsed.data?.nicknameGradientEnd, undefined)
})

test('disabling nickname shine removes its color while keeping the database schema untouched', () => {
  const parsed = parseBadgeDefinition({
    name: '关闭闪光测试勋章',
    nicknameEffect: 'NONE',
    nicknameColor: '#d4af37',
  })
  assert.equal(parsed.error, undefined)
  assert.equal(parsed.data?.nicknameEffect, 'NONE')
  assert.equal(parsed.data?.nicknameColor, null)
})
