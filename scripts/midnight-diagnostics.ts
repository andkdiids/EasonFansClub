import { readFileSync } from 'node:fs'

type JsonRecord = Record<string, unknown>

const argv = process.argv.slice(2)
function valueFor(flag: string) {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}
function valuesFor(flag: string) {
  const values: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag && argv[index + 1]) values.push(argv[index + 1])
  }
  return values
}
function requiredDate(flag: string) {
  const value = valueFor(flag)
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error(`请提供有效的 ${flag} ISO 时间`)
  return new Date(value)
}
function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
function recordFromLine(line: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(line) as unknown
    return parsed && typeof parsed === 'object' ? parsed as JsonRecord : null
  } catch {
    return null
  }
}
function percentile(values: number[], p: number) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return Number(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))].toFixed(4))
}
function minuteKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '00'
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}
function routeFromRecord(record: JsonRecord) {
  const raw = String(record.uri || record.request_uri || record.requestUri || '/')
  try { return new URL(raw, 'http://localhost').pathname } catch { return raw.split('?')[0] || '/' }
}

function analyzeNginx(files: string[], start: Date, end: Date) {
  type RouteStats = { requests: number; statuses: Record<string, number>; requestTimes: number[]; upstreamTimes: number[] }
  const routes = new Map<string, RouteStats>()
  const perMinute: Record<string, number> = {}
  let linesRead = 0
  let recordsInWindow = 0
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line) continue
      linesRead += 1
      const record = recordFromLine(line)
      if (!record) continue
      const timestamp = String(record.time || record.time_iso8601 || record.timestamp || '')
      const date = new Date(timestamp)
      if (!Number.isFinite(date.getTime()) || date < start || date >= end) continue
      const route = routeFromRecord(record)
      const status = numberValue(record.status)
      const requestTime = numberValue(record.request_time)
      const upstreamRaw = String(record.upstream_response_time ?? record.upstreamResponseTime ?? '')
      const upstreamTime = numberValue(upstreamRaw.split(',')[0])
      const current = routes.get(route) || { requests: 0, statuses: {}, requestTimes: [], upstreamTimes: [] }
      current.requests += 1
      if (status !== undefined) {
        const statusKey = String(status)
        current.statuses[statusKey] = (current.statuses[statusKey] || 0) + 1
        if (status >= 200 && status < 300) current.statuses['2xx'] = (current.statuses['2xx'] || 0) + 1
        if (status >= 400 && status < 500) current.statuses['4xx'] = (current.statuses['4xx'] || 0) + 1
      }
      if (requestTime !== undefined) current.requestTimes.push(requestTime)
      if (upstreamTime !== undefined) current.upstreamTimes.push(upstreamTime)
      routes.set(route, current)
      const minute = minuteKey(date)
      perMinute[minute] = (perMinute[minute] || 0) + 1
      recordsInWindow += 1
    }
  }
  const top = [...routes.entries()].sort((a, b) => b[1].requests - a[1].requests).slice(0, 30).map(([route, stats]) => ({
    route,
    requests: stats.requests,
    statuses: stats.statuses,
    requestTime: { p50: percentile(stats.requestTimes, .50), p95: percentile(stats.requestTimes, .95), p99: percentile(stats.requestTimes, .99) },
    upstreamResponseTime: { p50: percentile(stats.upstreamTimes, .50), p95: percentile(stats.upstreamTimes, .95), p99: percentile(stats.upstreamTimes, .99) },
  }))
  return { files, linesRead, recordsInWindow, top, perMinute }
}

const errorPatterns: Array<[string, RegExp]> = [
  ['P2024', /P2024/i], ['P2028', /P2028/i], ['PrismaClient', /PrismaClient|Transaction API error/i],
  ['ETIMEDOUT', /ETIMEDOUT/i], ['ECONNRESET', /ECONNRESET/i], ['socket hang up', /socket hang up/i],
  ['heap/OOM', /heap|out of memory|OOM/i], ['UnhandledPromiseRejection', /UnhandledPromiseRejection/i],
]
function logDateFromLine(line: string) {
  const match = line.match(/(20\d{2}-\d{2}-\d{2}[T ][0-9:.+-]+(?:Z|[+-]\d{2}:?\d{2})?)/)
  if (!match) return null
  const raw = match[1]
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const withTimezone = /Z|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}+08:00`
  const date = new Date(withTimezone)
  return Number.isFinite(date.getTime()) ? date : null
}
function analyzePm2(files: string[], start: Date, end: Date) {
  const groups = new Map<string, { count: number; first: string | null; last: string | null; routes: Record<string, number> }>()
  let linesRead = 0
  let linesInWindow = 0
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line) continue
      linesRead += 1
      const date = logDateFromLine(line)
      if (!date || date < start || date >= end) continue
      linesInWindow += 1
      const matched = errorPatterns.find(([, pattern]) => pattern.test(line))
      if (!matched) continue
      const routeMatch = line.match(/\/api\/[A-Za-z0-9_./-]+/)
      const route = routeMatch?.[0] || 'unknown'
      const current = groups.get(matched[0]) || { count: 0, first: null, last: null, routes: {} }
      current.count += 1
      current.first = current.first || date.toISOString()
      current.last = date.toISOString()
      current.routes[route] = (current.routes[route] || 0) + 1
      groups.set(matched[0], current)
    }
  }
  return { files, linesRead, linesInWindow, groups: Object.fromEntries(groups) }
}

function analyzeMysql(file: string | undefined) {
  if (!file) return null
  const cumulative = new Set(['Questions', 'Queries', 'Slow_queries', 'Innodb_row_lock_waits', 'Innodb_row_lock_time', 'Connections', 'Select_scan', 'Select_full_join', 'Created_tmp_tables', 'Created_tmp_disk_tables', 'Handler_read_rnd_next'])
  const samples = new Map<string, Record<string, number>>()
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const [timestamp, metric, raw] = line.split('\t')
    const value = Number(raw)
    if (!timestamp || !metric || !Number.isFinite(value)) continue
    const row = samples.get(timestamp) || {}
    row[metric] = value
    samples.set(timestamp, row)
  }
  const timestamps = [...samples.keys()].sort((a, b) => Date.parse(a) - Date.parse(b))
  return timestamps.map((timestamp, index) => {
    const values = samples.get(timestamp) || {}
    const previous = index ? samples.get(timestamps[index - 1]) || {} : {}
    const delta: Record<string, number> = {}
    for (const metric of cumulative) {
      if (values[metric] !== undefined && previous[metric] !== undefined) delta[metric] = values[metric] - previous[metric]
    }
    return { timestamp, values, delta }
  })
}

const start = requiredDate('--start')
const end = requiredDate('--end')
const nginxFiles = valuesFor('--nginx-log')
const pm2Files = valuesFor('--pm2-log')
const mysqlFile = valueFor('--mysql-samples')
console.log(JSON.stringify({
  event: 'midnight.diagnostics',
  timezone: 'Asia/Shanghai',
  window: { start: start.toISOString(), end: end.toISOString() },
  nginx: analyzeNginx(nginxFiles, start, end),
  pm2: analyzePm2(pm2Files, start, end),
  mysql: analyzeMysql(mysqlFile),
}, null, 2))
