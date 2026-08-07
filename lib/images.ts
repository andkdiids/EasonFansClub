const blockedLocalUploadPrefixes = ['/uploads/profile/', '/uploads/site/']

const supabaseStorageMarkers = ['supabase.co', 'supabase.in', 'storage/v1/object']

export function publicImageUrl(value?: string | null) {
  const url = value?.trim()
  if (!url) return null
  if (blockedLocalUploadPrefixes.some((prefix) => url.startsWith(prefix))) return null
  return url
}

// 旧 Supabase Storage 已停用且不可访问，历史地址一律视为失效
export function isSupabaseStorageUrl(value?: string | null) {
  const url = value?.trim()
  if (!url) return false
  return supabaseStorageMarkers.some((marker) => url.includes(marker))
}

// 用户头像 / 个人背景图专用：失效的 Supabase 地址视为空，统一走默认头像或默认背景
export function profileImageUrl(value?: string | null) {
  const url = publicImageUrl(value)
  if (!url || isSupabaseStorageUrl(url)) return null
  return url
}

export function supabasePublicObjectUrl(supabaseUrl: string, bucket: string, objectPath: string) {
  const baseUrl = supabaseUrl.replace(/\/$/, '')
  const encodedPath = objectPath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')

  return `${baseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedPath}`
}
