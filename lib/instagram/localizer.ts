import { assertAnywhereDoorStorageMode, getAnywhereDoorStorageMode } from '@/lib/anywhere-door/config'
import { InstagramMediaSafetyError, MockInstagramMediaLocalizer, SafeExternalInstagramMediaLocalizer, type InstagramMediaLocalizer } from '@/lib/instagram/media'
import { InstagramProviderError } from '@/lib/instagram/types'

export function assertProductionMediaLocalizer(localizer: InstagramMediaLocalizer) {
  if (process.env.NODE_ENV === 'production' && !(localizer instanceof SafeExternalInstagramMediaLocalizer)) {
    throw new InstagramProviderError('UNSAFE_MEDIA_LOCALIZER', '生产环境必须使用 SafeExternalInstagramMediaLocalizer')
  }
  return localizer
}

export function createInstagramMediaLocalizer(username: string, proxyUrl?: string | null): InstagramMediaLocalizer {
  const mode = getAnywhereDoorStorageMode()
  if (!mode) throw new InstagramProviderError('CONFIG_ERROR', '随意门存储模式无效')
  if (process.env.NODE_ENV === 'production') {
    if (mode !== 'production') throw new InstagramProviderError('CONFIG_ERROR', '生产环境必须显式使用 production 存储模式')
    return new SafeExternalInstagramMediaLocalizer({ username, storageMode: mode, proxyUrl })
  }
  if (mode === 'production') return new SafeExternalInstagramMediaLocalizer({ username, storageMode: mode, proxyUrl })
  return new MockInstagramMediaLocalizer()
}

export function validateProductionStorageConfiguration() {
  try {
    const mode = assertAnywhereDoorStorageMode()
    if (process.env.NODE_ENV === 'production' && mode !== 'production') {
      throw new InstagramProviderError('CONFIG_ERROR', '生产环境存储模式不是 production')
    }
    return { ok: true as const, mode }
  } catch (error) {
    if (error instanceof InstagramMediaSafetyError || error instanceof InstagramProviderError) {
      return { ok: false as const, code: error.code, mode: null }
    }
    return { ok: false as const, code: 'CONFIG_ERROR', mode: null }
  }
}
