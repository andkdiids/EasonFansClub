const stateChangingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function isStateChangingMethod(method: string) {
  return stateChangingMethods.has(method.toUpperCase())
}
/**
 * Browser CSRF protection is deliberately separate from client authentication.
 * Missing Origin/Referer is allowed for native clients and command-line tools;
 * an explicitly cross-site browser request is rejected.
 */
export function isCrossSiteRequest(request: Request) {
  const fetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase()
  if (fetchSite === 'cross-site' || fetchSite === 'cross-origin') return true
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) return true

  const source = request.headers.get('origin') || request.headers.get('referer')
  if (!source) return false

  try {
    const sourceOrigin = new URL(source).origin
    const requestUrl = new URL(request.url)
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    const requestHost = forwardedHost || request.headers.get('host')?.trim() || requestUrl.host
    const requestProtocol = forwardedProtocol || requestUrl.protocol.replace(/:$/, '')
    const expectedOrigins = new Set([
      requestUrl.origin,
      `${requestProtocol}://${requestHost}`,
    ])
    return !expectedOrigins.has(sourceOrigin)
  } catch {
    return true
  }
}
