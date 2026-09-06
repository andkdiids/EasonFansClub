import { publicImageUrl } from '@/lib/images'

export type ImageViewerUrlInput = {
  src: string
  /** Explicitly provided original URL; only used when the item carries its own key. */
  originalUrl?: string | null
  /** True when the item explicitly owns an `originalUrl` key, even when null. */
  hasExplicitOriginal?: boolean
}

/**
 * Select the URL the ImageViewer full-screen stage actually requests.
 *
 * The viewer must never reconstruct a sibling “original” path by guessing.
 * Content images are uploaded with `preserveOriginal: false`, so an object at
 * `…/<dir>/source.webp` has no `…/<dir>/original` sibling; deriving one would
 * 404 in the lightbox while the same image already loads fine inline.
 *
 * The full-screen stage therefore reuses the exact effective public URL that
 * the inline image is known to load (publicImageUrl keeps every already
 * resolved `/cos-files/…` or gateway URL untouched and never double-encodes),
 * and only switches to another URL when the caller explicitly provides one —
 * for example a real preserved original served through a protected endpoint.
 */
export function resolveImageViewerFullUrl(input: ImageViewerUrlInput): string {
  const publicSrc = publicImageUrl(input.src) || input.src
  if (!input.hasExplicitOriginal) return publicSrc
  const explicitOriginal = publicImageUrl(input.originalUrl) || input.originalUrl
  return explicitOriginal || publicSrc
}
