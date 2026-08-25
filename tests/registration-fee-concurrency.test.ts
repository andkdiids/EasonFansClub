import assert from 'node:assert/strict'
import test from 'node:test'
import { awardRegistrationFee } from '../lib/registration-fee'

type RewardState = {
  points: number
  logs: Array<{ id: string; businessKey: string | null; points: number }>
}

function createMutex() {
  let locked = false
  const waiters: Array<() => void> = []
  return {
    async acquire() {
      if (!locked) {
        locked = true
        return
      }
      await new Promise<void>((resolve) => waiters.push(resolve))
      locked = true
    },
    release() {
      const next = waiters.shift()
      if (next) next()
      else locked = false
    },
  }
}

function createFakeTransactions(state: RewardState) {
  const mutex = createMutex()
  let nextId = 0
  return () => {
    let ownsUserLock = false
    const tx = {
      pointLog: {
        findUnique: async ({ where }: { where: { businessKey?: string } }) => {
          const businessKey = where.businessKey
          const row = state.logs.find((item) => item.businessKey === businessKey)
          return row ? { id: row.id } : null
        },
        create: async ({ data }: { data: { businessKey?: string | null; points: number } }) => {
          const row = { id: `log-${++nextId}`, businessKey: data.businessKey || null, points: data.points }
          state.logs.push(row)
          return row
        },
      },
      user: {
        findUniqueOrThrow: async () => ({ points: state.points }),
        update: async ({ data }: { data: { points: { increment: number } } }) => {
          state.points += data.points.increment
          return { points: state.points }
        },
      },
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join(' ')
        if (sql.includes('FROM `User`')) {
          await mutex.acquire()
          ownsUserLock = true
          return [{ id: 'user-1', points: state.points }]
        }
        if (sql.includes('FROM `PointLog`')) {
          const businessKey = String(values[0] || '')
          const row = state.logs.find((item) => item.businessKey === businessKey)
          return row ? [{ id: row.id }] : []
        }
        return []
      },
    }
    return { tx, release: () => { if (ownsUserLock) mutex.release() } }
  }
}

async function runConcurrentRewards(businessKeys: string[]) {
  const state: RewardState = { points: 10, logs: [] }
  const create = createFakeTransactions(state)
  const results = await Promise.all(businessKeys.map(async (businessKey) => {
    const transaction = create()
    try {
      return await awardRegistrationFee(transaction.tx as never, {
        userId: 'user-1',
        requestedAmount: 7,
        action: 'DAILY_CHECK_IN',
        reason: 'test',
        businessKey,
      })
    } finally {
      transaction.release()
    }
  }))
  return { state, results }
}

test('同一 businessKey 的 10 个并发奖励只增加一次积分', async () => {
  const { state, results } = await runConcurrentRewards(Array.from({ length: 10 }, () => 'checkin:one'))
  assert.equal(results.filter((result) => !result.duplicate).length, 1)
  assert.equal(state.points, 17)
  assert.equal(state.logs.length, 1)
})

test('签到与娱乐两个不同 businessKey 并发时各自成功且不丢积分', async () => {
  const { state, results } = await runConcurrentRewards(['checkin:one', 'entertainment-draw:one'])
  assert.equal(results.filter((result) => !result.duplicate).length, 2)
  assert.equal(state.points, 24)
  assert.equal(state.logs.length, 2)
})
