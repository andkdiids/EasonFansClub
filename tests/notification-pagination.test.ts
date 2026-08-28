import assert from 'node:assert/strict'
import test from 'node:test'
import { compareNotificationOrder } from '../lib/notification-order'

const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 10, minutes)).toISOString()

test('unread notifications stay before newer read notifications', () => {
  const rows = [
    { id: 'A', readAt: null, createdAt: at(0) },
    { id: 'B', readAt: at(-10), createdAt: at(-10) },
    { id: 'C', readAt: null, createdAt: at(-20) },
    { id: 'D', readAt: at(-30), createdAt: at(-30) },
  ].sort(compareNotificationOrder)
  assert.deepEqual(rows.map((row) => row.id), ['A', 'C', 'B', 'D'])
})

test('notification pagination keeps the unread/read boundary intact', () => {
  const rows = Array.from({ length: 335 }, (_, index) => ({
    id: String(index),
    readAt: index >= 35 ? at(-index) : null,
    createdAt: at(-index),
  })).sort(compareNotificationOrder)
  const page = (number: number) => rows.slice((number - 1) * 20, number * 20)

  assert.equal(page(1).filter((row) => row.readAt === null).length, 20)
  assert.equal(page(1).filter((row) => row.readAt !== null).length, 0)
  assert.equal(page(2).filter((row) => row.readAt === null).length, 15)
  assert.equal(page(2).filter((row) => row.readAt !== null).length, 5)
  assert.equal(page(3).filter((row) => row.readAt === null).length, 0)
  assert.equal(page(3).filter((row) => row.readAt !== null).length, 20)
})

test('marking one unread row read moves it below the remaining unread rows', () => {
  const rows = [
    { id: 'A', readAt: null, createdAt: at(0) },
    { id: 'C', readAt: null, createdAt: at(-20) },
    { id: 'B', readAt: at(-10), createdAt: at(-10) },
    { id: 'D', readAt: at(-30), createdAt: at(-30) },
  ]
  rows[1].readAt = at(-1)
  rows.sort(compareNotificationOrder)
  assert.deepEqual(rows.map((row) => row.id), ['A', 'B', 'C', 'D'])
})
