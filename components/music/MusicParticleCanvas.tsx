'use client'

import { useEffect, useRef } from 'react'

type Particle = { x: number; y: number; vx: number; vy: number; driftX: number; driftY: number; size: number }
type Ripple = { x: number; y: number; radius: number; alpha: number }

export function MusicParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const interactive = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 768px)').matches && !reducedMotion
    const particles: Particle[] = []
    const ripples: Ripple[] = []
    const pointer = { x: -1000, y: -1000, active: false }
    let width = 0
    let height = 0
    let frame = 0
    let lastTime = performance.now()

    const seedParticles = () => {
      const count = interactive ? Math.min(48, Math.max(30, Math.round(width / 34))) : Math.min(26, Math.max(18, Math.round(width / 22)))
      while (particles.length > count) particles.pop()
      while (particles.length < count) {
        const driftX = (Math.random() - 0.5) * 0.075
        const driftY = (Math.random() - 0.5) * 0.075
        particles.push({ x: Math.random() * width, y: Math.random() * height, vx: driftX, vy: driftY, driftX, driftY, size: 0.7 + Math.random() * 1.4 })
      }
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      seedParticles()
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
      if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) ripples.push({ x, y, radius: 6, alpha: 0.28 })
    }

    const draw = (now: number) => {
      const delta = Math.min(32, now - lastTime)
      lastTime = now
      context.clearRect(0, 0, width, height)

      for (const particle of particles) {
        if (!reducedMotion) {
          if (interactive && pointer.active) {
            const dx = pointer.x - particle.x
            const dy = pointer.y - particle.y
            const distanceSquared = dx * dx + dy * dy
            if (distanceSquared > 1 && distanceSquared < 22500) {
              const force = (1 - Math.sqrt(distanceSquared) / 150) * 0.0009 * delta
              particle.vx += dx * force
              particle.vy += dy * force
            }
          }
          particle.vx += (particle.driftX - particle.vx) * Math.min(0.12, delta * 0.003)
          particle.vy += (particle.driftY - particle.vy) * Math.min(0.12, delta * 0.003)
          const speed = Math.hypot(particle.vx, particle.vy)
          if (speed > 0.28) {
            particle.vx = particle.vx / speed * 0.28
            particle.vy = particle.vy / speed * 0.28
          }
          particle.x += particle.vx * delta
          particle.y += particle.vy * delta
          if (particle.x < -8) particle.x = width + 8
          if (particle.x > width + 8) particle.x = -8
          if (particle.y < -8) particle.y = height + 8
          if (particle.y > height + 8) particle.y = -8
        }
        context.beginPath()
        context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2)
        context.fillStyle = 'rgba(186, 230, 253, .62)'
        context.fill()
      }

      for (let index = 0; index < particles.length; index += 1) {
        for (let other = index + 1; other < particles.length; other += 1) {
          const dx = particles[index].x - particles[other].x
          const dy = particles[index].y - particles[other].y
          const distance = Math.sqrt(dx * dx + dy * dy)
          if (distance > 112) continue
          context.beginPath()
          context.moveTo(particles[index].x, particles[index].y)
          context.lineTo(particles[other].x, particles[other].y)
          context.strokeStyle = `rgba(125, 190, 235, ${0.09 * (1 - distance / 112)})`
          context.lineWidth = 0.6
          context.stroke()
        }
      }

      for (let index = ripples.length - 1; index >= 0; index -= 1) {
        const ripple = ripples[index]
        ripple.radius += delta * 0.08
        ripple.alpha -= delta * 0.00055
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

  return <canvas ref={canvasRef} data-music-particles="active" aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 h-full w-full opacity-80" />
}
