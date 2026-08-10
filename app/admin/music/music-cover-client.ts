const MUSIC_COVER_BROWSER_MAX_WIDTH = 2000
const MUSIC_COVER_BROWSER_QUALITY = 0.82

function loadImage(objectUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片读取失败，请重新选择图片'))
    image.src = objectUrl
  })
}

function canvasToWebp(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('图片压缩失败，请重新选择图片或更换浏览器'))
    }, 'image/webp', MUSIC_COVER_BROWSER_QUALITY)
  })
}

export async function compressMusicCoverInBrowser(file: File) {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await loadImage(objectUrl)
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error('图片尺寸无效，请重新选择图片')
    }

    const scale = Math.min(1, MUSIC_COVER_BROWSER_MAX_WIDTH / image.naturalWidth)
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建图片处理画布')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, width, height)

    const blob = await canvasToWebp(canvas)
    const baseName = file.name.replace(/\.[^/.]+$/, '') || 'music-cover'
    return new File([blob], `${baseName}.webp`, {
      type: 'image/webp',
      lastModified: file.lastModified,
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
