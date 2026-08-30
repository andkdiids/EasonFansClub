export const SALON_MAX_FILES = 9
export const SALON_MAX_FILE_SIZE = 20 * 1024 * 1024
export const SALON_ACCEPTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const

export type SalonUploadFileLike = Readonly<{
  name: string
  size: number
  type?: string | null
}>

export type SalonFileValidationResult = Readonly<{
  ok: boolean
  error: string | null
  oversizedNames: readonly string[]
  invalidNames: readonly string[]
}>

function fileNameForMessage(value: string) {
  const normalized = value.trim().replace(/\\/g, '/')
  return normalized.split('/').pop() || '图片'
}

function hasAcceptedExtension(name: string) {
  const extension = name.split('.').pop()?.trim().toLowerCase() || ''
  return (SALON_ACCEPTED_EXTENSIONS as readonly string[]).includes(extension)
}

export function validateSalonFiles(files: readonly SalonUploadFileLike[], existingCount = 0): SalonFileValidationResult {
  const oversizedNames = files
    .filter((file) => file.size > SALON_MAX_FILE_SIZE)
    .map((file) => fileNameForMessage(file.name))
  const invalidNames = files
    .filter((file) => file.size <= 0 || !hasAcceptedExtension(file.name))
    .map((file) => fileNameForMessage(file.name))

  if (existingCount + files.length > SALON_MAX_FILES) {
    return { ok: false, error: `一次最多上传 ${SALON_MAX_FILES} 张图片`, oversizedNames, invalidNames }
  }
  if (oversizedNames.length === 1) {
    return { ok: false, error: `${oversizedNames[0]} 超过 20MB，请重新选择`, oversizedNames, invalidNames }
  }
  if (oversizedNames.length > 1) {
    return { ok: false, error: `有 ${oversizedNames.length} 张图片超过 20MB，请重新选择：${oversizedNames.join('、')}`, oversizedNames, invalidNames }
  }
  if (invalidNames.length) {
    return { ok: false, error: `不支持的图片格式或空文件：${invalidNames.join('、')}`, oversizedNames, invalidNames }
  }
  return { ok: true, error: null, oversizedNames, invalidNames }
}
