import type { BeadLab, BeadPaletteColor, BeadRgb } from './types'

export type ColorMatchMode = 'fast' | 'balanced' | 'precise'

function pivotRgb(value: number) {
  const normalized = value / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

export function rgbToXyz(rgb: BeadRgb) {
  const r = pivotRgb(rgb.r)
  const g = pivotRgb(rgb.g)
  const b = pivotRgb(rgb.b)
  return {
    x: (r * 0.4124 + g * 0.3576 + b * 0.1805) * 100,
    y: (r * 0.2126 + g * 0.7152 + b * 0.0722) * 100,
    z: (r * 0.0193 + g * 0.1192 + b * 0.9505) * 100,
  }
}

export function xyzToLab(xyz: { x: number; y: number; z: number }): BeadLab {
  const x = xyz.x / 95.047
  const y = xyz.y / 100
  const z = xyz.z / 108.883
  const fx = x > 0.008856 ? x ** (1 / 3) : 7.787 * x + 16 / 116
  const fy = y > 0.008856 ? y ** (1 / 3) : 7.787 * y + 16 / 116
  const fz = z > 0.008856 ? z ** (1 / 3) : 7.787 * z + 16 / 116
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

export function rgbToLab(rgb: BeadRgb) {
  return xyzToLab(rgbToXyz(rgb))
}

/** CIE76 (Euclidean distance in the perceptual LAB space). */
export function deltaE76(left: BeadLab, right: BeadLab) {
  return Math.hypot(left.L - right.L, left.a - right.a, left.b - right.b)
}

/** CIEDE2000 color difference. */
export function deltaE2000(left: BeadLab, right: BeadLab) {
  const c1 = Math.hypot(left.a, left.b)
  const c2 = Math.hypot(right.a, right.b)
  const cBar = (c1 + c2) / 2
  const g = 0.5 * (1 - Math.sqrt((cBar ** 7) / (cBar ** 7 + 25 ** 7)))
  const a1Prime = (1 + g) * left.a
  const a2Prime = (1 + g) * right.a
  const c1Prime = Math.hypot(a1Prime, left.b)
  const c2Prime = Math.hypot(a2Prime, right.b)
  const h1Prime = Math.atan2(left.b, a1Prime) * 180 / Math.PI + (Math.atan2(left.b, a1Prime) < 0 ? 360 : 0)
  const h2Prime = Math.atan2(right.b, a2Prime) * 180 / Math.PI + (Math.atan2(right.b, a2Prime) < 0 ? 360 : 0)
  const deltaL = right.L - left.L
  const deltaC = c2Prime - c1Prime
  let deltaH = h2Prime - h1Prime
  if (c1Prime * c2Prime === 0) deltaH = 0
  else if (deltaH > 180) deltaH -= 360
  else if (deltaH < -180) deltaH += 360
  const deltaBigH = 2 * Math.sqrt(c1Prime * c2Prime) * Math.sin((deltaH / 2) * Math.PI / 180)
  const lBar = (left.L + right.L) / 2
  const cPrimeBar = (c1Prime + c2Prime) / 2
  let hPrimeBar = (h1Prime + h2Prime) / 2
  if (c1Prime * c2Prime === 0) hPrimeBar = h1Prime + h2Prime
  else if (Math.abs(h1Prime - h2Prime) > 180) hPrimeBar += h1Prime + h2Prime < 360 ? 180 : -180
  const t = 1
    - 0.17 * Math.cos((hPrimeBar - 30) * Math.PI / 180)
    + 0.24 * Math.cos(2 * hPrimeBar * Math.PI / 180)
    + 0.32 * Math.cos((3 * hPrimeBar + 6) * Math.PI / 180)
    - 0.20 * Math.cos((4 * hPrimeBar - 63) * Math.PI / 180)
  const deltaTheta = 30 * Math.exp(-(((hPrimeBar - 275) / 25) ** 2))
  const rC = 2 * Math.sqrt((cPrimeBar ** 7) / (cPrimeBar ** 7 + 25 ** 7))
  const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2)
  const sC = 1 + 0.045 * cPrimeBar
  const sH = 1 + 0.015 * cPrimeBar * t
  const rT = -Math.sin(2 * deltaTheta * Math.PI / 180) * rC
  return Math.sqrt(
    (deltaL / sL) ** 2
      + (deltaC / sC) ** 2
      + (deltaBigH / sH) ** 2
      + rT * (deltaC / sC) * (deltaBigH / sH),
  )
}

function colorDistance(left: BeadRgb, leftLab: BeadLab | null, right: BeadPaletteColor, mode: ColorMatchMode) {
  if (mode === 'fast') return (left.r - right.rgb.r) ** 2 + (left.g - right.rgb.g) ** 2 + (left.b - right.rgb.b) ** 2
  const lab = leftLab || rgbToLab(left)
  return mode === 'precise' ? deltaE2000(lab, right.lab) : deltaE76(lab, right.lab)
}

export function findNearestBeadColor(rgb: BeadRgb, palette: readonly BeadPaletteColor[], mode: ColorMatchMode = 'balanced') {
  if (!palette.length) return -1
  let bestIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY
  const lab = mode === 'fast' ? null : rgbToLab(rgb)
  palette.forEach((color, index) => {
    if (color.enabled === false) return
    const distance = colorDistance(rgb, lab, color, mode)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })
  return bestIndex
}

type Bucket = BeadRgb[]

function meanColor(colors: readonly BeadRgb[]): BeadRgb {
  if (!colors.length) return { r: 0, g: 0, b: 0 }
  const total = colors.reduce((sum, color) => ({ r: sum.r + color.r, g: sum.g + color.g, b: sum.b + color.b }), { r: 0, g: 0, b: 0 })
  return { r: Math.round(total.r / colors.length), g: Math.round(total.g / colors.length), b: Math.round(total.b / colors.length) }
}

/** A compact median-cut quantizer for the target-sized cell samples. */
export function quantizeColors(colors: readonly BeadRgb[], maxColors: number) {
  if (maxColors <= 0 || colors.length <= maxColors) return colors.map((color) => ({ ...color }))
  const buckets: Bucket[] = [colors.map((color) => ({ ...color }))]
  while (buckets.length < maxColors) {
    let splitIndex = -1
    let splitRange = -1
    buckets.forEach((bucket, index) => {
      if (bucket.length < 2) return
      const ranges = ['r', 'g', 'b'].map((key) => {
        const values = bucket.map((color) => color[key as keyof BeadRgb])
        return Math.max(...values) - Math.min(...values)
      })
      const range = Math.max(...ranges)
      if (range > splitRange) {
        splitRange = range
        splitIndex = index
      }
    })
    if (splitIndex < 0) break
    const bucket = buckets[splitIndex]
    const ranges = ['r', 'g', 'b'].map((key) => {
      const values = bucket.map((color) => color[key as keyof BeadRgb])
      return Math.max(...values) - Math.min(...values)
    })
    const channel = (['r', 'g', 'b'] as const)[ranges.indexOf(Math.max(...ranges))]
    const sorted = [...bucket].sort((left, right) => left[channel] - right[channel])
    const middle = Math.ceil(sorted.length / 2)
    buckets.splice(splitIndex, 1, sorted.slice(0, middle), sorted.slice(middle))
  }
  return buckets.map(meanColor)
}

/** Floyd–Steinberg keeps the output constrained to the supplied palette. */
export function applyFloydSteinberg(colors: readonly BeadRgb[], width: number, height: number, palette: readonly BeadPaletteColor[], mode: ColorMatchMode = 'balanced') {
  const working = colors.map((color) => ({ ...color }))
  const indexes = new Array<number>(working.length).fill(0)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * width + x
      const index = findNearestBeadColor(working[offset], palette, mode)
      indexes[offset] = index
      const chosen = palette[index].rgb
      const error = { r: working[offset].r - chosen.r, g: working[offset].g - chosen.g, b: working[offset].b - chosen.b }
      const distribute = (targetX: number, targetY: number, factor: number) => {
        if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) return
        const target = working[targetY * width + targetX]
        target.r = Math.max(0, Math.min(255, target.r + error.r * factor))
        target.g = Math.max(0, Math.min(255, target.g + error.g * factor))
        target.b = Math.max(0, Math.min(255, target.b + error.b * factor))
      }
      distribute(x + 1, y, 7 / 16)
      distribute(x - 1, y + 1, 3 / 16)
      distribute(x, y + 1, 5 / 16)
      distribute(x + 1, y + 1, 1 / 16)
    }
  }
  return indexes
}

export function hexToRgb(hex: string): BeadRgb {
  const normalized = hex.replace('#', '')
  const value = Number.parseInt(normalized.length === 3 ? normalized.split('').map((part) => part + part).join('') : normalized, 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

export function paletteColor(brand: string, series: string, code: string, name: string, hex: string): BeadPaletteColor {
  const rgb = hexToRgb(hex)
  return { brand, series, code, name, hex: hex.toUpperCase(), rgb, lab: rgbToLab(rgb), enabled: true, groups: [], source: 'existing' }
}
