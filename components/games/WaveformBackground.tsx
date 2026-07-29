'use client'

import { useEffect, useRef } from 'react'

export function WaveformBackground({ active }: Readonly<{ active: boolean }>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    let animationFrame = 0
    let phase = 0

    const render = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(rect.width * ratio))
      const height = Math.max(1, Math.round(rect.height * ratio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      context.clearRect(0, 0, width, height)
      context.lineWidth = 1.5 * ratio
      context.strokeStyle = active ? 'rgba(46, 204, 143, .7)' : 'rgba(124, 156, 184, .28)'
      context.beginPath()
      for (let x = 0; x <= width; x += 4 * ratio) {
        const normalized = x / width
        const envelope = Math.sin(normalized * Math.PI)
        const wave = active
          ? Math.sin(normalized * Math.PI * 10 + phase) * Math.sin(normalized * Math.PI * 3.4 + phase * .72)
          : Math.sin(normalized * Math.PI * 4) * .08
        const y = height / 2 + wave * height * .21 * envelope
        if (x === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.stroke()
    }

    const tick = () => {
      render()
      if (!active || document.visibilityState === 'hidden') return
      phase += .055
      animationFrame = window.requestAnimationFrame(tick)
    }
    const onVisibilityChange = () => {
      window.cancelAnimationFrame(animationFrame)
      tick()
    }
    tick()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('resize', render)
    return () => {
      window.cancelAnimationFrame(animationFrame)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('resize', render)
      context.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [active])

  return <canvas ref={canvasRef} className="guess-waveform" aria-hidden="true" />
}
