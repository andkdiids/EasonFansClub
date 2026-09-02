import { generatePatternFromPixels } from './image'
import type { BeadPaletteColor, BeadPatternGrid, BeadRgb, BeadSettings } from './types'

type WorkerMessage = {
  samples: BeadRgb[]
  transparent: boolean[]
  settings: BeadSettings
  palette: BeadPaletteColor[]
}

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null
  postMessage: (message: { ok: boolean; pattern?: BeadPatternGrid; message?: string }) => void
}

const workerScope = self as unknown as WorkerScope
workerScope.onmessage = (event) => {
  try {
    workerScope.postMessage({ ok: true, pattern: generatePatternFromPixels(event.data.samples, event.data.transparent, event.data.settings, event.data.palette) })
  } catch {
    workerScope.postMessage({ ok: false, message: 'worker processing failed' })
  }
}
