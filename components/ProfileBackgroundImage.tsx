'use client'

import { useEffect, useRef, useState } from 'react'
import {
  profileBackgroundTransformStyle,
  type ProfileBackgroundDevice,
  type ProfileBackgroundGeometry,
  type ProfileBackgroundTransform,
} from '@/lib/profile-background'

function ProfileBackgroundLayer({
  sourceUrl,
  device,
  transform,
  className,
}: {
  sourceUrl: string
  device: ProfileBackgroundDevice
  transform?: ProfileBackgroundTransform | null
  className: string
}) {
  const layerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [geometry, setGeometry] = useState<ProfileBackgroundGeometry | null>(null)

  useEffect(() => {
    setGeometry(null)
    const layer = layerRef.current
    if (!layer) return

    const measure = () => {
      const image = imageRef.current
      const rect = layer.getBoundingClientRect()
      if (!image || image.naturalWidth <= 0 || image.naturalHeight <= 0 || rect.width <= 0 || rect.height <= 0) return
      const nextGeometry: ProfileBackgroundGeometry = {
        device,
        imageSize: { width: image.naturalWidth, height: image.naturalHeight },
        containerSize: { width: rect.width, height: rect.height },
      }
      setGeometry((current) => {
        if (
          current?.device === nextGeometry.device &&
          current.imageSize.width === nextGeometry.imageSize.width &&
          current.imageSize.height === nextGeometry.imageSize.height &&
          current.containerSize.width === nextGeometry.containerSize.width &&
          current.containerSize.height === nextGeometry.containerSize.height
        ) return current
        return nextGeometry
      })
    }

    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(layer)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [device, sourceUrl])

  return (
    <div ref={layerRef} className={className} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imageRef}
        src={sourceUrl}
        alt=""
        className="profile-background-image"
        style={profileBackgroundTransformStyle(transform || null, geometry)}
        onLoad={() => {
          const layer = layerRef.current
          const image = imageRef.current
          if (!layer || !image) return
          const rect = layer.getBoundingClientRect()
          if (image.naturalWidth <= 0 || image.naturalHeight <= 0 || rect.width <= 0 || rect.height <= 0) return
          setGeometry({
            device,
            imageSize: { width: image.naturalWidth, height: image.naturalHeight },
            containerSize: { width: rect.width, height: rect.height },
          })
        }}
        draggable={false}
      />
    </div>
  )
}

export function ProfileBackgroundImage({
  sourceUrl,
  desktopTransform,
  mobileTransform,
}: {
  sourceUrl: string | null
  desktopTransform?: ProfileBackgroundTransform | null
  mobileTransform?: ProfileBackgroundTransform | null
}) {
  if (!sourceUrl) return null

  return (
    <>
      <ProfileBackgroundLayer
        sourceUrl={sourceUrl}
        device="mobile"
        transform={mobileTransform}
        className="profile-background-layer profile-background-layer-mobile"
      />
      <ProfileBackgroundLayer
        sourceUrl={sourceUrl}
        device="desktop"
        transform={desktopTransform}
        className="profile-background-layer profile-background-layer-desktop"
      />
    </>
  )
}
