type HeaderValue = string | string[] | undefined

export type IpHeaderSource = Readonly<Record<string, HeaderValue>> | Pick<Headers, 'get'>

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

function trustedHeaderNames(source: string) {
  if (source === 'nginx-legacy') return [trustedClientIpHeader, 'x-real-ip']
  return [trustedClientIpHeader]
}

function cloudflareHeaderCandidates(source: IpHeaderSource) {
  const cloudflareIp = readHeader(source, 'cf-connecting-ip')
  const rewrittenClientIp = readHeader(source, trustedClientIpHeader)
  const normalizedCloudflareIp = normalizeIp(cloudflareIp)
  const normalizedRewrittenClientIp = normalizeIp(rewrittenClientIp)

  // Nginx overwrites X-ECFC-Client-IP after the realip module has validated
  // the connecting proxy. A raw CF-Connecting-IP header is not trusted unless
  // it agrees with that rewritten value, which prevents direct-origin spoofing.
  if (!normalizedRewrittenClientIp) return []
  if (normalizedCloudflareIp && normalizedCloudflareIp !== normalizedRewrittenClientIp) {
    return [rewrittenClientIp]
  }
  return [cloudflareIp, rewrittenClientIp]
}

function trustedClientIpSource() {
  return (process.env.TRUSTED_CLIENT_IP_SOURCE || 'nginx').trim().toLowerCase()
}

function firstPublicIp(candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    const normalized = normalizeIp(candidate)
    if (normalized && !isLocalOrPrivateIp(normalized)) return normalized
  }
  return 'unknown'
}

/**
 * Resolve the client address only from headers rewritten by a trusted edge.
 * The default Nginx contract is X-ECFC-Client-IP. X-Forwarded-For is kept for
 * diagnostics and upstream compatibility, but is never parsed here because a
 * browser can send it before an incorrectly configured proxy appends to it.
 */
export function getClientIp(request: Request) {
  const resolvedClientIp = getClientIpFromHeaders(request.headers)
  if (process.env.DEBUG_CLIENT_IP === 'true' || process.env.IP_DIAGNOSTICS_LOG === 'true') {
    console.info('[ip-diagnostics]', getClientIpDiagnostics(request, resolvedClientIp))
  }
  return resolvedClientIp
}

export function getClientIpFromHeaders(source: IpHeaderSource, socketRemoteAddress?: string | null) {
  const clientIpSource = trustedClientIpSource()
  const candidates = clientIpSource === 'cloudflare'
    ? cloudflareHeaderCandidates(source)
    : trustedHeaderNames(clientIpSource).map((name) => readHeader(source, name))
  if (clientIpSource === 'nginx-forwarded') {
    const forwardedFor = readHeader(source, 'x-forwarded-for')
    if (forwardedFor) candidates.push(...forwardedFor.split(',').map((value) => value.trim()))
    candidates.push(readHeader(source, 'x-real-ip'))
  }
  if (clientIpSource === 'socket') {
    candidates.push(socketRemoteAddress || null)
  }
  return firstPublicIp(candidates)
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

export function getClientIpDiagnostics(request: Request, resolvedClientIp = getClientIp(request)) {
  const cfConnectingIp = request.headers.get('cf-connecting-ip')
  const xRealIp = request.headers.get('x-real-ip')
  const xForwardedFor = request.headers.get('x-forwarded-for')
  const trustedClientIp = request.headers.get(trustedClientIpHeader)
  const remoteAddress = request.headers.get('x-ecfc-remote-address')

  return {
    source: trustedClientIpSource(),
    hasCfConnectingIp: hasHeaderValue(cfConnectingIp),
    hasXRealIp: hasHeaderValue(xRealIp),
    hasTrustedClientIp: hasHeaderValue(trustedClientIp),
    forwardedForCount: forwardedForCount(xForwardedFor),
    hasRemoteAddress: hasHeaderValue(remoteAddress),
    resolvedIp: maskIpForDiagnostics(resolvedClientIp),
  }
}
