import { monitorEventLoopDelay } from 'node:perf_hooks'

type RuntimeObservabilityState = {
  histogram: ReturnType<typeof monitorEventLoopDelay>
  timer: NodeJS.Timeout
}

type RuntimeGlobal = typeof globalThis & {
  __ecfcRuntimeObservability?: RuntimeObservabilityState
}

const runtimeGlobal = globalThis as RuntimeGlobal

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
}

function nanosecondsToMilliseconds(value: number) {
  return Number((value / 1_000_000).toFixed(2))
}

function sampleRuntime(histogram: ReturnType<typeof monitorEventLoopDelay>) {
  const memory = process.memoryUsage()
  const meanMs = nanosecondsToMilliseconds(histogram.mean)
  const p95Ms = nanosecondsToMilliseconds(histogram.percentile(95))
  const p99Ms = nanosecondsToMilliseconds(histogram.percentile(99))
  const maxMs = nanosecondsToMilliseconds(histogram.max)
  const heapUsedRatio = memory.heapTotal > 0
    ? Number((memory.heapUsed / memory.heapTotal).toFixed(4))
    : 0
  const payload = {
    event: 'runtime.metrics',
    pid: process.pid,
    meanMs,
    p95Ms,
    p99Ms,
    maxMs,
    rss: memory.rss,
    heapUsed: memory.heapUsed,
    heapTotal: memory.heapTotal,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
    heapUsedRatio,
  }
  const eventLoopWarningMs = positiveInteger(process.env.RUNTIME_EVENT_LOOP_WARN_P99_MS, 200)
  const heapWarningRatio = Number(process.env.RUNTIME_HEAP_WARN_RATIO || 0.85)
  const isWarning = p99Ms >= eventLoopWarningMs || maxMs >= eventLoopWarningMs * 2 || heapUsedRatio >= heapWarningRatio
  if (isWarning) console.warn('[runtime.metrics.warning]', payload)
  else console.info('[runtime.metrics]', payload)
  histogram.reset()
}

/** Start one low-frequency monitor per Node process. The timer is unref'ed. */
export function ensureRuntimeObservability() {
  if (runtimeGlobal.__ecfcRuntimeObservability) return

  const histogram = monitorEventLoopDelay({ resolution: 20 })
  histogram.enable()
  const intervalMs = positiveInteger(process.env.RUNTIME_METRICS_INTERVAL_MS, 60_000)
  const timer = setInterval(() => sampleRuntime(histogram), intervalMs)
  timer.unref()
  runtimeGlobal.__ecfcRuntimeObservability = { histogram, timer }
}

export function resetRuntimeObservabilityForTests() {
  const state = runtimeGlobal.__ecfcRuntimeObservability
  if (!state) return
  clearInterval(state.timer)
  state.histogram.disable()
  delete runtimeGlobal.__ecfcRuntimeObservability
}
