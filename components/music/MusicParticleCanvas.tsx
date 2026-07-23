'use client'

import { useEffect, useRef } from 'react'

type Star = {
  x: number
  y: number
  speed: number
  verticalDrift: number
  size: number
  alpha: number
  phase: number
  offsetX: number
  offsetY: number
}

type Ripple = { x: number; y: number; radius: number; alpha: number }

export function MusicParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const mobile = window.matchMedia('(max-width: 767px)').matches
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const interactive = !mobile && window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const stars: Star[] = []
    const ripples: Ripple[] = []
    const pointer = { x: -1000, y: -1000, active: false }
    let width = 1
    let height = 1
    let frame = 0
    let lastTime = performance.now()

    const createStar = (startAtLeft = false): Star => ({
      x: startAtLeft ? -8 - Math.random() * 48 : Math.random() * width,
      y: Math.random() * height,
      speed: (mobile ? 0.012 : 0.018) + Math.random() * (mobile ? 0.022 : 0.045),
      verticalDrift: (Math.random() - 0.5) * 0.005,
      size: 0.35 + Math.random() * 0.85,
      alpha: 0.2 + Math.random() * 0.7,
      phase: Math.random() * Math.PI * 2,
      offsetX: 0,
      offsetY: 0,
    })

    const seedStars = () => {
      const densityCount = Math.round((width * Math.min(height, 1100)) / (mobile ? 7200 : 9000))
      const count = mobile
        ? Math.max(40, Math.min(60, densityCount))
        : Math.max(110, Math.min(190, densityCount))
      canvas.dataset.particleCount = String(count)
      canvas.dataset.motion = reducedMotion ? 'reduced-horizontal' : 'horizontal'
      stars.length = 0
      for (let index = 0; index < count; index += 1) stars.push(createStar())
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      const ratio = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5)
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      seedStars()
    }

    const updatePointer = (event: PointerEvent) => {
      if (!interactive) return
      const rect = canvas.getBoundingClientRect()
      pointer.x = event.clientX - rect.left
      pointer.y = event.clientY - rect.top
      pointer.active = pointer.x >= 0 && pointer.x <= rect.width && pointer.y >= 0 && pointer.y <= rect.height
    }
    const clearPointer = () => { pointer.active = false }
    const addRipple = (event: PointerEvent) => {
      if (!interactive) return
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) ripples.push({ x, y, radius: 8, alpha: 0.3 })
    }

    const draw = (now: number) => {
      const delta = Math.min(34, Math.max(0, now - lastTime))
      lastTime = now
      context.clearRect(0, 0, width, height)

      for (const star of stars) {
        const motionScale = reducedMotion ? 0.3 : 1
        star.x += star.speed * delta * motionScale
        star.y += star.verticalDrift * delta * motionScale

        if (star.x > width + 12) Object.assign(star, createStar(true))
        if (star.y < -8) star.y = height + 8
        if (star.y > height + 8) star.y = -8

        let targetOffsetX = 0
        let targetOffsetY = 0
        const renderX = star.x + star.offsetX
        const renderY = star.y + star.offsetY
        if (interactive && pointer.active) {
          const dx = renderX - pointer.x
          const dy = renderY - pointer.y
          const distance = Math.hypot(dx, dy)
          if (distance > 1 && distance < 145) {
 const force = (1 - distance / 145) * 6
            targetOffsetX = dx / distance * force
            targetOffsetY = dy / distance * force
          }
        }
        star.offsetX += (targetOffsetX - star.offsetX) * Math.min(1, delta * 0.012)
        star.offsetY += (targetOffsetY - star.offsetY) * Math.min(1, delta * 0.012)

        const twinkle = 0.78 + Math.sin(now * 0.0007 + star.phase) * 0.22
        const alpha = star.alpha * twinkle
        const x = star.x + star.offsetX
        const y = star.y + star.offsetY
        if (star.size > 0.9) {
          context.beginPath()
          context.arc(x, y, star.size * 1.8, 0, Math.PI * 2)
          context.fillStyle = `rgba(86, 166, 232, ${alpha * 0.04})`
          context.fill()
        }
        context.beginPath()
        context.arc(x, y, star.size, 0, Math.PI * 2)
        context.fillStyle = `rgba(206, 235, 255, ${alpha})`
        context.fill()
      }

      for (let index = ripples.length - 1; index >= 0; index -= 1) {
        const ripple = ripples[index]
        ripple.radius += delta * 0.095
        ripple.alpha -= delta * 0.00065
        if (ripple.alpha <= 0) { ripples.splice(index, 1); continue }
        context.beginPath()
        context.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2)
        context.strokeStyle = `rgba(125, 211, 252, ${ripple.alpha})`
        context.lineWidth = 1
        context.stroke()
      }

      frame = window.requestAnimationFrame(draw)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    window.addEventListener('pointermove', updatePointer, { passive: true })
    window.addEventListener('pointerleave', clearPointer)
    window.addEventListener('click', addRipple, { passive: true })
    frame = window.requestAnimationFrame(draw)

    const handleVisibility = () => {
      window.cancelAnimationFrame(frame)
      if (!document.hidden) {
        lastTime = performance.now()
        frame = window.requestAnimationFrame(draw)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', updatePointer)
      window.removeEventListener('pointerleave', clearPointer)
      window.removeEventListener('click', addRipple)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  return <canvas ref={canvasRef} data-music-particles="active" aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 h-full w-full opacity-90" />
}
