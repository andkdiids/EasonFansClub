import type { Prisma } from '@prisma/client'
import { publicImageUrl } from '@/lib/images'
import type { MyLivePhotoCategoryValue, MyLivePhotoView } from '@/lib/my-live-photo-types'

export type MyLivePhotoRow = {
  id: string
  category: MyLivePhotoCategoryValue
  imageUrl: string
  width: number
  height: number
  sortOrder: number
  watermarked: boolean
  createdAt: Date | string
}

export const myLivePhotoSelect = {
  id: true,
  category: true,
  imageUrl: true,
  width: true,
  height: true,
  sortOrder: true,
  watermarked: true,
  createdAt: true,
} satisfies Prisma.MyLivePhotoSelect

export const myLivePhotoOrderBy = [
  { sortOrder: 'asc' as const },
  { createdAt: 'asc' as const },
  { id: 'asc' as const },
]

export function serializeMyLivePhoto(photo: MyLivePhotoRow): MyLivePhotoView | null {
  const imageUrl = publicImageUrl(photo.imageUrl)
  if (!imageUrl) return null
  return {
    id: photo.id,
    category: photo.category,
    imageUrl,
    width: photo.width,
    height: photo.height,
    sortOrder: photo.sortOrder,
    watermarked: photo.watermarked,
  }
}

export function serializeMyLivePhotos(photos: readonly MyLivePhotoRow[]) {
  return [...photos]
    .sort((left, right) => left.sortOrder - right.sortOrder || new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() || left.id.localeCompare(right.id))
    .map(serializeMyLivePhoto)
    .filter((photo): photo is MyLivePhotoView => Boolean(photo))
}
