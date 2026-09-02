import type { IconName } from '@/components/UiIcon'

export const studioToolStatuses = ['AVAILABLE', 'BETA', 'COMING_SOON', 'DISABLED'] as const
export type StudioToolStatus = (typeof studioToolStatuses)[number]

export const studioCategories = ['image', 'design', 'support', 'utility', 'other'] as const
export type StudioToolCategory = (typeof studioCategories)[number]

export const studioExportFormats = ['PNG', 'JPEG', 'PDF', 'SVG'] as const
export type StudioExportFormat = (typeof studioExportFormats)[number]

export type StudioToolDefinition = {
  slug: string
  name: string
  description: string
  icon: IconName
  route: string
  category: StudioToolCategory
  status: StudioToolStatus
  enabled: boolean
  featured: boolean
  isNew: boolean
  isBeta: boolean
  requiresLogin: boolean
  supportsSave: boolean
  supportsShare: boolean
  supportsExport: boolean
  supportsCraftMode: boolean
  supportsMobile: boolean
  supportedExportFormats: readonly StudioExportFormat[]
  sortOrder: number
}

/**
 * The product name is deliberately kept out of these technical identifiers.
 * A future generator only needs to add a definition and its own module here.
 */
export const STUDIO_TOOLS: readonly StudioToolDefinition[] = [
  {
    slug: 'beads',
    name: '拼豆图纸',
    description: '把喜欢的画面，一颗一颗拼出来。',
    icon: 'palette',
    route: '/studio/beads',
    category: 'design',
    status: 'AVAILABLE',
    enabled: true,
    featured: true,
    isNew: true,
    isBeta: false,
    requiresLogin: false,
    supportsSave: true,
    supportsShare: true,
    supportsExport: true,
    supportsCraftMode: true,
    supportsMobile: true,
    supportedExportFormats: ['PNG', 'PDF'],
    sortOrder: 1,
  },
]

export function getStudioTool(slug: string | null | undefined) {
  return STUDIO_TOOLS.find((tool) => tool.slug === slug) || null
}

export function getVisibleStudioTools() {
  return STUDIO_TOOLS
    .filter((tool) => tool.enabled && tool.status !== 'DISABLED')
    .sort((left, right) => left.sortOrder - right.sortOrder)
}

export function getAvailableStudioTools() {
  return getVisibleStudioTools().filter((tool) => tool.status === 'AVAILABLE' || tool.status === 'BETA')
}

export function studioToolStatusLabel(status: StudioToolStatus) {
  if (status === 'BETA') return '测试版'
  if (status === 'COMING_SOON') return '即将上线'
  if (status === 'DISABLED') return '暂不可用'
  return '可使用'
}

export function studioCategoryLabel(category: StudioToolCategory) {
  if (category === 'image') return '图片'
  if (category === 'design') return '设计'
  if (category === 'support') return '应援'
  if (category === 'utility') return '实用工具'
  return '其他'
}
