import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getWantListenSummary } from '../lib/want-listen'
import { isWantListenModeEnabled, WANT_LISTEN_MODES } from '../lib/want-listen-config'
import { settleOptionalWantListenRead } from '../lib/want-listen-summary'

const root = join(process.cwd())

function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

type SummaryDatabaseOptions = {
  configError?: Error
  statsError?: Error
  activeError?: Error
}

type SummaryDatabase = NonNullable<Parameters<typeof getWantListenSummary>[1]>

function mockSummaryDatabase(options: SummaryDatabaseOptions = {}): SummaryDatabase {
  return {
    siteSetting: {
      findMany: async () => {
        if (options.configError) throw options.configError
        return []
      },
    },
    wantListenStats: {
      findMany: async () => {
        if (options.statsError) throw options.statsError
        return []
      },
    },
    wantListenSession: {
      updateMany: async () => ({ count: 0 }),
      findMany: async () => {
        if (options.activeError) throw options.activeError
        return []
      },
    },
  } as unknown as SummaryDatabase
}

test('非核心 summary 读取失败会保留 fallback，并显式标记 unavailable', () => {
  const failed = settleOptionalWantListenRead<string[]>({ status: 'rejected', reason: new Error('leaderboard unavailable') }, [])
  assert.deepEqual(failed.value, [])
  assert.equal(failed.available, false)
  assert.match(String(failed.reason), /leaderboard unavailable/)

  const succeeded = settleOptionalWantListenRead<string[]>({ status: 'fulfilled', value: ['ok'] }, [])
  assert.deepEqual(succeeded.value, ['ok'])
  assert.equal(succeeded.available, true)
})

test('服务层：统计与进行中会话 mock 失败时三种模式仍可开始', async () => {
  const summary = await getWantListenSummary('fixture-user', mockSummaryDatabase({
    statsError: new Error('stats unavailable'),
    activeError: new Error('active sessions unavailable'),
  }))

  assert.equal(summary.statsUnavailable, true)
  assert.equal(summary.activeSessionsUnavailable, true)
  assert.deepEqual(summary.activeSessions, [])
  for (const mode of WANT_LISTEN_MODES) {
    assert.equal(isWantListenModeEnabled(summary.config, mode), true, `${mode} should remain startable`)
  }
})

test('服务层：配置 mock 失败仍作为核心错误抛出，不默认放开游戏', async () => {
  const coreError = new Error('config unavailable')
  await assert.rejects(
    getWantListenSummary('fixture-user', mockSummaryDatabase({ configError: coreError })),
    (error: unknown) => error === coreError,
  )
})

test('想听首页将配置作为核心依赖，统计与进行中会话失败不阻断开始', () => {
  const service = source('lib/want-listen.ts')
  const home = source('app/games/want-listen/WantListenHome.tsx')
  assert.match(service, /Promise\.allSettled\(\[/)
  assert.match(service, /settleOptionalWantListenRead\(statsResult, \[\]\)/)
  assert.match(service, /settleOptionalWantListenRead\(activeResult, \[\]\)/)
  assert.match(service, /statsUnavailable: !statsRead\.available/)
  assert.match(service, /activeSessionsUnavailable: !activeRead\.available/)
  assert.match(service, /if \(configResult\.status === 'rejected'\) throw configResult\.reason/)
  assert.match(home, /summary && \(summary\.statsUnavailable \|\| summary\.activeSessionsUnavailable\)/)
  assert.match(home, /但游戏仍可开始/)
  assert.match(home, /personalStatsUnavailable \? '—'/)
  assert.doesNotMatch(service, /getWantListenLeaderboard\(/)
})

test('三种模式使用同一核心 session API 与正式 mode 值', () => {
  const config = source('lib/want-listen-config.ts')
  const home = source('app/games/want-listen/WantListenHome.tsx')
  const route = source('app/api/entertainment/want-listen/sessions/route.ts')
  const summaryRoute = source('app/api/entertainment/want-listen/summary/route.ts')
  const service = source('lib/want-listen.ts')
  for (const mode of ['WANT_LISTEN', 'CANTONESE_FRAGMENT', 'FALSE_TITLE']) assert.match(config, new RegExp(mode))
  assert.match(home, /body: JSON\.stringify\(\{ mode \}\)/)
  assert.match(route, /createWantListenSession\(guard\.user\.id, mode,/)
  assert.match(summaryRoute, /getWantListenSummary\(guard\.user\.id\)/)
  assert.match(service, /if \(!isWantListenMode\(value\)/)
  assert.match(service, /mode === 'FALSE_TITLE'/)
  assert.match(service, /mode === 'WANT_LISTEN'/)
  assert.match(service, /CANTONESE_FRAGMENT/)
})

test('未知列错误按数据库迁移失配返回明确诊断 code', () => {
  const api = source('lib/want-listen-api.ts')
  assert.match(api, /error\.code === 'P2022'/)
  assert.match(api, /DATABASE_MIGRATION_OUT_OF_SYNC/)
})
