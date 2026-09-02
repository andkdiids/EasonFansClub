import type { StudioExportFormat } from './tools'

export type StudioVisibility = 'PRIVATE' | 'PUBLIC' | 'UNLISTED'
export type StudioReviewStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED'

export type StudioProjectData = {
  version: number
  tool: string
  [key: string]: unknown
}

export type StudioProjectSummary = {
  id: string
  toolSlug: string
  title: string
  description?: string | null
  version: number
  thumbnailUrl?: string | null
  likeCount?: number
  favoriteCount?: number
  viewCount?: number
  downloadCount?: number
  isLiked?: boolean
  isFavorited?: boolean
  visibility: StudioVisibility
  reviewStatus: StudioReviewStatus
  createdAt: string
  updatedAt: string
  lastOpenedAt?: string | null
  metadata?: {
    width?: number
    height?: number
    totalBeads?: number
    colorCount?: number
  }
}

export type StudioGallerySort = 'latest' | 'hot'

export type StudioGalleryProject = StudioProjectSummary & {
  author: string
}

export type StudioLocalProject = StudioProjectSummary & {
  data: StudioProjectData
  supportedExportFormats?: readonly StudioExportFormat[]
}

export type StudioRecentTool = {
  toolSlug: string
  event: 'tool_open' | 'project_create' | 'project_save' | 'project_open' | 'project_export' | 'project_publish'
  occurredAt: string
}
