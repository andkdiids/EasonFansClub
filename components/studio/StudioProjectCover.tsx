'use client'

import { useState } from 'react'

type CoverProject = Readonly<{
  physicalCoverImage?: string | null
  thumbnailUrl?: string | null
}>

export function StudioProjectCover({ project, alt, imageClassName, patternClassName, patternCellClassName }: Readonly<{
  project: CoverProject
  alt: string
  imageClassName: string
  patternClassName: string
  patternCellClassName: string
}>) {
  const [physicalFailed, setPhysicalFailed] = useState(false)
  const [thumbnailFailed, setThumbnailFailed] = useState(false)
  const source = !physicalFailed ? project.physicalCoverImage : project.thumbnailUrl
  if (source && !(physicalFailed && thumbnailFailed)) {
    return <img src={source} alt={alt} className={imageClassName} loading="lazy" onError={() => physicalFailed ? setThumbnailFailed(true) : setPhysicalFailed(true)} />
  }
  return <span className={patternClassName} aria-label={`${alt}预览`}>{Array.from({ length: 100 }, (_, index) => <i key={index} className={patternCellClassName} />)}</span>
}
