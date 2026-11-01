'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const APP_DIR = '/home/apps/easonfansclub'
const TARGET = 'mreasonchan'
const PLATFORM = 'INSTAGRAM'
const SAFE_LOG_BYTES = 2 * 1024 * 1024
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/

function safeCode(value) {
  return typeof value === 'string' && SAFE_ERROR_CODE.test(value) ? value : value ? 'OTHER' : null
}

function validSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)
}

function safeWorkerPath(value) {
  if (typeof value !== 'string') return 'UNKNOWN'
  if (value === `${APP_DIR}/current` || new RegExp(`^${APP_DIR}/releases/[A-Za-z0-9._-]+$`).test(value)) return value
  return 'OTHER_PATH'
}

function safeRuntimeConfig(runtimeEnv, fileEnv) {
  const value = (key) => typeof runtimeEnv?.[key] === 'string' ? runtimeEnv[key] : typeof fileEnv?.[key] === 'string' ? fileEnv[key] : ''
  const enabled = (key) => ['true', 'false'].includes(value(key).trim().toLowerCase()) ? value(key).trim().toLowerCase() : 'MISSING_OR_INVALID'
  return {
    syncEnabled: enabled('ANYWHERE_DOOR_SYNC_ENABLED'),
    featureEnabled: enabled('ANYWHERE_DOOR_ENABLED'),
    provider: value('IG_PROVIDER').trim().toLowerCase() === 'apify' ? 'apify' : value('IG_PROVIDER') ? 'OTHER' : 'MISSING',
    target: value('IG_TARGET_USERNAME').trim().toLowerCase() === TARGET ? TARGET : value('IG_TARGET_USERNAME') ? 'OTHER' : 'MISSING',
    apifyTokenPresent: Boolean(value('APIFY_API_TOKEN').trim()),
  }
}

function safeWorkerArgs(pm2Args, processArgs = []) {
  const values = Array.isArray(pm2Args) ? pm2Args : typeof pm2Args === 'string' ? [pm2Args] : []
  return values.includes('scripts/instagram-sync-worker.ts') || processArgs.includes('scripts/instagram-sync-worker.ts')
    ? 'scripts/instagram-sync-worker.ts'
    : 'OTHER_ARGUMENTS'
}

function isPathWithin(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function parsePm2List(raw) {
  const list = JSON.parse(raw)
  if (!Array.isArray(list)) throw new Error('PM2_LIST_NOT_ARRAY')
  const workers = list.filter((item) => item && item.name === 'instagram-sync-worker')
  if (workers.length !== 1) return { count: workers.length, worker: null }
  const row = workers[0]
  const env = row.pm2_env && typeof row.pm2_env === 'object' ? row.pm2_env : {}
  const runtimeEnv = env.env && typeof env.env === 'object' ? env.env : env
  const pid = Number(row.pid || env.pid || 0)
  const restartCount = env.restart_time
  const uptime = Number(env.pm_uptime)
  const worker = {
      name: 'instagram-sync-worker',
      status: typeof env.status === 'string' && /^[A-Za-z_]+$/.test(env.status) ? env.status : 'UNKNOWN',
      pid: Number.isSafeInteger(pid) && pid > 0 ? pid : null,
      configuredCwd: safeWorkerPath(env.pm_cwd),
      execPath: typeof env.pm_exec_path === 'string' && env.pm_exec_path.endsWith('/node_modules/tsx/dist/cli.mjs') ? 'tsx/dist/cli.mjs' : 'OTHER_ENTRYPOINT',
      args: safeWorkerArgs(env.args),
      restartCount: Number.isSafeInteger(restartCount) && restartCount >= 0 ? restartCount : null,
      startedAt: Number.isFinite(uptime) && uptime > 0 ? new Date(uptime).toISOString() : null,
      runtimeConfig: safeRuntimeConfig(runtimeEnv, {}),
      outLogPath: typeof env.pm_out_log_path === 'string' ? env.pm_out_log_path : '',
  }
  Object.defineProperty(worker, 'runtimeEnv', { value: runtimeEnv, enumerable: false })
  Object.defineProperty(worker, 'pm2Args', { value: env.args, enumerable: false })
  return { count: 1, worker }
}

function parseWorkerLogLine(line) {
  if (typeof line !== 'string' || !line.includes('[instagram-sync-worker]')) return null
  const status = line.match(/\bstatus:\s*'([A-Z_]+)'/)
  if (!status) return null
  const errorCode = line.match(/\berrorCode:\s*(?:'([A-Z0-9_]{1,64})'|(null))/)
  const time = line.match(/\b(20\d{2}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)\b/)
  return {
    at: time ? time[1] : null,
    status: status[1],
    errorCode: errorCode ? (errorCode[2] === 'null' ? null : safeCode(errorCode[1])) : null,
  }
}

function parseWorkerLogBuffer(buffer, now = new Date()) {
  const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000
  return buffer.toString('utf8').split(/\r?\n/)
    .map(parseWorkerLogLine)
    .filter((entry) => entry && entry.at && Date.parse(entry.at) >= cutoff)
    .slice(-20)
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null
}

function summarizeSocialEvidence({ states, recentLogs, lastSuccess, lastAttempt, firstFailure, firstFailureAfterSuccess, posts, latestCreated, now = new Date() }) {
  const state = Array.isArray(states) && states.length === 1 ? states[0] : null
  const logs = Array.isArray(recentLogs) ? recentLogs : []
  const failures = logs.filter((log) => log.status === 'FAILED').sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
  const attempt = lastAttempt || (logs.length ? logs.reduce((a, b) => new Date(a.startedAt) > new Date(b.startedAt) ? a : b) : null)
  const earliestFailure = firstFailureAfterSuccess || firstFailure || failures[0] || null
  const latestSuccess = lastSuccess || logs.find((log) => log.status === 'SUCCEEDED') || null
  const rows = Array.isArray(posts) ? posts : []
  const latestPost = rows[0] || null
  return {
    stateCount: Array.isArray(states) ? states.length : 0,
    state: state ? {
      lastCheckedAt: iso(state.lastCheckedAt),
      lastSuccessfulSyncAt: iso(state.lastSuccessfulSyncAt),
      lastChangedAt: iso(state.lastChangedAt),
      lastErrorAt: iso(state.lastErrorAt),
      lastErrorCode: safeCode(state.lastErrorCode),
      consecutiveFailures: Number.isSafeInteger(state.consecutiveFailures) ? state.consecutiveFailures : null,
      syncRequestedAt: iso(state.syncRequestedAt),
    } : null,
    lastSuccess: latestSuccess ? {
      startedAt: iso(latestSuccess.startedAt),
      finishedAt: iso(latestSuccess.finishedAt),
      foundCount: latestSuccess.foundCount,
      createdCount: latestSuccess.createdCount,
      updatedCount: latestSuccess.updatedCount,
      errorCode: safeCode(latestSuccess.errorCode),
    } : null,
    lastAttempt: attempt ? {
      startedAt: iso(attempt.startedAt),
      finishedAt: iso(attempt.finishedAt),
      status: attempt.status,
      foundCount: attempt.foundCount,
      createdCount: attempt.createdCount,
      errorCode: safeCode(attempt.errorCode),
    } : null,
    firstFailureInRecentWindow: failures[0] ? {
      startedAt: iso(failures[0].startedAt),
      errorCode: safeCode(failures[0].errorCode),
    } : null,
    firstFailure: earliestFailure ? {
      startedAt: iso(earliestFailure.startedAt),
      errorCode: safeCode(earliestFailure.errorCode),
    } : null,
    recentLogCount: logs.length,
    posts: rows.map((row) => ({
      sourceId: typeof row.externalId === 'string' && /^[A-Za-z0-9._:-]{1,191}$/.test(row.externalId) ? row.externalId : 'INVALID_ID',
      shortcode: typeof row.shortcode === 'string' && /^[A-Za-z0-9._:-]{1,191}$/.test(row.shortcode) ? row.shortcode : null,
      provider: row.provider === 'apify' ? 'apify' : 'OTHER',
      mediaType: ['IMAGE', 'VIDEO', 'CAROUSEL', 'REEL'].includes(row.mediaType) ? row.mediaType : 'OTHER',
      status: ['DISCOVERED', 'DOWNLOADING', 'READY', 'FAILED', 'HIDDEN', 'SOURCE_DELETED'].includes(row.status) ? row.status : 'OTHER',
      publishedAt: iso(row.publishedAt),
      createdAt: iso(row.createdAt),
    })),
    latestDbPublishedAt: latestPost ? iso(latestPost.publishedAt) : null,
    latestDbCreatedAt: iso(latestCreated?.createdAt || null),
    observationAt: now.toISOString(),
  }
}

async function querySocialEvidence(prisma, now = new Date()) {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const [states, recentLogs, lastSuccess, lastAttempt, firstFailure, posts, latestCreated] = await Promise.all([
    prisma.socialSyncState.findMany({
      where: { platform: PLATFORM, target: TARGET },
      orderBy: { updatedAt: 'desc' },
      take: 2,
      select: { lastCheckedAt: true, lastSuccessfulSyncAt: true, lastChangedAt: true, lastErrorAt: true, lastErrorCode: true, consecutiveFailures: true, syncRequestedAt: true },
    }),
    prisma.socialSyncLog.findMany({
      where: { target: TARGET, startedAt: { gte: since } },
      orderBy: { startedAt: 'desc' },
      take: 200,
      select: { startedAt: true, finishedAt: true, status: true, foundCount: true, createdCount: true, updatedCount: true, errorCode: true },
    }),
    prisma.socialSyncLog.findFirst({
      where: { target: TARGET, status: 'SUCCEEDED' },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true, finishedAt: true, status: true, foundCount: true, createdCount: true, updatedCount: true, errorCode: true },
    }),
    prisma.socialSyncLog.findFirst({
      where: { target: TARGET },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true, finishedAt: true, status: true, foundCount: true, createdCount: true, updatedCount: true, errorCode: true },
    }),
    prisma.socialSyncLog.findFirst({
      where: { target: TARGET, status: 'FAILED' },
      orderBy: { startedAt: 'asc' },
      select: { startedAt: true, errorCode: true },
    }),
    prisma.socialPost.findMany({
      where: { platform: PLATFORM, authorUsername: TARGET },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: 20,
      select: { externalId: true, shortcode: true, provider: true, mediaType: true, status: true, publishedAt: true, createdAt: true },
    }),
    prisma.socialPost.findFirst({
      where: { platform: PLATFORM, authorUsername: TARGET },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ])
  let firstFailureAfterSuccess = null
  if (lastSuccess?.startedAt) {
    firstFailureAfterSuccess = await prisma.socialSyncLog.findFirst({
      where: { target: TARGET, status: 'FAILED', startedAt: { gt: lastSuccess.startedAt } },
      orderBy: { startedAt: 'asc' },
      select: { startedAt: true, errorCode: true },
    })
  }
  return summarizeSocialEvidence({ states, recentLogs, lastSuccess, lastAttempt, firstFailure, firstFailureAfterSuccess, posts, latestCreated, now })
}

function safeDatabaseError(error) {
  const code = error && typeof error === 'object' && typeof error.code === 'string' ? error.code : ''
  const allowed = new Set(['DATABASE_URL_MISSING', 'P1000', 'P1001', 'P1002', 'P1003', 'P1010', 'P2021', 'P2022', 'P2023', 'P2024', 'P2025'])
  return allowed.has(code) ? code : 'DATABASE_QUERY_FAILED'
}

function readSafeWorkerLogs(worker, pm2Home, now) {
  if (!worker || !worker.outLogPath) return { status: 'NOT_CONFIGURED', entries: [] }
  try {
    const logsDir = fs.realpathSync(path.join(pm2Home, 'logs'))
    const logPath = fs.realpathSync(worker.outLogPath)
    if (!isPathWithin(logsDir, logPath)) return { status: 'PATH_REJECTED', entries: [] }
    const stat = fs.statSync(logPath)
    if (!stat.isFile()) return { status: 'NOT_REGULAR_FILE', entries: [] }
    const fd = fs.openSync(logPath, 'r')
    try {
      const length = Math.min(stat.size, SAFE_LOG_BYTES)
      const buffer = Buffer.alloc(length)
      fs.readSync(fd, buffer, 0, length, Math.max(0, stat.size - length))
      return { status: 'READ', entries: parseWorkerLogBuffer(buffer, now) }
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return { status: 'UNAVAILABLE', entries: [] }
  }
}

function runtimeSnapshot() {
  const pm2Home = process.env.PM2_HOME || path.join(process.env.HOME || '', '.pm2')
  let parsed
  try {
    const socket = path.join(pm2Home, 'rpc.sock')
    if (!fs.existsSync(socket) || !fs.statSync(socket).isSocket()) return { pm2Status: 'DAEMON_SOCKET_MISSING', pm2Home, worker: null, count: null, workerLogs: { status: 'NOT_AVAILABLE', entries: [] } }
    parsed = parsePm2List(execFileSync('pm2', ['jlist'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }))
  } catch {
    return { pm2Status: 'QUERY_FAILED', pm2Home, worker: null, count: null, workerLogs: { status: 'NOT_AVAILABLE', entries: [] } }
  }
  const worker = parsed.worker
  let actualCwd = null
  let releaseSha = null
  if (worker && worker.pid) {
    try { actualCwd = fs.readlinkSync(`/proc/${worker.pid}/cwd`) } catch {}
    let processArgs = []
    try { processArgs = fs.readFileSync(`/proc/${worker.pid}/cmdline`).toString('utf8').split('\0').filter(Boolean) } catch {}
    worker.args = safeWorkerArgs(worker.pm2Args, processArgs)
    if (actualCwd && isPathWithin(path.join(APP_DIR, 'releases'), actualCwd)) {
      try {
        const marker = fs.readFileSync(path.join(actualCwd, '.deployed-sha'), 'utf8').trim()
        if (validSha(marker)) releaseSha = marker
      } catch {}
      let fileEnv = {}
      try {
        const releaseRequire = require('node:module').createRequire(path.join(actualCwd, 'package.json'))
        const dotenv = releaseRequire('dotenv')
        fileEnv = dotenv.parse(fs.readFileSync(path.join(actualCwd, '.env')))
      } catch {}
      worker.runtimeConfig = safeRuntimeConfig(worker.runtimeEnv || {}, fileEnv)
    }
  }
  return {
    pm2Status: 'PASS',
    pm2Home,
    count: parsed.count,
    worker: worker ? { ...worker, actualCwd: safeWorkerPath(actualCwd), releaseSha } : null,
    workerLogs: readSafeWorkerLogs(worker, pm2Home, new Date()),
  }
}

async function main() {
  let result = {
    readOnly: true,
    currentSha: null,
    currentRelease: null,
    workerEvidence: runtimeSnapshot(),
    databaseRead: { status: 'NOT_ATTEMPTED', errorClass: null, evidence: null },
  }
  let prisma
  try {
    const currentRelease = fs.realpathSync(path.join(APP_DIR, 'current'))
    const releasesRoot = fs.realpathSync(path.join(APP_DIR, 'releases'))
    if (!isPathWithin(releasesRoot, currentRelease)) throw new Error('CURRENT_RELEASE_PATH_REJECTED')
    result.currentRelease = safeWorkerPath(currentRelease)
    try {
      const marker = fs.readFileSync(path.join(currentRelease, '.deployed-sha'), 'utf8').trim()
      if (validSha(marker)) result.currentSha = marker
    } catch {}

    const releaseRequire = require('node:module').createRequire(path.join(currentRelease, 'package.json'))
    const dotenv = releaseRequire('dotenv')
    const envPath = path.join(currentRelease, '.env')
    if (!fs.statSync(envPath).isFile()) throw new Error('ENV_FILE_NOT_REGULAR')
    const parsedEnv = dotenv.parse(fs.readFileSync(envPath))
    for (const [key, value] of Object.entries(parsedEnv)) {
      if (process.env[key] === undefined) process.env[key] = value
    }
    if (typeof process.env.DATABASE_URL !== 'string' || !process.env.DATABASE_URL.trim()) {
      const error = new Error('DATABASE_URL_MISSING')
      error.code = 'DATABASE_URL_MISSING'
      throw error
    }
    const { PrismaClient } = releaseRequire('@prisma/client')
    prisma = new PrismaClient({ log: [] })
    result.databaseRead.evidence = await querySocialEvidence(prisma)
    result.databaseRead.status = 'PASS'
  } catch (error) {
    result.databaseRead.status = 'FAIL'
    result.databaseRead.errorClass = safeDatabaseError(error)
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => undefined)
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

module.exports = {
  isPathWithin,
  parsePm2List,
  safeRuntimeConfig,
  safeWorkerArgs,
  parseWorkerLogLine,
  parseWorkerLogBuffer,
  summarizeSocialEvidence,
  querySocialEvidence,
  safeDatabaseError,
  readSafeWorkerLogs,
}

if (process.env.ECFC_ANYWHERE_DIAGNOSTIC_RUN === '1') {
  main().catch(() => {
    process.stdout.write(`${JSON.stringify({ readOnly: true, fatal: 'DIAGNOSTIC_FAILED' })}\n`)
    process.exitCode = 1
  })
}
