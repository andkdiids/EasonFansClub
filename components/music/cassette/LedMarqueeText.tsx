'use client'

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

type LedMarqueeTextProps = Readonly<{
  text: string
  className?: string
}>

export function LedMarqueeText({ text, className }: LedMarqueeTextProps) {
  const viewportRef = useRef<HTMLSpanElement | null>(null)
  const measureRef = useRef<HTMLSpanElement | null>(null)
  const [overflowing, setOverflowing] = useState(false)

  useLayoutEffect(() => {
    let disposed = false
    let measureFrame: number | null = null

    const measure = () => {
      if (measureFrame !== null) window.cancelAnimationFrame(measureFrame)
      measureFrame = window.requestAnimationFrame(() => {
        measureFrame = null
        if (disposed) return

        const viewport = viewportRef.current
        const textNode = measureRef.current
        if (!viewport || !textNode) return

        const nextOverflowing = textNode.getBoundingClientRect().width > viewport.clientWidth + 1
        setOverflowing((current) => current === nextOverflowing ? current : nextOverflowing)
      })
    }

    measure()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (resizeObserver && viewportRef.current) resizeObserver.observe(viewportRef.current)
    if (resizeObserver && measureRef.current) resizeObserver.observe(measureRef.current)

    const fontsReady = document.fonts?.ready
    if (fontsReady) void fontsReady.then(measure)

    return () => {
      disposed = true
      if (measureFrame !== null) window.cancelAnimationFrame(measureFrame)
      resizeObserver?.disconnect()
    }
  }, [text])

  const classes = ['easmusic-led-text', className].filter(Boolean).join(' ')
  const style = {
    '--led-marquee-duration': '30s',
    '--led-marquee-gap': '4em',
  } as CSSProperties

  return (
    <span ref={viewportRef} className={classes} data-overflowing={overflowing ? 'true' : 'false'} style={style} aria-label={text}>
      <span className="easmusic-led-text-run">
        <span ref={measureRef} className="easmusic-led-text-item">{text}</span>
        <span className="easmusic-led-text-item" aria-hidden="true">{text}</span>
      </span>
    </span>
  )
}
