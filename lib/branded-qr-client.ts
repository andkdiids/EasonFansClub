'use client'

import {
  BRANDED_QR_LIGHT_COLOR,
  BRANDED_QR_LOGO_PLATE_PADDING_PX,
  BRANDED_QR_LOGO_RATIO,
  createBrandedQrDataUrl,
} from '@/lib/branded-qr'

function loadImage(source: string, crossOrigin = true) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    if (crossOrigin) image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('BRANDED_QR_IMAGE_UNAVAILABLE'))
    image.src = source
  })
}

/**
 * Draw the shared QR matrix and then place the official logo as a separate
 * canvas layer. Keeping the logo out of the data-URI SVG avoids nested-image
 * CORS differences between Chromium, WebKit, and embedded WebViews.
 */
export async function drawBrandedQrToCanvas(canvas: HTMLCanvasElement, payload: string, size: number) {
  const outputSize = Math.max(1, Math.round(size))
  const qrImage = await loadImage(createBrandedQrDataUrl(payload, outputSize, { includeLogo: false }))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('BRANDED_QR_CANVAS_CONTEXT_UNAVAILABLE')

  canvas.width = outputSize
  canvas.height = outputSize
  context.clearRect(0, 0, outputSize, outputSize)
  context.imageSmoothingEnabled = false
  context.drawImage(qrImage, 0, 0, outputSize, outputSize)

  if (outputSize < 120) return
  let logo: HTMLImageElement
  try {
    logo = await loadImage(new URL('/icon.png', window.location.origin).toString())
  } catch {
    // The QR remains valid and usable if the optional visual logo asset is
    // unavailable in a transient offline/cache state.
    return
  }

  const logoSize = Math.round(outputSize * BRANDED_QR_LOGO_RATIO)
  const plateSize = logoSize + BRANDED_QR_LOGO_PLATE_PADDING_PX
  const logoX = (outputSize - logoSize) / 2
  const logoY = (outputSize - logoSize) / 2
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.fillStyle = BRANDED_QR_LIGHT_COLOR
  context.beginPath()
  context.arc(outputSize / 2, outputSize / 2, plateSize / 2, 0, Math.PI * 2)
  context.fill()
  context.drawImage(logo, logoX, logoY, logoSize, logoSize)
}
