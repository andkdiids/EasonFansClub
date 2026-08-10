import { getShanghaiDayRange } from '@/lib/checkin'
import { normalizeIp } from '@/lib/security'
import { prisma } from '@/lib/prisma'

export const REGISTRATION_EMAIL_CODE_DAILY_LIMIT = 3
export const REGISTRATION_EMAIL_CODE_RATE_LIMIT_ACTION = 'registration:email-code:success'
export const EHOSPITAL_CHECK_START_RATE_LIMIT_WINDOW_MS = 10_000
export const EHOSPITAL_CHECK_START_RATE_LIMIT_MAX = 20

type HospitalCheckStartWindow = {
  startedAt: number
  count: number
}

const hospitalCheckStartWindows = new Map<string, HospitalCheckStartWindow>()
const MAX_TRACKED_HOSPITAL_CHECK_IPS = 4096

function getRateLimitKey(ip: string) {
  return `ip:${normalizeIp(ip) || 'unknown'}`
}

export async function countDailyRegistrationEmailCodeSends(ip: string, now = new Date()) {
  const { start, end } = getShanghaiDayRange(now)
  return prisma.rateLimitLog.count({
    where: {
      key: getRateLimitKey(ip),
      action: REGISTRATION_EMAIL_CODE_RATE_LIMIT_ACTION,
      createdAt: { gte: start, lt: end },
    },
  })
}

export async function checkDailyRegistrationEmailCodeLimit(ip: string, now = new Date()) {
  const count = await countDailyRegistrationEmailCodeSends(ip, now)
  return {
    limited: count >= REGISTRATION_EMAIL_CODE_DAILY_LIMIT,
    count,
    remaining: Math.max(0, REGISTRATION_EMAIL_CODE_DAILY_LIMIT - count),
  }
}

/** Record only after the email provider confirms that the code was sent. */
export async function recordSuccessfulRegistrationEmailCodeSend(ip: string, now = new Date()) {
  const { end } = getShanghaiDayRange(now)
  return prisma.rateLimitLog.create({
    data: {
      key: getRateLimitKey(ip),
      action: REGISTRATION_EMAIL_CODE_RATE_LIMIT_ACTION,
      expiresAt: end,
    },
  })
}

/**
 * Short burst protection for the expensive registration hospital-check start.
 * This is deliberately process-local: it must reject before another database
 * query is issued and is not the daily email-code business limit.
 */
export function consumeHospitalCheckStartRateLimit(ip: string, now = Date.now()) {
  const normalized = normalizeIp(ip)
  if (!normalized) {
    return {
      limited: false,
      remaining: EHOSPITAL_CHECK_START_RATE_LIMIT_MAX,
      retryAfterSeconds: 0,
    }
  }

  if (hospitalCheckStartWindows.size >= MAX_TRACKED_HOSPITAL_CHECK_IPS) {
    for (const [key, entry] of hospitalCheckStartWindows) {
      if (now - entry.startedAt >= EHOSPITAL_CHECK_START_RATE_LIMIT_WINDOW_MS) hospitalCheckStartWindows.delete(key)
    }
    if (hospitalCheckStartWindows.size >= MAX_TRACKED_HOSPITAL_CHECK_IPS) {
      const oldest = hospitalCheckStartWindows.keys().next().value
      if (typeof oldest === 'string') hospitalCheckStartWindows.delete(oldest)
    }
  }

  const current = hospitalCheckStartWindows.get(normalized)
  if (!current || now - current.startedAt >= EHOSPITAL_CHECK_START_RATE_LIMIT_WINDOW_MS) {
    hospitalCheckStartWindows.set(normalized, { startedAt: now, count: 1 })
    return {
      limited: false,
      remaining: EHOSPITAL_CHECK_START_RATE_LIMIT_MAX - 1,
      retryAfterSeconds: Math.ceil(EHOSPITAL_CHECK_START_RATE_LIMIT_WINDOW_MS / 1000),
    }
  }

  current.count += 1
  const retryAfterSeconds = Math.max(1, Math.ceil((current.startedAt + EHOSPITAL_CHECK_START_RATE_LIMIT_WINDOW_MS - now) / 1000))
  return {
    limited: current.count > EHOSPITAL_CHECK_START_RATE_LIMIT_MAX,
    remaining: Math.max(0, EHOSPITAL_CHECK_START_RATE_LIMIT_MAX - current.count),
    retryAfterSeconds,
  }
}
