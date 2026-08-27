import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeSocialCursor, encodeSocialCursor } from '@/lib/social-posts'

test('social feed cursor is opaque but round-trips a publishedAt/id pair', () => {
  const cursor = encodeSocialCursor({ publishedAt: '2026-08-25T10:00:00.000Z', id: 'cuid_123' })
  assert.notEqual(cursor, '2026-08-25T10:00:00.000Z')
  assert.deepEqual(decodeSocialCursor(cursor), { publishedAt: '2026-08-25T10:00:00.000Z', id: 'cuid_123' })
  assert.equal(decodeSocialCursor('not-a-cursor'), null)
})
