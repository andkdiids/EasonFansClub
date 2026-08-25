import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getStorePacks, getStoreCategories } from '@/lib/sticker-center'
import { unauthenticatedResponse } from '@/lib/security'

export const dynamic = 'force-dynamic'

/**
 * 表情商店：列出所有已上架的表情包（按下载量排序）。
 * 支持：sort=hot|new|official，category=xxx，分页。
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse()

  const url = new URL(request.url)
  const sortRaw = url.searchParams.get('sort') || 'hot'
  const sort: 'hot' | 'new' | 'official' = ['hot', 'new', 'official'].includes(sortRaw) ? (sortRaw as 'hot' | 'new' | 'official') : 'hot'
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const pageSize = Math.min(60, Math.max(8, parseInt(url.searchParams.get('pageSize') || '24', 10) || 24))
  const category = url.searchParams.get('category') || null
  const includeCategories = url.searchParams.get('withCategories') === '1'

  try {
    const [{ packs, total }, categories] = await Promise.all([
      getStorePacks({ userId: user.id, page, pageSize, sort, category }),
      includeCategories ? getStoreCategories() : Promise.resolve([]),
    ])
    return NextResponse.json({ success: true, packs, total, page, pageSize, sort, category, categories })
  } catch (error) {
    console.error('[sticker.store]', error)
    return NextResponse.json({ message: '加载失败' }, { status: 500 })
  }
}
