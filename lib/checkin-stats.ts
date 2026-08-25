import { getShanghaiDateKey } from '@/lib/checkin'
import { safeDb } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'

export type CheckInMoodStat = {
  mood: string | null
  _count: { mood: number }
}

export type CheckInPublicStats = {
  todayCount: number
  moodStats: CheckInMoodStat[]
}

type CheckInStatsDb = Pick<typeof prisma, 'checkIn'>

type CacheEntry<T> = {
  expiresAt: number
  pending: boolean
  promise: Promise<T>
  cacheHits: number
  singleflightJoins: number
  cacheHitLogged: boolean
  singleflightJoinLogged: boolean
}

const configuredCheckInStatsCacheTtlMs = Number(process.env.CHECKIN_STATS_CACHE_TTL_MS || 45000)
const checkInStatsCacheTtlMs = Number.isFinite(configuredCheckInStatsCacheTtlMs) && configuredCheckInStatsCacheTtlMs > 0
  ? configuredCheckInStatsCacheTtlMs
  : 45000
const checkInCountCache = new Map<string, CacheEntry<number>>()
const checkInStatsCache = new Map<string, CacheEntry<CheckInPublicStats>>()

function logCacheEvent(event: 'cache_hit' | 'cache_miss' | 'singleflight_join' | 'db_refresh', key: string, extra: Record<string, unknown> = {}) {
  console.info('[checkin.stats_cache]', { event, key, ...extra })
}

function cached<T>(cache: Map<string, CacheEntry<T>>, key: string, loader: () => Promise<T>) {
  const now = Date.now()
  const existing = cache.get(key)
  if (existing?.pending) {
    existing.singleflightJoins += 1
    if (!existing.singleflightJoinLogged) {
      existing.singleflightJoinLogged = true
      logCacheEvent('singleflight_join', key)
    }
    return existing.promise
  }
  if (existing && existing.expiresAt > now) {
    existing.cacheHits += 1
    if (!existing.cacheHitLogged) {
      existing.cacheHitLogged = true
      logCacheEvent('cache_hit', key)
    }
    return existing.promise
  }

  logCacheEvent('cache_miss', key)

  const promise = loader()
    .then((value) => {
      const current = cache.get(key)
      if (current?.promise === promise) {
        current.pending = false
        current.expiresAt = Date.now() + checkInStatsCacheTtlMs
        logCacheEvent('db_refresh', key, {
          cacheHits: current.cacheHits,
          singleflightJoins: current.singleflightJoins,
          ttlMs: checkInStatsCacheTtlMs,
        })
      }
      return value
    })
    .catch((error) => {
      if (cache.get(key)?.promise === promise) cache.delete(key)
      throw error
    })
  cache.set(key, {
    expiresAt: now + checkInStatsCacheTtlMs,
    pending: true,
    promise,
    cacheHits: 0,
    singleflightJoins: 0,
    cacheHitLogged: false,
    singleflightJoinLogged: false,
  })
  return promise
}

export function getTodayCheckInCount(
  dateKey = getShanghaiDateKey(),
  db: CheckInStatsDb = prisma,
) {
  return cached(checkInCountCache, `checkin:count:${dateKey}`, () => safeDb(
    'CheckIn.count checkinStats.todayCount',
    db.checkIn.count({ where: { checkinDateKey: dateKey } }),
    0,
  ))
}

export function getCheckInPublicStats(
  dateKey = getShanghaiDateKey(),
  db: CheckInStatsDb = prisma,
) {
  return cached(checkInStatsCache, `checkin:stats:${dateKey}`, async () => {
    const [todayCount, moodStats] = await Promise.all([
      getTodayCheckInCount(dateKey, db),
      safeDb(
        'CheckIn.groupBy checkinStats.moodStats',
        db.checkIn.groupBy({
          by: ['mood'],
          where: { checkinDateKey: dateKey, mood: { not: null } },
          _count: { mood: true },
        }),
        [],
      ),
    ])
    return { todayCount, moodStats }
  })
}

export function invalidateCheckInStatsCache(dateKey?: string) {
  if (dateKey) {
    checkInCountCache.delete(`checkin:count:${dateKey}`)
    checkInStatsCache.delete(`checkin:stats:${dateKey}`)
    return
  }
  checkInCountCache.clear()
  checkInStatsCache.clear()
}

export function resetCheckInStatsCacheForTests() {
  invalidateCheckInStatsCache()
}
