import assert from 'node:assert/strict'
import test from 'node:test'
import { isCompleteActiveUser } from '@/lib/users'

test('active session user accepts the current Prisma Profile relation', () => {
  assert.equal(isCompleteActiveUser({
    uid: 1,
    status: 'ACTIVE',
    isDeleted: false,
    Profile: { id: 'profile-id' },
  }), true)
})

test('active session user still requires a Profile relation', () => {
  assert.equal(isCompleteActiveUser({
    uid: 1,
    status: 'ACTIVE',
    isDeleted: false,
    Profile: null,
  }), false)
})
