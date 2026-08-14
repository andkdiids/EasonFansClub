type HeaderValue = string | string[] | undefined

export type IpHeaderSource = Readonly<Record<string, HeaderValue>> | Pick<Headers, 'get'>

export type ClientIpHeaderSource =
  | 'cf-connecting-ip'
  | 'x-ecfc-client-ip'
  | 'x-forwarded-for'
  | 'x-real-ip'
  | 'remoteAddress'
  | 'none'

export type ClientIpResolutionStatus = 'success' | 'private-ip' | 'invalid-ip' | 'none'

export type ClientIpResolution = {
  ip: string
  source: ClientIpHeaderSource
  status: ClientIpResolutionStatus
}

const trustedClientIpHeader = 'x-ecfc-client-ip'

function readHeader(source: IpHeaderSource, name: string) {
  if ('get' in source && typeof source.get === 'function') {
    return source.get(name)
  }

  const value = (source as Readonly<Record<string, HeaderValue>>)[name]
  return Array.isArray(value) ? value[0] || null : value || null
}

function parseIPv4(value: string) {
  const parts = value.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null
  const octets = parts.map(Number)
  if (octets.some((octet) => octet < 0 || octet > 255)) return null
  return octets.join('.')
}

function parseIPv6(value: string) {
  let candidate = value.toLowerCase()
  const lastColon = candidate.lastIndexOf(':')
  const embeddedIPv4 = candidate.slice(lastColon + 1)
  const parsedIPv4 = embeddedIPv4.includes('.') ? parseIPv4(embeddedIPv4) : null
  if (embeddedIPv4.includes('.') && !parsedIPv4) return null
  if (parsedIPv4) {
    const octets = parsedIPv4.split('.').map(Number)
    const high = ((octets[0] << 8) | octets[1]).toString(16)
    const low = ((octets[2] << 8) | octets[3]).toString(16)
    candidate = `${candidate.slice(0, lastColon + 1)}${high}:${low}`
  }

  const compressionParts = candidate.split('::')
  if (compressionParts.length > 2) return null
  const hasCompression = compressionParts.length === 2
  const left = (hasCompression ? compressionParts[0] : candidate).split(':').filter(Boolean)
  const right = hasCompression ? compressionParts[1].split(':').filter(Boolean) : []
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null

  const missing = 8 - left.length - right.length
  if (hasCompression ? missing < 1 : missing !== 0) return null
  const groups = [
    ...left,
    ...(hasCompression ? Array.from({ length: missing }, () => '0') : []),
    ...right,
  ].map((part) => Number.parseInt(part, 16))
  if (groups.length !== 8) return null

  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff,
    ].join('.')
  }

  let bestStart = -1
  let bestLength = 0
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== 0) {
      index += 1
      continue
    }
    const start = index
    while (index < groups.length && groups[index] === 0) index += 1
    const length = index - start
    if (length >= 2 && length > bestLength) {
      bestStart = start
      bestLength = length
    }
  }

  if (bestStart < 0) return groups.map((group) => group.toString(16)).join(':')
  const before = groups.slice(0, bestStart).map((group) => group.toString(16)).join(':')
  const after = groups.slice(bestStart + bestLength).map((group) => group.toString(16)).join(':')
  return `${before}::${after}`
}

export function normalizeIp(value: unknown) {
  if (typeof value !== 'string') return ''
  let candidate = value.trim().replace(/^"|"$/g, '')
  if (!candidate) return ''

  if (candidate.startsWith('[')) {
    const closingBracket = candidate.indexOf(']')
    if (closingBracket < 0) return ''
    candidate = candidate.slice(1, closingBracket)
  } else {
    const ipv4WithPort = candidate.match(/^((?:\d{1,3}\.){3}\d{1,3}):\d{1,5}$/)
    if (ipv4WithPort) candidate = ipv4WithPort[1]
  }

  // RFC 4007 zone identifiers are not valid in a public HTTP client IP.
  candidate = candidate.replace(/%[0-9a-z_.-]+$/i, '')
  return parseIPv4(candidate) || (candidate.includes(':') ? parseIPv6(candidate) || '' : '')
}

function isLocalOrPrivateIp(value: string) {
  if (value === '0.0.0.0' || value === '127.0.0.1' || value === '::' || value === '::1') return true
  const ipv4 = value.split('.').map(Number)
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part))) {
    return ipv4[0] === 10
      || ipv4[0] === 127
      || (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127)
      || (ipv4[0] === 169 && ipv4[1] === 254)
      || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
      || (ipv4[0] === 192 && ipv4[1] === 168)
  }
  const firstGroup = Number.parseInt(value.split(':')[0] || '0', 16)
  return (firstGroup >= 0xfc00 && firstGroup <= 0xfdff)
    || (firstGroup >= 0xfe80 && firstGroup <= 0xfebf)
}

export function isPublicIp(value: unknown) {
  const normalized = normalizeIp(value)
  return Boolean(normalized && !isLocalOrPrivateIp(normalized))
}

function trustedHeaderNames(source: string) {
  if (source === 'nginx-legacy') return [trustedClientIpHeader, 'x-real-ip']
  return [trustedClientIpHeader]
}

type IpCandidate = {
  value: string | null
  source: ClientIpHeaderSource
}

function cloudflareHeaderCandidates(source: IpHeaderSource): IpCandidate[] {
  const cloudflareIp = readHeader(source, 'cf-connecting-ip')
  const rewrittenClientIp = readHeader(source, trustedClientIpHeader)
  const normalizedCloudflareIp = normalizeIp(cloudflareIp)
  const normalizedRewrittenClientIp = normalizeIp(rewrittenClientIp)

  // Nginx overwrites X-ECFC-Client-IP after the realip module has validated
  // the connecting proxy. A raw CF-Connecting-IP header is not trusted unless
  // it agrees with that rewritten value, which prevents direct-origin spoofing.
  if (!normalizedRewrittenClientIp) return []
  if (normalizedCloudflareIp && normalizedCloudflareIp !== normalizedRewrittenClientIp) {
    return [{ value: rewrittenClientIp, source: 'x-ecfc-client-ip' }]
  }
  return [
    { value: cloudflareIp, source: 'cf-connecting-ip' },
    { value: rewrittenClientIp, source: 'x-ecfc-client-ip' },
  ]
}

function trustedClientIpSource() {
  return (process.env.TRUSTED_CLIENT_IP_SOURCE || 'nginx').trim().toLowerCase()
}

function candidatesFromHeaders(source: IpHeaderSource, socketRemoteAddress?: string | null): IpCandidate[] {
  const clientIpSource = trustedClientIpSource()
  if (clientIpSource === 'cloudflare') return cloudflareHeaderCandidates(source)

  if (clientIpSource === 'nginx-forwarded') {
    const trustedClientIp = readHeader(source, trustedClientIpHeader)
    // X-Forwarded-For is only meaningful after the trusted Nginx boundary
    // has proven that it rewrote the dedicated client-IP header. This keeps a
    // direct request with a forged XFF from becoming a valid client address.
    if (!trustedClientIp?.trim()) return []
    if (!isPublicIp(trustedClientIp)) {
      return [{ value: trustedClientIp, source: 'x-ecfc-client-ip' }]
    }

    const forwardedFor = readHeader(source, 'x-forwarded-for')
    const candidates: IpCandidate[] = forwardedFor
      ? forwardedFor.split(',').map((value) => ({
        value: value.trim(),
        source: 'x-forwarded-for' as const,
      }))
      : []
    candidates.push({ value: readHeader(source, 'x-real-ip'), source: 'x-real-ip' })
    candidates.push({ value: trustedClientIp, source: 'x-ecfc-client-ip' })
    return candidates
  }

  const candidates: IpCandidate[] = trustedHeaderNames(clientIpSource).map((name) => ({
    value: readHeader(source, name),
    source: name === 'x-real-ip' ? 'x-real-ip' : 'x-ecfc-client-ip',
  }))

  if (clientIpSource === 'socket') {
    candidates.push({ value: socketRemoteAddress || null, source: 'remoteAddress' })
  }
  return candidates
}

function resolveCandidates(candidates: IpCandidate[]): ClientIpResolution {
  let sawInvalid = false
  let sawPrivate = false

  for (const candidate of candidates) {
    const normalized = normalizeIp(candidate.value)
    if (!candidate.value?.trim()) continue
    if (!normalized) {
      sawInvalid = true
      continue
    }
    if (isLocalOrPrivateIp(normalized)) {
      sawPrivate = true
      continue
    }
    return { ip: normalized, source: candidate.source, status: 'success' }
  }

  return {
    ip: 'unknown',
    source: 'none',
    status: sawPrivate ? 'private-ip' : sawInvalid ? 'invalid-ip' : 'none',
  }
}

function resolveClientIpFromHeaders(source: IpHeaderSource, socketRemoteAddress?: string | null) {
  return resolveCandidates(candidatesFromHeaders(source, socketRemoteAddress))
}

/**
 * Resolve the client address only from headers rewritten by a trusted edge.
 * The default Nginx contract is X-ECFC-Client-IP. X-Forwarded-For is kept for
 * diagnostics and upstream compatibility, but is never parsed here because a
 * browser can send it before an incorrectly configured proxy appends to it.
 */
export function getClientIp(request: Request) {
  const resolution = getClientIpResolution(request)
  const resolvedClientIp = resolution.ip
  if (process.env.DEBUG_CLIENT_IP === 'true' || process.env.IP_DIAGNOSTICS_LOG === 'true') {
    console.info('[ip-diagnostics]', getClientIpDiagnostics(request, resolvedClientIp))
  }
  return resolvedClientIp
}

export function getClientIpFromHeaders(source: IpHeaderSource, socketRemoteAddress?: string | null) {
  return resolveClientIpFromHeaders(source, socketRemoteAddress).ip
}

export function getClientIpResolution(request: Request): ClientIpResolution {
  return resolveClientIpFromHeaders(request.headers)
}

export function getClientIpResolutionFromHeaders(
  source: IpHeaderSource,
  socketRemoteAddress?: string | null,
) {
  return resolveClientIpFromHeaders(source, socketRemoteAddress)
}

function hasHeaderValue(value: string | null) {
  return Boolean(value?.trim())
}

function forwardedForCount(value: string | null) {
  return value
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .length || 0
}

function maskIpForDiagnostics(value: string | null | undefined) {
  const normalized = normalizeIp(value)
  if (!normalized) return 'unknown'

  const ipv4 = normalized.split('.')
  if (ipv4.length === 4) return `${ipv4[0]}.***.***.${ipv4[3]}`

  const groups = normalized.split(':').filter(Boolean)
  if (groups.length >= 2) return `${groups[0]}:****:...:${groups[groups.length - 1]}`
  return 'ipv6'
}

function maskForwardedForDiagnostics(value: string | null) {
  const values = value
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8)
  return values?.length ? values.map((part) => maskIpForDiagnostics(part)) : []
}

function safeTextForDiagnostics(value: string | null) {
  const normalized = value?.trim().replace(/[\u0000-\u001f\u007f\r\n]+/g, ' ')
  return normalized ? normalized.slice(0, 255) : null
}

export function getClientIpDiagnostics(request: Request, resolvedClientIp = getClientIp(request)) {
  const resolution = getClientIpResolution(request)
  const cfConnectingIp = request.headers.get('cf-connecting-ip')
  const xRealIp = request.headers.get('x-real-ip')
  const xForwardedFor = request.headers.get('x-forwarded-for')
  const trustedClientIp = request.headers.get(trustedClientIpHeader)
  const remoteAddress = request.headers.get('x-ecfc-remote-address')
  const host = request.headers.get('host')
  const forwardedHost = request.headers.get('x-forwarded-host')

  return {
    source: trustedClientIpSource(),
    clientIpSource: resolution.source,
    resolutionStatus: resolution.status,
    hasCfConnectingIp: hasHeaderValue(cfConnectingIp),
    hasXRealIp: hasHeaderValue(xRealIp),
    hasTrustedClientIp: hasHeaderValue(trustedClientIp),
    forwardedForCount: forwardedForCount(xForwardedFor),
    hasRemoteAddress: hasHeaderValue(remoteAddress),
    hasHost: hasHeaderValue(host),
    hasForwardedHost: hasHeaderValue(forwardedHost),
    cfConnectingIp: maskIpForDiagnostics(cfConnectingIp),
    xForwardedFor: maskForwardedForDiagnostics(xForwardedFor),
    xRealIp: maskIpForDiagnostics(xRealIp),
    trustedClientIp: maskIpForDiagnostics(trustedClientIp),
    remoteAddress: maskIpForDiagnostics(remoteAddress),
    host: safeTextForDiagnostics(host),
    forwardedHost: safeTextForDiagnostics(forwardedHost),
    resolvedIp: maskIpForDiagnostics(resolvedClientIp),
  }
}
