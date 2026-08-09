'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

type PerformanceAuditResource = {
  name: string
  initiatorType: string
  durationMs: number
  startTimeMs: number
  responseEndMs: number
  transferSize: number
  encodedBodySize: number
  decodedBodySize: number
  renderBlockingStatus: string | null
}

type PerformanceAuditFps = {
  sampleDurationMs: number
  frames: number
  averageFps: number
  minimumFps: number
  jankCount: number
  longestFrameMs: number
}

export type PerformanceAuditSnapshot = {
  path: string
  capturedAt: string
  metrics: {
    ttfbMs: number | null
    fcpMs: number | null
    lcpMs: number | null
    domContentLoadedMs: number | null
    loadEventMs: number | null
  }
  fps: PerformanceAuditFps | null
  resources: PerformanceAuditResource[]
}

declare global {
  interface Window {
    __ECFC_PERF__?: PerformanceAuditSnapshot
  }
}

const FPS_SAMPLE_MS = 5000
const JANK_FRAME_MS = 34
const PERFORMANCE_NODE_ID = 'ecfc-performance-audit'

function auditEnabled() {
  if (typeof window === 'undefined') return false
  const value = new URLSearchParams(window.location.search).get('perf')
  return value === '1' || value === 'true'
}

function roundMetric(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : null
}

function paintMetric(name: string) {
  const entry = performance.getEntriesByName(name)[0]
  return entry ? roundMetric(entry.startTime) : null
}

function safeResourceName(value: string) {
  try {
    const url = new URL(value, window.location.href)
    return url.origin === window.location.origin ? url.pathname : `${url.hostname}${url.pathname}`
  } catch {
    return value.split('?')[0]
  }
}

function collectResources(): PerformanceAuditResource[] {
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  return entries
    .filter((entry) => ['img', 'image', 'video', 'script', 'link', 'css', 'font', 'fetch', 'xmlhttprequest'].includes(entry.initiatorType))
    .map((entry) => {
      const blocking = (entry as PerformanceResourceTiming & { renderBlockingStatus?: string }).renderBlockingStatus
      return {
        name: safeResourceName(entry.name),
        initiatorType: entry.initiatorType,
        durationMs: roundMetric(entry.duration) || 0,
        startTimeMs: roundMetric(entry.startTime) || 0,
        responseEndMs: roundMetric(entry.responseEnd) || 0,
        transferSize: entry.transferSize || 0,
        encodedBodySize: entry.encodedBodySize || 0,
        decodedBodySize: entry.decodedBodySize || 0,
        renderBlockingStatus: blocking || null,
      }
    })
    .sort((left, right) => right.transferSize - left.transferSize || right.durationMs - left.durationMs)
    .slice(0, 200)
}

function collectMetrics(): PerformanceAuditSnapshot['metrics'] {
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  const requestStart = navigation?.requestStart || navigation?.startTime || 0
  return {
    ttfbMs: navigation ? roundMetric(Math.max(0, navigation.responseStart - requestStart)) : null,
    fcpMs: paintMetric('first-contentful-paint'),
    lcpMs: paintMetric('largest-contentful-paint'),
    domContentLoadedMs: navigation ? roundMetric(navigation.domContentLoadedEventEnd) : null,
    loadEventMs: navigation ? roundMetric(navigation.loadEventEnd) : null,
  }
}

export function PerformanceAudit() {
  const pathname = usePathname()

  useEffect(() => {
    if (!auditEnabled()) return

    let active = true
    let latestLcp: number | null = null
    let fpsFrame: number | null = null
    let lcpObserver: PerformanceObserver | null = null

    const publish = (fps: PerformanceAuditFps | null = null) => {
      if (!active) return
      const metrics = collectMetrics()
      const snapshot: PerformanceAuditSnapshot = {
        path: pathname || window.location.pathname,
        capturedAt: new Date().toISOString(),
        metrics: { ...metrics, lcpMs: latestLcp ?? metrics.lcpMs },
        fps,
        resources: collectResources(),
      }
      window.__ECFC_PERF__ = snapshot
      let auditNode = document.getElementById(PERFORMANCE_NODE_ID)
      if (!auditNode) {
        auditNode = document.createElement('script')
        auditNode.id = PERFORMANCE_NODE_ID
        auditNode.setAttribute('type', 'application/json')
        auditNode.setAttribute('aria-hidden', 'true')
        document.body.appendChild(auditNode)
      }
      auditNode.textContent = JSON.stringify(snapshot)
      window.dispatchEvent(new CustomEvent('ecfc:performance-ready', { detail: snapshot }))
    }

    const refreshPaintMetrics = () => {
      const observedLcp = performance.getEntriesByType('largest-contentful-paint').at(-1)
      if (observedLcp) latestLcp = roundMetric(observedLcp.startTime)
      publish()
    }

    if (typeof PerformanceObserver !== 'undefined') {
      try {
        lcpObserver = new PerformanceObserver((list) => {
          const lastEntry = list.getEntries().at(-1)
          if (lastEntry) latestLcp = roundMetric(lastEntry.startTime)
          publish()
        })
        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true })
      } catch {
        lcpObserver = null
      }
    }

    publish()
    window.setTimeout(refreshPaintMetrics, 1000)

    let firstFrameAt = 0
    let previousFrameAt = 0
    let frames = 0
    let longestFrameMs = 0
    let jankCount = 0

    const sampleFrame = (now: number) => {
      if (!active) return
      if (document.visibilityState === 'visible') {
        if (!firstFrameAt) firstFrameAt = now
        if (previousFrameAt) {
          const delta = now - previousFrameAt
          if (delta > 0 && delta < 1000) {
            frames += 1
            longestFrameMs = Math.max(longestFrameMs, delta)
            if (delta > JANK_FRAME_MS) jankCount += 1
          }
        }
        previousFrameAt = now
      } else {
        firstFrameAt = 0
        previousFrameAt = 0
      }

      if (firstFrameAt && now - firstFrameAt >= FPS_SAMPLE_MS) {
        const elapsed = Math.max(1, now - firstFrameAt)
        const averageFps = Math.min(60, frames / (elapsed / 1000))
        const minimumFps = longestFrameMs ? Math.max(0, Math.min(60, 1000 / longestFrameMs)) : 0
        publish({
          sampleDurationMs: Math.round(elapsed),
          frames,
          averageFps: Math.round(averageFps * 10) / 10,
          minimumFps: Math.round(minimumFps * 10) / 10,
          jankCount,
          longestFrameMs: Math.round(longestFrameMs * 10) / 10,
        })
        return
      }
      fpsFrame = window.requestAnimationFrame(sampleFrame)
    }

    fpsFrame = window.requestAnimationFrame(sampleFrame)

    return () => {
      active = false
      if (fpsFrame !== null) window.cancelAnimationFrame(fpsFrame)
      lcpObserver?.disconnect()
      document.getElementById(PERFORMANCE_NODE_ID)?.remove()
      if (window.__ECFC_PERF__?.path === (pathname || window.location.pathname)) delete window.__ECFC_PERF__
    }
  }, [pathname])

  return null
}
