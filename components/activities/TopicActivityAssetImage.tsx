'use client'

import { useEffect, useRef, useState } from 'react'

const MAX_PREVIEW_RETRIES = 1

/**
 * Render a topic-activity derivative without an unbounded image retry loop.
 * The URL is normally a stable same-origin asset proxy; the single retry is
 * only for a transient response failure and never changes to the original.
 */
export function TopicActivityAssetImage({ src, alt, className }: { src: string; alt: string; className: string }) {
  const [currentSrc, setCurrentSrc] = useState(src)
  const [failed, setFailed] = useState(false)
  const retryCount = useRef(0)
  const attemptToken = useRef(0)

  useEffect(() => {
    retryCount.current = 0
    setCurrentSrc(src)
    setFailed(false)
  }, [src])

  function retry(manual = false) {
    if (manual) retryCount.current = 0
    if (retryCount.current >= MAX_PREVIEW_RETRIES) {
      setFailed(true)
      return
    }
    retryCount.current += 1
    attemptToken.current += 1
    const separator = src.includes('?') ? '&' : '?'
    setCurrentSrc(`${src}${separator}previewRetry=${attemptToken.current}`)
    setFailed(false)
  }

  if (failed) {
    return <div role="alert" className="flex min-h-10 min-w-20 flex-col items-start justify-center gap-1 text-xs text-[var(--foreground-muted)]"><span>图片加载失败</span><button type="button" onClick={() => retry(true)} className="underline">重新加载图片</button></div>
  }

  return <img src={currentSrc} alt={alt} className={className} onError={() => retry()} />
}
