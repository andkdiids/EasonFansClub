import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getWantListenSummary, isRetryableWantListenTransactionError } from '../lib/want-listen'
import { isWantListenModeEnabled, WANT_LISTEN_MODES } from '../lib/want-listen-config'
import { buildCantoneseFragmentQuestion, buildFalseTitleQuestion, buildWantListenQuestion, validateQuestion, type WantListenSongCandidate } from '../lib/want-listen-questions'
import { settleOptionalWantListenRead } from '../lib/want-listen-summary'

const root = join(process.cwd())

function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function healthSong(index: number): WantListenSongCandidate {
  return {
    id: `health-song-${index}`,
    title: `健康检查歌曲 ${index}`,
    releaseYear: 2000 + (index % 20),
    language: '粤语',
    lyricist: '健康检查作词',
    composer: '健康检查作曲',
    arranger: null,
    producer: null,
    lyrics: [0, 1, 2, 3, 4].map((line) => `第${index}号${index}号${index}号独特歌词内容丰富悠长第${index}句 ${line}`).join('\n'),
    description: null,
    story: null,
    album: { id: `health-album-${index}`, name: `健康检查专辑 ${index}`, releaseYear: 2000 + (index % 20), language: '粤语', coverUrl: null },
  }
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

test('启动事务会重试可恢复的 Prisma 事务断连，并为创建预留足够的等待窗口', () => {
  const retryable = Object.assign(new Error('Transaction API error'), { code: 'P2028' })
  const deadlock = Object.assign(new Error('deadlock found when trying to get lock'), { code: 'P2034' })
  const poolTimeout = Object.assign(new Error('Timed out fetching a new connection from the connection pool'), { code: 'P2024' })
  const closedConnection = Object.assign(new Error('Server has closed the connection'), { code: 'P1017' })
  const permanent = Object.assign(new Error('invalid input'), { code: 'P2003' })
  assert.equal(isRetryableWantListenTransactionError(retryable), true)
  assert.equal(isRetryableWantListenTransactionError(deadlock), true)
  assert.equal(isRetryableWantListenTransactionError(poolTimeout), true)
  assert.equal(isRetryableWantListenTransactionError(closedConnection), true)
  assert.equal(isRetryableWantListenTransactionError(permanent), false)

  const service = source('lib/want-listen.ts')
  assert.match(service, /code === 'P2028'/)
  assert.match(service, /maxWait: 10_000, timeout: 15_000/)
})

test('下一题生成在交互事务内复用同一个 Prisma 客户端，避免额外占用连接池', () => {
  const service = source('lib/want-listen.ts')
  assert.match(service, /type WantListenDatabase = Prisma\.TransactionClient \| typeof prisma/)
  assert.match(service, /async function loadSongRows\(database: WantListenDatabase = prisma\)/)
  assert.match(service, /async function loadActiveFakeTitles\(realTitles: readonly string\[\], database: WantListenDatabase = prisma\)/)
  assert.match(service, /async function buildQuestionAtPosition\([\s\S]*database: WantListenDatabase = prisma\)/)
  assert.match(service, /prevData\?\.fakeTitleId \? new Set\(\[prevData\.fakeTitleId\]\) : new Set\(\),\n\s+database,\n\s+\)/)
  assert.match(service, /loadRealTitles\(database\)/)
  assert.match(service, /loadActiveFakeTitles\(realTitles, database\)/)
  assert.match(service, /loadSongPool\(mode, database\)/)
})

test('历史 session 唯一键残留可精确释放，清理异常不吞掉并继续走权威创建链路', () => {
  const service = source('lib/want-listen.ts')
  const home = source('app/games/want-listen/WantListenHome.tsx')
  assert.match(service, /async function clearStaleWantListenActiveKey\(userId: string, mode: WantListenMode\)/)
  assert.match(service, /activeKey, status: \{ not: 'IN_PROGRESS' \}/)
  assert.match(service, /WANT_LISTEN_STARTUP_CLEANUP_DEGRADED/)
  assert.match(service, /await ensureModeAvailable\(mode\)/)
  assert.match(service, /for \(let attempt = 0; attempt < 2 && !created; attempt \+= 1\)/)
  assert.match(home, /summaryUnavailable/)
  assert.match(home, /summary && !isWantListenModeEnabled\(summary\.config, mode\)/)
  assert.doesNotMatch(home, /if \(starting \|\| !summary/)
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

test('summary 成功会清除旧的错误状态，并允许用户重试恢复首页', () => {
  const home = source('app/games/want-listen/WantListenHome.tsx')
  assert.match(home, /const \[summaryRetryKey, setSummaryRetryKey\] = useState\(0\)/)
  assert.match(home, /request<Summary>\('\/api\/entertainment\/want-listen\/summary'[\s\S]*?\.then\(\(value\) => \{\s+setSummary\(value\)\s+setError\(''\)\s+setSummaryUnavailable\(false\)/)
  assert.match(home, /\}, \[summaryRetryKey\]\)/)
  assert.match(home, /setSummaryRetryKey\(\(value\) => value \+ 1\)/)
  assert.match(home, /重试中…/)
})

test('三个模式分别读取独立配置，不会因单个 mode 配置影响另外两个模式', () => {
  const enabled = { enabled: true, wantListenEnabled: true, cantoneseFragmentEnabled: true, falseTitleEnabled: true }
  const cantoneseOnlyOff = { ...enabled, cantoneseFragmentEnabled: false }
  assert.equal(isWantListenModeEnabled(cantoneseOnlyOff, 'WANT_LISTEN'), true)
  assert.equal(isWantListenModeEnabled(cantoneseOnlyOff, 'CANTONESE_FRAGMENT'), false)
  assert.equal(isWantListenModeEnabled(cantoneseOnlyOff, 'FALSE_TITLE'), true)
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

test('题库健康检查：三个正式模式各能连续生成 20 道有效题目', () => {
  const pool = Array.from({ length: 24 }, (_, index) => healthSong(index))
  const realTitles = pool.map((song) => song.title)

  for (const position of Array.from({ length: 20 }, (_, index) => index + 1)) {
    const wantListen = buildWantListenQuestion(pool[position % pool.length], pool, () => 0.31)
    assert.ok(wantListen, `WANT_LISTEN question ${position} should be valid`)

    const cantonese = buildCantoneseFragmentQuestion(pool[position % pool.length], pool, position, () => 0.27)
    assert.ok(cantonese, `CANTONESE_FRAGMENT question ${position} should be valid`)
    assert.equal(validateQuestion(cantonese.data), true)

    const falseTitle = buildFalseTitleQuestion(realTitles, '健康检查不存在歌名', 'NORMAL')
    assert.ok(falseTitle, `FALSE_TITLE question ${position} should be valid`)
  }
})

test('未知列错误按数据库迁移失配返回明确诊断 code', () => {
  const api = source('lib/want-listen-api.ts')
  assert.match(api, /error\.code === 'P2022'/)
  assert.match(api, /DATABASE_MIGRATION_OUT_OF_SYNC/)
})
