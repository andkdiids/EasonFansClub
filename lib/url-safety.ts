const PRODUCTION_PUBLIC_ORIGIN = 'https://ecfc.fans'
const LOCAL_DEV_HOST = 'localhost'
const LOCAL_DEV_PORT = '3000'
const URL_SENTINEL_ORIGIN = 'https://ecfc.invalid'
const PUBLIC_HOSTS = new Set(['ecfc.fans', 'www.ecfc.fans'])
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const loggedInvalidOrigins = new Set<string>()

function firstHeader(request: Request, name: string) {
  return request.headers.get(name)?.split(',')[0]?.trim() || ''
}

function isProduction() {
  return process.env.NODE_ENV === 'production'
}

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^\.+|\.+$/g, '').replace(/^\[|\]$/g, '')
}

export function isLocalHostname(hostname: string) {
  const normalized = normalizeHostname(hostname)
  return LOCAL_HOSTS.has(normalized) || normalized.endsWith('.localhost')
}

function isPublicHostname(hostname: string) {
  return PUBLIC_HOSTS.has(normalizeHostname(hostname))
}

function parseOrigin(value: string) {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (parsed.username || parsed.password) return null
    return parsed
  } catch {
    return null
  }
}

function parseHostHeader(value: string) {
  const candidate = value.trim()
  if (!candidate || CONTROL_CHARACTERS.test(candidate) || /[\s/]/.test(candidate)) return null

  try {
    const parsed = new URL(`http://${candidate}`)
    if (parsed.username || parsed.password || parsed.pathname !== '/') return null
    return parsed
  } catch {
    return null
  }
}

function originFromHost(protocol: string, host: string) {
  const normalizedProtocol = protocol.trim().toLowerCase()
  if (normalizedProtocol !== 'http' && normalizedProtocol !== 'https') return null
  const parsedHost = parseHostHeader(host)
  if (!parsedHost) return null
  return new URL(`${normalizedProtocol}://${parsedHost.host}`)
}

function isAllowedProductionOrigin(origin: URL) {
  return origin.protocol === 'https:' && origin.port === '' && isPublicHostname(origin.hostname)
}

function logInvalidConfiguredOrigin(name: string) {
  if (loggedInvalidOrigins.has(name)) return
  loggedInvalidOrigins.add(name)
  console.error('[public-url.invalid-origin]', { source: name })
}

function configuredPublicOrigin() {
  const configured = [
    ['NEXT_PUBLIC_APP_URL', process.env.NEXT_PUBLIC_APP_URL],
    ['APP_URL', process.env.APP_URL],
  ] as const

  for (const [name, value] of configured) {
    const raw = value?.trim()
    if (!raw) continue

    const parsed = parseOrigin(raw)
    const invalid = !parsed || isLocalHostname(parsed.hostname) || (isProduction() && !isAllowedProductionOrigin(parsed))
    if (invalid) {
      if (isProduction()) logInvalidConfiguredOrigin(name)
      continue
    }
    return parsed.origin
  }

  return null
}

function requestPublicOrigin(request: Request) {
  const forwardedProto = firstHeader(request, 'x-forwarded-proto')
  const forwardedHost = firstHeader(request, 'x-forwarded-host')
  const host = firstHeader(request, 'host')
  const requestUrl = parseOrigin(request.url)
  const candidates = [
    forwardedHost ? originFromHost(forwardedProto || requestUrl?.protocol.replace(':', '') || 'http', forwardedHost) : null,
    host ? originFromHost(forwardedProto || requestUrl?.protocol.replace(':', '') || 'http', host) : null,
    requestUrl,
  ]

  for (const candidate of candidates) {
    if (!candidate || isLocalHostname(candidate.hostname)) continue
    if (isProduction()) {
      if (isAllowedProductionOrigin(candidate)) return candidate.origin
      continue
    }
    return candidate.origin
  }

  return null
}

export function getPublicOrigin(request?: Request) {
  const configured = configuredPublicOrigin()
  if (configured) return configured

  const fromRequest = request ? requestPublicOrigin(request) : null
  if (fromRequest) return fromRequest
  if (isProduction()) return PRODUCTION_PUBLIC_ORIGIN
  return `http://${LOCAL_DEV_HOST}:${LOCAL_DEV_PORT}`
}

function normalizeInternalPathCandidate(value: unknown) {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw || raw.length > 4096 || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null
  if (CONTROL_CHARACTERS.test(raw) || raw.includes('\\')) return null

  let decoded = raw
  for (let index = 0; index < 3; index += 1) {
    let next: string
    try {
      next = decodeURIComponent(decoded)
    } catch {
      return null
    }
    if (next === decoded) break
    decoded = next
  }

  if (!decoded.startsWith('/') || decoded.startsWith('//') || decoded.startsWith('/\\')) return null
  if (CONTROL_CHARACTERS.test(decoded) || decoded.includes('\\')) return null

  try {
    const parsed = new URL(decoded, URL_SENTINEL_ORIGIN)
    if (parsed.origin !== URL_SENTINEL_ORIGIN || parsed.pathname.startsWith('//')) return null
  } catch {
    return null
  }

  return raw
}

export function safeInternalPathOrNull(value: unknown) {
  return normalizeInternalPathCandidate(value)
}

export function safeInternalPath(value: unknown, fallback = '/') {
  return normalizeInternalPathCandidate(value) || normalizeInternalPathCandidate(fallback) || '/'
}

export function legacyLocalhostUrlToInternalPath(value: unknown) {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!/^https?:\/\//i.test(raw)) return null

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }

  if (!isLocalHostname(parsed.hostname) || parsed.username || parsed.password) return null
  if (parsed.port && parsed.port !== LOCAL_DEV_PORT) return null

  return safeInternalPathOrNull(`${parsed.pathname}${parsed.search}${parsed.hash}`)
}

export function normalizeStoredInternalPath(value: unknown) {
  return safeInternalPathOrNull(value) || legacyLocalhostUrlToInternalPath(value)
}

export function normalizeActionUrl(value: unknown) {
  const internal = normalizeStoredInternalPath(value)
  if (internal) return internal
  if (typeof value !== 'string') return null

  const raw = value.trim()
  if (!raw || raw.startsWith('//')) return null

  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (isLocalHostname(parsed.hostname)) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function buildPublicAbsoluteUrl(path: string, request?: Request) {
  const safePath = safeInternalPath(path)
  const origin = getPublicOrigin(request)
  let parsed = new URL(safePath, origin)

  if (isLocalHostname(parsed.hostname)) {
    console.error('[public-url.invalid-origin]', { source: 'resolved', origin })
    parsed = new URL(safePath, PRODUCTION_PUBLIC_ORIGIN)
  }

  return parsed.toString()
}
