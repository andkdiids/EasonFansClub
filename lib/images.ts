const blockedLocalUploadPrefixes = ['/uploads/profile/', '/uploads/site/']

export function publicImageUrl(value?: string | null) {
  const url = value?.trim()
  if (!url) return null
  if (blockedLocalUploadPrefixes.some((prefix) => url.startsWith(prefix))) return null
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
