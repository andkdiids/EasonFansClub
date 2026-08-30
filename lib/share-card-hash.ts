import { createHash } from 'node:crypto'
import type { ShareCardData } from '@/lib/share-card'

/** Bump when any generated pixel/layout changes. v5 restores the media Hero and compacts the footer row. */
export const SHARE_CARD_TEMPLATE_VERSION = 'v5'
export const SHARE_CARD_LOGO_SOURCE = 'app/icon.png'
export const SHARE_CARD_LOGO_VERSION = 'app-icon-footer-v1'

export function shareCardHashPayload(data: ShareCardData) {
  return {
    templateVersion: SHARE_CARD_TEMPLATE_VERSION,
    logo: {
      source: SHARE_CARD_LOGO_SOURCE,
      version: SHARE_CARD_LOGO_VERSION,
    },
    type: data.type,
    contentId: data.contentId || '',
    title: data.title.trim(),
    description: data.description.trim(),
    image: data.image?.trim() || null,
    url: data.url.trim(),
    author: data.author?.trim() || null,
    authorAvatar: data.authorAvatar?.trim() || null,
    date: data.date?.trim() || null,
    meta: data.meta.map(({ label, value }) => ({ label: label.trim(), value: value.trim() })),
  } as const
}

/** Stable content-version key. Engagement counters are intentionally absent. */
export function createShareCardContentHash(data: ShareCardData) {
  return createHash('sha256')
    .update(JSON.stringify(shareCardHashPayload(data)))
    .digest('hex')
}
