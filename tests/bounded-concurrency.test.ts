import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapWithConcurrency } from '../lib/bounded-concurrency'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('bounded worker pool processes all rows in order without exceeding its limit', async () => {
  let active = 0
  let peak = 0
  const result = await mapWithConcurrency(Array.from({ length: 20 }, (_, index) => index), 4, async (value) => {
    active += 1
    peak = Math.max(peak, active)
    await delay(2)
    active -= 1
    return value * 2
  })

  assert.deepEqual(result, Array.from({ length: 20 }, (_, index) => index * 2))
  assert.equal(peak, 4)
  assert.equal(active, 0)
})

test('worker failure stops assigning new rows and waits for in-flight work', async () => {
  let active = 0
  const started: number[] = []
  await assert.rejects(mapWithConcurrency(Array.from({ length: 20 }, (_, index) => index), 3, async (value) => {
    started.push(value)
    active += 1
    try {
      if (value === 0) throw new Error('synthetic worker failure')
      await delay(5)
    } finally {
      active -= 1
    }
  }), /synthetic worker failure/)

  assert.ok(started.length <= 3)
  assert.equal(active, 0)
})

test('worker pool rejects invalid concurrency and accepts an empty input', async () => {
  await assert.rejects(mapWithConcurrency([], 0, async () => undefined), RangeError)
  assert.deepEqual(await mapWithConcurrency([], 2, async () => undefined), [])
})