import assert from 'node:assert/strict'
import test from 'node:test'
import { compareNotificationOrder } from '../lib/notification-order'

const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 10, minutes)).toISOString()

test('unread notifications stay before newer read notifications', () => {
  const rows = [
    { id: 'A', isRead: false, createdAt: at(0) },
    { id: 'B', isRead: true, createdAt: at(-10) },
    { id: 'C', isRead: false, createdAt: at(-20) },
    { id: 'D', isRead: true, createdAt: at(-30) },
  ].sort(compareNotificationOrder)
  assert.deepEqual(rows.map((row) => row.id), ['A', 'C', 'B', 'D'])
})

test('notification pagination keeps the unread/read boundary intact', () => {
  const rows = Array.from({ length: 335 }, (_, index) => ({
    id: String(index),
    isRead: index >= 35,
    createdAt: at(-index),
  })).sort(compareNotificationOrder)
  const page = (number: number) => rows.slice((number - 1) * 20, number * 20)

  assert.equal(page(1).filter((row) => !row.isRead).length, 20)
  assert.equal(page(1).filter((row) => row.isRead).length, 0)
  assert.equal(page(2).filter((row) => !row.isRead).length, 15)
  assert.equal(page(2).filter((row) => row.isRead).length, 5)
  assert.equal(page(3).filter((row) => !row.isRead).length, 0)
  assert.equal(page(3).filter((row) => row.isRead).length, 20)
})

test('marking one unread row read moves it below the remaining unread rows', () => {
  const rows = [
    { id: 'A', isRead: false, createdAt: at(0) },
    { id: 'C', isRead: false, createdAt: at(-20) },
    { id: 'B', isRead: true, createdAt: at(-10) },
    { id: 'D', isRead: true, createdAt: at(-30) },
  ]
  rows[1].isRead = true
  rows.sort(compareNotificationOrder)
  assert.deepEqual(rows.map((row) => row.id), ['A', 'B', 'C', 'D'])
})
