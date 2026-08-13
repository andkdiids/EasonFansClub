import assert from 'node:assert/strict'
import test from 'node:test'
import { CHECK_IN_DESKTOP_MESSAGE_PAGE_SIZE, CHECK_IN_MESSAGE_PAGE_SIZE, getCheckInMessagePageSize } from '../lib/checkin-messages'
import { getProfileRecordPagination, PROFILE_RECORD_PAGE_SIZE } from '../lib/profile-page'
import { scrollToSectionTop } from '../lib/pagination'

test('check-in message page size keeps desktop and mobile rules separate', () => {
  assert.equal(getCheckInMessagePageSize(true), CHECK_IN_DESKTOP_MESSAGE_PAGE_SIZE)
  assert.equal(getCheckInMessagePageSize(false), CHECK_IN_MESSAGE_PAGE_SIZE)
  assert.equal(CHECK_IN_DESKTOP_MESSAGE_PAGE_SIZE, 7)
  assert.equal(CHECK_IN_MESSAGE_PAGE_SIZE, 5)
})

test('section pagination scrolls only its own target to the top', () => {
  const calls: Array<ScrollIntoViewOptions | undefined> = []
  const target = { scrollIntoView: (options?: ScrollIntoViewOptions) => calls.push(options) }

  scrollToSectionTop(target)
  scrollToSectionTop(null)

  assert.deepEqual(calls, [{ behavior: 'smooth', block: 'start' }])
})

test('profile record pagination clamps empty and stale pages without changing newest-first page semantics', () => {
  assert.deepEqual(getProfileRecordPagination(0, 99), {
    page: 1,
    pageSize: PROFILE_RECORD_PAGE_SIZE,
    total: 0,
    totalPages: 1,
    hasMore: false,
  })
  assert.deepEqual(getProfileRecordPagination(21, 2), {
    page: 2,
    pageSize: PROFILE_RECORD_PAGE_SIZE,
    total: 21,
    totalPages: 3,
    hasMore: true,
  })
  assert.equal(getProfileRecordPagination(21, 99).page, 3)
})
