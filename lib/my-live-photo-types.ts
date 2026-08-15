export const MY_LIVE_PHOTO_LIMITS = {
  TICKET: 2,
  LIVE: 6,
  TOTAL: 8,
} as const

export type MyLivePhotoCategoryValue = 'TICKET' | 'LIVE'

export type MyLivePhotoView = {
  id: string
  category: MyLivePhotoCategoryValue
  imageUrl: string
  width: number
  height: number
  sortOrder: number
  watermarked: boolean
}
