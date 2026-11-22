export type MemoirBadge = {
  imageUrl: string
  name: string
  x: number
  y: number
  size: number
  angle: number
}

type BadgeCandidate = { id: string; imageUrl: string; name: string }

function hash(value: string) {
  let result = 2166136261
  for (const char of value) result = Math.imul(result ^ char.codePointAt(0)!, 16777619)
  return result >>> 0
}

// Positions are centered on the page and leave room for both the heading and count.
const positions = [
  [],
  [[540, 892, 395, -10]],
  [[414, 830, 356, -11], [700, 1000, 274, 12]],
  [[396, 788, 313, -12], [699, 879, 262, 10], [519, 1080, 286, 4]],
  [[354, 733, 289, -12], [676, 781, 253, 11], [721, 1065, 252, -8], [409, 1057, 331, 4]],
  [[346, 723, 255, -12], [668, 705, 244, 12], [755, 976, 250, -8], [352, 1031, 244, 8], [538, 873, 340, -3]],
  [[349, 709, 240, -12], [668, 702, 227, 12], [784, 922, 228, -8], [701, 1127, 222, 8], [375, 1050, 266, 7], [526, 882, 321, -3]],
] as const

export function composeMemoirBadges(candidates: BadgeCandidate[], seed: string) {
  const selected = candidates
    .map((badge) => ({ badge, rank: hash(seed + ':pick:' + badge.id) }))
    .sort((a, b) => a.rank - b.rank || a.badge.id.localeCompare(b.badge.id, 'en'))
    .slice(0, 6)
  return selected.map(({ badge }, index) => {
    const [x, y, size, angle] = positions[selected.length][index]
    const variation = (field: string, range: number) => hash(seed + ':' + badge.id + ':' + field) % (2 * range + 1) - range
    return { ...badge, x: x + variation('x', 14), y: y + variation('y', 13),
      size: size + variation('size', 8), angle: angle + variation('angle', 3) }
  })
}

export async function loadMemoirBadges(badges?: readonly MemoirBadge[]) {
  const images = new Map<string, HTMLImageElement>()
  await Promise.all([...new Set(badges?.map((badge) => badge.imageUrl) ?? [])].map(async (url) => {
    try {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.src = url
      const timeout = window.setTimeout(() => image.removeAttribute('src'), 7000)
      try {
        await image.decode()
      } finally {
        window.clearTimeout(timeout)
      }
      // Reject a source that a browser can display but cannot safely export.
      const probe = document.createElement('canvas')
      probe.width = probe.height = 1
      const context = probe.getContext('2d')
      if (!context) return
      context.drawImage(image, 0, 0, 1, 1)
      context.getImageData(0, 0, 1, 1)
      images.set(url, image)
    } catch {
      // Missing or inaccessible artwork degrades to the printed badge name.
    }
  }))
  return images
}
