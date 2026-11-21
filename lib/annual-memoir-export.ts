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

export async function renderMemoirZip(chapters: string[][], year: number, onProgress: (count: number) => void) {
  if (chapters.length !== 10) throw new Error('MEMOIR_INCOMPLETE')
  await document.fonts.ready
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1920
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE')
  try {
    const files = []
    for (const [index, [title, ...lines]] of chapters.entries()) {
      const number = String(index + 1).padStart(2, '0')
      ctx.fillStyle = index % 2 ? '#50243f' : '#fff1dc'
      ctx.fillRect(0, 0, 1080, 1920)
      ctx.strokeStyle = '#c4a374'
      ctx.lineWidth = 3
      ctx.strokeRect(54, 54, 972, 1812)
      ctx.fillStyle = index % 2 ? '#fff1dc' : '#4a243e'
      const font = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'
      ctx.font = `36px ${font}`
      ctx.fillText(`葡萄成熟时 · ${year} · ${number}`, 112, 250)
      ctx.font = `bold 100px ${font}`
      ctx.fillText(title, 112, 570, 856)
      ctx.font = `52px ${font}`
      let y = 755
      for (const line of lines) {
        let row = ''
        for (const character of Array.from(line)) {
          if (row && ctx.measureText(row + character).width > 856) {
            if (y > 1760) throw new Error('MEMOIR_TEXT_OVERFLOW')
            ctx.fillText(row, 112, y)
            y += 80
            row = ''
          }
          row += character
        }
        if (y > 1760) throw new Error('MEMOIR_TEXT_OVERFLOW')
        ctx.fillText(row, 112, y)
        y += 112
      }
      const jpg = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (blob) => blob?.type === 'image/jpeg' ? resolve(blob) : reject(new Error('JPEG_UNAVAILABLE')),
        'image/jpeg', 0.94,
      ))
      files.push({ name: `${number}-${title}.jpg`, bytes: new Uint8Array(await jpg.arrayBuffer()) })
      onProgress(index + 1)
    }
    return makeMemoirZip(files)
  } finally {
    canvas.width = canvas.height = 0
  }
}
