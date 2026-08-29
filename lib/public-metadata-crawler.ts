const PUBLIC_METADATA_CRAWLER_MARKERS = [
  'micromessenger',
  'facebookexternalhit',
  'facebot',
  'twitterbot',
  'linkedinbot',
  'slackbot',
  'discordbot',
  'telegrambot',
  'whatsapp',
  'googlebot',
  'bingbot',
] as const

/**
 * The user-agent is only a narrow presentation hint for the exact homepage.
 * It is deliberately an allow-list: generic "bot" strings must not bypass
 * the normal authentication middleware.
 */
export function isPublicMetadataCrawlerUserAgent(userAgent: string | null | undefined) {
  const normalized = userAgent?.trim().toLowerCase() || ''
  return Boolean(normalized) && PUBLIC_METADATA_CRAWLER_MARKERS.some((marker) => normalized.includes(marker))
}
