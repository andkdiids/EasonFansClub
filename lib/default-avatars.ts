import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isSupabaseStorageUrl, publicImageUrl } from '@/lib/images'

export const DEFAULT_AVATAR_SETTING_KEY = 'users.defaultAvatarPool'

export type DefaultAvatarItem = {
  id: string
  url: string
  enabled: boolean
  createdAt: string
  retired?: boolean
}

export type DefaultAvatarOption = {
  id: string
  url: string
}

type DefaultAvatarDatabase = Pick<Prisma.TransactionClient, 'siteSetting'>

function parsePool(value?: string | null): DefaultAvatarItem[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const id = String(item.id || '').trim()
      const url = String(item.url || '').trim()
      if (!id || !url) return []
      return [{
        id,
        url,
        enabled: item.enabled !== false,
        createdAt: String(item.createdAt || new Date(0).toISOString()),
        retired: item.retired === true,
      }]
    })
  } catch {
    return []
  }
}

export async function getDefaultAvatarPool(database: DefaultAvatarDatabase = prisma, includeRetired = false) {
  const setting = await database.siteSetting.findUnique({
    where: { key: DEFAULT_AVATAR_SETTING_KEY },
    select: { value: true },
  })
  const pool = parsePool(setting?.value)
  return includeRetired ? pool : pool.filter((item) => !item.retired)
}

/** The single public read model used by registration, profile editing and admin tools. */
export async function getDefaultAvatarOptions(database: DefaultAvatarDatabase = prisma): Promise<DefaultAvatarOption[]> {
  const pool = await getDefaultAvatarPool(database)
  return pool
    .filter((item) => item.enabled && !isSupabaseStorageUrl(item.url))
    .flatMap((item) => {
      const url = publicImageUrl(item.url)
      return url ? [{ id: item.id, url }] : []
    })
}

export async function saveDefaultAvatarPool(items: DefaultAvatarItem[], database: DefaultAvatarDatabase = prisma) {
  await database.siteSetting.upsert({
    where: { key: DEFAULT_AVATAR_SETTING_KEY },
    update: {
      value: JSON.stringify(items),
      valueType: 'JSON',
      group: 'users',
      label: '系统默认头像池',
    },
    create: {
      key: DEFAULT_AVATAR_SETTING_KEY,
      value: JSON.stringify(items),
      valueType: 'JSON',
      group: 'users',
      label: '系统默认头像池',
    },
  })
}

export async function chooseDefaultAvatar(database: DefaultAvatarDatabase = prisma) {
  // 旧 Supabase 头像已失效，不再参与分配
  const enabled = (await getDefaultAvatarPool(database)).filter((item) => item.enabled && !isSupabaseStorageUrl(item.url))
  if (!enabled.length) return null
  return enabled[Math.floor(Math.random() * enabled.length)]?.url || null
}

export async function isDefaultAvatarUrl(url?: string | null) {
  if (!url) return false
  const candidate = publicImageUrl(url)
  if (!candidate) return false
  return (await getDefaultAvatarPool(prisma, true)).some((item) => publicImageUrl(item.url) === candidate)
}

export async function assignDefaultAvatarsToUnassignedUsers() {
  const enabled = (await getDefaultAvatarPool()).filter((item) => item.enabled && !isSupabaseStorageUrl(item.url))
  if (!enabled.length) return 0

  const users = await prisma.user.findMany({
    where: {
      avatarUrl: null,
      isDeleted: false,
      OR: [
        { Profile: { is: null } },
        { Profile: { is: { avatarUrl: null } } },
      ],
    },
    select: { id: true },
  })

  if (!users.length) return 0
  await prisma.$transaction(users.map((user) => prisma.user.update({
    where: { id: user.id },
    data: { avatarUrl: enabled[Math.floor(Math.random() * enabled.length)].url },
  })))
  return users.length
}
