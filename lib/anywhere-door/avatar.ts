import type { Prisma } from '@prisma/client'
import { isPublicMediaProxyUrl, toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'

import { ANYWHERE_DOOR_TARGET } from '@/lib/anywhere-door/config'

/**
 * Account-level override for the public source identity shown by Anywhere
 * Door.  SiteSetting is already the project's persisted, audited settings
 * store, so the override does not need a second account/CMS table.
 */
export const ANYWHERE_DOOR_MANUAL_AVATAR_SETTING_KEY = `anywhere-door.${ANYWHERE_DOOR_TARGET}.manualAvatarUrl`
export const ANYWHERE_DOOR_MANUAL_AVATAR_SETTING_LABEL = `随意门 @${ANYWHERE_DOOR_TARGET} 手动头像`

const PUBLIC_AUTHOR_AVATAR_HOSTS = ['cdninstagram.com', 'fbcdn.net'] as const

export type AnywhereDoorAvatarSource = 'manual' | 'instagram' | 'fallback'

export type AnywhereDoorAvatarResolution = {
  url: string | null
  source: AnywhereDoorAvatarSource
}

export function isAnywhereDoorAccountUsername(username?: string | null) {
  return username?.trim().replace(/^@+/, '').toLowerCase() === ANYWHERE_DOOR_TARGET
}

/**
 * Keep the browser-facing source identity constrained to site media, the
 * reviewed Instagram CDN hosts, or a same-site relative URL.  In particular,
 * an admin setting cannot turn the public feed into an arbitrary image proxy.
 */
export function safePublicAnywhereDoorAvatarUrl(value?: string | null) {
  const url = toPublicMediaUrl(value)
  if (!url) return null
  if (isPublicMediaProxyUrl(url)) return url
  try {
    const parsed = new URL(url, 'https://local.invalid')
    if (parsed.origin === 'https://local.invalid' && parsed.pathname.startsWith('/') && !parsed.username && !parsed.password) {
      return url
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
    return PUBLIC_AUTHOR_AVATAR_HOSTS.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)) ? url : null
  } catch {
    return null
  }
}

export function resolveAnywhereDoorAvatar(input: {
  manualAvatarUrl?: string | null
  autoAvatarUrl?: string | null
}): AnywhereDoorAvatarResolution {
  const manualAvatarUrl = safePublicAnywhereDoorAvatarUrl(input.manualAvatarUrl)
  if (manualAvatarUrl) return { url: manualAvatarUrl, source: 'manual' }

  const autoAvatarUrl = safePublicAnywhereDoorAvatarUrl(input.autoAvatarUrl)
  if (autoAvatarUrl) return { url: autoAvatarUrl, source: 'instagram' }

  return { url: null, source: 'fallback' }
}

type SiteSettingDatabase = Pick<Prisma.TransactionClient, 'siteSetting'>

/** A failed optional settings read must never take the public feed down. */
export async function readManualAnywhereDoorAvatar(database: SiteSettingDatabase = prisma) {
  try {
    const setting = await database.siteSetting.findUnique({
      where: { key: ANYWHERE_DOOR_MANUAL_AVATAR_SETTING_KEY },
      select: { value: true },
    })
    return safePublicAnywhereDoorAvatarUrl(setting?.value)
  } catch {
    return null
  }
}

export async function getAnywhereDoorAvatarProfile(options: {
  database?: typeof prisma
  autoAvatarUrl?: string | null
} = {}) {
  const manualAvatarUrl = await readManualAnywhereDoorAvatar(options.database || prisma)
  const resolution = resolveAnywhereDoorAvatar({ manualAvatarUrl, autoAvatarUrl: options.autoAvatarUrl })
  return {
    account: `@${ANYWHERE_DOOR_TARGET}`,
    manualAvatarUrl,
    autoAvatarUrl: safePublicAnywhereDoorAvatarUrl(options.autoAvatarUrl),
    resolvedAvatarUrl: resolution.url,
    source: resolution.source,
  }
}
