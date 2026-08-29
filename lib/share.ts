export type SharePayload = Readonly<{
  title: string
  text?: string | null
  url: string
}>

export type ShareResult = 'shared' | 'copied'

/** The deterministic text used when the Web Share API is unavailable. */
export function shareFallbackText({ title, url }: Pick<SharePayload, 'title' | 'url'>) {
  return `${title.trim()}\n${url.trim()}`
}

async function copyText(value: string) {
  if (typeof navigator.clipboard?.writeText === 'function') {
    await navigator.clipboard.writeText(value)
    return
  }

  if (typeof document === 'undefined' || !document.body) throw new Error('clipboard unavailable')

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = typeof document.execCommand === 'function' && document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('clipboard unavailable')
}

/**
 * Prefer the native share sheet and fall back to copying exactly "title\nurl".
 * The caller owns user-facing success/cancelled messages.
 */
export async function shareContent({ title, text, url }: SharePayload): Promise<ShareResult> {
  if (typeof navigator === 'undefined') throw new Error('share unavailable')

  const normalizedTitle = title.trim()
  const normalizedUrl = url.trim()
  const normalizedText = text?.trim()
  if (typeof navigator.share === 'function') {
    await navigator.share({
      title: normalizedTitle,
      ...(normalizedText ? { text: normalizedText } : {}),
      url: normalizedUrl,
    })
    return 'shared'
  }

  await copyText(shareFallbackText({ title: normalizedTitle, url: normalizedUrl }))
  return 'copied'
}
