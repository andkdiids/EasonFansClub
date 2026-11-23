import { drawMemoirPage, memoirChapters, type MemoirAlbum } from '@/lib/annual-memoir-art'
import { loadMemoirBadges } from '@/lib/annual-memoir-badges'

const encoder = new TextEncoder()

export function makeMemoirZip(files: { name: string; bytes: Uint8Array<ArrayBuffer> }[]) {
  const entries: BlobPart[] = []
  const directory: BlobPart[] = []
  let offset = 0
  let directorySize = 0
  for (const { name, bytes } of files) {
    const filename = encoder.encode(name)
    let crc = -1
    for (const byte of bytes) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
    const local = new DataView(new ArrayBuffer(30))
    const central = new DataView(new ArrayBuffer(46))
    local.setUint32(0, 0x04034b50, true)
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(4, 20, true)
    for (const [header, start] of [[local, 4], [central, 6]] as const) {
      header.setUint16(start, 20, true)
      header.setUint16(start + 2, 0x800, true)
      header.setUint16(start + 8, 33, true)
      header.setUint32(start + 10, ~crc, true)
      header.setUint32(start + 14, bytes.length, true)
      header.setUint32(start + 18, bytes.length, true)
      header.setUint16(start + 22, filename.length, true)
    }
    central.setUint32(42, offset, true)
    entries.push(local.buffer, filename, bytes)
    directory.push(central.buffer, filename)
    offset += 30 + filename.length + bytes.length
    directorySize += 46 + filename.length
  }
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, directorySize, true)
  end.setUint32(16, offset, true)
  return new Blob([...entries, ...directory, end.buffer], { type: 'application/zip' })
}

export async function renderMemoirImages(report: MemoirAlbum, year: number, onProgress: (count: number) => void, prepared?: Promise<ReadonlyMap<string, HTMLImageElement>>) {
  const [badgeImages] = await Promise.all([prepared ?? loadMemoirBadges(report.badgeCollage), document.fonts.ready])
  const canvas = document.createElement('canvas')
  try {
    const files = []
    for (const [index, title] of memoirChapters.entries()) {
      const number = String(index + 1).padStart(2, '0')
      drawMemoirPage(canvas, report, year, index, badgeImages)
      const jpg = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (blob) => blob?.type === 'image/jpeg' ? resolve(blob) : reject(new Error('JPEG_UNAVAILABLE')),
        'image/jpeg', 0.94,
      ))
      files.push(new File([jpg], `${number}-${title}.jpg`, { type: 'image/jpeg' }))
      onProgress(index + 1)
    }
    return files
  } finally {
    canvas.width = canvas.height = 0
  }
}

export async function renderMemoirZip(report: MemoirAlbum, year: number, onProgress: (count: number) => void, prepared?: Promise<ReadonlyMap<string, HTMLImageElement>>) {
  const files = await renderMemoirImages(report, year, onProgress, prepared)
  return makeMemoirZip(await Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))))
}
